const PDFDocument = require('pdfkit');
const { getDb } = require('../db/database');
const auditService = require('./auditService');
const { BadRequestError } = require('../utils/errors');

/**
 * Sanitizes a single cell value to prevent CSV Formula Injection (CWE-1236)
 * and conforms to RFC 4180 standard escaping.
 */
function sanitizeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Formula injection prevention: prefix dangerous starting characters with single quote
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  if (str.length > 0 && dangerousPrefixes.includes(str[0])) {
    str = `'${str}`;
  }

  // If cell contains commas, quotes, or newlines, wrap in quotes and escape internal quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function buildCsvRow(values) {
  return values.map(sanitizeCsvCell).join(',') + '\r\n';
}

function validateDateRange(startDate, endDate) {
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestError('Invalid date format for report filter');
    }
    const diffDays = (end - start) / (1000 * 3600 * 24);
    if (diffDays < 0) {
      throw new BadRequestError('Start date must be before or equal to end date');
    }
    if (diffDays > 90) {
      throw new BadRequestError('Report date range cannot exceed 90 days');
    }
  }
}

class ReportService {
  /**
   * Generates Deliveries CSV. Excludes tokens, customer PII, and OTPs.
   */
  generateDeliveriesCsv(filters, user) {
    validateDateRange(filters.start_date, filters.end_date);
    const db = getDb();

    let query = `
      SELECT d.id, d.status, d.priority, d.pickup_address, d.dropoff_address,
             d.scheduled_time, d.created_at, d.updated_at,
             v.registration_number as vehicle_reg, dr.name as driver_name
      FROM deliveries d
      LEFT JOIN assignments a ON a.delivery_id = d.id AND a.is_active = 1
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      LEFT JOIN drivers dr ON dr.id = a.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.start_date) {
      query += ' AND d.created_at >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      query += ' AND d.created_at <= ?';
      params.push(filters.end_date);
    }

    query += ' ORDER BY d.created_at DESC LIMIT 5000';
    const rows = db.prepare(query).all(...params);

    let csv = buildCsvRow([
      'Delivery ID',
      'Status',
      'Priority',
      'Pickup Address',
      'Dropoff Address',
      'Scheduled Time',
      'Vehicle',
      'Driver',
      'Created At'
    ]);

    for (const r of rows) {
      csv += buildCsvRow([
        r.id,
        r.status,
        r.priority,
        r.pickup_address,
        r.dropoff_address,
        r.scheduled_time,
        r.vehicle_reg || 'Unassigned',
        r.driver_name || 'Unassigned',
        r.created_at
      ]);
    }

    auditService.log({
      entity_type: 'report',
      entity_id: 'deliveries_csv',
      action: 'report_exported',
      old_state: null,
      new_state: { format: 'csv', count: rows.length },
      performed_by: user?.username || 'system',
      details: `Exported deliveries CSV report (${rows.length} records)`
    });

    return csv;
  }

  /**
   * Generates Driver Performance CSV.
   */
  generateDriverPerformanceCsv(filters, user) {
    validateDateRange(filters.start_date, filters.end_date);
    const db = getDb();

    const query = `
      SELECT d.id, d.name, d.phone, d.availability_status,
             COUNT(a.id) as total_assignments,
             SUM(CASE WHEN del.status = 'delivered' THEN 1 ELSE 0 END) as completed_deliveries
      FROM drivers d
      LEFT JOIN assignments a ON a.driver_id = d.id
      LEFT JOIN deliveries del ON del.id = a.delivery_id
      GROUP BY d.id
      LIMIT 5000
    `;
    const rows = db.prepare(query).all();

    let csv = buildCsvRow([
      'Driver ID',
      'Driver Name',
      'Availability Status',
      'Total Assignments',
      'Completed Deliveries'
    ]);

    for (const r of rows) {
      csv += buildCsvRow([
        r.id,
        r.name,
        r.availability_status,
        r.total_assignments || 0,
        r.completed_deliveries || 0
      ]);
    }

    auditService.log({
      entity_type: 'report',
      entity_id: 'driver_performance_csv',
      action: 'report_exported',
      old_state: null,
      new_state: { format: 'csv', count: rows.length },
      performed_by: user?.username || 'system',
      details: `Exported driver performance CSV report (${rows.length} records)`
    });

    return csv;
  }

  /**
   * Generates Vehicle Utilization CSV.
   */
  generateVehicleUtilizationCsv(filters, user) {
    validateDateRange(filters.start_date, filters.end_date);
    const db = getDb();

    const query = `
      SELECT v.id, v.registration_number, v.type, v.capacity, v.odometer, v.status,
             COUNT(a.id) as total_trips
      FROM vehicles v
      LEFT JOIN assignments a ON a.vehicle_id = v.id
      GROUP BY v.id
      LIMIT 5000
    `;
    const rows = db.prepare(query).all();

    let csv = buildCsvRow([
      'Vehicle ID',
      'Registration Number',
      'Type',
      'Capacity (kg)',
      'Current Odometer (km)',
      'Status',
      'Total Trips'
    ]);

    for (const r of rows) {
      csv += buildCsvRow([
        r.id,
        r.registration_number,
        r.type,
        r.capacity,
        r.odometer,
        r.status,
        r.total_trips || 0
      ]);
    }

    auditService.log({
      entity_type: 'report',
      entity_id: 'vehicle_utilization_csv',
      action: 'report_exported',
      old_state: null,
      new_state: { format: 'csv', count: rows.length },
      performed_by: user?.username || 'system',
      details: `Exported vehicle utilization CSV report (${rows.length} records)`
    });

    return csv;
  }

  /**
   * Generates Fuel & Maintenance CSV.
   */
  generateFuelMaintenanceCsv(filters, user) {
    validateDateRange(filters.start_date, filters.end_date);
    const db = getDb();

    let query = `
      SELECT f.id, 'fuel' as record_type, f.vehicle_id, v.registration_number,
             f.liters, f.cost, f.odometer, f.logged_at as event_date,
             d.name as driver_name, NULL as service_type
      FROM fuel_logs f
      JOIN vehicles v ON v.id = f.vehicle_id
      LEFT JOIN drivers d ON d.id = f.driver_id
      LIMIT 5000
    `;
    const rows = db.prepare(query).all();

    let csv = buildCsvRow([
      'Log ID',
      'Record Type',
      'Vehicle ID',
      'Registration Number',
      'Liters',
      'Cost ($)',
      'Odometer',
      'Driver',
      'Date'
    ]);

    for (const r of rows) {
      csv += buildCsvRow([
        r.id,
        r.record_type,
        r.vehicle_id,
        r.registration_number,
        r.liters || '',
        r.cost,
        r.odometer,
        r.driver_name || '',
        r.event_date
      ]);
    }

    auditService.log({
      entity_type: 'report',
      entity_id: 'fuel_maintenance_csv',
      action: 'report_exported',
      old_state: null,
      new_state: { format: 'csv', count: rows.length },
      performed_by: user?.username || 'system',
      details: `Exported fuel & maintenance CSV report (${rows.length} records)`
    });

    return csv;
  }

  /**
   * Generates Executive Summary PDF Report.
   */
  generateSummaryPdf(filters, user) {
    validateDateRange(filters.start_date, filters.end_date);
    const db = getDb();

    const vehCount = db.prepare('SELECT COUNT(*) as c FROM vehicles').get().c;
    const drvCount = db.prepare('SELECT COUNT(*) as c FROM drivers').get().c;
    const delCount = db.prepare('SELECT COUNT(*) as c FROM deliveries').get().c;
    const compCount = db.prepare("SELECT COUNT(*) as c FROM deliveries WHERE status = 'delivered'").get().c;
    const fuelCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM fuel_logs').get().total;
    const maintCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM maintenance_records').get().total;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    // Header
    doc.fontSize(22).fillColor('#0f172a').text('FleetWise Executive Operations Summary', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#64748b').text(`Generated on: ${new Date().toUTCString()}`, { align: 'center' });
    doc.moveDown(1.5);

    // Section 1: Fleet Overview
    doc.fontSize(15).fillColor('#1e293b').text('1. Fleet & Personnel Overview');
    doc.fontSize(11).fillColor('#334155');
    doc.text(`• Total Vehicles Registered: ${vehCount}`);
    doc.text(`• Total Drivers Active: ${drvCount}`);
    doc.moveDown(1);

    // Section 2: Delivery Operations
    doc.fontSize(15).fillColor('#1e293b').text('2. Delivery Performance');
    doc.fontSize(11).fillColor('#334155');
    doc.text(`• Total Delivery Requests: ${delCount}`);
    doc.text(`• Completed Deliveries: ${compCount}`);
    const rate = delCount > 0 ? Math.round((compCount / delCount) * 100) : 0;
    doc.text(`• Delivery Completion Rate: ${rate}%`);
    doc.moveDown(1);

    // Section 3: Operational Expenditures
    doc.fontSize(15).fillColor('#1e293b').text('3. Operational Expenditures');
    doc.fontSize(11).fillColor('#334155');
    doc.text(`• Total Fuel Expenditure: $${Number(fuelCost).toFixed(2)}`);
    doc.text(`• Total Maintenance Expenditure: $${Number(maintCost).toFixed(2)}`);
    doc.text(`• Combined Operating Cost: $${(Number(fuelCost) + Number(maintCost)).toFixed(2)}`);
    doc.moveDown(2);

    doc.fontSize(9).fillColor('#94a3b8').text('Confidential — FleetWise Operational Intelligence Platform', { align: 'center' });

    doc.end();

    auditService.log({
      entity_type: 'report',
      entity_id: 'summary_pdf',
      action: 'report_exported',
      old_state: null,
      new_state: { format: 'pdf' },
      performed_by: user?.username || 'system',
      details: 'Exported executive summary PDF report'
    });

    return doc;
  }
}

module.exports = new ReportService();
module.exports.sanitizeCsvCell = sanitizeCsvCell;
