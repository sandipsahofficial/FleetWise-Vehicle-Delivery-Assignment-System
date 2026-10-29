const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 4 - Assignment Engine & Concurrency Conflict Prevention', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // Create test resources
  const v1 = await (await fetch(`${baseUrl}/vehicles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registration_number: 'CONC-V1', type: 'Van', capacity: 1000 })
  })).json();

  const d1 = await (await fetch(`${baseUrl}/drivers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Driver Dave', phone: '+1-555-0801' })
  })).json();

  const del1 = await (await fetch(`${baseUrl}/deliveries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pickup_address: 'Port A',
      dropoff_address: 'Hub B',
      scheduled_time: '2026-11-01T10:00:00Z'
    })
  })).json();

  const del2 = await (await fetch(`${baseUrl}/deliveries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pickup_address: 'Port C',
      dropoff_address: 'Hub D',
      scheduled_time: '2026-11-01T11:00:00Z'
    })
  })).json();

  await t.test('Assign del1 with v1 and d1 succeeds', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v1.id, driver_id: d1.id })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'assigned');
  });

  await t.test('Assigning already-assigned vehicle v1 to del2 is rejected with 409 Conflict', async () => {
    // Create new driver d2 so driver is not the cause of conflict
    const d2 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver Diana', phone: '+1-555-0802' })
    })).json();

    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v1.id, driver_id: d2.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available|assigned/i);

    // Verify del2 remained pending and unassigned (Rollback check)
    const checkDel2 = await (await fetch(`${baseUrl}/deliveries/${del2.id}`)).json();
    assert.equal(checkDel2.status, 'pending');
    assert.equal(checkDel2.assignment, null);

    // Verify d2 remained available
    const checkD2 = await (await fetch(`${baseUrl}/drivers/${d2.id}`)).json();
    assert.equal(checkD2.availability_status, 'available');
  });

  await t.test('Assigning already-assigned driver d1 to del2 is rejected with 409 Conflict', async () => {
    // Create new vehicle v2
    const v2 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'CONC-V2', type: 'Van', capacity: 1500 })
    })).json();

    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v2.id, driver_id: d1.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available|assigned/i);

    // Verify del2 still pending and v2 still available
    const checkDel2 = await (await fetch(`${baseUrl}/deliveries/${del2.id}`)).json();
    assert.equal(checkDel2.status, 'pending');
    assert.equal(checkDel2.assignment, null);

    const checkV2 = await (await fetch(`${baseUrl}/vehicles/${v2.id}`)).json();
    assert.equal(checkV2.status, 'available');
  });

  await t.test('Rejects assigning when delivery is not pending', async () => {
    const v3 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'CONC-V3', type: 'Truck', capacity: 2500 })
    })).json();

    const d3 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver Dan', phone: '+1-555-0803' })
    })).json();

    // del1 is already assigned, try to assign again
    const res = await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v3.id, driver_id: d3.id })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /cannot be assigned because its status is/i);
  });

  await t.test('Concurrent race condition: simultaneous assignments for same vehicle/driver', async () => {
    // Single shared vehicle and driver
    const sharedVeh = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'RACE-V1', type: 'Van', capacity: 1800 })
    })).json();

    const sharedDrv = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Race Driver', phone: '+1-555-0999' })
    })).json();

    // Two competing deliveries
    const comp1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Race Origin 1',
        dropoff_address: 'Race Dest 1',
        scheduled_time: '2026-11-02T10:00:00Z'
      })
    })).json();

    const comp2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Race Origin 2',
        dropoff_address: 'Race Dest 2',
        scheduled_time: '2026-11-02T10:00:00Z'
      })
    })).json();

    // Fire both assignments simultaneously
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/deliveries/${comp1.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      }),
      fetch(`${baseUrl}/deliveries/${comp2.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: sharedDrv.id })
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one should succeed (200) and exactly one should be rejected with conflict (409)
    assert.deepEqual(statuses, [200, 409], 'Exactly one concurrent request succeeds and the other fails with 409');
  });
});
