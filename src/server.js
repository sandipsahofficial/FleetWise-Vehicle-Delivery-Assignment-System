const http = require('node:http');
const app = require('./app');
const config = require('./config');
const { getDb, closeDb } = require('./db/database');
const { initSocket } = require('./realtime/socket');
const outboxWorker = require('./services/notifications/outboxWorker');
const logger = require('./utils/logger');

// Initialize database
try {
  getDb();
  logger.info({ path: config.dbPath }, 'Database initialized successfully');
} catch (err) {
  logger.fatal({ error: err.message }, 'Failed to initialize database');
  process.exit(1);
}

// Create HTTP Server & attach Socket.IO
const server = http.createServer(app);
const io = initSocket(server);

// Start listening unless required as a test module
if (require.main === module) {
  server.listen(config.port, () => {
    logger.info({ port: config.port }, `FleetWise server running on http://localhost:${config.port}`);
  });
}

let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, `Received ${signal}, initiating graceful shutdown...`);

  // Hard timeout: force exit if resources cannot close within 10 seconds
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out (10s), forcing process exit');
    process.exit(1);
  }, 10000);
  if (typeof forceExitTimer.unref === 'function') {
    forceExitTimer.unref();
  }

  // 1. Stop receiving new HTTP requests
  server.close((serverErr) => {
    if (serverErr) {
      logger.error({ error: serverErr.message }, 'Error while closing HTTP server');
    } else {
      logger.info('HTTP server closed');
    }

    // 2. Terminate Socket.IO server & disconnect active clients
    try {
      if (io && typeof io.close === 'function') {
        io.close(() => {
          logger.info('Socket.IO connections closed');
        });
      }
    } catch (e) {
      logger.warn({ error: e.message }, 'Error closing Socket.IO');
    }

    // 3. Stop background outbox worker
    try {
      if (outboxWorker && typeof outboxWorker.stop === 'function') {
        outboxWorker.stop();
        logger.info('Outbox worker stopped');
      }
    } catch (e) {
      logger.warn({ error: e.message }, 'Error stopping outbox worker');
    }

    // 4. Close SQLite database handle
    try {
      closeDb();
      logger.info('SQLite database closed successfully');
    } catch (e) {
      logger.warn({ error: e.message }, 'Error closing database connection');
    }

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.gracefulShutdown = gracefulShutdown;

module.exports = server;
