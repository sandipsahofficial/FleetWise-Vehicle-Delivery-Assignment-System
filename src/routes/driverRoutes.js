const express = require('express');
const driverService = require('../services/driverService');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// POST /drivers - create driver (requires fleet_manager)
router.post('/drivers', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const driver = driverService.createDriver(req.body);
    res.status(201).json(driver);
  } catch (err) {
    next(err);
  }
});

// GET /drivers - list drivers with filters
router.get('/drivers', (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      search: req.query.search
    };
    const drivers = driverService.listDrivers(filters);
    res.status(200).json(drivers);
  } catch (err) {
    next(err);
  }
});

// GET /drivers/:id - get single driver
router.get('/drivers/:id', (req, res, next) => {
  try {
    const driver = driverService.getDriverById(req.params.id);
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

// PATCH /drivers/:id/status - update availability status (requires fleet_manager)
router.patch('/drivers/:id/status', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const { status } = req.body;
    const driver = driverService.updateDriverStatus(req.params.id, status);
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

// PUT /drivers/:id - update driver (requires fleet_manager)
router.put('/drivers/:id', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    const driver = driverService.updateDriver(req.params.id, req.body);
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

// DELETE /drivers/:id - delete driver (if safe, requires fleet_manager)
router.delete('/drivers/:id', requireRole(['fleet_manager']), (req, res, next) => {
  try {
    driverService.deleteDriver(req.params.id);
    res.status(200).json({
      message: `Driver '${req.params.id}' successfully deleted`,
      id: req.params.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

