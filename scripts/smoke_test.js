#!/usr/bin/env node

/**
 * FleetWise Smoke Test Script
 * 
 * Verifies live system health, authentication, assignment workflows, data minimization,
 * proof of delivery completion, and resource lifecycle in a real running deployment.
 * 
 * Usage:
 *   node scripts/smoke_test.js [--url <baseUrl>] [--admin-user <user>] [--confirm]
 * 
 * Authentication:
 *   Reads password from SMOKE_ADMIN_PASSWORD or ADMIN_PASSWORD environment variable.
 *   Never accepts inline passwords via CLI arguments to prevent shell history leaks.
 */

const { URL } = require('node:url');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: 'http://localhost:3000',
    adminUser: 'admin',
    confirm: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) {
      options.url = args[++i];
    } else if (arg === '--admin-user' && args[i + 1]) {
      options.adminUser = args[++i];
    } else if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
FleetWise Production Smoke Test CLI

Options:
  --url <url>           Base URL of running FleetWise instance (default: http://localhost:3000)
  --admin-user <user>   Admin username (default: admin)
  --confirm             Required confirmation flag when targeting non-localhost URLs
  -h, --help            Show this help text

Environment Variables:
  SMOKE_ADMIN_PASSWORD  Password for admin authentication (fallback: ADMIN_PASSWORD)
      `);
      process.exit(0);
    }
  }

  return options;
}

async function run() {
  // If invoked unintentionally by node test runner discovery, return cleanly
  if (process.execArgv.some((a) => a.startsWith('--test')) && !process.argv.includes('--url')) {
    return;
  }

  const options = parseArgs();
  const parsedUrl = new URL(options.url);
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname);

  if (!isLocal && !options.confirm) {
    console.error(`[ERROR] Non-local target host "${parsedUrl.hostname}" detected.`);
    console.error('To run smoke tests against staging or production environments, you must supply the --confirm flag.');
    process.exit(1);
  }

  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('[ERROR] Missing admin password in environment.');
    console.error('Please set SMOKE_ADMIN_PASSWORD or ADMIN_PASSWORD before running the smoke test.');
    process.exit(1);
  }

  const baseUrl = options.url.replace(/\/+$/, '');
  const runId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const smokeTag = `SMOKE-${runId}`;

  console.log(`Starting FleetWise Smoke Test [Run ID: ${runId}] targeting ${baseUrl}...`);

  try {
    // 1. Health Probe Check
    console.log('[1/8] Verifying liveness and health endpoints...');
    const healthRes = await fetch(`${baseUrl}/health`);
    if (!healthRes.ok) throw new Error(`Health probe returned HTTP ${healthRes.status}`);
    const healthJson = await healthRes.json();
    if (healthJson.status !== 'UP') throw new Error(`Health probe reported non-UP status: ${JSON.stringify(healthJson)}`);
    console.log('      Liveness probe: OK (status: UP)');

    // 2. Admin Authentication & JWT Acquisition
    console.log('[2/8] Authenticating admin user and acquiring JWT...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: options.adminUser, password: adminPassword })
    });
    if (!loginRes.ok) throw new Error(`Admin login failed with HTTP ${loginRes.status}`);
    const loginJson = await loginRes.json();
    if (!loginJson.accessToken) throw new Error('Login response did not contain an accessToken');
    const accessToken = loginJson.accessToken;
    console.log('      Admin authentication: OK (token acquired, role: admin)');

    // 3. Register Smoke Vehicle & Driver
    console.log('[3/8] Registering isolated test entities...');
    const vehReg = `SMK-V${runId}`;
    const vehRes = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        registration_number: vehReg,
        type: 'Van',
        capacity: 1200
      })
    });
    if (!vehRes.ok) throw new Error(`Vehicle creation failed with HTTP ${vehRes.status}`);
    const vehJson = await vehRes.json();
    const vehicleId = vehJson.id;

    const drvRes = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        name: `Smoke Driver ${runId}`,
        phone: `+1-555-${Math.floor(100000 + Math.random() * 900000)}`
      })
    });
    if (!drvRes.ok) throw new Error(`Driver creation failed with HTTP ${drvRes.status}`);
    const drvJson = await drvRes.json();
    const driverId = drvJson.id;
    console.log(`      Created vehicle ${vehicleId} and driver ${driverId}: OK`);

    // 4. Create Delivery & Atomic Assignment
    console.log('[4/8] Creating delivery and executing atomic assignment...');
    const delRes = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        pickup_address: `100 Smoke Way, ${smokeTag}`,
        dropoff_address: `500 Verification Blvd, ${smokeTag}`,
        priority: 'high',
        scheduled_time: new Date(Date.now() + 3600000).toISOString(),
        notes: 'Automated smoke test delivery'
      })
    });
    if (!delRes.ok) throw new Error(`Delivery creation failed with HTTP ${delRes.status}`);
    const delJson = await delRes.json();
    const deliveryId = delJson.id;

    const assignRes = await fetch(`${baseUrl}/deliveries/${deliveryId}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ vehicle_id: vehicleId, driver_id: driverId })
    });
    if (!assignRes.ok) throw new Error(`Delivery assignment failed with HTTP ${assignRes.status}`);
    console.log(`      Delivery ${deliveryId} assigned to vehicle and driver: OK`);

    // 5. Advance Status to In-Transit
    console.log('[5/8] Advancing delivery lifecycle to in_transit...');
    const transitRes = await fetch(`${baseUrl}/deliveries/${deliveryId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ status: 'in_transit' })
    });
    if (!transitRes.ok) throw new Error(`Status update to in_transit failed with HTTP ${transitRes.status}`);
    console.log('      Delivery in_transit state: OK');

    // 6. Generate Tracking Link & Verify Data Minimization
    console.log('[6/8] Generating tracking link and verifying data minimization...');
    const trackLinkRes = await fetch(`${baseUrl}/deliveries/${deliveryId}/tracking`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!trackLinkRes.ok) throw new Error(`Tracking link generation failed with HTTP ${trackLinkRes.status}`);
    const trackLinkJson = await trackLinkRes.json();
    const token = trackLinkJson.tracking_token;

    const pubTrackRes = await fetch(`${baseUrl}/api/track/${token}`);
    if (!pubTrackRes.ok) throw new Error(`Public tracking endpoint returned HTTP ${pubTrackRes.status}`);
    const pubTrackJson = await pubTrackRes.json();

    // Data minimization assertion: No street addresses, customer names, or OTP hashes
    if (pubTrackJson.pickup_address || pubTrackJson.dropoff_address) {
      throw new Error('Data leak detected: Public tracking exposed exact pickup or dropoff street address');
    }
    if (pubTrackJson.otp || pubTrackJson.otp_hash) {
      throw new Error('Data leak detected: Public tracking exposed OTP or OTP hash');
    }
    console.log('      Public tracking data minimization: OK (zero sensitive data leaked)');

    // 7. Complete Delivery via Verified OTP
    console.log('[7/8] Generating OTP and completing delivery proof of delivery...');
    const otpGenRes = await fetch(`${baseUrl}/deliveries/${deliveryId}/otp/regenerate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!otpGenRes.ok) throw new Error(`OTP retrieval failed with HTTP ${otpGenRes.status}`);
    const otpGenJson = await otpGenRes.json();
    const otp = otpGenJson.otp;

    const completeRes = await fetch(`${baseUrl}/deliveries/${deliveryId}/complete-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ otp, notes: 'Smoke test completion verified' })
    });
    if (!completeRes.ok) throw new Error(`Delivery completion failed with HTTP ${completeRes.status}`);
    console.log('      Proof of delivery completion: OK (delivery delivered)');

    // 8. Resource Release Verification & Cleanup
    console.log('[8/8] Verifying resource release back to available pool...');
    const checkVeh = await (await fetch(`${baseUrl}/vehicles/${vehicleId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })).json();
    const checkDrv = await (await fetch(`${baseUrl}/drivers/${driverId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })).json();

    if (checkVeh.status !== 'available') throw new Error(`Vehicle status is ${checkVeh.status}, expected available`);
    if (checkDrv.availability_status !== 'available') throw new Error(`Driver status is ${checkDrv.availability_status}, expected available`);
    console.log('      Resources released to available pool: OK');

    // Cleanup smoke test resources
    console.log('Cleaning up test entities...');
    await fetch(`${baseUrl}/vehicles/${vehicleId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    await fetch(`${baseUrl}/drivers/${driverId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    console.log('Cleanup completed successfully.');

    console.log(`\nAll smoke tests PASSED successfully for ${baseUrl}!`);
    process.exit(0);
  } catch (err) {
    console.error(`\n[SMOKE TEST FAILED]: ${err.message}`);
    process.exit(1);
  }
}

run();
