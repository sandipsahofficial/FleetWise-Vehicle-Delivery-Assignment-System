const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 2 - Vehicle Management API', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  let createdVehicleId;

  await t.test('POST /vehicles successfully creates a vehicle', async () => {
    const payload = {
      registration_number: 'NYC-1001',
      type: 'Sprinter Van',
      capacity: 1500,
      status: 'available'
    };
    const res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.registration_number, 'NYC-1001');
    assert.equal(body.type, 'Sprinter Van');
    assert.equal(body.capacity, 1500);
    assert.equal(body.status, 'available');
    assert.equal(body.active_delivery, null);
    createdVehicleId = body.id;
  });

  await t.test('POST /vehicles rejects duplicate registration numbers with 409', async () => {
    const payload = {
      registration_number: 'nyc-1001', // case-insensitive check
      type: 'Box Truck',
      capacity: 3000
    };
    const res = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /already exists/i);
  });

  await t.test('POST /vehicles rejects invalid capacity or missing type with 400', async () => {
    const res1 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'NYC-1002', type: 'Van', capacity: -5 })
    });
    assert.equal(res1.status, 400);

    const res2 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'NYC-1002', capacity: 100 })
    });
    assert.equal(res2.status, 400);
  });

  await t.test('GET /vehicles lists all vehicles', async () => {
    const res = await fetch(`${baseUrl}/vehicles`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].id, createdVehicleId);
  });

  await t.test('GET /vehicles/:id returns vehicle details', async () => {
    const res = await fetch(`${baseUrl}/vehicles/${createdVehicleId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, createdVehicleId);
    assert.equal(body.registration_number, 'NYC-1001');
  });

  await t.test('PATCH /vehicles/:id/status updates vehicle status to maintenance', async () => {
    const res = await fetch(`${baseUrl}/vehicles/${createdVehicleId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'maintenance' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'maintenance');

    // Verify status updated in database
    const verifyRes = await fetch(`${baseUrl}/vehicles/${createdVehicleId}`);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.status, 'maintenance');
  });

  await t.test('PATCH /vehicles/:id/status rejects invalid status with 400', async () => {
    const res = await fetch(`${baseUrl}/vehicles/${createdVehicleId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'flying' })
    });
    assert.equal(res.status, 400);
  });
});
