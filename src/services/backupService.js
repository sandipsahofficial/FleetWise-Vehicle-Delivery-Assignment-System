const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

class BackupService {
  /**
   * Creates an atomic SQLite snapshot via VACUUM INTO, verifies integrity,
   * archives storage proofs, and prunes older backups according to retention policy.
   */
  createBackup(options = {}) {
    const backupDir = options.targetDir || config.backupDir;
    const retentionDays = typeof options.retentionDays === 'number' ? options.retentionDays : 7;
    const db = options.db || getDb(options.customDbPath);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDbFilename = `fleetwise-${timestamp}.db`;
    const backupDbPath = path.join(backupDir, backupDbFilename);

    // 1. Create SQLite snapshot using VACUUM INTO
    // Escape single quotes for SQL literal
    const escapedPath = backupDbPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}';`);

    // 2. Run PRAGMA integrity_check on the generated snapshot
    this.verifyBackup(backupDbPath);

    // 3. Backup proofs storage if exists
    const storageDir = options.storageDir || config.storageDir;
    let proofsBackupPath = null;
    if (fs.existsSync(storageDir)) {
      const proofsBackupDirname = `proofs-${timestamp}`;
      proofsBackupPath = path.join(backupDir, proofsBackupDirname);
      fs.cpSync(storageDir, proofsBackupPath, { recursive: true });
    }

    // 4. Save companion metadata manifest
    const stats = fs.statSync(backupDbPath);
    const manifest = {
      timestamp: new Date().toISOString(),
      backupDbFilename,
      backupDbPath,
      proofsBackupPath,
      dbSizeBytes: stats.size,
      version: '1.0.0'
    };
    const manifestPath = path.join(backupDir, `fleetwise-${timestamp}-meta.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // 5. Prune backups older than retention policy
    const prunedCount = this.pruneBackups(backupDir, retentionDays);

    logger.info({ backupDbPath, proofsBackupPath, prunedCount }, 'Backup created and verified successfully');

    return {
      backupDbPath,
      proofsBackupPath,
      manifestPath,
      dbSizeBytes: stats.size,
      prunedCount,
      timestamp: manifest.timestamp
    };
  }

  /**
   * Verifies database snapshot integrity. Throws if corrupted.
   */
  verifyBackup(backupDbPath) {
    if (!fs.existsSync(backupDbPath)) {
      throw new Error(`Backup file does not exist: ${backupDbPath}`);
    }

    const verifyDb = new DatabaseSync(backupDbPath);
    try {
      const row = verifyDb.prepare('PRAGMA integrity_check;').get();
      if (!row || row.integrity_check !== 'ok') {
        throw new Error(`Integrity check failed for ${backupDbPath}: ${JSON.stringify(row)}`);
      }
      return true;
    } finally {
      try {
        verifyDb.close();
      } catch (_) {}
    }
  }

  /**
   * Prunes backup files older than retention policy.
   */
  pruneBackups(backupDir, retentionDays) {
    if (!fs.existsSync(backupDir) || retentionDays <= 0) return 0;

    const cutoffTime = Date.now() - retentionDays * 24 * 3600 * 1000;
    const entries = fs.readdirSync(backupDir);
    let pruned = 0;

    for (const entry of entries) {
      const fullPath = path.join(backupDir, entry);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs < cutoffTime) {
          if (stats.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          pruned++;
        }
      } catch (err) {
        logger.warn({ path: fullPath, error: err.message }, 'Failed to prune old backup item');
      }
    }

    return pruned;
  }

  /**
   * Offline restore: Restores a verified snapshot to the target database and storage locations.
   */
  restoreBackup(options = {}) {
    const { backupDbPath, proofsBackupPath, targetDbPath = config.dbPath, targetProofsDir = config.storageDir } = options;

    if (!backupDbPath || !fs.existsSync(backupDbPath)) {
      throw new Error(`Cannot restore: Backup DB file not found at ${backupDbPath}`);
    }

    // 1. Verify integrity of the backup before proceeding
    this.verifyBackup(backupDbPath);

    // 2. Ensure target directories exist
    const targetDbDir = path.dirname(targetDbPath);
    if (!fs.existsSync(targetDbDir)) {
      fs.mkdirSync(targetDbDir, { recursive: true });
    }

    // 3. Atomically copy database file
    fs.copyFileSync(backupDbPath, targetDbPath);

    // Remove any leftover WAL / SHM files for target DB
    try {
      if (fs.existsSync(`${targetDbPath}-wal`)) fs.unlinkSync(`${targetDbPath}-wal`);
      if (fs.existsSync(`${targetDbPath}-shm`)) fs.unlinkSync(`${targetDbPath}-shm`);
    } catch (_) {}

    // 4. Restore proofs if provided or if companion directory exists
    let effectiveProofsBackup = proofsBackupPath;
    if (!effectiveProofsBackup) {
      // Look for companion proofs folder next to backup DB
      const baseName = path.basename(backupDbPath, path.extname(backupDbPath));
      const companionDir = path.join(path.dirname(backupDbPath), baseName.replace('fleetwise-', 'proofs-'));
      if (fs.existsSync(companionDir)) {
        effectiveProofsBackup = companionDir;
      }
    }

    if (effectiveProofsBackup && fs.existsSync(effectiveProofsBackup)) {
      if (!fs.existsSync(targetProofsDir)) {
        fs.mkdirSync(targetProofsDir, { recursive: true });
      }
      fs.cpSync(effectiveProofsBackup, targetProofsDir, { recursive: true });
    }

    logger.info({ targetDbPath, targetProofsDir }, 'Backup successfully restored');

    return {
      restored: true,
      targetDbPath,
      targetProofsDir
    };
  }
}

module.exports = new BackupService();
module.exports.BackupService = BackupService;
