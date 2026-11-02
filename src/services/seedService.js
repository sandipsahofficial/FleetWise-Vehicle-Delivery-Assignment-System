const { getDb } = require('../db/database');
const config = require('../config');
const logger = require('../utils/logger');
const vehicleService = require('./vehicleService');
const driverService = require('./driverService');
const deliveryService = require('./deliveryService');
const assignmentService = require('./assignmentService');
const authService = require('./authService');
const { ForbiddenError } = require('../utils/errors');

class SeedService {
  ensureDemoUsers(db, driverId = null) {
    const adminPass = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
    const dispatcherPass = process.env.DEMO_DISPATCHER_PASSWORD || 'DispatcherPass123!';
    const driverPass = process.env.DEMO_DRIVER_PASSWORD || 'DriverPassword123!';

    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    if (!admin) {
      try {
        authService.register({ username: 'admin', password: adminPass, role: 'admin' });
      } catch (_) {}
    }

    const dispatcher = db.prepare("SELECT id FROM users WHERE username = 'dispatcher'").get();
    if (!dispatcher) {
      try {
        authService.register({ username: 'dispatcher', password: dispatcherPass, role: 'dispatcher' });
      } catch (_) {}
    }

    const driver1 = db.prepare("SELECT id FROM users WHERE username = 'driver1'").get();
    if (!driver1) {
      const targetDriverId = driverId || db.prepare("SELECT id FROM drivers LIMIT 1").get()?.id || null;
      try {
        authService.register({
          username: 'driver1',
          password: driverPass,
          role: 'driver',
          driver_id: targetDriverId
        });
      } catch (_) {}
    }

    if (!process.env.DEMO_DISPATCHER_PASSWORD || !process.env.DEMO_DRIVER_PASSWORD || !process.env.ADMIN_PASSWORD) {
      logger.info({
        demoCredentials: {
          admin: { username: 'admin', password: process.env.ADMIN_PASSWORD ? '[CONFIGURED_IN_ENV]' : adminPass },
          dispatcher: { username: 'dispatcher', password: process.env.DEMO_DISPATCHER_PASSWORD ? '[CONFIGURED_IN_ENV]' : dispatcherPass },
          driver: { username: 'driver1', password: process.env.DEMO_DRIVER_PASSWORD ? '[CONFIGURED_IN_ENV]' : driverPass }
        }
      }, 'Demo user credentials initialized');
    }
  }

