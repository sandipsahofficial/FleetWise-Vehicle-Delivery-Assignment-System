const express = require('express');
const vehicleService = require('../services/vehicleService');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// POST /vehicles - create vehicle (requires fleet_manager)
router.post('/vehicles', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const vehicle = vehicleService.createVehicle(req.body);
    res.status(201).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// GET /vehicles - list vehicles with filters
router.get('/vehicles', (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      type: req.query.type,
      search: req.query.search
    };
    const vehicles = vehicleService.listVehicles(filters);
    res.status(200).json(vehicles);
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/:id - get single vehicle
router.get('/vehicles/:id', (req, res, next) => {
  try {
    const vehicle = vehicleService.getVehicleById(req.params.id);
    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// PATCH /vehicles/:id/status - update status (requires fleet_manager)
router.patch('/vehicles/:id/status', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const { status } = req.body;
    const vehicle = vehicleService.updateVehicleStatus(req.params.id, status);
    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// PUT /vehicles/:id - update vehicle (requires fleet_manager)
router.put('/vehicles/:id', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const vehicle = vehicleService.updateVehicle(req.params.id, req.body);
    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// DELETE /vehicles/:id - delete vehicle (if safe, requires fleet_manager)
router.delete('/vehicles/:id', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    vehicleService.deleteVehicle(req.params.id);
    res.status(200).json({
      message: `Vehicle '${req.params.id}' successfully deleted`,
      id: req.params.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

