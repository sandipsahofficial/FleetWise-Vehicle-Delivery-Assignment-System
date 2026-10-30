const { getDb } = require('../db/database');
const crypto = require('node:crypto');

class LocationRepository {
  upsertLatestLocation({ driver_id, lat, lng, speed = 0, heading = 0, timestamp }) {
    const db = getDb();
    const ts = timestamp || new Date().toISOString();
    
    db.prepare(`
      INSERT INTO driver_locations (driver_id, lat, lng, speed, heading, timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, DATETIME('now'))
      ON CONFLICT(driver_id) DO UPDATE SET
        lat = excluded.lat,
        lng = excluded.lng,
        speed = excluded.speed,
        heading = excluded.heading,
        timestamp = excluded.timestamp,
        updated_at = DATETIME('now')
    `).run(driver_id, lat, lng, speed, heading, ts);

    // Also record into history
    this.recordHistoryPoint({ driver_id, lat, lng, speed, heading, timestamp: ts });
    
    // Prune history (keep max 100 rows per driver and rows younger than 7 days)
    this.pruneOldHistory(driver_id);

    return this.getLatestLocation(driver_id);
  }

  recordHistoryPoint({ driver_id, lat, lng, speed = 0, heading = 0, timestamp }) {
    const db = getDb();
    const id = crypto.randomUUID();
    const ts = timestamp || new Date().toISOString();
    db.prepare(`
      INSERT INTO driver_location_history (id, driver_id, lat, lng, speed, heading, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, driver_id, lat, lng, speed, heading, ts);
  }

  getLatestLocation(driver_id) {
    const db = getDb();
    return db.prepare(`
      SELECT dl.*, d.name AS driver_name, d.phone AS driver_phone, d.availability_status
      FROM driver_locations dl
      JOIN drivers d ON d.id = dl.driver_id
      WHERE dl.driver_id = ?
    `).get(driver_id) || null;
  }

  getAllLatestLocations() {
    const db = getDb();
    return db.prepare(`
      SELECT 
        dl.driver_id,
        dl.lat,
        dl.lng,
        dl.speed,
        dl.heading,
        dl.timestamp,
        dl.updated_at,
        d.name AS driver_name,
        d.phone AS driver_phone,
        d.availability_status,
        a.delivery_id,
        a.vehicle_id,
        v.registration_number AS vehicle_registration,
        v.type AS vehicle_type,
        del.status AS delivery_status,
        del.pickup_address,
        del.dropoff_address
      FROM driver_locations dl
      JOIN drivers d ON d.id = dl.driver_id
      LEFT JOIN assignments a ON a.driver_id = dl.driver_id AND a.is_active = 1
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      LEFT JOIN deliveries del ON del.id = a.delivery_id
      ORDER BY dl.updated_at DESC
    `).all();
  }

  getDriverHistory(driver_id, limit = 50) {
    const db = getDb();
    return db.prepare(`
      SELECT id, driver_id, lat, lng, speed, heading, timestamp
      FROM driver_location_history
      WHERE driver_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(driver_id, limit);
  }

  pruneOldHistory(driver_id) {
    const db = getDb();
    // 1. Time-based retention: delete points older than 7 days
    db.prepare(`
      DELETE FROM driver_location_history
      WHERE driver_id = ? AND timestamp < DATETIME('now', '-7 days')
    `).run(driver_id);

    // 2. Count-based retention: keep at most 100 recent points
    db.prepare(`
      DELETE FROM driver_location_history
      WHERE driver_id = ? AND id NOT IN (
        SELECT id FROM driver_location_history
        WHERE driver_id = ?
        ORDER BY timestamp DESC
        LIMIT 100
      )
    `).run(driver_id, driver_id);
  }
}

module.exports = new LocationRepository();
