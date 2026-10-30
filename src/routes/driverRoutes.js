const express = require('express');
const driverService = require('../services/driverService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { paginate } = require('../utils/pagination');
const {
  createDriverSchema,
  updateDriverStatusSchema,
  updateDriverSchema,
  listDriverQuerySchema
} = require('../schemas/driverSchemas');

const router = express.Router();

// POST /drivers - create driver (requires admin)
router.post(
  '/drivers',
  authenticate(),
  requireRole(['admin']),
  validate(createDriverSchema),
  (req, res, next) => {
    try {
      const driver = driverService.createDriver(req.body);
      res.status(201).json(driver);
    } catch (err) {
      next(err);
    }
  }
);

// GET /drivers - list drivers with filters and pagination
router.get(
  '/drivers',
  authenticate({ optional: true }),
  validate(listDriverQuerySchema),
  (req, res, next) => {
    try {
      const filters = {
        status: req.query.status,
        search: req.query.search
      };
      const drivers = driverService.listDrivers(filters);
      const response = paginate(drivers, req, res);
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

// GET /drivers/:id - get single driver
router.get(
  '/drivers/:id',
  authenticate({ optional: true }),
  (req, res, next) => {
    try {
      const driver = driverService.getDriverById(req.params.id);
      res.status(200).json(driver);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /drivers/:id/status - update availability status (requires admin)
router.patch(
  '/drivers/:id/status',
  authenticate(),
  requireRole(['admin']),
  validate(updateDriverStatusSchema),
  (req, res, next) => {
    try {
      const { status } = req.body;
      const driver = driverService.updateDriverStatus(req.params.id, status);
      res.status(200).json(driver);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /drivers/:id - update driver (requires admin)
router.put(
  '/drivers/:id',
  authenticate(),
  requireRole(['admin']),
  validate(updateDriverSchema),
  (req, res, next) => {
    try {
      const driver = driverService.updateDriver(req.params.id, req.body);
      res.status(200).json(driver);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /drivers/:id - delete driver (requires admin)
router.delete(
  '/drivers/:id',
  authenticate(),
  requireRole(['admin']),
  (req, res, next) => {
    try {
      driverService.deleteDriver(req.params.id);
      res.status(200).json({
        message: `Driver '${req.params.id}' successfully deleted`,
        id: req.params.id
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
