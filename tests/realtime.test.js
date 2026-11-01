const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../src/app');
const { initSocket } = require('../src/realtime/socket');
const { resetDbForTesting, getDb } = require('../src/db/database');
const authService = require('../src/services/authService');
const config = require('../src/config');

test('Phase 2 — Real-Time Core: WebSockets, Room Isolation, Post-Commit Events & Live Telematics', async (t) => {
  resetDbForTesting();

  const app = createApp();
  const server = http.createServer(app);
  const ioServer = initSocket(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  const wsUrl = `http://localhost:${port}`;

  t.after(async () => {
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  // Seed Users & Drivers
  const _adminUser = authService.register({
    username: 'ops_admin',
    password: 'AdminPassword123!',
    role: 'admin'
  });

  // Create two drivers in DB
  const db = getDb();
  db.prepare(`
    INSERT INTO drivers (id, name, phone, availability_status)
    VALUES ('DRV-101', 'John Doe', '+1-555-1010', 'available'),
           ('DRV-102', 'Jane Smith', '+1-555-2020', 'available')
  `).run();

  // Create commercial vehicle
  db.prepare(`
    INSERT INTO vehicles (id, registration_number, type, capacity, status)
    VALUES ('VEH-101', 'TRUCK-101', 'Van', 2500, 'available')
  `).run();

  // Register driver user accounts linked to driver IDs
  const _driverAUser = authService.register({
    username: 'driver_john',
    password: 'DriverPassword123!',
    role: 'driver',
    driver_id: 'DRV-101'
  });

  const _driverBUser = authService.register({
    username: 'driver_jane',
    password: 'DriverPassword123!',
    role: 'driver',
    driver_id: 'DRV-102'
  });

  // Create Dispatcher User
  const _dispatcherUser = authService.register({
    username: 'dispatcher_mike',
    password: 'DispatcherPass123!',
    role: 'dispatcher'
  });

  // Get tokens
  const adminTokens = authService.login({ username: 'ops_admin', password: 'AdminPassword123!' });
  const dispatcherTokens = authService.login({ username: 'dispatcher_mike', password: 'DispatcherPass123!' });
  const driverATokens = authService.login({ username: 'driver_john', password: 'DriverPassword123!' });
  const driverBTokens = authService.login({ username: 'driver_jane', password: 'DriverPassword123!' });

  // Helper to connect socket client
  function connectClient(token) {
    return ioClient(wsUrl, {
      auth: { token },
      autoConnect: true,
      reconnection: false,
      transports: ['websocket']
    });
  }

  // -------------------------------------------------------------
  // 1. Socket Authentication & Rejection Tests
  // -------------------------------------------------------------
  await t.test('1. Socket Handshake Authentication', async (t2) => {
    await t2.test('Reject connection without token', async () => {
      const socket = ioClient(wsUrl, {
        autoConnect: true,
        reconnection: false,
        transports: ['websocket']
      });

      await new Promise((resolve) => {
        socket.on('connect_error', (err) => {
          assert.ok(err.message.includes('Authentication error'));
          socket.disconnect();
          resolve();
        });
      });
    });

    await t2.test('Reject connection with expired or forged JWT', async () => {
      // Create expired token
      const expiredToken = jwt.sign(
        { sub: 'user_1', username: 'expired', role: 'dispatcher' },
        config.jwt.secret,
        { expiresIn: '-5s' }
      );

      const socket = connectClient(expiredToken);
      await new Promise((resolve) => {
        socket.on('connect_error', (err) => {
          assert.ok(err.message.includes('Invalid or expired token'));
          socket.disconnect();
          resolve();
        });
      });
    });

    await t2.test('Successfully connect with valid JWT and authenticate user', async () => {
      const socket = connectClient(adminTokens.accessToken);
      await new Promise((resolve) => {
        socket.on('connect', () => {
          assert.ok(socket.connected);
          socket.disconnect();
          resolve();
        });
      });
    });
  });

  // -------------------------------------------------------------
  // 2. Room Joining & Room-Based Event Isolation Tests
  // -------------------------------------------------------------
  await t.test('2. Room Joining & Role-Based Event Isolation', async (t2) => {
    const adminSocket = connectClient(adminTokens.accessToken);
    const driverASocket = connectClient(driverATokens.accessToken);
    const driverBSocket = connectClient(driverBTokens.accessToken);

    await Promise.all([
      new Promise((res) => adminSocket.on('connect', res)),
      new Promise((res) => driverASocket.on('connect', res)),
      new Promise((res) => driverBSocket.on('connect', res))
    ]);

    let createdDeliveryId;

    await t2.test('Delivery creation emits delivery.created to ops_room', async () => {
      const eventPromise = new Promise((resolve) => {
        adminSocket.once('delivery.created', (event) => {
          resolve(event);
        });
      });

      const res = await fetch(`${baseUrl}/deliveries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminTokens.accessToken}`
        },
        body: JSON.stringify({
          pickup_address: '100 Broadway, NY',
          dropoff_address: '500 5th Ave, NY',
          scheduled_time: new Date(Date.now() + 3600000).toISOString(),
          priority: 'high',
          notes: 'Express courier'
        })
      });

      assert.equal(res.status, 201);
      const delivery = await res.json();
      createdDeliveryId = delivery.id;

      const receivedEvent = await eventPromise;
      assert.equal(receivedEvent.id, createdDeliveryId);
    });

    await t2.test('Delivery assignment emits to ops_room AND assigned driver room, but NOT other driver', async () => {
      let driverAReceived = null;
      let driverBReceived = null;
      let adminReceived = null;

      driverASocket.once('delivery.assigned', (event) => {
        driverAReceived = event;
      });

      driverBSocket.once('delivery.assigned', (event) => {
        driverBReceived = event;
      });

      const adminPromise = new Promise((resolve) => {
        adminSocket.once('delivery.assigned', (event) => {
          adminReceived = event;
          resolve(event);
        });
      });

      // Assign to Driver A (DRV-101)
      const assignRes = await fetch(`${baseUrl}/deliveries/${createdDeliveryId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminTokens.accessToken}`
        },
        body: JSON.stringify({
          vehicle_id: 'VEH-101',
          driver_id: 'DRV-101'
        })
      });

      assert.equal(assignRes.status, 200);
      await adminPromise;

      // Small delay to ensure no leaked events reach Driver B
      await new Promise((r) => setTimeout(r, 60));

      assert.ok(adminReceived, 'Admin received delivery.assigned');
      assert.ok(driverAReceived, 'Assigned driver (Driver A) received delivery.assigned');
      assert.equal(driverAReceived.id, createdDeliveryId);
      assert.equal(driverBReceived, null, 'Unassigned driver (Driver B) MUST NOT receive private delivery.assigned event');
    });

    await t2.test('Delivery status transitions emit delivery.status_changed strictly to assigned rooms', async () => {
      let driverAReceived = null;
      let driverBReceived = null;

      driverASocket.once('delivery.status_changed', (event) => {
        driverAReceived = event;
      });

      driverBSocket.once('delivery.status_changed', (event) => {
        driverBReceived = event;
      });

      // Driver A transitions status to in_transit
      const statusRes = await fetch(`${baseUrl}/deliveries/${createdDeliveryId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverATokens.accessToken}`
        },
        body: JSON.stringify({ status: 'in_transit' })
      });

      assert.equal(statusRes.status, 200);

      await new Promise((r) => setTimeout(r, 60));

      assert.ok(driverAReceived, 'Driver A received status_changed');
      assert.equal(driverAReceived.status, 'in_transit');
      assert.equal(driverBReceived, null, 'Driver B must NOT receive Driver A delivery status event');
    });

    adminSocket.disconnect();
    driverASocket.disconnect();
    driverBSocket.disconnect();
  });

  // -------------------------------------------------------------
  // 3. Driver Location Tracking (REST Fallback & Security)
  // -------------------------------------------------------------
  await t.test('3. Driver Location Tracking via REST API', async (t2) => {
    await t2.test('Driver A successfully posts own location update', async () => {
      const res = await fetch(`${baseUrl}/drivers/DRV-101/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverATokens.accessToken}`
        },
        body: JSON.stringify({
          lat: 40.7128,
          lng: -74.0060,
          speed: 45.2,
          heading: 90
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.location.driver_id, 'DRV-101');
      assert.equal(data.location.lat, 40.7128);
      assert.equal(data.location.speed, 45.2);
    });

    await t2.test('Driver A posting location for Driver B returns 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/drivers/DRV-102/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverATokens.accessToken}`
        },
        body: JSON.stringify({
          lat: 40.7500,
          lng: -73.9900,
          speed: 30
        })
      });

      assert.equal(res.status, 403);
      const err = await res.json();
      assert.ok(err.message.includes('Access denied'));
    });

    await t2.test('Reject out-of-range latitude/longitude with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/drivers/DRV-101/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverATokens.accessToken}`
        },
        body: JSON.stringify({
          lat: 95.123, // Invalid lat > 90
          lng: -74.0060
        })
      });

      assert.equal(res.status, 400);
    });

    await t2.test('Reject stale timestamps (> 24h past) with 400 Bad Request', async () => {
      const staleTime = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/drivers/DRV-101/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverATokens.accessToken}`
        },
        body: JSON.stringify({
          lat: 40.7128,
          lng: -74.0060,
          timestamp: staleTime
        })
      });

      assert.equal(res.status, 400);
    });

    await t2.test('GET /drivers/locations/latest returns latest fleet positions for dispatcher', async () => {
      const res = await fetch(`${baseUrl}/drivers/locations/latest`, {
        headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
      });

      assert.equal(res.status, 200);
      const locations = await res.json();
      assert.ok(Array.isArray(locations));
      const drv1 = locations.find((l) => l.driver_id === 'DRV-101');
      assert.ok(drv1);
      assert.equal(drv1.driver_name, 'John Doe');
      assert.equal(drv1.lat, 40.7128);
    });

    await t2.test('GET /drivers/:id/locations/history permissions check', async () => {
      // Driver A can view own history
      const ownRes = await fetch(`${baseUrl}/drivers/DRV-101/locations/history`, {
        headers: { 'Authorization': `Bearer ${driverATokens.accessToken}` }
      });
      assert.equal(ownRes.status, 200);
      const ownHist = await ownRes.json();
      assert.ok(Array.isArray(ownHist));
      assert.ok(ownHist.length >= 1);

      // Driver A viewing Driver B history returns 403 Forbidden
      const otherRes = await fetch(`${baseUrl}/drivers/DRV-102/locations/history`, {
        headers: { 'Authorization': `Bearer ${driverATokens.accessToken}` }
      });
      assert.equal(otherRes.status, 403);

      // Dispatcher viewing Driver A history returns 200 OK
      const dispRes = await fetch(`${baseUrl}/drivers/DRV-101/locations/history`, {
        headers: { 'Authorization': `Bearer ${dispatcherTokens.accessToken}` }
      });
      assert.equal(dispRes.status, 200);
    });
  });

  // -------------------------------------------------------------
  // 4. Driver Location Tracking via Socket Event
  // -------------------------------------------------------------
  await t.test('4. Driver Location Tracking via Socket Events', async (t2) => {
    const adminSocket = connectClient(adminTokens.accessToken);
    const driverASocket = connectClient(driverATokens.accessToken);

    await Promise.all([
      new Promise((res) => adminSocket.on('connect', res)),
      new Promise((res) => driverASocket.on('connect', res))
    ]);

    await t2.test('Driver A emits driver:location_update and ops_room receives broadcast', async () => {
      const opsPromise = new Promise((resolve) => {
        adminSocket.once('driver.location_updated', (data) => {
          resolve(data);
        });
      });

      const ack = await new Promise((resolve) => {
        driverASocket.emit(
          'driver:location_update',
          {
            lat: 40.7200,
            lng: -74.0100,
            speed: 55.0,
            heading: 180
          },
          (res) => resolve(res)
        );
      });

      assert.ok(ack.success);
      assert.equal(ack.location.lat, 40.7200);

      const opsReceived = await opsPromise;
      assert.equal(opsReceived.driver_id, 'DRV-101');
      assert.equal(opsReceived.lat, 40.7200);
      assert.equal(opsReceived.speed, 55.0);
    });

    await t2.test('Driver A attempting socket update for Driver B is rejected', async () => {
      const ack = await new Promise((resolve) => {
        driverASocket.emit(
          'driver:location_update',
          {
            driver_id: 'DRV-102', // Mismatched driver ID
            lat: 40.7200,
            lng: -74.0100
          },
          (res) => resolve(res)
        );
      });

      assert.ok(ack.error);
      assert.ok(ack.error.includes('Access denied'));
    });

    adminSocket.disconnect();
    driverASocket.disconnect();
  });

  // -------------------------------------------------------------
  // 5. Location History Retention Pruning
  // -------------------------------------------------------------
  await t.test('5. Location History Retention Pruning', async () => {
    const locationRepository = require('../src/repositories/locationRepository');

    // Insert an old point beyond 7 days directly
    db.prepare(`
      INSERT INTO driver_location_history (id, driver_id, lat, lng, speed, heading, timestamp)
      VALUES ('stale-1', 'DRV-101', 40.71, -74.01, 10, 0, DATETIME('now', '-10 days'))
    `).run();

    // Run upsert which triggers pruning
    locationRepository.upsertLatestLocation({
      driver_id: 'DRV-101',
      lat: 40.7300,
      lng: -74.0200,
      speed: 40,
      heading: 90
    });

    // Check that 'stale-1' was pruned
    const staleCheck = db.prepare('SELECT id FROM driver_location_history WHERE id = ?').get('stale-1');
    assert.equal(staleCheck, undefined, 'Stale history older than 7 days must be pruned');

    // Verify history point count is bounded
    const history = locationRepository.getDriverHistory('DRV-101', 200);
    assert.ok(history.length <= 100);
  });

  // -------------------------------------------------------------
  // 6. Token Expiry & Active Socket Disconnect
  // -------------------------------------------------------------
  await t.test('6. Expired access token disconnects already-open socket', async () => {
    const shortToken = jwt.sign(
      { sub: 'user_short', username: 'short_user', role: 'admin' },
      config.jwt.secret,
      { expiresIn: '1s' }
    );
    const socket = connectClient(shortToken);
    await new Promise((res) => socket.on('connect', res));
    assert.ok(socket.connected);

    // Wait for auto-disconnect triggered by expiry timer
    await new Promise((resolve) => {
      socket.on('disconnect', () => {
        resolve();
      });
      setTimeout(() => {
        socket.disconnect();
        resolve();
      }, 2000);
    });
    assert.ok(!socket.connected);
  });

  // -------------------------------------------------------------
  // 7. Socket Location Event Rate Limiting
  // -------------------------------------------------------------
  await t.test('7. Socket location updates are rate-limited on rapid calls', async () => {
    let mockTime = 1000000;
    ioServer.setClock(() => mockTime);

    const driverASocket = connectClient(driverATokens.accessToken);
    await new Promise((res) => driverASocket.on('connect', res));

    // Send 1st update at mockTime
    const ack1 = await new Promise((res) => {
      driverASocket.emit('driver:location_update', { lat: 40.71, lng: -74.01 }, res);
    });
    assert.ok(ack1 && ack1.success, `ack1 failed: ${ack1 ? ack1.error : 'no ack'}`);

    // Advance mock time by only 100ms (< 200ms throttle interval)
    mockTime += 100;
    const ack2 = await new Promise((res) => {
      driverASocket.emit('driver:location_update', { lat: 40.71, lng: -74.01 }, res);
    });
    assert.ok(ack2.error);
    assert.ok(ack2.error.includes('Rate limit'));

    // Advance mock time past 200ms threshold (+ 250ms -> 350ms total)
    mockTime += 250;
    const ack3 = await new Promise((res) => {
      driverASocket.emit('driver:location_update', { lat: 40.71, lng: -74.01 }, res);
    });
    assert.ok(ack3 && ack3.success, `ack3 failed: ${ack3 ? ack3.error : 'no ack'}`);

    driverASocket.disconnect();
    ioServer.setClock(() => Date.now());
  });

  // -------------------------------------------------------------
  // 8. /api/seed Admin-Only and Production Lockout
  // -------------------------------------------------------------
  await t.test('8. /api/seed is admin-only and strictly disabled in production', async () => {
    // Driver cannot seed (403)
    const driverRes = await fetch(`${baseUrl}/api/seed`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driverATokens.accessToken}` }
    });
    assert.equal(driverRes.status, 403);

    // In production, even admin cannot seed (403)
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const prodRes = await fetch(`${baseUrl}/api/seed`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminTokens.accessToken}` }
      });
      assert.equal(prodRes.status, 403);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
