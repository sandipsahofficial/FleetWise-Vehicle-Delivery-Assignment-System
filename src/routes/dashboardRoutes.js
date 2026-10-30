const express = require('express');
const dashboardService = require('../services/dashboardService');
const auditService = require('../services/auditService');
const seedService = require('../services/seedService');
const { paginate } = require('../utils/pagination');

const router = express.Router();

router.get('/dashboard/stats', (req, res, next) => {
  try {
    const stats = dashboardService.getStats();
    res.status(200).json(stats);
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/performance - detailed fleet & delivery performance metrics
router.get('/analytics/performance', (req, res, next) => {
  try {
    const analytics = dashboardService.getPerformanceAnalytics();
    res.status(200).json(analytics);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit-logs - query audit logs with optional filters and pagination
router.get('/audit-logs', (req, res, next) => {
  try {
    const filters = {
      entity_type: req.query.entity_type,
      entity_id: req.query.entity_id,
      limit: req.query.limit
    };
    const logs = auditService.getLogs(filters);
    
    // If page query is present, use standardized pagination envelope
    if (req.query.page !== undefined) {
      const response = paginate(logs, req, res);
      return res.status(200).json(response);
    }

    // Default structure for existing tests
    res.status(200).json({
      count: logs.length,
      logs
    });
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
