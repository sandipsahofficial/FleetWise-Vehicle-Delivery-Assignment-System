const http = require('node:http');
const app = require('./app');
const config = require('./config');
const { getDb } = require('./db/database');
const { initSocket } = require('./realtime/socket');
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

server.listen(config.port, () => {
  logger.info({ port: config.port }, `FleetWise server running on http://localhost:${config.port}`);
});

process.on('SIGINT', () => {
  logger.info('Gracefully shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

module.exports = server;
