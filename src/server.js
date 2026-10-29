const app = require('./app');
const config = require('./config');
const { getDb } = require('./db/database');

// Initialize database
try {
  getDb();
  console.log(`[FleetWise] Database initialized at: ${config.dbPath}`);
} catch (err) {
  console.error('[FleetWise] Failed to initialize database:', err);
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`[FleetWise] Server running on http://localhost:${config.port}`);
});

process.on('SIGINT', () => {
  console.log('[FleetWise] Gracefully shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

module.exports = server;