  seedDemoData() {
    const isAllowed = process.env.ALLOW_DEMO_SEED === 'true';
    if (!isAllowed || config.isProd || process.env.NODE_ENV === 'production') {
      throw new ForbiddenError('Demo data seeding is disabled. ALLOW_DEMO_SEED=true is required, and seeding is strictly disabled in production.');
    }

    const db = getDb();

    // Check if data already exists
    const vehCount = db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count;
    if (vehCount > 0) {
      this.ensureDemoUsers(db);
      return { message: 'Demo data already present (demo users verified)', seeded: false };
    }

    // 1. Seed Vehicles
    const v1 = vehicleService.createVehicle({
      registration_number: 'VAN-701',
      type: 'Mercedes Sprinter Van',
      capacity: 1400,
      status: 'available'
    });
    const v2 = vehicleService.createVehicle({
      registration_number: 'TRK-902',
      type: 'Freightliner 24ft Box Truck',
      capacity: 4500,
      status: 'available'
    });
    const v3 = vehicleService.createVehicle({
      registration_number: 'EV-303',
      type: 'Ford E-Transit Electric',
      capacity: 1100,
      status: 'available'
    });
    vehicleService.createVehicle({
      registration_number: 'VAN-504',
      type: 'Ram ProMaster High Roof',
      capacity: 1800,
      status: 'available'
    });
    vehicleService.createVehicle({
      registration_number: 'MNT-105',
      type: 'Isuzu NPR Truck',
      capacity: 3500,
      status: 'maintenance'
    });

    // 2. Seed Drivers
    const d1 = driverService.createDriver({
      name: 'Marcus Vance',
      phone: '+1-555-0101',
      availability_status: 'available'
    });
    const d2 = driverService.createDriver({
      name: 'Elena Rostova',
      phone: '+1-555-0102',
      availability_status: 'available'
    });
    const d3 = driverService.createDriver({
      name: 'Jordan Lee',
      phone: '+1-555-0103',
      availability_status: 'available'
    });
    driverService.createDriver({
      name: 'Sarah Chen',
      phone: '+1-555-0104',
      availability_status: 'available'
    });
    driverService.createDriver({
      name: 'Devon Miller',
      phone: '+1-555-0105',
      availability_status: 'unavailable'
    });

    // 3. Seed Demo Users for Development Testing
    this.ensureDemoUsers(db, d1.id);

    // 4. Seed Deliveries
    // Delivery 1: In transit
    const del1 = deliveryService.createDelivery({
      pickup_address: 'Port Newark Terminal 4, NJ',
      dropoff_address: 'Midtown Medical Center, 550 1st Ave, NY',
      scheduled_time: new Date(Date.now() + 2 * 3600000).toISOString(),
      priority: 'urgent',
      notes: 'Priority pharmaceuticals requiring climate monitor'
    });
    assignmentService.assignDelivery(del1.id, v1.id, d1.id);
    deliveryService.updateDeliveryStatus(del1.id, 'in_transit');

    // Delivery 2: Assigned
    const del2 = deliveryService.createDelivery({
      pickup_address: 'JFK Cargo Logistics Hub, Bldg 88, Queens',
      dropoff_address: 'Apex Fulfillment Center, Brooklyn Navy Yard',
      scheduled_time: new Date(Date.now() + 4 * 3600000).toISOString(),
      priority: 'high',
      notes: 'Palletized electronics batch A-4'
    });
    assignmentService.assignDelivery(del2.id, v2.id, d2.id);

    // Delivery 3: Pending
    deliveryService.createDelivery({
      pickup_address: 'Hudson Yards Loading Dock B',
      dropoff_address: 'Wall Street Financial Tower, 60 Wall St, NY',
      scheduled_time: new Date(Date.now() + 6 * 3600000).toISOString(),
      priority: 'medium',
      notes: 'Confidential client documentation boxes'
    });

    // Delivery 4: Pending
    deliveryService.createDelivery({
      pickup_address: 'Staten Island Distribution Center',
      dropoff_address: 'Columbia University Campus Store, 116th St, NY',
      scheduled_time: new Date(Date.now() + 8 * 3600000).toISOString(),
      priority: 'low',
      notes: 'Textbook semester restock shipment'
    });

    // Delivery 5: Completed with OTP proof
    const del5 = deliveryService.createDelivery({
      pickup_address: 'Long Island City Warehouse 12',
      dropoff_address: 'Grand Central Terminal Retail Hub, NY',
      scheduled_time: new Date(Date.now() - 3600000).toISOString(),
      priority: 'high',
      notes: 'Morning express delivery - completed'
    });
    assignmentService.assignDelivery(del5.id, v3.id, d3.id);
    deliveryService.updateDeliveryStatus(del5.id, 'in_transit');

    // Complete delivery with verified OTP proof
    db.prepare(`
      INSERT OR REPLACE INTO delivery_proofs (delivery_id, proof_type, completed_at, created_at)
      VALUES (?, 'otp', DATETIME('now'), DATETIME('now'))
    `).run(del5.id);
    db.prepare(`
      UPDATE deliveries
      SET status = 'delivered', updated_at = DATETIME('now')
      WHERE id = ?
    `).run(del5.id);
    db.prepare(`
      UPDATE assignments
      SET is_active = 0, released_at = DATETIME('now')
      WHERE delivery_id = ?
    `).run(del5.id);
    db.prepare("UPDATE vehicles SET status = 'available', updated_at = DATETIME('now') WHERE id = ?").run(v3.id);
    db.prepare("UPDATE drivers SET availability_status = 'available', updated_at = DATETIME('now') WHERE id = ?").run(d3.id);

    return {
      message: 'Demo dataset successfully seeded with vehicles, drivers, demo users, and deliveries',
      seeded: true
    };
  }
}

module.exports = new SeedService();
