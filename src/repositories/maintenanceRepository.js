const crypto = require('node:crypto');
const { getDb } = require('../db/database');

class MaintenanceRepository {
  // -------------------------------------------------------------
  // Maintenance Schedules
  // -------------------------------------------------------------
  createSchedule({ vehicle_id, service_type, due_date = null, due_odometer = null, notes = null }) {
    const db = getDb();
    const id = `SCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    db.prepare(`
      INSERT INTO maintenance_schedules (id, vehicle_id, service_type, due_date, due_odometer, status, notes)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, vehicle_id, service_type, due_date, due_odometer, notes);

    return this.findScheduleById(id);
  }

  findScheduleById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(id);
  }

  listSchedules({ vehicle_id, status } = {}) {
    const db = getDb();
    let sql = 'SELECT s.*, v.registration_number, v.odometer as current_odometer FROM maintenance_schedules s JOIN vehicles v ON v.id = s.vehicle_id WHERE 1=1';
    const params = [];

    if (vehicle_id) {
      sql += ' AND s.vehicle_id = ?';
      params.push(vehicle_id);
    }
    if (status) {
      sql += ' AND s.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY s.due_date ASC, s.created_at DESC';
    return db.prepare(sql).all(...params);
  }

  // -------------------------------------------------------------
  // Maintenance Records
  // -------------------------------------------------------------
  createRecord({ vehicle_id, service_type, completed_at, odometer, cost, performed_by, notes = null }) {
    const db = getDb();
    const id = `MNT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    db.prepare(`
      INSERT INTO maintenance_records (id, vehicle_id, service_type, completed_at, odometer, cost, performed_by, notes)
      VALUES (?, ?, ?, COALESCE(?, DATETIME('now')), ?, ?, ?, ?)
    `).run(id, vehicle_id, service_type, completed_at, odometer, cost, performed_by, notes);

    return this.findRecordById(id);
  }

  findRecordById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM maintenance_records WHERE id = ?').get(id);
  }

  listRecords({ vehicle_id, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    let sql = 'SELECT r.*, v.registration_number FROM maintenance_records r JOIN vehicles v ON v.id = r.vehicle_id WHERE 1=1';
    const params = [];

    if (vehicle_id) {
      sql += ' AND r.vehicle_id = ?';
      params.push(vehicle_id);
    }

    sql += ' ORDER BY r.completed_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  // -------------------------------------------------------------
  // Fuel Logs
  // -------------------------------------------------------------
  createFuelLog({ vehicle_id, driver_id, liters, cost, odometer, logged_at = null }) {
    const db = getDb();
    const id = `FUL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    db.prepare(`
      INSERT INTO fuel_logs (id, vehicle_id, driver_id, liters, cost, odometer, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, DATETIME('now')))
    `).run(id, vehicle_id, driver_id, liters, cost, odometer, logged_at);

    return this.findFuelLogById(id);
  }

  findFuelLogById(id) {
    const db = getDb();
    return db.prepare(`
      SELECT f.*, v.registration_number, d.name as driver_name
      FROM fuel_logs f
      JOIN vehicles v ON v.id = f.vehicle_id
      JOIN drivers d ON d.id = f.driver_id
      WHERE f.id = ?
    `).get(id);
  }

  listFuelLogs({ vehicle_id, driver_id, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    let sql = `
      SELECT f.*, v.registration_number, d.name as driver_name
      FROM fuel_logs f
      JOIN vehicles v ON v.id = f.vehicle_id
      JOIN drivers d ON d.id = f.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (vehicle_id) {
      sql += ' AND f.vehicle_id = ?';
      params.push(vehicle_id);
    }
    if (driver_id) {
      sql += ' AND f.driver_id = ?';
      params.push(driver_id);
    }

    sql += ' ORDER BY f.logged_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }
}

module.exports = new MaintenanceRepository();
