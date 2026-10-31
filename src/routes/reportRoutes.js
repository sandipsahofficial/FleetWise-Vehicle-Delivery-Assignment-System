const express = require('express');
const reportService = require('../services/reportService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { exportReportSchema } = require('../schemas/reportSchemas');

const router = express.Router();

// GET /api/reports/deliveries/csv
router.get(
  '/api/reports/deliveries/csv',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(exportReportSchema),
  (req, res, next) => {
    try {
      const csv = reportService.generateDeliveriesCsv(req.query, req.user);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="deliveries-report.csv"');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/drivers/csv
router.get(
  '/api/reports/drivers/csv',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(exportReportSchema),
  (req, res, next) => {
    try {
      const csv = reportService.generateDriverPerformanceCsv(req.query, req.user);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="driver-performance-report.csv"');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/vehicles/csv
router.get(
  '/api/reports/vehicles/csv',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(exportReportSchema),
  (req, res, next) => {
    try {
      const csv = reportService.generateVehicleUtilizationCsv(req.query, req.user);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vehicle-utilization-report.csv"');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/fuel-maintenance/csv
router.get(
  '/api/reports/fuel-maintenance/csv',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(exportReportSchema),
  (req, res, next) => {
    try {
      const csv = reportService.generateFuelMaintenanceCsv(req.query, req.user);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="fuel-maintenance-report.csv"');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/summary/pdf
router.get(
  '/api/reports/summary/pdf',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(exportReportSchema),
  (req, res, next) => {
    try {
      const doc = reportService.generateSummaryPdf(req.query, req.user);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="fleetwise-executive-summary.pdf"');
      doc.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
