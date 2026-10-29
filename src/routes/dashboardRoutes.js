const express = require('express');
const dashboardService = require('../services/dashboardService');
const seedService = require('../services/seedService');

const router = express.Router();

router.get('/dashboard/stats', (req, res, next) => {
  try {
    const stats = dashboardService.getStats();
    res.status(200).json(stats);
  } catch (err) {
    next(err);
  }
});

router.post('/seed', (req, res, next) => {
  try {
    const result = seedService.seedDemoData();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
