const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting, getDb } = require('../src/db/database');

test('Phase 3 - Core Assignment Engine & Concurrency Verification', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // Helper function to create vehicle
  async function makeVehicle(reg, status = 'available', type = 'Van', cap = 1500) {
    const res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: reg, status, type, capacity: cap })
    });
    return res.json();
  }

  // Helper function to create driver
  async function makeDriver(name, phone, availability_status = 'available') {
    const res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, availability_status })
    });
    return res.json();
  }

  // Helper function to create delivery
  async function makeDelivery(pickup = 'Warehouse Alpha', dropoff = 'Client Beta') {
    const res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: pickup,
        dropoff_address: dropoff,
        scheduled_time: '2026-11-15T09:00:00Z',
        priority: 'high'
      })
    });
    return res.json();
  }

  // 1. Successful assignment
  await t.test('1. Successful assignment: creates record and updates states atomically', async () => {
    const v = await makeVehicle('ASSIGN-V1');
    const d = await makeDriver('Alice Assign', '+1-555-1101');
    const del = await makeDelivery();

    const res = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'assigned');
    assert.ok(body.delivery.assignment);
    assert.equal(body.delivery.assignment.vehicle.id, v.id);
    assert.equal(body.delivery.assignment.driver.id, d.id);

    // Verify DB states
    const vehCheck = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    assert.equal(vehCheck.status, 'assigned');
    assert.equal(vehCheck.active_delivery.delivery_id, del.id);

    const drvCheck = await (await fetch(`${baseUrl}/drivers/${d.id}`)).json();
    assert.equal(drvCheck.availability_status, 'assigned');
    assert.equal(drvCheck.active_delivery.delivery_id, del.id);
  });

  // 2. Vehicle conflict: vehicle already active in another delivery
  await t.test('2. Vehicle conflict: rejecting vehicle already in active delivery', async () => {
    const v = await makeVehicle('ASSIGN-V2');
    const d1 = await makeDriver('Bob One', '+1-555-1102');
    const d2 = await makeDriver('Bob Two', '+1-555-1103');
    const del1 = await makeDelivery('Origin 1', 'Dest 1');
    const del2 = await makeDelivery('Origin 2', 'Dest 2');

    // Assign del1
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d1.id })
    });

    // Attempt assigning same vehicle v to del2
    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d2.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available|already assigned/i);

    // Rollback check: del2 and d2 must be untouched
    const checkDel2 = await (await fetch(`${baseUrl}/deliveries/${del2.id}`)).json();
    assert.equal(checkDel2.status, 'pending');
    assert.equal(checkDel2.assignment, null);

    const checkD2 = await (await fetch(`${baseUrl}/drivers/${d2.id}`)).json();
    assert.equal(checkD2.availability_status, 'available');
  });

  // 3. Driver conflict: driver already active in another delivery
  await t.test('3. Driver conflict: rejecting driver already in active delivery', async () => {
    const v1 = await makeVehicle('ASSIGN-V3');
    const v2 = await makeVehicle('ASSIGN-V4');
    const d = await makeDriver('Charlie Driver', '+1-555-1104');
    const del1 = await makeDelivery('Depot A', 'Store B');
    const del2 = await makeDelivery('Depot C', 'Store D');

    // Assign del1
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v1.id, driver_id: d.id })
    });

    // Attempt assigning same driver d to del2
    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v2.id, driver_id: d.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available|already assigned/i);

    // Rollback check
    const checkDel2 = await (await fetch(`${baseUrl}/deliveries/${del2.id}`)).json();
    assert.equal(checkDel2.status, 'pending');
    const checkV2 = await (await fetch(`${baseUrl}/vehicles/${v2.id}`)).json();
    assert.equal(checkV2.status, 'available');
  });

  // 4. Both resources occupied
  await t.test('4. Both resources occupied: vehicle and driver both in separate active deliveries', async () => {
    const busyVeh = await makeVehicle('ASSIGN-V5');
    const busyDrv = await makeDriver('Busy Driver', '+1-555-1105');
    const otherVeh = await makeVehicle('ASSIGN-V6');
    const otherDrv = await makeDriver('Other Driver', '+1-555-1106');

    const activeDel1 = await makeDelivery('Port 1', 'Drop 1');
    const activeDel2 = await makeDelivery('Port 2', 'Drop 2');
    const targetDel = await makeDelivery('Port 3', 'Drop 3');

    // busyVeh is assigned to activeDel1
    await fetch(`${baseUrl}/deliveries/${activeDel1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: busyVeh.id, driver_id: otherDrv.id })
    });

    // busyDrv is assigned to activeDel2
    await fetch(`${baseUrl}/deliveries/${activeDel2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: otherVeh.id, driver_id: busyDrv.id })
    });

    // Attempt to assign busyVeh and busyDrv to targetDel
    const res = await fetch(`${baseUrl}/deliveries/${targetDel.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: busyVeh.id, driver_id: busyDrv.id })
    });

    assert.equal(res.status, 409);
    const targetCheck = await (await fetch(`${baseUrl}/deliveries/${targetDel.id}`)).json();
    assert.equal(targetCheck.status, 'pending');
    assert.equal(targetCheck.assignment, null);
  });

  // 5. Unavailable driver
  await t.test('5. Unavailable driver: reject assigning driver with unavailable status', async () => {
    const v = await makeVehicle('ASSIGN-V7');
    const unavailDrv = await makeDriver('OffDuty Dan', '+1-555-1107', 'unavailable');
    const del = await makeDelivery();

    const res = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: unavailDrv.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available for assignment.*unavailable/i);

    // Rollback check: vehicle must remain available, delivery remains pending
    const vCheck = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    assert.equal(vCheck.status, 'available');
    const delCheck = await (await fetch(`${baseUrl}/deliveries/${del.id}`)).json();
    assert.equal(delCheck.status, 'pending');
  });

  // 6. Maintenance vehicle
  await t.test('6. Maintenance vehicle: reject assigning vehicle in maintenance or inactive', async () => {
    const maintVeh = await makeVehicle('ASSIGN-V8', 'maintenance');
    const inactVeh = await makeVehicle('ASSIGN-V9', 'inactive');
    const d = await makeDriver('Ready Dave', '+1-555-1108');
    const del1 = await makeDelivery();
    const del2 = await makeDelivery();

    // Try maintenance
    const res1 = await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: maintVeh.id, driver_id: d.id })
    });
    assert.equal(res1.status, 409);
    assert.match((await res1.json()).message, /not available for assignment.*maintenance/i);

    // Try inactive
    const res2 = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: inactVeh.id, driver_id: d.id })
    });
    assert.equal(res2.status, 409);
    assert.match((await res2.json()).message, /not available for assignment.*inactive/i);

    // Driver remains available
    const dCheck = await (await fetch(`${baseUrl}/drivers/${d.id}`)).json();
    assert.equal(dCheck.availability_status, 'available');
  });

  // 7. Missing IDs & non-existent records
  await t.test('7. Missing IDs: reject missing or non-existent IDs with 400 or 404', async () => {
    const v = await makeVehicle('ASSIGN-V10');
    const d = await makeDriver('Valid Driver', '+1-555-1109');
    const del = await makeDelivery();

    // Missing vehicle_id
    const resNoVeh = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: d.id })
    });
    assert.equal(resNoVeh.status, 400);

    // Missing driver_id
    const resNoDrv = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id })
    });
    assert.equal(resNoDrv.status, 400);

    // Non-existent delivery
    const resBadDel = await fetch(`${baseUrl}/deliveries/DEL-GHOST/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(resBadDel.status, 404);

    // Non-existent vehicle
    const resBadVeh = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: 'VEH-GHOST', driver_id: d.id })
    });
    assert.equal(resBadVeh.status, 404);

    // Non-existent driver
    const resBadDrv = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: 'DRV-GHOST' })
    });
    assert.equal(resBadDrv.status, 404);
  });

  // 8. Duplicate submissions
  await t.test('8. Duplicate submissions: submitting assignment for already assigned delivery fails', async () => {
    const v = await makeVehicle('ASSIGN-V11');
    const d = await makeDriver('Dup Driver', '+1-555-1110');
    const del = await makeDelivery();

    // Submission 1: Succeeds
    const res1 = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res1.status, 200);

    // Submission 2: Re-submitting the exact same assignment
    const res2 = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res2.status, 409);
    const body2 = await res2.json();
    assert.match(body2.message, /cannot be assigned because its status is 'assigned'/i);
  });

  // 9. Concurrency & Race Condition Verification
  await t.test('9. Concurrency: exactly one parallel assignment succeeds under race conditions', async () => {
    // 1 single vehicle and 1 single driver
    const sharedVeh = await makeVehicle('RACE-TARGET-V');
    const sharedDrv = await makeDriver('Race Hero', '+1-555-9999');

    // 4 concurrent competing deliveries
    const [delA, delB, delC, delD] = await Promise.all([
      makeDelivery('Race Origin A', 'Race Dest A'),
      makeDelivery('Race Origin B', 'Race Dest B'),
      makeDelivery('Race Origin C', 'Race Dest C'),
      makeDelivery('Race Origin D', 'Race Dest D')
    ]);

    // Dispatch 4 concurrent requests competing for the exact same vehicle and driver
    const responses = await Promise.all([
      fetch(`${baseUrl}/deliveries/${delA.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      }),
      fetch(`${baseUrl}/deliveries/${delB.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      }),
      fetch(`${baseUrl}/deliveries/${delC.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      }),
      fetch(`${baseUrl}/deliveries/${delD.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      })
    ]);

    const statusCodes = responses.map(r => r.status);
    const successCount = statusCodes.filter(s => s === 200).length;
    const conflictCount = statusCodes.filter(s => s === 409).length;

    assert.equal(successCount, 1, 'Exactly one concurrent request must succeed with 200 OK');
    assert.equal(conflictCount, 3, 'All other concurrent requests must be rejected with 409 Conflict');

    // Verify physical database state: exactly 1 active assignment exists for this vehicle & driver
    const db = getDb();
    const activeVehAssigns = db.prepare(`
      SELECT COUNT(*) as count FROM assignments WHERE vehicle_id = ? AND is_active = 1
    `).get(sharedVeh.id).count;
    assert.equal(activeVehAssigns, 1, 'Physical database must contain exactly 1 active assignment for vehicle');

    const activeDrvAssigns = db.prepare(`
      SELECT COUNT(*) as count FROM assignments WHERE driver_id = ? AND is_active = 1
    `).get(sharedDrv.id).count;
    assert.equal(activeDrvAssigns, 1, 'Physical database must contain exactly 1 active assignment for driver');
  });
});
