const { getDb } = require('../db/database');

const userRepository = {
  create({ id, username, password_hash, role = 'dispatcher', driver_id = null }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO users (id, username, password_hash, role, driver_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, username, password_hash, role, driver_id);
    return this.findById(id);
  },

  findByUsername(username) {
    const db = getDb();
    return db.prepare(`
      SELECT id, username, password_hash, role, driver_id, created_at, updated_at
      FROM users
      WHERE username = ?
    `).get(username) || null;
  },

  findById(id) {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, username, role, driver_id, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(id);
    return row || null;
  },

  listUsers({ limit = 50, offset = 0, role = null } = {}) {
    const db = getDb();
    if (role) {
      return db.prepare(`
        SELECT id, username, role, driver_id, created_at, updated_at
        FROM users
        WHERE role = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(role, limit, offset);
    }
    return db.prepare(`
      SELECT id, username, role, driver_id, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  },

  countUsers({ role = null } = {}) {
    const db = getDb();
    if (role) {
      const row = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get(role);
      return row.count;
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
    return row.count;
  },

  // Refresh token management (stores token_hash)
  storeRefreshToken({ id, user_id, token_hash, expires_at }) {
    const db = getDb();
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(id, user_id, token_hash, expires_at);
  },

  findRefreshToken(token_hash) {
    const db = getDb();
    return db.prepare(`
      SELECT rt.id, rt.user_id, rt.token_hash, rt.expires_at, rt.revoked_at,
             u.username, u.role, u.driver_id
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ?
    `).get(token_hash) || null;
  },

  revokeRefreshToken(token_hash) {
    const db = getDb();
    db.prepare(`
      UPDATE refresh_tokens
      SET revoked_at = DATETIME('now')
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(token_hash);
  },

  revokeAllUserRefreshTokens(user_id) {
    const db = getDb();
    db.prepare(`
      UPDATE refresh_tokens
      SET revoked_at = DATETIME('now')
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(user_id);
  }
};

module.exports = userRepository;

