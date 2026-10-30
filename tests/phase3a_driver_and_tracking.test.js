const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { initSocket } = require('../src/realtime/socket');
const { resetDbForTesting, getDb } = require('../src/db/database');
const authService = require('../src/services/authService');
const proofRepository = require('../src/repositories/proofRepository');
const trackingRepository = require('../src/repositories/trackingRepository');

test('Phase 3A — Driver Mobile View, Proof of Delivery (OTP/Photo), Concurrency & Customer Tracking', async (t) => {
  resetDbForTesting();

  const app = createApp();
  const server = http.createServer(app);
  const ioServer = initSocket(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  const db = getDb();

  // Seed Users
  authService.register({ username: 'super_admin', password: 'AdminPassword123!', role: 'admin' });
  authService.register({ username: 'dispatcher_dan', password: 'DispatcherPass123!', role: 'dispatcher' });

  // Create Drivers
  db.prepare(`
    INSERT INTO drivers (id, name, phone, availability_status)
    VALUES ('DRV-301', 'Driver One', '+1-555-3001', 'available'),
           ('DRV-302', 'Driver Two', '+1-555-3002', 'available')
  `).run();

  // Create Vehicles
  db.prepare(`
    INSERT INTO vehicles (id, registration_number, type, capacity, status)
    VALUES ('VEH-301', 'VAN-301', 'Sprinter', 2000, 'available'),
           ('VEH-302', 'VAN-302', 'Sprinter', 2000, 'available')
  `).run();

  // Register Driver Users
  authService.register({ username: 'driver_one', password: 'DriverPassword123!', role: 'driver', driver_id: 'DRV-301' });
  authService.register({ username: 'driver_two', password: 'DriverPassword123!', role: 'driver', driver_id: 'DRV-302' });

  // Login
  const adminTokens = authService.login({ username: 'super_admin', password: 'AdminPassword123!' });
  const dispatcherTokens = authService.login({ username: 'dispatcher_dan', password: 'DispatcherPass123!' });
  const driver1Tokens = authService.login({ username: 'driver_one', password: 'DriverPassword123!' });
  const driver2Tokens = authService.login({ username: 'driver_two', password: 'DriverPassword123!' });

  // Helper to create & assign delivery
  async function createAndAssign(pickup = '100 Main St', dropoff = '200 Market St') {
    db.prepare("UPDATE assignments SET is_active = 0 WHERE vehicle_id = 'VEH-301' OR driver_id = 'DRV-301'").run();
    db.prepare("UPDATE deliveries SET status = 'cancelled' WHERE id IN (SELECT delivery_id FROM assignments WHERE vehicle_id = 'VEH-301' OR driver_id = 'DRV-301')").run();
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const createRes = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({
        pickup_address: pickup,
        dropoff_address: dropoff,
        scheduled_time: new Date(Date.now() + 3600000).toISOString(),
        priority: 'high'
      })
    });
    assert.equal(createRes.status, 201);
    const del = await createRes.json();

    const assignRes = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({ vehicle_id: 'VEH-301', driver_id: 'DRV-301' })
    });
    assert.equal(assignRes.status, 200);
    return (await assignRes.json()).delivery;
  }

  // -------------------------------------------------------------
  // Test 1: Driver PATCH status=delivered without proof is blocked
  // -------------------------------------------------------------
  await t.test('1. Driver PATCH status=delivered without proof is strictly blocked with 403', async () => {
    const delivery = await createAndAssign('Point A', 'Point B');

    // Driver starts trip (assigned -> in_transit is allowed)
    const startRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(startRes.status, 200);

    // Driver attempts to PATCH status=delivered directly
    const patchDeliveredRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(patchDeliveredRes.status, 403);
    const err = await patchDeliveredRes.json();
    assert.ok(err.message.includes('complete-otp or complete-photo'));

    // Admin can override with audit reason
    const adminOverrideRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTokens.accessToken}` },
      body: JSON.stringify({ status: 'delivered', reason: 'Customer accepted delivery via paper signature' })
    });
    assert.equal(adminOverrideRes.status, 200);

    // Verify audit log has the override reason
    const auditStmt = db.prepare("SELECT details FROM audit_logs WHERE entity_id = ? AND action = 'status_changed' ORDER BY rowid DESC LIMIT 1").get(delivery.id);
    assert.ok(auditStmt && auditStmt.details && auditStmt.details.includes('Customer accepted delivery via paper signature'));
  });

  // -------------------------------------------------------------
  // Test 2: OTP Generation, Verification, Expiry & 5-Attempt Lockout
  // -------------------------------------------------------------
  await t.test('2. OTP Generation, Verification, 5-Attempt Lockout & Regeneration', async () => {
    // Reset vehicle and driver status for new delivery
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const delivery = await createAndAssign('Point C', 'Point D');

    // Driver starts trip -> triggers OTP generation
    await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'in_transit' })
    });

    // Dispatcher gets the plain OTP once
    const regenRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/otp/regenerate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
    });
    assert.equal(regenRes.status, 200);
    const regenData = await regenRes.json();
    const correctOtp = regenData.otp;
    assert.match(correctOtp, /^\d{6}$/);

    // Fail 4 times with incorrect OTP
    for (let i = 1; i <= 4; i++) {
      const failRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
        body: JSON.stringify({ otp: '000000' })
      });
      assert.equal(failRes.status, 400);
      const failData = await failRes.json();
      assert.ok(failData.message.includes(`${5 - i} attempt(s) remaining`));
    }

    // 5th failure: locks the OTP
    const fifthFail = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ otp: '000000' })
    });
    assert.equal(fifthFail.status, 403);
    assert.ok((await fifthFail.json()).message.includes('locked'));

    // Even correct OTP is now rejected because it is locked
    const lockedRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ otp: correctOtp })
    });
    assert.equal(lockedRes.status, 403);

    // Admin regenerates OTP -> resets attempts and unlocks
    const unlockRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/otp/regenerate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(unlockRes.status, 200);
    const newOtp = (await unlockRes.json()).otp;

    // Driver enters new valid OTP
    const successRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ otp: newOtp, lat: 40.7128, lng: -74.0060 })
    });
    assert.equal(successRes.status, 200);
    const successData = await successRes.json();
    assert.equal(successData.delivery.status, 'delivered');

    // Resources released
    const vCheck = db.prepare('SELECT status FROM vehicles WHERE id = ?').get('VEH-301');
    assert.equal(vCheck.status, 'available');
  });

  // -------------------------------------------------------------
  // Test 3: OTP and Token hashes NEVER appear in any API response
  // -------------------------------------------------------------
  await t.test('3. OTP/Token hashes never appear in any API response', async () => {
    // Check GET /deliveries
    const listRes = await fetch(`${baseUrl}/deliveries`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    const listText = await listRes.text();
    assert.ok(!listText.includes('otp_hash'));
    assert.ok(!listText.includes('token_hash'));

    // Check GET /deliveries/:id
    const dRes = await fetch(`${baseUrl}/deliveries/1`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    const dText = await dRes.text();
    assert.ok(!dText.includes('otp_hash'));
    assert.ok(!dText.includes('token_hash'));
  });

  // -------------------------------------------------------------
  // Test 4: Photo Proof Upload, Magic Bytes (WebP RIFF..WEBP), Size Limit & Ownership
  // -------------------------------------------------------------
  await t.test('4. Photo Proof Upload, Magic Bytes, 5MB Limit & Ownership Check', async () => {
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const delivery = await createAndAssign('Warehouse A', 'Store B');

    // Start trip
    await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'in_transit' })
    });

    // 1. Reject fake image (text file disguised as image)
    const fakeForm = new FormData();
    fakeForm.append('photo', new Blob(['hello world fake image content'], { type: 'image/jpeg' }), 'fake.jpg');
    const fakeRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-photo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: fakeForm
    });
    assert.equal(fakeRes.status, 400);
    assert.ok((await fakeRes.json()).message.includes('not a valid JPEG, PNG, or WebP'));

    // 2. Reject oversized file > 5MB
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    // Add JPEG magic bytes at head
    bigBuffer[0] = 0xFF; bigBuffer[1] = 0xD8; bigBuffer[2] = 0xFF;
    const bigForm = new FormData();
    bigForm.append('photo', new Blob([bigBuffer], { type: 'image/jpeg' }), 'big.jpg');
    const bigRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-photo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: bigForm
    });
    assert.equal(bigRes.status, 400);

    // 3. Valid WebP image with RIFF....WEBP magic bytes
    const webpBuffer = Buffer.alloc(32);
    webpBuffer.write('RIFF', 0, 'ascii');
    webpBuffer.writeUInt32LE(24, 4);
    webpBuffer.write('WEBP', 8, 'ascii');
    webpBuffer.write('VP8 ', 12, 'ascii');

    const validForm = new FormData();
    validForm.append('photo', new Blob([webpBuffer], { type: 'image/webp' }), 'proof.webp');
    validForm.append('lat', '40.7300');
    validForm.append('lng', '-73.9900');

    const validRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-photo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: validForm
    });
    assert.equal(validRes.status, 200);

    // 4. Driver 2 cannot access Driver 1's proof photo (403)
    const unauthorizedPhotoRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/proof/photo`, {
      headers: { 'Authorization': `Bearer ${driver2Tokens.accessToken}` }
    });
    assert.equal(unauthorizedPhotoRes.status, 403);

    // 5. Admin can access Driver 1's proof photo with nosniff header
    const adminPhotoRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/proof/photo`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(adminPhotoRes.status, 200);
    assert.equal(adminPhotoRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(adminPhotoRes.headers.get('content-type'), 'image/webp');
  });

  // -------------------------------------------------------------
  // Test 5: Orphan-File Cleanup on Transaction Failure
  // -------------------------------------------------------------
  await t.test('5. Orphan-file cleanup: photo deleted if DB transaction fails', async () => {
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const delivery = await createAndAssign('Loc 1', 'Loc 2');
    // Notice: Delivery is left in 'assigned' state, NOT 'in_transit'!
    // Attempting to complete will fail DB check.

    const storageDir = path.join(__dirname, '..', 'storage', 'proofs');
    const filesBefore = fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : [];

    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const form = new FormData();
    form.append('photo', new Blob([pngBuffer], { type: 'image/png' }), 'proof.png');

    const res = await fetch(`${baseUrl}/deliveries/${delivery.id}/complete-photo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: form
    });

    assert.equal(res.status, 409); // Conflict: must be in_transit
    const filesAfter = fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : [];

    // Verify no new orphan file was left on disk
    assert.equal(filesAfter.length, filesBefore.length);
  });

  // -------------------------------------------------------------
  // Test 6: Concurrent Completion Race Condition (Exactly 1 succeeds)
  // -------------------------------------------------------------
  await t.test('6. Concurrent completion race condition: exactly one succeeds', async () => {
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const delivery = await createAndAssign('Point Race 1', 'Point Race 2');

    await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'in_transit' })
    });

    const regenRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/otp/regenerate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    const otp = (await regenRes.json()).otp;

    // Fire two simultaneous completion requests
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
        body: JSON.stringify({ otp })
      }),
      fetch(`${baseUrl}/deliveries/${delivery.id}/complete-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
        body: JSON.stringify({ otp })
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Exactly one completion must succeed (200) and the other must be rejected (409)');
  });

  // -------------------------------------------------------------
  // Test 7: Public Tracking Endpoint, Data Minimization & Headers
  // -------------------------------------------------------------
  await t.test('7. Customer Tracking Endpoint, Data Minimization & Security Headers', async () => {
    db.prepare("UPDATE vehicles SET status = 'available' WHERE id = 'VEH-301'").run();
    db.prepare("UPDATE drivers SET availability_status = 'available' WHERE id = 'DRV-301'").run();

    const delivery = await createAndAssign('Central Depot', 'Customer House');

    // Driver starts trip & reports GPS
    await fetch(`${baseUrl}/deliveries/${delivery.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ status: 'in_transit' })
    });

    await fetch(`${baseUrl}/drivers/DRV-301/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driver1Tokens.accessToken}` },
      body: JSON.stringify({ lat: 40.7580, lng: -73.9855, speed: 38.5 })
    });

    // Admin generates tracking link
    const trackLinkRes = await fetch(`${baseUrl}/deliveries/${delivery.id}/tracking`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(trackLinkRes.status, 200);
    const trackData = await trackLinkRes.json();
    const token = trackData.token;

    // Test HTML tracking page security headers
    const pageRes = await fetch(`${baseUrl}/t/${token}`);
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(pageRes.headers.get('cache-control').includes('no-store'));
    assert.ok(pageRes.headers.get('x-robots-tag').includes('noindex'));

    // Test JSON data minimization endpoint
    const apiTrackRes = await fetch(`${baseUrl}/api/track/${token}`);
    assert.equal(apiTrackRes.status, 200);
    const trackingInfo = await apiTrackRes.json();

    // Required fields present
    assert.equal(trackingInfo.status, 'in_transit');
    assert.equal(trackingInfo.progress_stage, 'Out for Delivery');
    assert.equal(trackingInfo.vehicle_location.lat, 40.7580);
    assert.equal(trackingInfo.vehicle_location.lng, -73.9855);

    // CRITICAL: Verify NO internal data leaked
    assert.equal(trackingInfo.driver_id, undefined);
    assert.equal(trackingInfo.driver_name, undefined);
    assert.equal(trackingInfo.driver_phone, undefined);
    assert.equal(trackingInfo.vehicle_id, undefined);
    assert.equal(trackingInfo.registration_number, undefined);
    assert.equal(trackingInfo.otp, undefined);
    assert.equal(trackingInfo.otp_hash, undefined);
    assert.equal(trackingInfo.notes, undefined);

    // Revoke tracking link
    await fetch(`${baseUrl}/deliveries/${delivery.id}/tracking/revoke`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });

    // Invalid & Revoked tokens both return identical 404
    const revokedRes = await fetch(`${baseUrl}/api/track/${token}`);
    assert.equal(revokedRes.status, 404);

    const nonExistentRes = await fetch(`${baseUrl}/api/track/nonexistent_random_token_12345`);
    assert.equal(nonExistentRes.status, 404);
    assert.equal((await revokedRes.json()).message, (await nonExistentRes.json()).message);
  });
});
