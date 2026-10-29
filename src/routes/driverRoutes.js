const express = require('express');
const driverService = require('../services/driverService');

const router = express.Router();

// POST /drivers - create driver
router.post('/drivers', (req, res, next) => {
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

// PATCH /drivers/:id/status - update availability status
router.patch('/drivers/:id/status', (req, res, next) => {
  try {
    const { status } = req.body;
    const driver = driverService.updateDriverStatus(req.params.id, status);
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

// PUT /drivers/:id - update driver
router.put('/drivers/:id', (req, res, next) => {
  try {
    const driver = driverService.updateDriver(req.params.id, req.body);
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

// DELETE /drivers/:id - delete driver (if safe)
router.delete('/drivers/:id', (req, res, next) => {
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

