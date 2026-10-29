const { getDb } = require('../db/database');

class VehicleRepository {
  create(vehicle) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO vehicles (id, registration_number, type, capacity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
    `);
    stmt.run(
      vehicle.id,
      vehicle.registration_number,
      vehicle.type,
      vehicle.capacity,
      vehicle.status || 'available'
    );
    return this.findById(vehicle.id);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        v.id,
        v.registration_number,
        v.type,
        v.capacity,
        v.status,
        v.created_at,
        v.updated_at,
        a.id AS active_assignment_id,
        a.assigned_at AS active_assignment_assigned_at,
        d.id AS active_delivery_id,
        d.pickup_address AS active_delivery_pickup,
        d.dropoff_address AS active_delivery_dropoff,
        d.scheduled_time AS active_delivery_scheduled_time,
        d.priority AS active_delivery_priority,
        d.status AS active_delivery_status
      FROM vehicles v
      LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.is_active = 1
      LEFT JOIN deliveries d ON d.id = a.delivery_id
      WHERE v.id = ?
    `);
    const row = stmt.get(id);
    if (!row) return null;
    return this._formatVehicle(row);
  }

  findByRegistration(regNumber) {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM vehicles WHERE LOWER(registration_number) = LOWER(?)`);
    return stmt.get(regNumber) || null;
  }

  findAll(filters = {}) {
    const db = getDb();
    let query = `
      SELECT 
        v.id,
        v.registration_number,
        v.type,
        v.capacity,
        v.status,
        v.created_at,
        v.updated_at,
        a.id AS active_assignment_id,
        a.assigned_at AS active_assignment_assigned_at,
        d.id AS active_delivery_id,
        d.pickup_address AS active_delivery_pickup,
        d.dropoff_address AS active_delivery_dropoff,
        d.scheduled_time AS active_delivery_scheduled_time,
        d.priority AS active_delivery_priority,
        d.status AS active_delivery_status
      FROM vehicles v
      LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.is_active = 1
      LEFT JOIN deliveries d ON d.id = a.delivery_id
    `;
    const params = [];
    const clauses = [];

    if (filters.status) {
      clauses.push('v.status = ?');
      params.push(filters.status);
    }
    if (filters.type) {
      clauses.push('v.type = ?');
      params.push(filters.type);
    }
    if (filters.search) {
      clauses.push('(v.registration_number LIKE ? OR v.type LIKE ? OR v.id LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(' AND ')}`;
    }

    query += ' ORDER BY v.created_at DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r) => this._formatVehicle(r));
  }

  hasActiveAssignment(vehicleId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 1 FROM assignments WHERE vehicle_id = ? AND is_active = 1 LIMIT 1
    `);
    return Boolean(stmt.get(vehicleId));
  }

  updateStatus(id, status) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE vehicles
      SET status = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(status, id);
    return this.findById(id);
  }

  _formatVehicle(row) {
    const vehicle = {
      id: row.id,
      registration_number: row.registration_number,
      type: row.type,
      capacity: Number(row.capacity),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      active_delivery: null
    };

    if (row.active_assignment_id && row.active_delivery_id) {
      vehicle.active_delivery = {
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

    return vehicle;
  }
}

module.exports = new VehicleRepository();
