const express = require('express');
const path = require('node:path');
const trackingService = require('../services/trackingService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { trackingLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// GET /api/track/:token - Public data-minimized JSON tracking endpoint
router.get(
  '/api/track/:token',
  trackingLimiter,
  (req, res, next) => {
    try {
      const data = trackingService.getPublicTrackingData(req.params.token);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /t/:token - Public HTML customer tracking page
router.get(
  '/t/:token',
  trackingLimiter,
  (req, res, next) => {
    try {
      // First verify that token exists and is valid (identical 404 on failure)
      trackingService.getPublicTrackingData(req.params.token);

      // Security headers for tracking page
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');

      res.sendFile(path.join(__dirname, '..', 'public', 'track', 'index.html'));
    } catch (err) {
      next(err);
    }
  }
);

// POST /deliveries/:id/tracking - Generate or regenerate customer tracking link
router.post(
  '/deliveries/:id/tracking',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const result = trackingService.generateTrackingLink(req.params.id, req.user);
      res.status(200).json({
        message: 'Customer tracking link generated successfully',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /deliveries/:id/tracking/revoke - Revoke active customer tracking link
router.post(
  '/deliveries/:id/tracking/revoke',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const result = trackingService.revokeTrackingLink(req.params.id, req.user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
