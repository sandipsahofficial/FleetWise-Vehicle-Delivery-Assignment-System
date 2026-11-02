#!/usr/bin/env node

/**
 * FleetWise Demo Seeder CLI
 *
 * Populates development environment with vehicles, drivers, deliveries,
 * and standard demo users (admin, dispatcher, driver1).
 */

process.env.ALLOW_DEMO_SEED = 'true';

const { getDb } = require('../src/db/database');
const seedService = require('../src/services/seedService');

getDb();
const result = seedService.seedDemoData();

const adminPass = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
const dispatcherPass = process.env.DEMO_DISPATCHER_PASSWORD || 'DispatcherPass123!';
const driverPass = process.env.DEMO_DRIVER_PASSWORD || 'DriverPassword123!';

console.log('\n======================================================');
console.log('   FleetWise Development & Demo User Credentials      ');
console.log('======================================================');
console.log(' 1. Administrator (Full System & Asset Management):');
console.log('    Username : admin');
console.log(`    Password : ${adminPass}`);
console.log('    Role     : admin\n');
console.log(' 2. Dispatcher (Operations, Assignment & Live Tracking):');
console.log('    Username : dispatcher');
console.log(`    Password : ${dispatcherPass}`);
console.log('    Role     : dispatcher\n');
console.log(' 3. Driver (Mobile PWA & Geolocation at /driver):');
console.log('    Username : driver1');
console.log(`    Password : ${driverPass}`);
console.log('    Role     : driver');
console.log('======================================================\n');
console.log(`Status: ${result.message}\n`);
