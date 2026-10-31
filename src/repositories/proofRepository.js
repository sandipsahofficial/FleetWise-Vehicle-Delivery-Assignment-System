const { getDb } = require('../db/database');

class ProofRepository {
  upsertOtp({ delivery_id, otp_hash, otp_expires_at }) {
    const db = getDb();
    db.prepare(`
      INSERT INTO delivery_proofs (
        delivery_id, proof_type, otp_hash, otp_expires_at, otp_attempts, otp_locked, created_at
      ) VALUES (?, 'otp', ?, ?, 0, 0, DATETIME('now'))
      ON CONFLICT(delivery_id) DO UPDATE SET
        otp_hash = excluded.otp_hash,
        otp_expires_at = excluded.otp_expires_at,
        otp_attempts = 0,
        otp_locked = 0
    `).run(delivery_id, otp_hash, otp_expires_at);
  }

  getProof(delivery_id) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM delivery_proofs WHERE delivery_id = ?
    `).get(delivery_id) || null;
  }

  incrementOtpAttempts(delivery_id) {
    const db = getDb();
    db.prepare(`
      UPDATE delivery_proofs
      SET otp_attempts = otp_attempts + 1
      WHERE delivery_id = ?
    `).run(delivery_id);

    const updated = this.getProof(delivery_id);
    return updated ? updated.otp_attempts : 0;
  }

  lockOtp(delivery_id) {
    const db = getDb();
    db.prepare(`
      UPDATE delivery_proofs
      SET otp_locked = 1
      WHERE delivery_id = ?
    `).run(delivery_id);
  }

  recordOtpCompletion({ delivery_id, lat = null, lng = null }) {
    const db = getDb();
    db.prepare(`
      INSERT INTO delivery_proofs (
        delivery_id, proof_type, lat, lng, completed_at
      ) VALUES (?, 'otp', ?, ?, DATETIME('now'))
      ON CONFLICT(delivery_id) DO UPDATE SET
        proof_type = 'otp',
        lat = excluded.lat,
        lng = excluded.lng,
        completed_at = DATETIME('now')
    `).run(delivery_id, lat, lng);
  }

  recordPhotoCompletion({ delivery_id, photo_path, photo_mime, photo_size, lat = null, lng = null }) {
    const db = getDb();
    db.prepare(`
      INSERT INTO delivery_proofs (
        delivery_id, proof_type, photo_path, photo_mime, photo_size, lat, lng, completed_at
      ) VALUES (?, 'photo', ?, ?, ?, ?, ?, DATETIME('now'))
      ON CONFLICT(delivery_id) DO UPDATE SET
        proof_type = 'photo',
        photo_path = excluded.photo_path,
        photo_mime = excluded.photo_mime,
        photo_size = excluded.photo_size,
        lat = excluded.lat,
        lng = excluded.lng,
        completed_at = DATETIME('now')
    `).run(delivery_id, photo_path, photo_mime, photo_size, lat, lng);
  }
}

module.exports = new ProofRepository();

