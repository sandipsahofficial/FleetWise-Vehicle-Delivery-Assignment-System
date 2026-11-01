const express = require('express');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

/**
 * Public Liveness Probe: Minimal status check.
 * Returns only { "status": "UP" } with 200, or { "status": "DOWN" } with 503.
 */
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as healthy').get();

    if (row && row.healthy === 1) {
      return res.status(200).json({ status: 'UP' });
    }

    return res.status(503).json({ status: 'DOWN' });
  } catch (_error) {
    return res.status(503).json({ status: 'DOWN' });
  }
});

/**
 * Readiness Probe: Verifies database connectivity and worker operational readiness.
 * Returns minimal public information with 200 OK or 503 Service Unavailable.
 */
router.get('/ready', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as alive').get();
    if (!row || row.alive !== 1) {
      return res.status(503).json({ ready: false, error: 'Database is not responsive' });
    }

    // Verify background worker state if available
    const worker = req.app && req.app.outboxWorker;
    if (worker && worker.isRunning === false && req.app.locals && req.app.locals.config && req.app.locals.config.nodeEnv === 'production') {
      return res.status(503).json({ ready: false, error: 'Background workers are not operational' });
    }

    return res.status(200).json({ ready: true });
  } catch (_err) {
    return res.status(503).json({ ready: false, error: 'Service Unavailable' });
  }
});

/**
 * Detailed Diagnostic Health: Admin only.
 * Returns detailed diagnostics including memory usage, uptime, database status, and node version.
 */
router.get('/api/admin/health', authenticate({ strict: true }), requireRole(['admin']), (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as healthy').get();
    const isDbConnected = Boolean(row && row.healthy === 1);

    const diagnostics = {
      status: isDbConnected ? 'UP' : 'DOWN',
      service: 'FleetWise',
      database: isDbConnected ? 'connected' : 'unhealthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    };

    return res.status(isDbConnected ? 200 : 503).json(diagnostics);
  } catch (err) {
    return res.status(503).json({
      status: 'DOWN',
      service: 'FleetWise',
      database: 'disconnected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      error: err.message
    });
  }
});

module.exports = router;
