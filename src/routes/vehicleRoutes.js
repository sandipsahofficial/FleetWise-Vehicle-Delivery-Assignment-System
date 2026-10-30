const express = require('express');
const vehicleService = require('../services/vehicleService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { paginate } = require('../utils/pagination');
const {
  createVehicleSchema,
  updateVehicleStatusSchema,
  updateVehicleSchema,
  listVehicleQuerySchema
} = require('../schemas/vehicleSchemas');

const router = express.Router();

// POST /vehicles - create vehicle (requires admin or fleet_manager)
router.post(
  '/vehicles',
  authenticate(),
  requireRole(['admin']),
  validate(createVehicleSchema),
  (req, res, next) => {
    try {
      const vehicle = vehicleService.createVehicle(req.body);
      res.status(201).json(vehicle);
    } catch (err) {
      next(err);
    }
  }
);

// GET /vehicles - list vehicles with filters and pagination
router.get(
  '/vehicles',
  authenticate({ optional: true }),
  validate(listVehicleQuerySchema),
  (req, res, next) => {
    try {
      const filters = {
        status: req.query.status,
        type: req.query.type,
        search: req.query.search
      };
      const vehicles = vehicleService.listVehicles(filters);
      const response = paginate(vehicles, req, res);
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

// GET /vehicles/:id - get single vehicle
router.get(
  '/vehicles/:id',
  authenticate({ optional: true }),
  (req, res, next) => {
    try {
      const vehicle = vehicleService.getVehicleById(req.params.id);
      res.status(200).json(vehicle);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /vehicles/:id/status - update status (requires admin)
router.patch(
  '/vehicles/:id/status',
  authenticate(),
  requireRole(['admin']),
  validate(updateVehicleStatusSchema),
  (req, res, next) => {
    try {
      const { status } = req.body;
      const vehicle = vehicleService.updateVehicleStatus(req.params.id, status);
      res.status(200).json(vehicle);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /vehicles/:id - update vehicle (requires admin)
router.put(
  '/vehicles/:id',
  authenticate(),
  requireRole(['admin']),
  validate(updateVehicleSchema),
  (req, res, next) => {
    try {
      const vehicle = vehicleService.updateVehicle(req.params.id, req.body);
      res.status(200).json(vehicle);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /vehicles/:id - delete vehicle (requires admin)
router.delete(
  '/vehicles/:id',
  authenticate(),
  requireRole(['admin']),
  (req, res, next) => {
    try {
      vehicleService.deleteVehicle(req.params.id);
      res.status(200).json({
        message: `Vehicle '${req.params.id}' successfully deleted`,
        id: req.params.id
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
