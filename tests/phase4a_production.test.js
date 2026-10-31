const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { getDb, resetDbForTesting } = require('../src/db/database');
const {
  validateEnvironment,
  isStrongPassword,
  containsPlaceholder
} = require('../src/config');
const backupService = require('../src/services/backupService');

test('Phase 4A — Production Readiness, Observability, Health/Ready Probes & Backup/Restore', async (t) => {
  resetDbForTesting();

  const app = createApp({
    isTest: true,
    nodeEnv: 'test'
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await new Promise((r) => server.close(r));
  });

  // -------------------------------------------------------------
  // 1. Config Validation: Strong Secrets & Placeholders
  // -------------------------------------------------------------
  await t.test('1. Config: Password strength and placeholder detection', () => {
    assert.equal(isStrongPassword('weak'), false);
    assert.equal(isStrongPassword('nouppercase123!'), false);
    assert.equal(isStrongPassword('NOLOWERCASE123!'), false);
    assert.equal(isStrongPassword('NoSpecialChar1234'), false);
    assert.equal(isStrongPassword('NoNumbers!@#$%^'), false);
    assert.equal(isStrongPassword('AdminSecurePass123!'), true);

    assert.equal(containsPlaceholder('supersecret_key'), true);
    assert.equal(containsPlaceholder('my-change-me-key'), true);
    assert.equal(containsPlaceholder('this_is_your-secret_now'), true);
    assert.equal(containsPlaceholder('default_jwt_secret'), true);
    assert.equal(containsPlaceholder('production_strong_unique_random_entropy_key_999'), false);
  });

  // -------------------------------------------------------------
  // 2. Config: Production Environment Startup Validation
  // -------------------------------------------------------------
  await t.test('2. Config: Strict production environment validation rejects insecure configs', () => {
    const validBaseEnv = {
      NODE_ENV: 'production',
      JWT_SECRET: 'alpha_production_jwt_secret_token_at_least_32_characters_1',
      JWT_REFRESH_SECRET: 'beta_production_jwt_refresh_token_at_least_32_characters_2',
      OTP_HMAC_SECRET: 'gamma_production_otp_hmac_secret_at_least_32_characters_3',
      ADMIN_PASSWORD: 'ProductionSecureAdminPass123!',
      NOTIFICATIONS_ENABLED: 'false'
    };

    // Valid production config passes
    assert.doesNotThrow(() => validateEnvironment(validBaseEnv));

    // Reject short JWT_SECRET (<32 chars)
    assert.throws(
      () => validateEnvironment({ ...validBaseEnv, JWT_SECRET: 'short_key_12345' }),
      /FATAL: JWT_SECRET must be at least 32 characters long in production/
    );

    // Reject placeholder in JWT_SECRET
    assert.throws(
      () => validateEnvironment({ ...validBaseEnv, JWT_SECRET: 'supersecret_key_that_is_at_least_32_chars_long' }),
      /FATAL: JWT_SECRET contains an insecure placeholder or default pattern/
    );

    // Reject short JWT_REFRESH_SECRET (<32 chars)
    assert.throws(
      () => validateEnvironment({ ...validBaseEnv, JWT_REFRESH_SECRET: 'short_refresh_12345' }),
      /FATAL: JWT_REFRESH_SECRET must be at least 32 characters long in production/
    );

    // Reject placeholder in OTP_HMAC_SECRET
    assert.throws(
      () => validateEnvironment({ ...validBaseEnv, OTP_HMAC_SECRET: 'your-secret_hmac_key_that_is_32_chars_long' }),
      /FATAL: OTP_HMAC_SECRET contains an insecure placeholder/
    );

    // Reject non-distinct secrets (JWT_SECRET === JWT_REFRESH_SECRET)
    assert.throws(
      () => validateEnvironment({
        ...validBaseEnv,
        JWT_REFRESH_SECRET: validBaseEnv.JWT_SECRET
      }),
      /FATAL: JWT_SECRET, JWT_REFRESH_SECRET, and OTP_HMAC_SECRET must be mutually distinct/
    );

    // Reject non-distinct secrets (JWT_SECRET === OTP_HMAC_SECRET)
    assert.throws(
      () => validateEnvironment({
        ...validBaseEnv,
        OTP_HMAC_SECRET: validBaseEnv.JWT_SECRET
      }),
      /FATAL: JWT_SECRET, JWT_REFRESH_SECRET, and OTP_HMAC_SECRET must be mutually distinct/
    );

    // Reject weak ADMIN_PASSWORD in production
    assert.throws(
      () => validateEnvironment({
        ...validBaseEnv,
        ADMIN_PASSWORD: 'weakpassword'
      }),
      /FATAL: ADMIN_PASSWORD must be strong in production/
    );

    // Reject console notification provider in production when enabled
    assert.throws(
      () => validateEnvironment({
        ...validBaseEnv,
        NOTIFICATIONS_ENABLED: 'true',
        NOTIFICATION_PROVIDER: 'console'
      }),
      /FATAL: NOTIFICATION_PROVIDER cannot be "console" in production/
    );

    // Reject missing SMTP credentials when notifications enabled in production
    assert.throws(
      () => validateEnvironment({
        ...validBaseEnv,
        NOTIFICATIONS_ENABLED: 'true',
        NOTIFICATION_PROVIDER: 'smtp'
      }),
      /FATAL: SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured in production/
    );
  });

  // -------------------------------------------------------------
  // 3. Request ID Middleware & Header Propagation
  // -------------------------------------------------------------
  await t.test('3. Observability: X-Request-ID propagation and sanitization', async () => {
    // Case A: No incoming request ID -> server generates UUID
    const resA = await fetch(`${baseUrl}/health`);
    assert.equal(resA.status, 200);
    const reqIdA = resA.headers.get('x-request-id');
    assert.ok(reqIdA, 'Expected X-Request-ID header in response');
    assert.match(reqIdA, /^[0-9a-f-]{36}$/, 'Expected UUID format for generated request ID');

    // Case B: Valid incoming request ID -> preserved in response
    const customId = 'client-trace-id-998877';
    const resB = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-ID': customId }
    });
    assert.equal(resB.status, 200);
    assert.equal(resB.headers.get('x-request-id'), customId);

    // Case C: Invalid characters in incoming request ID -> replaced with safe UUID
    const invalidId = 'bad-id-with-symbols-!@#$%^&*()';
    const resC = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-ID': invalidId }
    });
    assert.equal(resC.status, 200);
    const sanitizedId = resC.headers.get('x-request-id');
    assert.notEqual(sanitizedId, invalidId);
    assert.match(sanitizedId, /^[0-9a-f-]{36}$/);

    // Case D: Exceeds 64 characters -> replaced with safe UUID
    const longId = 'a'.repeat(65);
    const resD = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-ID': longId }
    });
    assert.equal(resD.status, 200);
    assert.notEqual(resD.headers.get('x-request-id'), longId);
  });

  // -------------------------------------------------------------
  // 4. Liveness & Readiness Probes
  // -------------------------------------------------------------
  await t.test('4. Probes: GET /health (Liveness) and GET /ready (Readiness)', async () => {
    // GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'UP');
    assert.equal(healthBody.service, 'FleetWise');
    assert.equal(healthBody.database, 'connected');
    assert.ok(typeof healthBody.uptime === 'number');

    // GET /ready
    const readyRes = await fetch(`${baseUrl}/ready`);
    assert.equal(readyRes.status, 200);
    const readyBody = await readyRes.json();
    assert.equal(readyBody.ready, true);
  });

  // -------------------------------------------------------------
  // 5. Offline Backup & Restore Cycle
  // -------------------------------------------------------------
  await t.test('5. Disaster Recovery: Offline Backup & Restore Cycle', async () => {
    const tempDir = path.join(__dirname, '..', 'data', 'test_backups_' + Date.now());
    const tempProofsDir = path.join(tempDir, 'proofs_src');
    const tempRestoreDbDir = path.join(tempDir, 'restore_target');
    const tempRestoreProofsDir = path.join(tempDir, 'proofs_restored');

    fs.mkdirSync(tempProofsDir, { recursive: true });
    fs.mkdirSync(tempRestoreDbDir, { recursive: true });

    // Populate source data
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO vehicles (id, registration_number, type, capacity, status)
      VALUES ('VEH-BK-1', 'BK-REG-100', 'Van', 1200, 'available')
    `).run();

    // Create dummy proof file
    const sampleProof = path.join(tempProofsDir, 'sample_pod.jpg');
    fs.writeFileSync(sampleProof, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    try {
      // 1. Create hot backup
      const backupResult = backupService.createBackup({
        targetDir: tempDir,
        storageDir: tempProofsDir,
        retentionDays: 7
      });

      assert.ok(fs.existsSync(backupResult.backupDbPath), 'Backup SQLite snapshot must exist');
      assert.ok(fs.existsSync(backupResult.manifestPath), 'Backup manifest must exist');
      assert.ok(backupResult.dbSizeBytes > 0, 'Backup DB must have non-zero size');

      // 2. Verify snapshot integrity
      const isIntegrityOk = backupService.verifyBackup(backupResult.backupDbPath);
      assert.equal(isIntegrityOk, true);

      // 3. Perform offline restore into new target location
      const restoreTargetDb = path.join(tempRestoreDbDir, 'restored.db');
      const restoreResult = backupService.restoreBackup({
        backupDbPath: backupResult.backupDbPath,
        proofsBackupPath: backupResult.proofsBackupPath,
        targetDbPath: restoreTargetDb,
        targetProofsDir: tempRestoreProofsDir
      });

      assert.equal(restoreResult.restored, true);
      assert.ok(fs.existsSync(restoreTargetDb), 'Restored DB file must exist');

      // Verify restored database contains pre-backup records
      const restoredDb = new DatabaseSync(restoreTargetDb);
      const vehicleRow = restoredDb.prepare('SELECT * FROM vehicles WHERE id = ?').get('VEH-BK-1');
      assert.ok(vehicleRow, 'Record from original DB must exist in restored DB');
      assert.equal(vehicleRow.registration_number, 'BK-REG-100');
      restoredDb.close();

      // Verify restored proofs exist
      const restoredProof = path.join(tempRestoreProofsDir, 'sample_pod.jpg');
      assert.ok(fs.existsSync(restoredProof), 'Restored photo proof must exist');

      // 4. Verify that restoring an invalid/corrupted file fails
      const corruptFile = path.join(tempDir, 'corrupt.db');
      fs.writeFileSync(corruptFile, 'not a valid sqlite database content');
      assert.throws(
        () => backupService.restoreBackup({ backupDbPath: corruptFile, targetDbPath: restoreTargetDb }),
        /Integrity check failed|not a database/i
      );
    } finally {
      // Cleanup temp directories
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  // -------------------------------------------------------------
  // 6. Graceful Shutdown Functionality
  // -------------------------------------------------------------
  await t.test('6. Process Lifecycle: Graceful shutdown handler', () => {
    const serverModule = require('../src/server');
    assert.equal(typeof serverModule.gracefulShutdown, 'function');
  });
});
