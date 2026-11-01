const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

/**
 * Liveness Probe: Checks if the application process is running and can serve requests.
 */
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as healthy').get();

    if (row && row.healthy === 1) {
      return res.status(200).json({
        status: 'UP',
        service: 'FleetWise',
        timestamp: new Date().toISOString(),
        database: 'connected',
        uptime: process.uptime()
      });
    }

    return res.status(503).json({
      status: 'DOWN',
      service: 'FleetWise',
      timestamp: new Date().toISOString(),
      database: 'unhealthy'
    });
  } catch (_error) {
    return res.status(503).json({
      status: 'DOWN',
      service: 'FleetWise',
      timestamp: new Date().toISOString(),
      error: 'Service Unavailable'
    });
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

module.exports = router;
