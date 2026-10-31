#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const backupService = require('../src/services/backupService');

// Parse CLI arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
FleetWise Offline Database & Proofs Restore Utility
Usage:
  node scripts/restore.js <path-to-backup-db-file> [--target-db <path>] [--proofs <path>]

Options:
  --target-db <path>    Custom target SQLite database path (defaults to config.dbPath)
  --proofs <path>       Companion proofs directory to restore (defaults to companion proofs folder)
`);
  process.exit(args.length === 0 ? 1 : 0);
}

const backupDbPath = path.resolve(args[0]);
let targetDbPath = undefined;
let proofsBackupPath = undefined;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--target-db' && args[i + 1]) {
    targetDbPath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--proofs' && args[i + 1]) {
    proofsBackupPath = path.resolve(args[i + 1]);
    i++;
  }
}

try {
  console.log(`[Restore] Verifying snapshot integrity for: ${backupDbPath}...`);
  const result = backupService.restoreBackup({
    backupDbPath,
    proofsBackupPath,
    targetDbPath
  });
  console.log(`[Restore] PRAGMA integrity_check passed.`);
  console.log(`[Restore] Restored database to: ${result.targetDbPath}`);
  if (result.targetProofsDir) {
    console.log(`[Restore] Restored proofs to: ${result.targetProofsDir}`);
  }
  console.log(`[Restore] Offline restoration complete. Server may now be restarted.`);
  process.exit(0);
} catch (err) {
  console.error(`[Restore Error] Restore failed: ${err.message}`);
  process.exit(1);
}
