const { getDb } = require('../db/database');
const vehicleService = require('./vehicleService');
const driverService = require('./driverService');
const deliveryService = require('./deliveryService');
const assignmentService = require('./assignmentService');

class SeedService {
  seedDemoData() {
    const db = getDb();

    // Check if data already exists
    const vehCount = db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count;
    if (vehCount > 0) {
      return { message: 'Demo data already present', seeded: false };
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
    const v4 = vehicleService.createVehicle({
      registration_number: 'VAN-504',
      type: 'Ram ProMaster High Roof',
      capacity: 1800,
      status: 'available'
    });
    const v5 = vehicleService.createVehicle({
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
    const d4 = driverService.createDriver({
      name: 'Sarah Chen',
      phone: '+1-555-0104',
      availability_status: 'available'
    });
    const d5 = driverService.createDriver({
      name: 'Devon Miller',
      phone: '+1-555-0105',
      availability_status: 'unavailable'
    });

    // 3. Seed Deliveries
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
    const del3 = deliveryService.createDelivery({
      pickup_address: 'Hudson Yards Loading Dock B',
      dropoff_address: 'Tribeca Design Studio, 180 Franklin St',
      scheduled_time: new Date(Date.now() + 6 * 3600000).toISOString(),
      priority: 'medium',
      notes: 'High-end architectural models'
    });

    // Delivery 4: Pending
    const del4 = deliveryService.createDelivery({
      pickup_address: 'Queens Wholesale Floral Market',
      dropoff_address: 'Grand Central Floral Pavilion',
      scheduled_time: new Date(Date.now() + 8 * 3600000).toISOString(),
      priority: 'low',
      notes: 'Refrigerated flowers'
    });

    // Delivery 5: Delivered (historical)
    const del5 = deliveryService.createDelivery({
      pickup_address: 'Bronx Distribution Depot',
      dropoff_address: 'Harlem Community Center',
      scheduled_time: new Date(Date.now() - 5 * 3600000).toISOString(),
      priority: 'medium',
      notes: 'Delivered successfully with signature'
    });
    assignmentService.assignDelivery(del5.id, v3.id, d3.id);
    deliveryService.updateDeliveryStatus(del5.id, 'in_transit');
    deliveryService.updateDeliveryStatus(del5.id, 'delivered');

    return {
      message: 'Demo dataset successfully seeded with vehicles, drivers, and deliveries',
      seeded: true
    };
  }
}

module.exports = new SeedService();
