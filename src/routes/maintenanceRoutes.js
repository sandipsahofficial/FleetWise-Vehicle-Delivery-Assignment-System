const express = require('express');
const maintenanceService = require('../services/maintenanceService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createScheduleSchema,
  createRecordSchema,
  createFuelLogSchema
} = require('../schemas/maintenanceSchemas');

const router = express.Router();

// POST /api/maintenance/schedules - Schedule vehicle maintenance
router.post(
  '/api/maintenance/schedules',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(createScheduleSchema),
  (req, res, next) => {
    try {
      const schedule = maintenanceService.createSchedule(req.body, req.user);
      res.status(201).json({
        message: 'Maintenance schedule created successfully',
        schedule
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/maintenance/schedules - List maintenance schedules
router.get(
  '/api/maintenance/schedules',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const schedules = maintenanceService.listSchedules(req.query);
      res.status(200).json({
        count: schedules.length,
        schedules
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/maintenance/overdue - Check overdue maintenance
router.get(
  '/api/maintenance/overdue',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const overdue = maintenanceService.getOverdueMaintenance();
      res.status(200).json({
        count: overdue.length,
        overdue
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/maintenance/records - Record completed maintenance
router.post(
  '/api/maintenance/records',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(createRecordSchema),
  (req, res, next) => {
    try {
      const record = maintenanceService.recordMaintenance(req.body, req.user);
      res.status(201).json({
        message: 'Maintenance record saved successfully',
        record
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/fuel-logs - Submit fuel log (Admin, Dispatcher, or Driver for assigned vehicle)
router.post(
  '/api/fuel-logs',
  authenticate(),
  validate(createFuelLogSchema),
  (req, res, next) => {
    try {
      const fuelLog = maintenanceService.logFuel(req.body, req.user);
      res.status(201).json({
        message: 'Fuel log saved successfully',
        fuelLog
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/fuel-logs - List fuel logs (Drivers scoped to own logs)
router.get(
  '/api/fuel-logs',
  authenticate(),
  (req, res, next) => {
    try {
      const fuelLogs = maintenanceService.listFuelLogs(req.query, req.user);
      res.status(200).json({
        count: fuelLogs.length,
        fuelLogs
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
