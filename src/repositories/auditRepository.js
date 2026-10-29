const { getDb } = require('../db/database');
const crypto = require('node:crypto');

class AuditRepository {
  createLog(entry) {
    const db = getDb();
    const id = `AUD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, old_state, new_state, performed_by, timestamp, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now'), ?)
    `);
    stmt.run(
      id,
      entry.entity_type,
      entry.entity_id,
      entry.action,
      entry.old_state ? JSON.stringify(entry.old_state) : null,
      entry.new_state ? JSON.stringify(entry.new_state) : null,
      entry.performed_by || 'system',
      entry.details || null
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM audit_logs WHERE id = ?`);
    const row = stmt.get(id);
    if (!row) return null;
    return this._formatLog(row);
  }

  findAll(filters = {}) {
    const db = getDb();
    let query = `SELECT * FROM audit_logs`;
    const params = [];
    const clauses = [];

    if (filters.entity_type) {
      clauses.push('entity_type = ?');
      params.push(filters.entity_type);
    }
    if (filters.entity_id) {
      clauses.push('entity_id = ?');
      params.push(filters.entity_id);
    }

    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(' AND ')}`;
    }

    query += ' ORDER BY timestamp DESC';

    const limit = parseInt(filters.limit || '100', 10);
    query += ` LIMIT ${limit}`;

    const rows = db.prepare(query).all(...params);
    return rows.map(r => this._formatLog(r));
  }

  _formatLog(row) {
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: row.action,
      old_state: row.old_state ? JSON.parse(row.old_state) : null,
      new_state: row.new_state ? JSON.parse(row.new_state) : null,
      performed_by: row.performed_by,
      timestamp: row.timestamp,
      details: row.details
    };
  }
}

module.exports = new AuditRepository();

