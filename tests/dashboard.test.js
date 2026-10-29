const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 5 - Dashboard & Operational Visibility API', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('GET /api/dashboard/stats returns zeroed counts when empty', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.vehicles.total, 0);
    assert.equal(body.drivers.total, 0);
    assert.equal(body.deliveries.total, 0);
    assert.equal(body.deliveries.active, 0);
  });

  await t.test('GET /api/dashboard/stats accurately reflects entities and assignments', async () => {
    // 1 vehicle
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'STAT-V1', type: 'Van', capacity: 1000 })
    })).json();

    // 1 driver
    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stat Driver', phone: '+1-555-0901' })
    })).json();

    // 2 deliveries
    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Loc A',
        dropoff_address: 'Loc B',
        scheduled_time: '2026-11-05T08:00:00Z',
        priority: 'urgent'
      })
    })).json();

    await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Loc C',
        dropoff_address: 'Loc D',
        scheduled_time: '2026-11-05T12:00:00Z',
        priority: 'medium'
      })
    });

    // Assign del1
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.vehicles.total, 1);
    assert.equal(body.vehicles.assigned, 1);
    assert.equal(body.vehicles.available, 0);
    assert.equal(body.vehicles.utilization_rate, 100);

    assert.equal(body.drivers.total, 1);
    assert.equal(body.drivers.assigned, 1);
    assert.equal(body.drivers.available, 0);

    assert.equal(body.deliveries.total, 2);
    assert.equal(body.deliveries.pending, 1);
    assert.equal(body.deliveries.active, 1);
    assert.equal(body.deliveries.assigned, 1);
  });
});
