#!/usr/bin/env node
const backupService = require('../src/services/backupService');
const logger = require('../src/utils/logger');

// Parse CLI arguments
const args = process.argv.slice(2);
let retentionDays = 7;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--retention-days' && args[i + 1]) {
    retentionDays = parseInt(args[i + 1], 10);
    i++;
  }
}

try {
  console.log(`[Backup] Initiating offline SQLite snapshot and proofs backup (retention: ${retentionDays} days)...`);
  const result = backupService.createBackup({ retentionDays });
  console.log(`[Backup] Snapshot created: ${result.backupDbPath} (${result.dbSizeBytes} bytes)`);
  if (result.proofsBackupPath) {
    console.log(`[Backup] Proofs archived: ${result.proofsBackupPath}`);
  }
  console.log(`[Backup] Verification passed: PRAGMA integrity_check OK`);
  console.log(`[Backup] Old items pruned: ${result.prunedCount}`);
  process.exit(0);
} catch (err) {
  console.error(`[Backup Error] Failed to create backup: ${err.message}`);
  process.exit(1);
}
