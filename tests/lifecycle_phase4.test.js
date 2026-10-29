const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting, getDb } = require('../src/db/database');

test('Phase 4 - Delivery Lifecycle Management & Safe Resource Release', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // Helpers
  async function createVehicle(reg, status = 'available') {
    const res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: reg, status, type: 'Sprinter Van', capacity: 1500 })
    });
    return res.json();
  }

  async function createDriver(name, phone, availability_status = 'available') {
    const res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, availability_status })
    });
    return res.json();
  }

  async function createDelivery(notes = '') {
    const res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: '100 Distribution Way',
        dropoff_address: '500 Retail Plaza',
        scheduled_time: '2026-11-20T10:00:00Z',
        priority: 'high',
        notes
      })
    });
    return res.json();
  }

  // 1. Full successful completion lifecycle: pending -> assigned -> in_transit -> delivered
  await t.test('1. Full successful completion lifecycle: pending -> assigned -> in_transit -> delivered', async () => {
    const v = await createVehicle('LIFE-V1');
    const d = await createDriver('Dan Lifecycle', '+1-555-8801');
    const del = await createDelivery('Lifecycle happy path');

    // pending -> assigned
    const assignRes = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(assignRes.status, 200);

    // assigned -> in_transit
    const transitRes = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(transitRes.status, 200);
    const transitDel = (await transitRes.json()).delivery;
    assert.equal(transitDel.status, 'in_transit');

    // in_transit -> delivered
    const deliverRes = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(deliverRes.status, 200);
    const deliveredDel = (await deliverRes.json()).delivery;
    assert.equal(deliveredDel.status, 'delivered');

    // Verify vehicle & driver safely released back to available
    const vehCheck = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    assert.equal(vehCheck.status, 'available');
    assert.equal(vehCheck.active_delivery, null);

    const drvCheck = await (await fetch(`${baseUrl}/drivers/${d.id}`)).json();
    assert.equal(drvCheck.availability_status, 'available');
    assert.equal(drvCheck.active_delivery, null);
  });

  // 2. Cancellation transitions with safe resource release
  await t.test('2. Cancellation: pending -> cancelled and assigned -> cancelled with resource release', async () => {
    // 2a. Direct cancellation of pending delivery (no resources involved)
    const delPending = await createDelivery('Pending to cancel');
    const cancelPendingRes = await fetch(`${baseUrl}/deliveries/${delPending.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(cancelPendingRes.status, 200);
    const cancelledPending = (await cancelPendingRes.json()).delivery;
    assert.equal(cancelledPending.status, 'cancelled');

    // 2b. Cancellation of assigned delivery (releases vehicle & driver safely)
    const v2 = await createVehicle('LIFE-V2');
    const d2 = await createDriver('Driver Cancel', '+1-555-8802');
    const delAssigned = await createDelivery('Assigned to cancel');

    await fetch(`${baseUrl}/deliveries/${delAssigned.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v2.id, driver_id: d2.id })
    });

    const cancelAssignedRes = await fetch(`${baseUrl}/deliveries/${delAssigned.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(cancelAssignedRes.status, 200);
    const cancelledAssigned = (await cancelAssignedRes.json()).delivery;
    assert.equal(cancelledAssigned.status, 'cancelled');

    // Resources released
    const v2Check = await (await fetch(`${baseUrl}/vehicles/${v2.id}`)).json();
    assert.equal(v2Check.status, 'available');
    const d2Check = await (await fetch(`${baseUrl}/drivers/${d2.id}`)).json();
    assert.equal(d2Check.availability_status, 'available');
  });

  // 3. Repeated status requests (idempotency safety)
  await t.test('3. Repeated status requests: safely idempotent without state corruption', async () => {
    const v3 = await createVehicle('LIFE-V3');
    const d3 = await createDriver('Driver Repeat', '+1-555-8803');
    const del = await createDelivery('Repeat tests');

    await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v3.id, driver_id: d3.id })
    });

    // Advance to in_transit
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });

    // Repeat in_transit request
    const repeatTransit = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(repeatTransit.status, 200);
    assert.equal((await repeatTransit.json()).delivery.status, 'in_transit');

    // Advance to delivered
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    // Repeat delivered request
    const repeatDelivered = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(repeatDelivered.status, 200);
    assert.equal((await repeatDelivered.json()).delivery.status, 'delivered');
  });

  // 4. Invalid / Unsupported transitions rejected
  await t.test('4. Unsupported transitions: rejected with 409 Conflict', async () => {
    const del = await createDelivery('Invalid transitions test');

    // pending -> delivered directly
    const res1 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(res1.status, 409);
    assert.match((await res1.json()).message, /Invalid status transition/i);

    // pending -> in_transit directly
    const res2 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(res2.status, 409);

    // pending -> assigned directly via PATCH status (without assign endpoint)
    const res3 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'assigned' })
    });
    assert.equal(res3.status, 400);

    // Cancel the delivery (terminal state)
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });

    // cancelled -> in_transit (transition out of terminal state)
    const res4 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(res4.status, 409);

    // cancelled -> pending
    const res5 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' })
    });
    assert.equal(res5.status, 409);
  });

  // 5. Resource reuse after completion & historical audit preservation
  await t.test('5. Resource reuse after completion: vehicle & driver can be reassigned to new delivery', async () => {
    const v = await createVehicle('REUSE-V1');
    const d = await createDriver('Reuse Driver', '+1-555-8805');
    const del1 = await createDelivery('Delivery 1');
    const del2 = await createDelivery('Delivery 2');

    // Assign del1
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    // Complete del1 (assigned -> in_transit -> delivered)
    await fetch(`${baseUrl}/deliveries/${del1.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    await fetch(`${baseUrl}/deliveries/${del1.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    // Now re-assign the exact same vehicle and driver to del2
    const reassignRes = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(reassignRes.status, 200);

    const del2Check = await (await fetch(`${baseUrl}/deliveries/${del2.id}`)).json();
    assert.equal(del2Check.status, 'assigned');
    assert.equal(del2Check.assignment.vehicle.id, v.id);
    assert.equal(del2Check.assignment.driver.id, d.id);

    // Verify assignment history:
    // del1 has 1 historical released assignment
    const hist1 = await (await fetch(`${baseUrl}/deliveries/${del1.id}/assignments`)).json();
    assert.equal(hist1.length, 1);
    assert.equal(hist1[0].is_active, 0);
    assert.ok(hist1[0].released_at);

    // del2 has 1 active assignment
    const hist2 = await (await fetch(`${baseUrl}/deliveries/${del2.id}/assignments`)).json();
    assert.equal(hist2.length, 1);
    assert.equal(hist2[0].is_active, 1);
    assert.equal(hist2[0].released_at, null);

    // Physical DB check: exactly 1 active assignment across both
    const db = getDb();
    const activeVehCount = db.prepare(`
      SELECT COUNT(*) as count FROM assignments WHERE vehicle_id = ? AND is_active = 1
    `).get(v.id).count;
    assert.equal(activeVehCount, 1);
  });

  // 6. Consistency after failures: rejection leaves records unmodified
  await t.test('6. Consistency after failures: rejection leaves delivery and resource records untouched', async () => {
    const del = await createDelivery('Consistency test');
    assert.equal(del.status, 'pending');

    // Attempt invalid transition
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    // Verify delivery is still strictly pending
    const verifyDel = await (await fetch(`${baseUrl}/deliveries/${del.id}`)).json();
    assert.equal(verifyDel.status, 'pending');
    assert.equal(verifyDel.assignment, null);
  });
});

