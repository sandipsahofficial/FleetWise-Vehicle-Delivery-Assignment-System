const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { getDb, resetDbForTesting } = require('../src/db/database');

test('Phase 8 — Final Acceptance Demonstration Sequence', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  let vehicleId;
  let driverId;
  let deliveryId1;
  let deliveryId2;
  let deliveryId3;

  // Step 1: Create a vehicle, driver, and delivery
  await t.test('Step 1: Create a vehicle, driver, and delivery', async () => {
    // 1. Vehicle
    const vRes = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': 'fleet_manager' },
      body: JSON.stringify({
        registration_number: 'DEMO-V100',
        type: 'Mercedes Sprinter Van',
        capacity: 1500,
        status: 'available'
      })
    });
    assert.equal(vRes.status, 201);
    const vBody = await vRes.json();
    assert.equal(vBody.registration_number, 'DEMO-V100');
    assert.equal(vBody.status, 'available');
    vehicleId = vBody.id;

    // 2. Driver
    const dRes = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': 'fleet_manager' },
      body: JSON.stringify({
        name: 'Jordan Hayes',
        phone: '+1-555-0812',
        availability_status: 'available'
      })
    });
    assert.equal(dRes.status, 201);
    const dBody = await dRes.json();
    assert.equal(dBody.name, 'Jordan Hayes');
    assert.equal(dBody.availability_status, 'available');
    driverId = dBody.id;

    // 3. Delivery
    const delRes = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': 'dispatcher' },
      body: JSON.stringify({
        pickup_address: 'Port Authority Cargo Terminal, Gate 4',
        dropoff_address: 'Downtown Medical Distribution Center, Bay 2',
        scheduled_time: '2026-11-05T09:30:00Z',
        priority: 'high',
        required_capacity: 800,
        required_vehicle_type: 'Van'
      })
    });
    assert.equal(delRes.status, 201);
    const delBody = await delRes.json();
    assert.equal(delBody.status, 'pending');
    deliveryId1 = delBody.id;
  });

  // Step 2: Assign the available resources successfully
  await t.test('Step 2: Assign the available resources successfully', async () => {
    const assignRes = await fetch(`${baseUrl}/deliveries/${deliveryId1}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': 'dispatcher' },
      body: JSON.stringify({
        vehicle_id: vehicleId,
        driver_id: driverId
      })
    });
    assert.equal(assignRes.status, 200);
    const assignBody = await assignRes.json();
    assert.equal(assignBody.delivery.status, 'assigned');
    assert.equal(assignBody.delivery.assignment.vehicle.id, vehicleId);
    assert.equal(assignBody.delivery.assignment.driver.id, driverId);

    // Verify DB states atomically updated
    const v = await (await fetch(`${baseUrl}/vehicles/${vehicleId}`)).json();
    const d = await (await fetch(`${baseUrl}/drivers/${driverId}`)).json();
    assert.equal(v.status, 'assigned');
    assert.equal(d.availability_status, 'assigned');
  });

  // Step 3: Attempt to reuse the same vehicle and show the rejection
  await t.test('Step 3: Attempt to reuse the same vehicle and show the rejection', async () => {
    // Create second driver & second delivery
    const d2Res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor Swift-Driver', phone: '+1-555-0813' })
    });
    const d2 = await d2Res.json();

    const del2Res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Suburban Depot',
        dropoff_address: 'City Center Mall',
        scheduled_time: '2026-11-05T11:00:00Z',
        priority: 'medium'
      })
    });
    const del2 = await del2Res.json();
    deliveryId2 = del2.id;

    // Attempt assignment with occupied vehicleId
    const rejectRes = await fetch(`${baseUrl}/deliveries/${deliveryId2}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: vehicleId,
        driver_id: d2.id
      })
    });
    assert.equal(rejectRes.status, 409);
    const errBody = await rejectRes.json();
    assert.equal(errBody.error, 'ConflictError');
    assert.match(errBody.message, /not available for assignment/i);
  });

  // Step 4: Attempt to reuse the same driver and show the rejection
  await t.test('Step 4: Attempt to reuse the same driver and show the rejection', async () => {
    // Create second vehicle
    const v2Res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'DEMO-V200', type: 'Van', capacity: 2000 })
    });
    const v2 = await v2Res.json();

    // Attempt assignment with occupied driverId
    const rejectRes = await fetch(`${baseUrl}/deliveries/${deliveryId2}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: v2.id,
        driver_id: driverId
      })
    });
    assert.equal(rejectRes.status, 409);
    const errBody = await rejectRes.json();
    assert.equal(errBody.error, 'ConflictError');
    assert.match(errBody.message, /not available for assignment/i);
  });

  // Step 5: Complete the original delivery
  await t.test('Step 5: Complete the original delivery', async () => {
    // Step 5a: Dispatch to in_transit
    const transitRes = await fetch(`${baseUrl}/deliveries/${deliveryId1}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(transitRes.status, 200);
    assert.equal((await transitRes.json()).delivery.status, 'in_transit');

    // Step 5b: Mark delivered
    const deliveredRes = await fetch(`${baseUrl}/deliveries/${deliveryId1}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(deliveredRes.status, 200);
    const delBody = await deliveredRes.json();
    assert.equal(delBody.delivery.status, 'delivered');

    // Verify safe resource release
    const v = await (await fetch(`${baseUrl}/vehicles/${vehicleId}`)).json();
    const d = await (await fetch(`${baseUrl}/drivers/${driverId}`)).json();
    assert.equal(v.status, 'available');
    assert.equal(d.availability_status, 'available');
    assert.equal(v.active_delivery, null);
    assert.equal(d.active_delivery, null);
  });

  // Step 6: Demonstrate that eligible resources can be assigned again
  await t.test('Step 6: Demonstrate that eligible resources can be assigned again', async () => {
    // Assign deliveryId2 with the newly freed vehicleId and driverId
    const reassignRes = await fetch(`${baseUrl}/deliveries/${deliveryId2}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: vehicleId,
        driver_id: driverId
      })
    });
    assert.equal(reassignRes.status, 200);
    const reassignBody = await reassignRes.json();
    assert.equal(reassignBody.delivery.status, 'assigned');
    assert.equal(reassignBody.delivery.assignment.vehicle.id, vehicleId);
    assert.equal(reassignBody.delivery.assignment.driver.id, driverId);

    // Verify resources are occupied once more
    const v = await (await fetch(`${baseUrl}/vehicles/${vehicleId}`)).json();
    const d = await (await fetch(`${baseUrl}/drivers/${driverId}`)).json();
    assert.equal(v.status, 'assigned');
    assert.equal(d.availability_status, 'assigned');
  });

  // Step 7: Show test evidence and confirm the database remains consistent
  await t.test('Step 7: Show test evidence and confirm the database remains consistent', async () => {
    const db = getDb();

    // 1. Verify assignments table has exactly 1 active assignment for vehicleId
    const activeVeh = db.prepare('SELECT COUNT(*) AS count FROM assignments WHERE vehicle_id = ? AND is_active = 1').get(vehicleId);
    assert.equal(activeVeh.count, 1);

    // 2. Verify assignments table has exactly 1 inactive assignment (from deliveryId1)
    const inactiveAssign = db.prepare('SELECT COUNT(*) AS count FROM assignments WHERE delivery_id = ? AND is_active = 0 AND released_at IS NOT NULL').get(deliveryId1);
    assert.equal(inactiveAssign.count, 1);

    // 3. Verify total deliveries count and breakdown
    const stats = await (await fetch(`${baseUrl}/api/dashboard/stats`)).json();
    assert.equal(stats.deliveries.completed, 1);
    assert.equal(stats.deliveries.assigned, 1);
    assert.equal(stats.deliveries.pending, 0);

    // 4. Verify audit trail logs all steps
    const auditRes = await (await fetch(`${baseUrl}/api/audit-logs`)).json();
    assert.ok(auditRes.count >= 7);
  });
});

