const crypto = require('node:crypto');
const { getDb } = require('../db/database');

class NotificationRepository {
  // -------------------------------------------------------------
  // Customer Contacts
  // -------------------------------------------------------------
  upsertContact({ delivery_id, name, email, phone = null, consent = 0, recorded_by = 'dispatcher' }) {
    const db = getDb();
    const id = `CST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const consentVal = consent ? 1 : 0;
    const consentAt = consentVal ? new Date().toISOString() : null;

    db.prepare(`
      INSERT INTO customer_contacts (id, delivery_id, name, email, phone, consent, consent_at, consent_recorded_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'))
      ON CONFLICT(delivery_id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        consent = excluded.consent,
        consent_at = excluded.consent_at,
        consent_recorded_by = excluded.consent_recorded_by,
        updated_at = DATETIME('now')
    `).run(id, delivery_id, name, email, phone, consentVal, consentAt, recorded_by);

    // Revoking consent immediately cancels pending outbox notifications for this delivery
    if (consentVal === 0) {
      db.prepare(`
        UPDATE notification_outbox
        SET status = 'cancelled', error_message = 'Customer revoked notification consent', locked_until = NULL, params_json = NULL
        WHERE delivery_id = ? AND status IN ('pending', 'processing')
      `).run(delivery_id);
    }

    return this.findByDeliveryId(delivery_id);
  }

  findByDeliveryId(deliveryId) {
    const db = getDb();
    return db.prepare('SELECT * FROM customer_contacts WHERE delivery_id = ?').get(deliveryId);
  }

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM customer_contacts WHERE id = ?').get(id);
  }

  anonymizeByDeliveryId(deliveryId) {
    const db = getDb();
    db.prepare(`
      UPDATE customer_contacts
      SET name = 'Anonymous Customer',
          email = 'anonymized@fleetwise.local',
          phone = NULL,
          consent = 0,
          consent_at = NULL,
          consent_recorded_by = 'system_gdpr',
          updated_at = DATETIME('now')
      WHERE delivery_id = ?
    `).run(deliveryId);

    db.prepare(`
      UPDATE notification_outbox
      SET status = 'cancelled', error_message = 'Customer opted out / contact anonymized', locked_until = NULL, params_json = NULL
      WHERE delivery_id = ? AND status IN ('pending', 'processing')
    `).run(deliveryId);

    return this.findByDeliveryId(deliveryId);
  }

  deleteByDeliveryId(deliveryId) {
    const db = getDb();
    return db.prepare('DELETE FROM customer_contacts WHERE delivery_id = ?').run(deliveryId);
  }

  // -------------------------------------------------------------
  // Notification Outbox
  // -------------------------------------------------------------
  insertOutboxRow(db, { delivery_id, event, channel = 'email', recipient, template, params = {}, idempotency_key }) {
    const id = `NTF-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const targetDb = db || getDb();

    // Idempotent insert: IGNORE if identical idempotency_key already queued
    targetDb.prepare(`
      INSERT OR IGNORE INTO notification_outbox (
        id, delivery_id, event, channel, recipient, template, params_json,
        status, attempts, max_attempts, idempotency_key, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, DATETIME('now'))
    `).run(
      id,
      delivery_id,
      event,
      channel,
      recipient,
      template,
      JSON.stringify(params),
      idempotency_key
    );

    return targetDb.prepare('SELECT * FROM notification_outbox WHERE idempotency_key = ?').get(idempotency_key);
  }

  /**
   * Claims a batch of pending/retryable notifications by moving status to 'processing'
   * and setting a 5-minute lease in locked_until.
   */
  claimBatch(batchSize = 10) {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');

    try {
      const candidates = db.prepare(`
        SELECT id FROM notification_outbox
        WHERE (
          (status = 'pending' AND (locked_until IS NULL OR locked_until < DATETIME('now')))
          OR (status = 'processing' AND locked_until < DATETIME('now'))
          OR (status = 'failed' AND attempts < max_attempts AND (locked_until IS NULL OR locked_until < DATETIME('now')))
        )
        ORDER BY created_at ASC
        LIMIT ?
      `).all(batchSize);

      if (candidates.length === 0) {
        db.exec('COMMIT');
        return [];
      }

      const ids = candidates.map(c => c.id);
      const placeholders = ids.map(() => '?').join(',');

      db.prepare(`
        UPDATE notification_outbox
        SET status = 'processing',
            locked_until = DATETIME('now', '+5 minutes')
        WHERE id IN (${placeholders})
      `).run(...ids);

      const claimed = db.prepare(`
        SELECT * FROM notification_outbox WHERE id IN (${placeholders})
      `).all(...ids);

      db.exec('COMMIT');
      return claimed;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }

  markSent(id) {
    const db = getDb();
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'sent',
          sent_at = DATETIME('now'),
          locked_until = NULL,
          params_json = NULL
      WHERE id = ?
    `).run(id);
  }

  updateStatus(id, status, errorMessage = null) {
    const db = getDb();
    db.prepare(`
      UPDATE notification_outbox
      SET status = ?,
          error_message = ?,
          locked_until = NULL,
          params_json = NULL
      WHERE id = ?
    `).run(status, errorMessage, id);
  }

  markFailed(id, errorMessage, delaySeconds = 60) {
    const db = getDb();
    const row = db.prepare('SELECT attempts, max_attempts FROM notification_outbox WHERE id = ?').get(id);
    if (!row) return;

    const nextAttempts = row.attempts + 1;
    const isFinalFail = nextAttempts >= row.max_attempts;

    if (isFinalFail) {
      db.prepare(`
        UPDATE notification_outbox
        SET status = 'failed',
            attempts = ?,
            error_message = ?,
            locked_until = NULL,
            params_json = NULL
        WHERE id = ?
      `).run(nextAttempts, String(errorMessage).slice(0, 500), id);
    } else {
      db.prepare(`
        UPDATE notification_outbox
        SET status = 'pending',
            attempts = ?,
            error_message = ?,
            locked_until = DATETIME('now', '+' || ? || ' seconds')
        WHERE id = ?
      `).run(nextAttempts, String(errorMessage).slice(0, 500), delaySeconds, id);
    }
  }

  getOutboxEntries({ status, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    if (status) {
      return db.prepare(`
        SELECT id, delivery_id, event, channel, recipient, template, status, attempts, max_attempts, idempotency_key, locked_until, error_message, created_at, sent_at
        FROM notification_outbox
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(status, limit, offset);
    }

    return db.prepare(`
      SELECT id, delivery_id, event, channel, recipient, template, status, attempts, max_attempts, idempotency_key, locked_until, error_message, created_at, sent_at
      FROM notification_outbox
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  pruneOldOutbox(days = 30) {
    const db = getDb();
    return db.prepare(`
      DELETE FROM notification_outbox
      WHERE (status = 'sent' OR status = 'failed')
        AND created_at < DATETIME('now', '-' || ? || ' days')
    `).run(days);
  }
}

module.exports = new NotificationRepository();
