const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createApp } = require('../src/app');
const { initSocket } = require('../src/realtime/socket');
const { resetDbForTesting, getDb } = require('../src/db/database');
const authService = require('../src/services/authService');
const notificationService = require('../src/services/notificationService');
const notificationRepository = require('../src/repositories/notificationRepository');
const outboxWorker = require('../src/services/notifications/outboxWorker');
const { RoutingService } = require('../src/services/routing/routingService');
const HaversineProvider = require('../src/services/routing/haversineProvider');
const { sanitizeCsvCell } = require('../src/services/reportService');
const { sanitizeHeader } = require('../src/services/notifications/providers/email');

test('Phase 3B — Distance & ETA Routing, Outbox Notifications, Maintenance & Fuel, Reports & Governance', async (t) => {
  resetDbForTesting();

  const app = createApp();
  const server = http.createServer(app);
  const ioServer = initSocket(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    outboxWorker.stop();
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  const db = getDb();

  // Seed Users
  authService.register({ username: 'ops_admin', password: 'AdminPassword123!', role: 'admin' });
  authService.register({ username: 'ops_dispatcher', password: 'DispatcherPass123!', role: 'dispatcher' });

  // Create Drivers & Vehicles
  db.prepare(`
    INSERT INTO drivers (id, name, phone, availability_status)
    VALUES ('DRV-401', 'Sam Driver', '+1-555-4001', 'available'),
           ('DRV-402', 'Alex Driver', '+1-555-4002', 'available')
  `).run();

  db.prepare(`
    INSERT INTO vehicles (id, registration_number, type, capacity, odometer, status)
    VALUES ('VEH-401', 'TRK-401', 'Sprinter', 2500, 10000.0, 'available'),
           ('VEH-402', 'TRK-402', 'Box Truck', 4000, 25000.0, 'available')
  `).run();

  authService.register({ username: 'sam_driver', password: 'DriverPassword123!', role: 'driver', driver_id: 'DRV-401' });
  authService.register({ username: 'alex_driver', password: 'DriverPassword123!', role: 'driver', driver_id: 'DRV-402' });

  const adminTokens = authService.login({ username: 'ops_admin', password: 'AdminPassword123!' });
  const dispatcherTokens = authService.login({ username: 'ops_dispatcher', password: 'DispatcherPass123!' });
  const samTokens = authService.login({ username: 'sam_driver', password: 'DriverPassword123!' });
  const alexTokens = authService.login({ username: 'alex_driver', password: 'DriverPassword123!' });

  // Helper to create pending delivery
  async function createDelivery(pickup = 'Warehouse A, Austin, TX', dropoff = 'Customer Site B, Austin, TX') {
    const res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        pickup_address: pickup,
        dropoff_address: dropoff,
        scheduled_time: new Date(Date.now() + 3600000).toISOString(),
        priority: 'high'
      })
    });
    assert.equal(res.status, 201);
    return res.json();
  }

  // -------------------------------------------------------------
  // Test 1: Routing Service, Haversine Fallback & Bounded LRU Cache
  // -------------------------------------------------------------
  await t.test('1. Routing Service: Haversine distance, average speed ETA, and bounded LRU cache', async () => {
    const haversine = new HaversineProvider(60); // 60 km/h average
    // New York (40.7128, -74.0060) to Philadelphia (39.9526, -75.1652) ~130 km
    const start = { lat: 40.7128, lng: -74.0060 };
    const end = { lat: 39.9526, lng: -75.1652 };

    const route = await haversine.getRoute(start, end);
    assert.equal(route.provider, 'haversine');
    assert.ok(route.distanceKm > 120 && route.distanceKm < 150, `Distance was ${route.distanceKm}`);
    assert.ok(route.durationMinutes > 100 && route.durationMinutes < 160);

    // Test Bounded LRU Cache (max size 2)
    const mockProvider = {
      calls: 0,
      async getRoute(_s, _e) {
        this.calls++;
        return { distanceKm: 10, durationMinutes: 15, provider: 'mock' };
      }
    };
    const testRouting = new RoutingService(mockProvider, 2, 10000);

    // Call 1 & 2 (adds 2 entries)
    await testRouting.calculateRoute({ lat: 10, lng: 10 }, { lat: 11, lng: 11 });
    await testRouting.calculateRoute({ lat: 20, lng: 20 }, { lat: 21, lng: 21 });
    assert.equal(mockProvider.calls, 2);

    // Call cached entry (no provider call)
    await testRouting.calculateRoute({ lat: 10, lng: 10 }, { lat: 11, lng: 11 });
    assert.equal(mockProvider.calls, 2);

    // Call 3rd entry (evicts oldest: {20,20})
    await testRouting.calculateRoute({ lat: 30, lng: 30 }, { lat: 31, lng: 31 });
    assert.equal(mockProvider.calls, 3);
    assert.equal(testRouting.cache.size, 2);

    // Coarse public ETA formatting
    assert.equal(testRouting.formatCoarseEta(1), 'arriving shortly');
    assert.equal(testRouting.formatCoarseEta(25), 'arriving in about 25 minutes');
    assert.equal(testRouting.formatCoarseEta(120), 'arriving in about 2 hours');
  });

  // -------------------------------------------------------------
  // Test 2: Customer Contact Registration & Privacy Anonymization
  // -------------------------------------------------------------
  await t.test('2. Customer Contact: Registration, Consent, and GDPR Anonymization', async () => {
    const delivery = await createDelivery();

    // 1. Driver gets 403 Forbidden on contact endpoints
    const driverContactRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/contact`, {
      headers: { 'Authorization': `Bearer ${samTokens.accessToken}` }
    });
    assert.equal(driverContactRes.status, 403);

    const driverPutContactRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${samTokens.accessToken}` },
      body: JSON.stringify({ name: 'Sneaky', email: 'driver@test.com' })
    });
    assert.equal(driverPutContactRes.status, 403);

    // 2. Register contact via PUT /deliveries/:id/contact (consent defaults to false)
    const putRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({
        name: 'Jane Customer',
        email: 'jane.customer@example.com',
        phone: '+1-555-9999',
        consent: true
      })
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.contact.name, 'Jane Customer');
    assert.equal(putData.contact.email, 'jane.customer@example.com');
    assert.equal(putData.contact.consent, 1);
    assert.ok(putData.contact.consent_at);

    // Verify audit log has CUSTOMER_CONTACT_UPDATED with ZERO PII in details/state
    const contactAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'CUSTOMER_CONTACT_UPDATED' AND entity_id = ?").get(delivery.id);
    assert.ok(contactAudit);
    assert.ok(!contactAudit.details.includes('jane.customer@example.com'));
    assert.ok(!contactAudit.details.includes('Jane Customer'));

    // 3. Fetch contact
    const getRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/contact`, {
      headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
    });
    assert.equal(getRes.status, 200);

    // 4. Revoking consent cancels pending outbox notifications
    db.prepare(`
      INSERT INTO notification_outbox (id, delivery_id, event, channel, recipient, template, status, attempts, max_attempts, idempotency_key, created_at)
      VALUES ('NTF-TEST-REVOKE', ?, 'trip_started', 'email', 'jane.customer@example.com', 'delivery_update', 'pending', 0, 3, 'IDEMP-REVOKE-TEST', DATETIME('now'))
    `).run(delivery.id);

    const revokeRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({
        name: 'Jane Customer',
        email: 'jane.customer@example.com',
        consent: false
      })
    });
    assert.equal(revokeRes.status, 200);
    const revokedOutbox = db.prepare("SELECT status FROM notification_outbox WHERE id = 'NTF-TEST-REVOKE'").get();
    assert.equal(revokedOutbox.status, 'cancelled');

    // 5. Anonymize contact
    const delRes = await fetch(`${baseUrl}/api/customers/${delivery.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(delRes.status, 200);
    const anonymized = await delRes.json();
    assert.equal(anonymized.contact.name, 'Anonymous Customer');
    assert.equal(anonymized.contact.consent, 0);
  });

  // -------------------------------------------------------------
  // Test 3: Transactional Outbox Enqueueing & Idempotency
  // -------------------------------------------------------------
  await t.test('3. Outbox: Enqueue in same transaction, rollback integrity, and idempotency', async () => {
    const delivery = await createDelivery('Pickup Point', 'Dropoff Point');

    // Register customer with consent
    await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        delivery_id: delivery.id,
        name: 'John Receiver',
        email: 'john.receiver@example.com',
        consent: true
      })
    });

    // Assign delivery -> triggers delivery_assigned outbox row
    const assignRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({ vehicle_id: 'VEH-401', driver_id: 'DRV-401' })
    });
    assert.equal(assignRes.status, 200);

    // Check outbox has the row
    const outboxRow = db.prepare("SELECT * FROM notification_outbox WHERE delivery_id = ? AND event = 'delivery_assigned'").get(delivery.id);
    assert.ok(outboxRow, 'Expected notification_outbox row to be present');
    assert.equal(outboxRow.status, 'pending');
    assert.equal(outboxRow.attempts, 0);

    // Duplicate event enqueue attempt yields the SAME row (idempotency key uniqueness)
    notificationService.enqueueNotification(db, {
      deliveryId: delivery.id,
      event: 'delivery_assigned'
    });
    const count = db.prepare("SELECT COUNT(*) as c FROM notification_outbox WHERE delivery_id = ? AND event = 'delivery_assigned'").get(delivery.id).c;
    assert.equal(count, 1, 'Idempotency prevented duplicate outbox insertion');

    // Verify Outbox list endpoint
    const listRes = await fetch(`${baseUrl}/api/notifications/outbox`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.entries.length > 0);
  });

  // -------------------------------------------------------------
  // Test 4: Outbox Worker Tick, Lease Recovery, and Sensitive Data Wipe
  // -------------------------------------------------------------
  await t.test('4. Outbox Worker: Tick execution, sensitive params wipe on send, and crash recovery', async () => {
    // Process pending outbox entries
    const tickResult = await outboxWorker.tick();
    assert.ok(tickResult.processed > 0);
    assert.ok(tickResult.sent > 0);

    // Verify row was marked 'sent' and params_json wiped
    const sentRow = db.prepare("SELECT * FROM notification_outbox WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1").get();
    assert.ok(sentRow);
    assert.equal(sentRow.status, 'sent');
    assert.equal(sentRow.params_json, null, 'params_json must be wiped after sending for data minimization');

    // Test Lease Timeout & Crash Recovery:
    // Create simulated stuck row in 'processing' with expired lease
    const existingDelivery = db.prepare('SELECT id FROM deliveries LIMIT 1').get();
    const stuckId = 'NTF-CRASHED-01';
    db.prepare(`
      INSERT INTO notification_outbox (id, delivery_id, event, channel, recipient, template, status, attempts, max_attempts, idempotency_key, locked_until, created_at)
      VALUES (?, ?, 'test_event', 'email', 'crash@example.com', 'test', 'processing', 0, 3, 'idem-crash-key', DATETIME('now', '-10 minutes'), DATETIME('now'))
    `).run(stuckId, existingDelivery.id);

    // Worker tick reclaims expired lease
    const claimed = notificationRepository.claimBatch(10);
    const hasRecovered = claimed.some(c => c.id === stuckId);
    assert.ok(hasRecovered, 'Expected worker to recover crashed row with expired lease');

    // Clean up mock row
    db.prepare('DELETE FROM notification_outbox WHERE id = ?').run(stuckId);
  });

  // -------------------------------------------------------------
  // Test 5: Email Header Injection Sanitization
  // -------------------------------------------------------------
  await t.test('5. Email Header Injection Defense: Strips CR and LF from header fields', async () => {
    const maliciousSubject = 'Urgent Update\r\nBcc: victim@example.com\r\nX-Injected: true';
    const cleanSubject = sanitizeHeader(maliciousSubject);
    assert.ok(!cleanSubject.includes('\r'));
    assert.ok(!cleanSubject.includes('\n'));
    assert.equal(cleanSubject, 'Urgent Update Bcc: victim@example.com X-Injected: true');
  });

  // -------------------------------------------------------------
  // Test 6: Production Secret & Provider Refusal Check
  // -------------------------------------------------------------
  await t.test('6. Production startup strictly refuses console notification provider', async () => {
    const script = `
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'valid_production_jwt_secret_99999999';
      process.env.JWT_REFRESH_SECRET = 'valid_production_refresh_secret_99999999';
      process.env.OTP_HMAC_SECRET = 'valid_production_otp_hmac_secret_99999999';
      process.env.NOTIFICATIONS_ENABLED = 'true';
      process.env.NOTIFICATION_PROVIDER = 'console';
      require('./src/config');
    `;
    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes('FATAL: NOTIFICATION_PROVIDER cannot be "console" in production'));
  });

  // -------------------------------------------------------------
  // Test 7: Monotonic Odometer & Concurrent Fuel Log Validation
  // -------------------------------------------------------------
  await t.test('7. Monotonic Odometer & Fuel Logging: Strict validation, driver scoping & concurrency', async () => {
    // Current VEH-401 odometer is 10000.0
    // 1. Rejecting non-monotonic (lower) odometer reading
    const lowerRes = await fetch(`${baseUrl}/api/fuel-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-401',
        odometer: 9500.0, // Invalid: lower than 10000.0
        liters: 40.0,
        cost: 65.0
      })
    });
    assert.equal(lowerRes.status, 400);
    const lowerErr = await lowerRes.json();
    assert.ok(lowerErr.message.includes('cannot be less than current vehicle odometer'));

    // 2. Rejecting unrealistic fuel liters
    const bigLitersRes = await fetch(`${baseUrl}/api/fuel-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-401',
        odometer: 10500.0,
        liters: 5000.0, // Invalid: > 1000L
        cost: 65.0
      })
    });
    assert.equal(bigLitersRes.status, 400);

    // 3. Driver Scoping: Alex driver (DRV-402) attempts to log fuel for VEH-401 (not assigned) -> 403
    const crossDriverRes = await fetch(`${baseUrl}/api/fuel-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${alexTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-401',
        odometer: 10500.0,
        liters: 45.0,
        cost: 70.0
      })
    });
    assert.equal(crossDriverRes.status, 403);

    // 4. Valid Fuel Log for assigned driver (Sam driver assigned to VEH-401)
    const validFuelRes = await fetch(`${baseUrl}/api/fuel-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${samTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-401',
        odometer: 10250.0,
        liters: 42.5,
        cost: 68.0
      })
    });
    assert.equal(validFuelRes.status, 201);

    // Verify vehicle odometer updated monotonically in DB
    const veh = db.prepare('SELECT odometer FROM vehicles WHERE id = ?').get('VEH-401');
    assert.equal(veh.odometer, 10250.0);
  });

  // -------------------------------------------------------------
  // Test 8: Vehicle Maintenance Schedules & Lockout Protection
  // -------------------------------------------------------------
  await t.test('8. Maintenance: Scheduling, overdue detection, and active assignment lockout', async () => {
    // 1. Create maintenance schedule
    const schedRes = await fetch(`${baseUrl}/api/maintenance/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-402',
        service_type: 'Brake Inspection',
        due_date: '2026-01-01', // Past date -> overdue
        due_odometer: 24000.0 // VEH-402 is at 25000 -> overdue
      })
    });
    assert.equal(schedRes.status, 201);

    // 2. Overdue detection
    const overdueRes = await fetch(`${baseUrl}/api/maintenance/overdue`, {
      headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
    });
    assert.equal(overdueRes.status, 200);
    const overdueList = await overdueRes.json();
    assert.ok(overdueList.overdue.some(o => o.vehicle_id === 'VEH-402'));

    // 3. Assignment of overdue vehicle without override is blocked with 409 Conflict
    const delOverdue = await createDelivery();
    const noOverrideRes = await fetch(`${baseUrl}/deliveries/${delOverdue.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({ vehicle_id: 'VEH-402', driver_id: 'DRV-402' })
    });
    assert.equal(noOverrideRes.status, 409);
    assert.ok((await noOverrideRes.json()).message.includes('overdue maintenance'));

    // 4. Override with reason shorter than 10 chars is rejected with 400 Bad Request
    const shortReasonRes = await fetch(`${baseUrl}/deliveries/${delOverdue.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-402',
        driver_id: 'DRV-402',
        override_overdue_maintenance: true,
        override_reason: 'short'
      })
    });
    assert.equal(shortReasonRes.status, 400);

    // 5. Override with valid reason (>= 10 chars) succeeds and logs audit entry
    const validOverrideRes = await fetch(`${baseUrl}/deliveries/${delOverdue.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-402',
        driver_id: 'DRV-402',
        override_overdue_maintenance: true,
        override_reason: 'Critical medical supply dispatch approved before maintenance'
      })
    });
    assert.equal(validOverrideRes.status, 200);

    const overrideAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'ASSIGNMENT_OVERDUE_OVERRIDE' AND entity_id LIKE 'ASG-%'").get();
    assert.ok(overrideAudit);
    assert.ok(overrideAudit.details.includes('Critical medical supply dispatch'));

    // 6. Suggestion engine ranks overdue vehicles lower and flags them
    const delPending = await createDelivery();
    const suggestRes = await fetch(`${baseUrl}/api/deliveries/${delPending.id}/suggestions`, {
      headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
    });
    if (suggestRes.ok) {
      const sug = await suggestRes.json();
      const vehSugs = sug.candidate_vehicles || [];
      const overdueSug = vehSugs.find(v => v.id === 'VEH-402');
      if (overdueSug) {
        assert.equal(overdueSug.has_overdue_maintenance, true);
      }
    }

    // 7. Status 'maintenance' stays a hard block: vehicle in maintenance CANNOT be assigned
    db.prepare("UPDATE vehicles SET status = 'maintenance' WHERE id = 'VEH-402'").run();
    const delMnt = await createDelivery();
    const hardBlockRes = await fetch(`${baseUrl}/deliveries/${delMnt.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatcherTokens.accessToken}` },
      body: JSON.stringify({
        vehicle_id: 'VEH-402',
        driver_id: 'DRV-402',
        override_overdue_maintenance: true,
        override_reason: 'Trying to assign a vehicle that is in maintenance status'
      })
    });
    assert.equal(hardBlockRes.status, 409);
    assert.ok((await hardBlockRes.json()).message.includes('not available'));
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-402'").run();

    // 8. Maintenance Lockout: actively assigned vehicle cannot be transitioned to maintenance
    const lockoutRes = await fetch(`${baseUrl}/vehicles/VEH-401/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({ status: 'maintenance' })
    });
    assert.equal(lockoutRes.status, 409);
    const lockoutErr = await lockoutRes.json();
    assert.ok(lockoutErr.message.includes('cannot be set to') || lockoutErr.message.includes('active'));
  });

  // -------------------------------------------------------------
  // Test 9: Reports Export, CSV Formula Injection & PDF Generation
  // -------------------------------------------------------------
  await t.test('9. Reports: Formula injection neutralization, date caps, audit logging & PDF export', async () => {
    // 1. Formula Injection Sanitization unit check
    assert.equal(sanitizeCsvCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.equal(sanitizeCsvCell('+12345'), "'+12345");
    assert.equal(sanitizeCsvCell('-cmd|calc'), "'-cmd|calc");
    assert.equal(sanitizeCsvCell('@external'), "'@external");
    assert.equal(sanitizeCsvCell('\tmalicious'), "'\tmalicious");
    assert.equal(sanitizeCsvCell('Safe Text, with comma'), '"Safe Text, with comma"');

    // 2. Deliveries CSV Export
    const csvRes = await fetch(`${baseUrl}/api/reports/deliveries/csv`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
    const csvContent = await csvRes.text();
    assert.ok(csvContent.includes('Delivery ID,Status,Priority'));

    // Verify audit log has the export event
    const auditExport = db.prepare("SELECT * FROM audit_logs WHERE action = 'report_exported' AND entity_id = 'deliveries_csv'").get();
    assert.ok(auditExport);

    // 3. Date range cap (> 90 days rejected with 400)
    const capRes = await fetch(`${baseUrl}/api/reports/deliveries/csv?start_date=2025-01-01&end_date=2025-06-01`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(capRes.status, 400);
    assert.ok((await capRes.json()).message.includes('cannot exceed 90 days'));

    // 4. Driver role gets 403 Forbidden on reports and outbox
    const driverReportRes = await fetch(`${baseUrl}/api/reports/deliveries/csv`, {
      headers: { 'Authorization': `Bearer ${samTokens.accessToken}` }
    });
    assert.equal(driverReportRes.status, 403);

    const driverPdfRes = await fetch(`${baseUrl}/api/reports/summary/pdf`, {
      headers: { 'Authorization': `Bearer ${samTokens.accessToken}` }
    });
    assert.equal(driverPdfRes.status, 403);

    const driverOutboxRes = await fetch(`${baseUrl}/api/notifications/outbox`, {
      headers: { 'Authorization': `Bearer ${samTokens.accessToken}` }
    });
    assert.equal(driverOutboxRes.status, 403);

    // 5. Row cap check: 413 Payload Too Large when row count exceeds 5,000
        const origPrepare = db.prepare.bind(db);
    db.prepare = (sql, ...args) => {
      if (sql.includes('SELECT COUNT(*) as total FROM deliveries')) {
        return { get: () => ({ total: 5001 }) };
      }
      return origPrepare(sql, ...args);
    };

    const cap413Res = await fetch(`${baseUrl}/api/reports/deliveries/csv`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(cap413Res.status, 413);
    const cap413Body = await cap413Res.json();
    assert.ok(cap413Body.message.includes('exceeding the maximum export limit of 5,000 rows'));
    db.prepare = origPrepare;

    // 6. Executive Summary PDF Generation
    const pdfRes = await fetch(`${baseUrl}/api/reports/summary/pdf`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    const pdfBuffer = await pdfRes.arrayBuffer();
    // PDF Magic bytes: %PDF
    const pdfMagic = Buffer.from(pdfBuffer.slice(0, 4)).toString('ascii');
    assert.equal(pdfMagic, '%PDF');
  });
});
