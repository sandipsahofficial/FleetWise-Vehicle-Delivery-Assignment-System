const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');
const authService = require('../src/services/authService');

test('Phase 1 - Skeleton & Health Check', async (t) => {
  resetDbForTesting();

  // Create users for admin health check authorization tests
  authService.register({ username: 'health_admin', password: 'AdminPassword123!', role: 'admin' });
  authService.register({ username: 'health_dispatcher', password: 'DispatcherPass123!', role: 'dispatcher' });
  authService.register({ username: 'health_driver', password: 'DriverPass123!', role: 'driver' });

  const adminTokens = authService.login({ username: 'health_admin', password: 'AdminPassword123!' });
  const dispatcherTokens = authService.login({ username: 'health_dispatcher', password: 'DispatcherPass123!' });
  const driverTokens = authService.login({ username: 'health_driver', password: 'DriverPass123!' });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('GET /health returns minimal 200 and UP status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'UP' });
  });

  await t.test('GET /api/admin/health requires admin authentication and returns diagnostics', async () => {
    // 401 unauthenticated
    const resNoAuth = await fetch(`${baseUrl}/api/admin/health`);
    assert.equal(resNoAuth.status, 401);

    // 403 for dispatcher
    const resDispatcher = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
    });
    assert.equal(resDispatcher.status, 403);

    // 403 for driver
    const resDriver = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { 'Authorization': `Bearer ${driverTokens.accessToken}` }
    });
    assert.equal(resDriver.status, 403);

    // 200 for admin with full diagnostics
    const resAdmin = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
    });
    assert.equal(resAdmin.status, 200);
    const body = await resAdmin.json();
    assert.equal(body.status, 'UP');
    assert.equal(body.service, 'FleetWise');
    assert.equal(body.database, 'connected');
    assert.ok(typeof body.uptime === 'number');
    assert.ok(body.timestamp);
    assert.ok(typeof body.memory === 'object');
    assert.ok(typeof body.nodeVersion === 'string');
  });

  await t.test('GET /api/unknown returns 404 with structured JSON', async () => {
    const res = await fetch(`${baseUrl}/api/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'NotFoundError');
  });
});
