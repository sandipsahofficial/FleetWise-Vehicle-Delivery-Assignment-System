const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/health', (req, res) => {
  try {
    const db = getDb();
    // Verify database query executes
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
  } catch (error) {
    return res.status(503).json({
      status: 'DOWN',
      service: 'FleetWise',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;

