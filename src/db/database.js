const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const config = require('../config');
const logger = require('../utils/logger');

let dbInstance = null;

function initDatabase(customPath) {
  const targetPath = customPath || config.dbPath;

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);

  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON;');
  
  if (targetPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  // Create tables and indexes
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      registration_number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      capacity REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available', 'assigned', 'maintenance', 'inactive')) DEFAULT 'available',
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      availability_status TEXT NOT NULL CHECK(availability_status IN ('available', 'assigned', 'unavailable')) DEFAULT 'available',
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      pickup_address TEXT NOT NULL,
      dropoff_address TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('pending', 'assigned', 'in_transit', 'delivered', 'cancelled')) DEFAULT 'pending',
      notes TEXT,
      required_capacity REAL DEFAULT 0,
      required_vehicle_type TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      assigned_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      released_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
    );

    -- Audit Log Table
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_state TEXT,
      new_state TEXT,
      performed_by TEXT DEFAULT 'system',
      timestamp TEXT NOT NULL DEFAULT (DATETIME('now')),
      details TEXT
    );

    -- Users Table (Phase 1 Authentication & RBAC)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'dispatcher', 'driver', 'fleet_manager')),
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    -- Refresh Tokens Table (Phase 1 SHA-256 Hashed Storage)
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    -- Driver Live Locations (Phase 2 Real-Time Core)
    CREATE TABLE IF NOT EXISTS driver_locations (
      driver_id TEXT PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed REAL DEFAULT 0,
      heading REAL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    -- Driver Location History (Phase 2 with Automated Pruning & Time-based Retention)
    CREATE TABLE IF NOT EXISTS driver_location_history (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed REAL DEFAULT 0,
      heading REAL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_driver_history ON driver_location_history(driver_id, timestamp DESC);

    -- Partial unique indexes: prevents double-booking at the physical database schema level!
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assign_vehicle 
      ON assignments(vehicle_id) WHERE is_active = 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assign_driver 
      ON assignments(driver_id) WHERE is_active = 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assign_delivery 
      ON assignments(delivery_id) WHERE is_active = 1;

    -- Performance index on delivery status
    CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
  `);

  // Safe migration for required_capacity and required_vehicle_type on existing tables
  try {
    const colInfo = db.prepare("PRAGMA table_info(deliveries)").all();
    const hasCap = colInfo.some(c => c.name === 'required_capacity');
    if (!hasCap) {
      db.exec("ALTER TABLE deliveries ADD COLUMN required_capacity REAL DEFAULT 0;");
    }
    const hasType = colInfo.some(c => c.name === 'required_vehicle_type');
    if (!hasType) {
      db.exec("ALTER TABLE deliveries ADD COLUMN required_vehicle_type TEXT;");
    }
  } catch (_) {}

  // Safe migration for driver_id on users if table previously existed without it
  try {
    const userColInfo = db.prepare("PRAGMA table_info(users)").all();
    const hasDriverId = userColInfo.some(c => c.name === 'driver_id');
    if (!hasDriverId) {
      db.exec("ALTER TABLE users ADD COLUMN driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL;");
    }
  } catch (_) {}

  // Initial Admin User Seeding (ONLY from ADMIN_USERNAME & ADMIN_PASSWORD env vars, no hardcoded passwords)
  try {
    if (config.adminSeed.username && config.adminSeed.password) {
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(config.adminSeed.username);
      if (!existing) {
        const hash = bcrypt.hashSync(config.adminSeed.password, 10);
        const adminId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO users (id, username, password_hash, role)
          VALUES (?, ?, ?, 'admin')
        `).run(adminId, config.adminSeed.username, hash);
        logger.info({ username: config.adminSeed.username }, 'Initial admin user seeded from environment configuration');
      }
    }
  } catch (err) {
    logger.warn({ error: err.message }, 'Admin seeding skipped or encountered non-fatal error');
  }

  return db;
}

function getDb(customPath) {
  if (!dbInstance) {
    dbInstance = initDatabase(customPath);
  }
  return dbInstance;
}

function setDb(db) {
  dbInstance = db;
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
  }
}

function resetDbForTesting() {
  closeDb();
  const db = initDatabase(':memory:');
  dbInstance = db;
  return db;
}

module.exports = {
  initDatabase,
  getDb,
  setDb,
  closeDb,
  resetDbForTesting,
};
