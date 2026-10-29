const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 2 - Driver Management API', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  let createdDriverId;

  await t.test('POST /drivers successfully creates a driver', async () => {
    const payload = {
      name: 'John Doe',
      phone: '+1-555-0199',
      availability_status: 'available'
    };
    const res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.name, 'John Doe');
    assert.equal(body.phone, '+1-555-0199');
    assert.equal(body.availability_status, 'available');
    assert.equal(body.active_delivery, null);
    createdDriverId = body.id;
  });

  await t.test('POST /drivers rejects duplicate phone numbers with 409', async () => {
    const payload = {
      name: 'Jane Doe',
      phone: '+1-555-0199'
    };
    const res = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /already exists/i);
  });

  await t.test('POST /drivers rejects missing name or phone with 400', async () => {
    const res1 = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1-555-0200' })
    });
    assert.equal(res1.status, 400);

    const res2 = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' })
    });
    assert.equal(res2.status, 400);
  });

  await t.test('GET /drivers lists all drivers', async () => {
    const res = await fetch(`${baseUrl}/drivers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].id, createdDriverId);
  });

  await t.test('GET /drivers/:id returns driver details', async () => {
    const res = await fetch(`${baseUrl}/drivers/${createdDriverId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, createdDriverId);
    assert.equal(body.name, 'John Doe');
  });

  await t.test('PATCH /drivers/:id/status updates availability to unavailable', async () => {
    const res = await fetch(`${baseUrl}/drivers/${createdDriverId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'unavailable' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.availability_status, 'unavailable');

    // Verify status updated in database
    const verifyRes = await fetch(`${baseUrl}/drivers/${createdDriverId}`);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.availability_status, 'unavailable');
  });

  await t.test('PATCH /drivers/:id/status rejects invalid status with 400', async () => {
    const res = await fetch(`${baseUrl}/drivers/${createdDriverId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sleeping' })
    });
    assert.equal(res.status, 400);
  });
});
