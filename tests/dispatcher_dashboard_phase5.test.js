const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 5 - Dispatcher Dashboard End-to-End Workflow & Accurate Visibility', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  let vehId;
  let drvId;
  let delId;

  // Step 1: Create a vehicle
  await t.test('Step 1: Dispatcher registers a commercial vehicle', async () => {
    const res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_number: 'DISP-V100',
        type: 'Mercedes Sprinter',
        capacity: 1800,
        status: 'available'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.registration_number, 'DISP-V100');
    assert.equal(body.status, 'available');
    vehId = body.id;
  });

  // Step 2: Create a driver
  await t.test('Step 2: Dispatcher registers a driver', async () => {
    const res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sarah Connor',
        phone: '+1-555-4321',
        availability_status: 'available'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, 'Sarah Connor');
    assert.equal(body.availability_status, 'available');
    drvId = body.id;
  });

  // Step 3: Create a delivery
  await t.test('Step 3: Dispatcher creates a delivery request', async () => {
    const res = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Port Newark Pier 5',
        dropoff_address: 'Manhattan Distribution Point',
        scheduled_time: '2026-11-25T11:00:00Z',
        priority: 'high',
        notes: 'Medical vaccine shipment'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'pending');
    delId = body.id;
  });

  // Step 4: Verify initial dashboard statistics reflect unassigned pending state
  await t.test('Step 4: Dashboard stats reflect initial counts (1 vehicle, 1 driver, 1 pending)', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const stats = await res.json();

    assert.equal(stats.vehicles.total, 1);
    assert.equal(stats.vehicles.available, 1);
    assert.equal(stats.vehicles.assigned, 0);

    assert.equal(stats.drivers.total, 1);
    assert.equal(stats.drivers.available, 1);
    assert.equal(stats.drivers.assigned, 0);

    assert.equal(stats.deliveries.total, 1);
    assert.equal(stats.deliveries.pending, 1);
    assert.equal(stats.deliveries.active, 0);
    assert.equal(stats.vehicles.utilization_rate, 0);
  });

  // Step 5: Assign vehicle and driver
  await t.test('Step 5: Dispatcher assigns resources to pending delivery', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${delId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vehId, driver_id: drvId })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'assigned');
    assert.equal(body.delivery.assignment.vehicle.id, vehId);
    assert.equal(body.delivery.assignment.driver.id, drvId);
  });

  // Step 6: Verify dashboard statistics update to active assignment
  await t.test('Step 6: Dashboard stats update (1 active, 0 pending, 100% utilization)', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const stats = await res.json();

    assert.equal(stats.vehicles.assigned, 1);
    assert.equal(stats.vehicles.available, 0);
    assert.equal(stats.vehicles.utilization_rate, 100);

    assert.equal(stats.drivers.assigned, 1);
    assert.equal(stats.drivers.available, 0);

    assert.equal(stats.deliveries.pending, 0);
    assert.equal(stats.deliveries.active, 1);
    assert.equal(stats.deliveries.assigned, 1);
  });

  // Step 7: Advance delivery to in_transit
  await t.test('Step 7: Dispatcher advances delivery to in_transit', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${delId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'in_transit');
  });

  // Step 8: Mark delivery delivered
  await t.test('Step 8: Driver completes delivery (delivered) releasing resources', async () => {
    const res = await fetch(`${baseUrl}/deliveries/${delId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'delivered');
  });

  // Step 9: Verify dashboard statistics reflect completion and released resources
  await t.test('Step 9: Dashboard reflects 1 completed delivery and 1 available vehicle & driver', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const stats = await res.json();

    assert.equal(stats.vehicles.available, 1);
    assert.equal(stats.vehicles.assigned, 0);
    assert.equal(stats.vehicles.utilization_rate, 0);

    assert.equal(stats.drivers.available, 1);
    assert.equal(stats.drivers.assigned, 0);

    assert.equal(stats.deliveries.completed, 1);
    assert.equal(stats.deliveries.active, 0);
  });

  // Step 10: Re-use resources for a second delivery
  await t.test('Step 10: Dispatcher successfully re-assigns freed vehicle and driver to a new delivery', async () => {
    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Pickup Point B',
        dropoff_address: 'Dropoff Point B',
        scheduled_time: '2026-11-26T14:00:00Z',
        priority: 'medium'
      })
    })).json();

    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vehId, driver_id: drvId })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.delivery.status, 'assigned');
    assert.equal(body.delivery.assignment.vehicle.id, vehId);
  });
});

