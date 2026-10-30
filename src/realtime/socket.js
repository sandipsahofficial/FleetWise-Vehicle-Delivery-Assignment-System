const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const locationRepository = require('../repositories/locationRepository');
const { locationUpdateSchema } = require('../schemas/locationSchemas');

let ioInstance = null;

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
        driver_id: decoded.driver_id || null
      };
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { role, username, driver_id } = socket.user;
    logger.info({ username, role }, 'Socket client connected');

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
      logger.info({ username }, 'Socket client disconnected');
    });
  });

  ioInstance = io;
  return io;
}

function getIO() {
  return ioInstance;
}

module.exports = {
  initSocket,
  getIO
};
