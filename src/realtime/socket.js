const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const locationRepository = require('../repositories/locationRepository');
const { locationUpdateSchema } = require('../schemas/locationSchemas');

let ioInstance = null;
const locationRateLimits = new Map(); // driverId -> Array<timestamp>

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // JWT Authentication Middleware for Socket Handshakes
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return next(new Error('Authentication error: Missing token'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.user = {
        id: decoded.sub,
        username: decoded.username,
        role: decoded.role === 'fleet_manager' ? 'admin' : decoded.role,
        driver_id: decoded.driver_id || null,
        exp: decoded.exp
      };
      next();
    } catch (_err) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { role, username, driver_id, exp } = socket.user;
    logger.info({ username, role }, 'Socket client connected');

    // Auto-disconnect when access token expires
    let expiryTimer = null;
    if (exp) {
      const msUntilExpiry = (exp * 1000) - Date.now();
      if (msUntilExpiry <= 0) {
        socket.emit('token_expired', { message: 'Access token expired' });
        socket.disconnect(true);
        return;
      }
      expiryTimer = setTimeout(() => {
        logger.info({ username }, 'Socket access token expired; disconnecting client');
        socket.emit('token_expired', { message: 'Access token expired' });
        socket.disconnect(true);
      }, msUntilExpiry);
    }

    // Role-based room joining
    if (role === 'admin' || role === 'dispatcher') {
      socket.join('ops_room');
    }

    if (role === 'driver' && driver_id) {
      socket.join(`driver:${driver_id}`);
    }

    // Socket Driver Location Update Event
    socket.on('driver:location_update', (payload, callback) => {
      try {
        if (socket.user.exp && Date.now() >= socket.user.exp * 1000) {
          if (callback) callback({ error: 'Access token expired' });
          socket.emit('token_expired', { message: 'Access token expired' });
          socket.disconnect(true);
          return;
        }

        if (socket.user.role !== 'driver' && socket.user.role !== 'admin') {
          if (callback) callback({ error: 'Only drivers can publish location updates' });
          return;
        }

        if (socket.user.role === 'driver' && payload.driver_id && payload.driver_id !== socket.user.driver_id) {
          if (callback) callback({ error: 'Access denied. Drivers can only post location updates for their own assigned driver account.' });
          return;
        }

        const targetDriverId = socket.user.role === 'driver' ? socket.user.driver_id : payload.driver_id;
        if (!targetDriverId) {
          if (callback) callback({ error: 'Missing associated driver ID' });
          return;
        }

        // Rate limiting: max 60 updates/min and min 200ms interval
        const now = Date.now();
        const timestamps = locationRateLimits.get(targetDriverId) || [];
        const recent = timestamps.filter((ts) => now - ts < 60000);
        if (recent.length >= 60) {
          if (callback) callback({ error: 'Rate limit exceeded: maximum 60 location updates per minute' });
          return;
        }
        if (recent.length > 0 && now - recent[recent.length - 1] < 200) {
          if (callback) callback({ error: 'Rate limit exceeded: updates throttled to at most once per 200ms' });
          return;
        }
        recent.push(now);
        locationRateLimits.set(targetDriverId, recent);

        // Validate coordinates with Zod
        const parsed = locationUpdateSchema.body.parse(payload);

        const updated = locationRepository.upsertLatestLocation({
          driver_id: targetDriverId,
          lat: parsed.lat,
          lng: parsed.lng,
          speed: parsed.speed,
          heading: parsed.heading,
          timestamp: parsed.timestamp || new Date().toISOString()
        });

        // Broadcast to operators
        io.to('ops_room').emit('driver.location_updated', updated);

        if (callback) callback({ success: true, location: updated });
      } catch (err) {
        if (callback) callback({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      logger.info({ username }, 'Socket client disconnected');
    });
  });

  ioInstance = io;
  return io;
}

function getIO() {
  return ioInstance;
}

function resetRateLimits() {
  locationRateLimits.clear();
}

module.exports = {
  initSocket,
  getIO,
  resetRateLimits
};
