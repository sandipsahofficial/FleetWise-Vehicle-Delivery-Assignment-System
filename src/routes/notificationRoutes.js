const express = require('express');
const notificationService = require('../services/notificationService');
const notificationRepository = require('../repositories/notificationRepository');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { registerContactSchema, queryOutboxSchema } = require('../schemas/notificationSchemas');

const router = express.Router();

// POST /api/customers - Register customer contact for a delivery
router.post(
  '/api/customers',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(registerContactSchema),
  (req, res, next) => {
    try {
      const contact = notificationService.registerContact(req.body.delivery_id, req.body);
      res.status(201).json({
        message: 'Customer contact registered successfully',
        contact
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/customers/:deliveryId - Get customer contact for delivery
router.get(
  '/api/customers/:deliveryId',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const contact = notificationService.getContact(req.params.deliveryId);
      res.status(200).json(contact);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/customers/:deliveryId - Anonymize/delete customer contact
router.delete(
  '/api/customers/:deliveryId',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const anonymized = notificationService.anonymizeContact(req.params.deliveryId);
      res.status(200).json({
        message: 'Customer contact anonymized in compliance with data privacy policies',
        contact: anonymized
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/notifications/outbox - Inspect notification outbox
router.get(
  '/api/notifications/outbox',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(queryOutboxSchema),
  (req, res, next) => {
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 50;
      const offset = (page - 1) * limit;

      const entries = notificationRepository.getOutboxEntries({
        status: req.query.status,
        limit,
        offset
      });

      res.status(200).json({
        count: entries.length,
        entries
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/notifications/status - Check notification dispatch status
router.get(
  '/api/notifications/status',
  authenticate(),
  (req, res) => {
    const config = require('../config');
    res.status(200).json({
      enabled: Boolean(config.notifications && config.notifications.enabled !== false),
      provider: config.notifications?.provider || 'disabled'
    });
  }
);

module.exports = router;

