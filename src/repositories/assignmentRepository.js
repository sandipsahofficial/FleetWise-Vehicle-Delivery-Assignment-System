const { getDb } = require('../db/database');

class AssignmentRepository {
  create(assignment) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO assignments (id, delivery_id, vehicle_id, driver_id, assigned_at, is_active)
      VALUES (?, ?, ?, ?, DATETIME('now'), 1)
    `);
    stmt.run(
      assignment.id,
      assignment.delivery_id,
      assignment.vehicle_id,
      assignment.driver_id
    );
    return this.findById(assignment.id);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM assignments WHERE id = ?`);
    return stmt.get(id) || null;
  }

  findActiveByDeliveryId(deliveryId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        a.*,
        v.registration_number AS vehicle_registration_number,
        v.type AS vehicle_type,
        v.status AS vehicle_status,
        d.name AS driver_name,
        d.phone AS driver_phone,
        d.availability_status AS driver_availability_status
      FROM assignments a
      JOIN vehicles v ON v.id = a.vehicle_id
      JOIN drivers d ON d.id = a.driver_id
      WHERE a.delivery_id = ? AND a.is_active = 1
    `);
    return stmt.get(deliveryId) || null;
  }

  findActiveByVehicleId(vehicleId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT * FROM assignments WHERE vehicle_id = ? AND is_active = 1
    `);
    return stmt.get(vehicleId) || null;
  }

  findActiveByDriverId(driverId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT * FROM assignments WHERE driver_id = ? AND is_active = 1
    `);
    return stmt.get(driverId) || null;
  }

  releaseActiveByDeliveryId(deliveryId) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE assignments
      SET is_active = 0, released_at = DATETIME('now')
      WHERE delivery_id = ? AND is_active = 1
    `);
    stmt.run(deliveryId);
  }

  getHistoryByDeliveryId(deliveryId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        a.id,
        a.delivery_id,
        a.vehicle_id,
        a.driver_id,
        a.assigned_at,
        a.released_at,
        a.is_active,
        v.registration_number AS vehicle_registration_number,
        v.type AS vehicle_type,
        d.name AS driver_name,
        d.phone AS driver_phone
      FROM assignments a
      JOIN vehicles v ON v.id = a.vehicle_id
      JOIN drivers d ON d.id = a.driver_id
      WHERE a.delivery_id = ?
      ORDER BY a.assigned_at DESC
    `);
    return stmt.all(deliveryId);
  }
}

module.exports = new AssignmentRepository();
