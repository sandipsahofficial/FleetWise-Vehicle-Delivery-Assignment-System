const { getDb } = require('../db/database');

class DriverRepository {
  create(driver) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO drivers (id, name, phone, availability_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
    `);
    stmt.run(
      driver.id,
      driver.name,
      driver.phone,
      driver.availability_status || 'available'
    );
    return this.findById(driver.id);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        d.id,
        d.name,
        d.phone,
        d.availability_status,
        d.created_at,
        d.updated_at,
        a.id AS active_assignment_id,
        a.assigned_at AS active_assignment_assigned_at,
        del.id AS active_delivery_id,
        del.pickup_address AS active_delivery_pickup,
        del.dropoff_address AS active_delivery_dropoff,
        del.scheduled_time AS active_delivery_scheduled_time,
        del.priority AS active_delivery_priority,
        del.status AS active_delivery_status
      FROM drivers d
      LEFT JOIN assignments a ON a.driver_id = d.id AND a.is_active = 1
      LEFT JOIN deliveries del ON del.id = a.delivery_id
      WHERE d.id = ?
    `);
    const row = stmt.get(id);
    if (!row) return null;
    return this._formatDriver(row);
  }

  findByPhone(phone) {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM drivers WHERE phone = ?`);
    return stmt.get(phone) || null;
  }

  findAll(filters = {}) {
    const db = getDb();
    let query = `
      SELECT 
        d.id,
        d.name,
        d.phone,
        d.availability_status,
        d.created_at,
        d.updated_at,
        a.id AS active_assignment_id,
        a.assigned_at AS active_assignment_assigned_at,
        del.id AS active_delivery_id,
        del.pickup_address AS active_delivery_pickup,
        del.dropoff_address AS active_delivery_dropoff,
        del.scheduled_time AS active_delivery_scheduled_time,
        del.priority AS active_delivery_priority,
        del.status AS active_delivery_status
      FROM drivers d
      LEFT JOIN assignments a ON a.driver_id = d.id AND a.is_active = 1
      LEFT JOIN deliveries del ON del.id = a.delivery_id
    `;
    const params = [];
    const clauses = [];

    if (filters.status) {
      clauses.push('d.availability_status = ?');
      params.push(filters.status);
    }
    if (filters.search) {
      clauses.push('(d.name LIKE ? OR d.phone LIKE ? OR d.id LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(' AND ')}`;
    }

    query += ' ORDER BY d.created_at DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r) => this._formatDriver(r));
  }

  hasActiveAssignment(driverId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 1 FROM assignments WHERE driver_id = ? AND is_active = 1 LIMIT 1
    `);
    return Boolean(stmt.get(driverId));
  }

  hasAnyAssignment(driverId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 1 FROM assignments WHERE driver_id = ? LIMIT 1
    `);
    return Boolean(stmt.get(driverId));
  }

  update(id, updates) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE drivers
      SET name = ?, phone = ?, availability_status = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(
      updates.name,
      updates.phone,
      updates.availability_status,
      id
    );
    return this.findById(id);
  }

  delete(id) {
    const db = getDb();
    const stmt = db.prepare(`DELETE FROM drivers WHERE id = ?`);
    const info = stmt.run(id);
    return info.changes > 0;
  }

  updateStatus(id, status) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE drivers
      SET availability_status = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(status, id);
    return this.findById(id);
  }

  _formatDriver(row) {
    const driver = {
      id: row.id,
      name: row.name,
      phone: row.phone,
      availability_status: row.availability_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      active_delivery: null
    };

    if (row.active_assignment_id && row.active_delivery_id) {
      driver.active_delivery = {
        assignment_id: row.active_assignment_id,
        assigned_at: row.active_assignment_assigned_at,
        delivery_id: row.active_delivery_id,
        pickup_address: row.active_delivery_pickup,
        dropoff_address: row.active_delivery_dropoff,
        scheduled_time: row.active_delivery_scheduled_time,
        priority: row.active_delivery_priority,
        status: row.active_delivery_status
      };
    }

    return driver;
  }
}

module.exports = new DriverRepository();

