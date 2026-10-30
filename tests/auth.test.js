const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting, getDb } = require('../src/db/database');
const authService = require('../src/services/authService');

test('Phase 1 — Production Foundation: Authentication, RBAC, Pagination & Security', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // Seed initial admin user directly for tests
  const adminUser = authService.register({
    username: 'superadmin',
    password: 'AdminPassword123!',
    role: 'admin'
  });

  let adminTokens;
  let dispatcherTokens;
  let driverATokens;
  let driverBTokens;
  let driverAEntity;
  let driverBEntity;

  await t.test('1. POST /auth/login - authenticate admin user and return JWT pair', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'superadmin',
        password: 'AdminPassword123!'
      })
    });

    assert.equal(res.status, 200);
    adminTokens = await res.json();
    assert.ok(adminTokens.accessToken);
    assert.ok(adminTokens.refreshToken);
    assert.equal(adminTokens.user.username, 'superadmin');
    assert.equal(adminTokens.user.role, 'admin');

    // Reject wrong password
    const badLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'superadmin',
        password: 'WrongPassword999'
      })
    });
    assert.equal(badLogin.status, 401);
  });

  await t.test('2. POST /auth/register - admin-only user creation', async () => {
    // Attempt registration without admin token -> 403 (or 401)
    const unauthorizedReg = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'dispatcher' // non-admin
      },
      body: JSON.stringify({
        username: 'newdispatcher',
        password: 'DispatcherPass123!',
        role: 'dispatcher'
      })
    });
    assert.equal(unauthorizedReg.status, 403);

    // Admin creates dispatcher user
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({
        username: 'newdispatcher',
        password: 'DispatcherPass123!',
        role: 'dispatcher'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.username, 'newdispatcher');
    assert.equal(body.user.role, 'dispatcher');

    // Login as dispatcher
    const loginDisp = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'newdispatcher',
        password: 'DispatcherPass123!'
      })
    });
    dispatcherTokens = await loginDisp.json();
    assert.equal(dispatcherTokens.user.role, 'dispatcher');
  });

  await t.test('3. Token Refresh & Rotation - single-use refresh token prevents replay', async () => {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: dispatcherTokens.refreshToken
      })
    });
    assert.equal(res.status, 200);
    const rotated = await res.json();
    assert.ok(rotated.accessToken);
    assert.ok(rotated.refreshToken);
    assert.notEqual(rotated.refreshToken, dispatcherTokens.refreshToken);

    // Replay with the already-used refresh token -> rejected with 401
    const replayRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: dispatcherTokens.refreshToken
      })
    });
    assert.equal(replayRes.status, 401);

    // Update dispatcherTokens with valid rotated tokens
    dispatcherTokens = rotated;
  });

  await t.test('4. GET /auth/me - inspect profile with Bearer JWT', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${dispatcherTokens.accessToken}`
      }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.username, 'newdispatcher');
    assert.equal(body.user.role, 'dispatcher');
  });

  await t.test('5. Driver scoping & isolation - drivers can only view & update own deliveries', async () => {
    // Create two physical drivers
    const createDriverA = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({ name: 'Driver Alpha', phone: '+1-555-0101' })
    });
    driverAEntity = await createDriverA.json();

    const createDriverB = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({ name: 'Driver Beta', phone: '+1-555-0102' })
    });
    driverBEntity = await createDriverB.json();

    // Create two vehicles
    const vA = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({ registration_number: 'VAN-ALPHA', type: 'Van', capacity: 1000 })
    })).json();

    const vB = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({ registration_number: 'VAN-BETA', type: 'Van', capacity: 1000 })
    })).json();

    // Create user accounts for both drivers with driver_id link
    await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({
        username: 'driver_alpha',
        password: 'DriverAlphaPass123!',
        role: 'driver',
        driver_id: driverAEntity.id
      })
    });

    await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokens.accessToken}`
      },
      body: JSON.stringify({
        username: 'driver_beta',
        password: 'DriverBetaPass123!',
        role: 'driver',
        driver_id: driverBEntity.id
      })
    });

    // Login both drivers
    driverATokens = await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'driver_alpha', password: 'DriverAlphaPass123!' })
    })).json();

    driverBTokens = await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'driver_beta', password: 'DriverBetaPass123!' })
    })).json();

    // Create two deliveries and assign one to Driver A, one to Driver B
    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dispatcherTokens.accessToken}`
      },
      body: JSON.stringify({
        pickup_address: 'Alpha Depot',
        dropoff_address: 'Alpha Destination',
        scheduled_time: '2026-11-10T10:00:00Z'
      })
    })).json();

    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dispatcherTokens.accessToken}`
      },
      body: JSON.stringify({
        pickup_address: 'Beta Depot',
        dropoff_address: 'Beta Destination',
        scheduled_time: '2026-11-10T11:00:00Z'
      })
    })).json();

    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dispatcherTokens.accessToken}`
      },
      body: JSON.stringify({ vehicle_id: vA.id, driver_id: driverAEntity.id })
    });

    await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dispatcherTokens.accessToken}`
      },
      body: JSON.stringify({ vehicle_id: vB.id, driver_id: driverBEntity.id })
    });

    // Driver A lists deliveries -> should ONLY see del1, NOT del2
    const driverAListRes = await fetch(`${baseUrl}/deliveries`, {
      headers: { 'Authorization': `Bearer ${driverATokens.accessToken}` }
    });
    assert.equal(driverAListRes.status, 200);
    const driverAList = await driverAListRes.json();
    assert.equal(driverAList.length, 1);
    assert.equal(driverAList[0].id, del1.id);

    // Driver A attempts to view Driver B's delivery -> 403 Forbidden
    const viewForbidden = await fetch(`${baseUrl}/deliveries/${del2.id}`, {
      headers: { 'Authorization': `Bearer ${driverATokens.accessToken}` }
    });
    assert.equal(viewForbidden.status, 403);

    // Driver A attempts to advance Driver B's delivery -> 403 Forbidden
    const updateForbidden = await fetch(`${baseUrl}/deliveries/${del2.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverATokens.accessToken}`
      },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(updateForbidden.status, 403);

    // Driver A advances their OWN delivery -> 200 OK
    const updateAllowed = await fetch(`${baseUrl}/deliveries/${del1.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverATokens.accessToken}`
      },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(updateAllowed.status, 200);
    const updatedBody = await updateAllowed.json();
    assert.equal(updatedBody.delivery.status, 'in_transit');
  });

  await t.test('6. Pagination, sorting, and Access-Control-Expose-Headers', async () => {
    const res = await fetch(`${baseUrl}/vehicles?page=1&limit=1&sortBy=registration_number&sortOrder=asc`);
    assert.equal(res.status, 200);

    // Verify pagination headers
    assert.ok(res.headers.get('x-total-count'));
    assert.equal(res.headers.get('x-page'), '1');
    assert.equal(res.headers.get('x-limit'), '1');
    assert.ok(res.headers.get('x-total-pages'));
    assert.match(res.headers.get('access-control-expose-headers'), /x-total-count/i);

    // Verify envelope format
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 1);
    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.limit, 1);
  });

  await t.test('7. OpenAPI Documentation - GET /api/docs serves Swagger UI', async () => {
    const res = await fetch(`${baseUrl}/api/docs/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /swagger-ui/i);
  });
});

