const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 3 & 4 - Delivery Management & Lifecycle Transitions', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // Seed 1 vehicle and 1 driver
  const vehRes = await fetch(`${baseUrl}/vehicles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registration_number: 'DEL-V1', type: 'Van', capacity: 1000 })
  });
  const vehicle = await vehRes.json();

  const drvRes = await fetch(`${baseUrl}/drivers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alice Smith', phone: '+1-555-0301' })
  });
  const driver = await drvRes.json();

  let deliveryId;

  await t.test('POST /deliveries creates a pending delivery', async () => {
    const payload = {
      pickup_address: '100 Main St, Warehouse A',
      dropoff_address: '250 Market St, Suite 400',
      scheduled_time: '2026-10-30T10:00:00Z',
      priority: 'high',
      notes: 'Fragile medical supplies'
    };

    const res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.status, 'pending');
    assert.equal(body.priority, 'high');
    assert.equal(body.assignment, null);
    deliveryId = body.id;
  });

  await t.test('Reject unsupported direct transition (pending -> delivered)', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${deliveryId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /Invalid status transition/i);
  });

  await t.test('POST /deliveries/:id/assign assigns vehicle & driver', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${deliveryId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vehicle.id, driver_id: driver.id })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'assigned');
    assert.ok(body.delivery.assignment);
    assert.equal(body.delivery.assignment.vehicle.id, vehicle.id);
    assert.equal(body.delivery.assignment.driver.id, driver.id);

    // Verify vehicle & driver statuses in DB are now assigned
    const checkVeh = await (await fetch(`${baseUrl}/vehicles/${vehicle.id}`)).json();
    assert.equal(checkVeh.status, 'assigned');
    assert.ok(checkVeh.active_delivery);

    const checkDrv = await (await fetch(`${baseUrl}/drivers/${driver.id}`)).json();
    assert.equal(checkDrv.availability_status, 'assigned');
    assert.ok(checkDrv.active_delivery);
  });

  await t.test('Transition assigned -> in_transit succeeds', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${deliveryId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'in_transit');
  });

  await t.test('Transition in_transit -> delivered safely releases resources', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${deliveryId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'delivered');

    // Verify vehicle and driver are released back to available
    const checkVeh = await (await fetch(`${baseUrl}/vehicles/${vehicle.id}`)).json();
    assert.equal(checkVeh.status, 'available');
    assert.equal(checkVeh.active_delivery, null);

    const checkDrv = await (await fetch(`${baseUrl}/drivers/${driver.id}`)).json();
    assert.equal(checkDrv.availability_status, 'available');
    assert.equal(checkDrv.active_delivery, null);
  });

  await t.test('Safe resource release does not overwrite maintenance/unavailable statuses', async () => {
    // Create new delivery, vehicle, driver
    const vRes = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'SPEC-V2', type: 'Van', capacity: 1200 })
    })).json();

    const dRes = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob Special', phone: '+1-555-0399' })
    })).json();

    const delRes = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Point A',
        dropoff_address: 'Point B',
        scheduled_time: '2026-10-31T09:00:00Z'
      })
    })).json();

    // Assign
    await fetch(`${baseUrl}/deliveries/${delRes.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vRes.id, driver_id: dRes.id })
    });

    // Cancel delivery with safe resource release
    const cancelRes = await fetch(`${baseUrl}/deliveries/${delRes.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(cancelRes.status, 200);

    const postCancelDel = await (await fetch(`${baseUrl}/deliveries/${delRes.id}`)).json();
    assert.equal(postCancelDel.status, 'cancelled');

    const vAfter = await (await fetch(`${baseUrl}/vehicles/${vRes.id}`)).json();
    assert.equal(vAfter.status, 'available');

    // Now set vehicle to maintenance
    await fetch(`${baseUrl}/vehicles/${vRes.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'maintenance' })
    });

    // Create another delivery and try to assign maintenance vehicle - must fail!
    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Point C',
        dropoff_address: 'Point D',
        scheduled_time: '2026-10-31T12:00:00Z'
      })
    })).json();

    const failAssign = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vRes.id, driver_id: dRes.id })
    });
    assert.equal(failAssign.status, 409);
  });
});
