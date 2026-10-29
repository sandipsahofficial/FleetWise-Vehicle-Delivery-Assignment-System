const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

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

    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

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

