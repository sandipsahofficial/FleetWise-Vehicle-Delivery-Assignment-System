const { getDb } = require('../db/database');

class DeliveryRepository {
  create(delivery) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO deliveries (id, pickup_address, dropoff_address, scheduled_time, priority, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
    `);
    stmt.run(
      delivery.id,
      delivery.pickup_address,
      delivery.dropoff_address,
      delivery.scheduled_time,
      delivery.priority || 'medium',
      delivery.status || 'pending',
      delivery.notes || null
    );
    return this.findById(delivery.id);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        d.id,
        d.pickup_address,
        d.dropoff_address,
        d.scheduled_time,
        d.priority,
        d.status,
        d.notes,
        d.created_at,
        d.updated_at,
        a.id AS assignment_id,
        a.assigned_at,
        a.released_at,
        v.id AS vehicle_id,
        v.registration_number AS vehicle_registration_number,
        v.type AS vehicle_type,
        v.capacity AS vehicle_capacity,
        v.status AS vehicle_status,
        drv.id AS driver_id,
        drv.name AS driver_name,
        drv.phone AS driver_phone,
        drv.availability_status AS driver_availability_status
      FROM deliveries d
      LEFT JOIN assignments a ON a.delivery_id = d.id AND a.is_active = 1
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      LEFT JOIN drivers drv ON drv.id = a.driver_id
      WHERE d.id = ?
    `);
    const row = stmt.get(id);
    if (!row) return null;
    return this._formatDelivery(row);
  }

  findAll(filters = {}) {
    const db = getDb();
    let query = `
      SELECT 
        d.id,
        d.pickup_address,
        d.dropoff_address,
        d.scheduled_time,
        d.priority,
        d.status,
        d.notes,
        d.created_at,
        d.updated_at,
        a.id AS assignment_id,
        a.assigned_at,
        a.released_at,
        v.id AS vehicle_id,
        v.registration_number AS vehicle_registration_number,
        v.type AS vehicle_type,
        v.capacity AS vehicle_capacity,
        v.status AS vehicle_status,
        drv.id AS driver_id,
        drv.name AS driver_name,
        drv.phone AS driver_phone,
        drv.availability_status AS driver_availability_status
      FROM deliveries d
      LEFT JOIN assignments a ON a.delivery_id = d.id AND a.is_active = 1
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      LEFT JOIN drivers drv ON drv.id = a.driver_id
    `;
    const params = [];
    const clauses = [];

    if (filters.status) {
      clauses.push('d.status = ?');
      params.push(filters.status);
    }
    if (filters.priority) {
      clauses.push('d.priority = ?');
      params.push(filters.priority);
    }
    if (filters.vehicle_id) {
      clauses.push('a.vehicle_id = ?');
      params.push(filters.vehicle_id);
    }
    if (filters.driver_id) {
      clauses.push('a.driver_id = ?');
      params.push(filters.driver_id);
    }
    if (filters.search) {
      clauses.push(`(
        d.id LIKE ? OR 
        d.pickup_address LIKE ? OR 
        d.dropoff_address LIKE ? OR 
        v.registration_number LIKE ? OR 
        drv.name LIKE ?
      )`);
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(' AND ')}`;
    }

    query += ' ORDER BY d.created_at DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r) => this._formatDelivery(r));
  }

  updateStatus(id, newStatus) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE deliveries
      SET status = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(newStatus, id);
    return this.findById(id);
  }

  _formatDelivery(row) {
    const delivery = {
      id: row.id,
      pickup_address: row.pickup_address,
      dropoff_address: row.dropoff_address,
      scheduled_time: row.scheduled_time,
      priority: row.priority,
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      assignment: null
    };

    if (row.assignment_id) {
      delivery.assignment = {
        id: row.assignment_id,
        assigned_at: row.assigned_at,
        released_at: row.released_at,
        vehicle: {
          id: row.vehicle_id,
          registration_number: row.vehicle_registration_number,
          type: row.vehicle_type,
          capacity: row.vehicle_capacity ? Number(row.vehicle_capacity) : null,
          status: row.vehicle_status
        },
        driver: {
          id: row.driver_id,
          name: row.driver_name,
          phone: row.driver_phone,
          availability_status: row.driver_availability_status
        }
      };
    }

    return delivery;
  }
}

module.exports = new DeliveryRepository();
