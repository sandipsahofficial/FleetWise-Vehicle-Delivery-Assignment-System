const crypto = require('node:crypto');
const { getDb } = require('../db/database');

class TrackingRepository {
  upsertTrackingLink({ delivery_id, token_hash, expires_at }) {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO tracking_links (
        id, delivery_id, token_hash, expires_at, revoked, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, DATETIME('now'), DATETIME('now'))
      ON CONFLICT(token_hash) DO UPDATE SET
        expires_at = excluded.expires_at,
        revoked = 0,
        updated_at = DATETIME('now')
    `).run(id, delivery_id, token_hash, expires_at);
  }

  findByTokenHash(token_hash) {
    const db = getDb();
    return db.prepare(`
      SELECT tl.*, d.status AS delivery_status, d.scheduled_time, d.pickup_address, d.dropoff_address
      FROM tracking_links tl
      JOIN deliveries d ON d.id = tl.delivery_id
      WHERE tl.token_hash = ?
    `).get(token_hash) || null;
  }

  findByDeliveryId(delivery_id) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM tracking_links WHERE delivery_id = ?
    `).get(delivery_id) || null;
  }

  revokeByDeliveryId(delivery_id) {
    const db = getDb();
    db.prepare(`
      UPDATE tracking_links
      SET revoked = 1, updated_at = DATETIME('now')
      WHERE delivery_id = ?
    `).run(delivery_id);
  }

  updateExpiryOnCompletion(delivery_id, hours = 48) {
    const db = getDb();
    db.prepare(`
      UPDATE tracking_links
      SET expires_at = DATETIME('now', ?), updated_at = DATETIME('now')
      WHERE delivery_id = ?
    `).run(`+${hours} hours`, delivery_id);
  }
}

module.exports = new TrackingRepository();

