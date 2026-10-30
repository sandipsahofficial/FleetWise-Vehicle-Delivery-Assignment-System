const express = require('express');
const driverService = require('../services/driverService');
const locationService = require('../services/locationService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { paginate } = require('../utils/pagination');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  createDriverSchema,
  updateDriverStatusSchema,
  updateDriverSchema,
  listDriverQuerySchema
} = require('../schemas/driverSchemas');
const { locationUpdateSchema } = require('../schemas/locationSchemas');

const router = express.Router();

// -------------------------------------------------------------
// LOCATION ROUTES (IMPORTANT: Registered BEFORE /drivers/:id)
// -------------------------------------------------------------

// GET /drivers/locations/latest - Live positions for map (admin & dispatcher only)
router.get(
  '/drivers/locations/latest',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const locations = locationService.getLatestLocations();
      res.status(200).json(locations);
    } catch (err) {
      next(err);
    }
  }
);

// POST /drivers/:id/location or /drivers/:id/locations - Driver location update (REST fallback, rate limited & validated)
router.post(
  ['/drivers/:id/location', '/drivers/:id/locations'],
  apiLimiter,
  authenticate(),
  validate(locationUpdateSchema),
  (req, res, next) => {
    try {
      const updated = locationService.updateLocation(req.params.id, req.body, req.user);
      res.status(200).json({
        message: 'Driver location recorded successfully',
        location: updated
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /drivers/:id/locations/history - Driver location history (admins/dispatchers, or driver for own history)
router.get(
  ['/drivers/:id/locations/history', '/drivers/:id/location/history'],
  authenticate(),
  (req, res, next) => {
    try {
      const history = locationService.getDriverHistory(req.params.id, req.user);
      res.status(200).json(history);
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// DRIVER CRUD ROUTES
// -------------------------------------------------------------

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
