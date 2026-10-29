const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, setDb } = require('../src/db/database');
const vehicleService = require('../src/services/vehicleService');
const driverService = require('../src/services/driverService');
const deliveryService = require('../src/services/deliveryService');
const assignmentService = require('../src/services/assignmentService');

test('Phase 6 - Data Persistence Across Application Restarts', async (t) => {
  const testDbDir = path.join(__dirname, '..', 'data');
  const testDbPath = path.join(testDbDir, 'test_persistence.db');

  // Ensure clean state before test
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

  t.after(() => {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch (_) {}
  });

  let savedVehicleId;
  let savedDriverId;
  let savedDeliveryId;

  // Session 1: Create resources and assignment
  await t.test('Session 1 - create resources and assign delivery in persistent file', () => {
    const db1 = initDatabase(testDbPath);
    setDb(db1);

    const vehicle = vehicleService.createVehicle({
      registration_number: 'PERSIST-01',
      type: 'Heavy Truck',
      capacity: 5000,
      status: 'available'
    });
    savedVehicleId = vehicle.id;

    const driver = driverService.createDriver({
      name: 'Sam Persistent',
      phone: '+1-555-7788',
      availability_status: 'available'
    });
    savedDriverId = driver.id;

    const delivery = deliveryService.createDelivery({
      pickup_address: 'Warehouse Origin',
      dropoff_address: 'Depot Destination',
      scheduled_time: '2026-11-10T14:00:00Z',
      priority: 'high'
    });
    savedDeliveryId = delivery.id;

    const assigned = assignmentService.assignDelivery(delivery.id, vehicle.id, driver.id);
    assert.equal(assigned.status, 'assigned');
    assert.equal(assigned.assignment.vehicle.id, vehicle.id);
    assert.equal(assigned.assignment.driver.id, driver.id);

    // Close session 1
    db1.close();
  });

  // Session 2: Re-open persistent DB from disk
  await t.test('Session 2 - records and active assignments persist after restart', () => {
    const db2 = initDatabase(testDbPath);
    setDb(db2);

    // Verify vehicle
    const vehicle = vehicleService.getVehicleById(savedVehicleId);
    assert.equal(vehicle.registration_number, 'PERSIST-01');
    assert.equal(vehicle.status, 'assigned');
    assert.ok(vehicle.active_delivery);
    assert.equal(vehicle.active_delivery.delivery_id, savedDeliveryId);

    // Verify driver
    const driver = driverService.getDriverById(savedDriverId);
    assert.equal(driver.name, 'Sam Persistent');
    assert.equal(driver.availability_status, 'assigned');
    assert.ok(driver.active_delivery);
    assert.equal(driver.active_delivery.delivery_id, savedDeliveryId);

    // Verify delivery and active assignment
    const delivery = deliveryService.getDeliveryById(savedDeliveryId);
    assert.equal(delivery.status, 'assigned');
    assert.ok(delivery.assignment);
    assert.equal(delivery.assignment.vehicle.id, savedVehicleId);
    assert.equal(delivery.assignment.driver.id, savedDriverId);

    // Transition status: assigned -> in_transit -> delivered in session 2
    deliveryService.updateDeliveryStatus(savedDeliveryId, 'in_transit');
    const delivered = deliveryService.updateDeliveryStatus(savedDeliveryId, 'delivered');
    assert.equal(delivered.status, 'delivered');

    // Resources released in persistent file
    const releasedVehicle = vehicleService.getVehicleById(savedVehicleId);
    assert.equal(releasedVehicle.status, 'available');
    assert.equal(releasedVehicle.active_delivery, null);

    const releasedDriver = driverService.getDriverById(savedDriverId);
    assert.equal(releasedDriver.availability_status, 'available');
    assert.equal(releasedDriver.active_delivery, null);

    db2.close();
  });
});
