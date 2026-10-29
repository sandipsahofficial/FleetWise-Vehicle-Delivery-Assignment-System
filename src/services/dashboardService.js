const { getDb } = require('../db/database');

class DashboardService {
  getStats() {
    const db = getDb();

    // Vehicles metrics
    const vehicleStats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive
      FROM vehicles
    `).get();

    // Drivers metrics
    const driverStats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN availability_status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN availability_status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN availability_status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable
      FROM drivers
    `).get();

    // Deliveries metrics
    const deliveryStats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status IN ('assigned', 'in_transit') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN status = 'in_transit' THEN 1 ELSE 0 END) AS in_transit,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM deliveries
    `).get();

    // Status breakdown list for charts
    const deliveriesByStatus = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM deliveries
      GROUP BY status
    `).all();

    // Priority breakdown list for charts
    const deliveriesByPriority = db.prepare(`
      SELECT priority, COUNT(*) AS count
      FROM deliveries
      GROUP BY priority
    `).all();

    const totalVehicles = Number(vehicleStats.total || 0);
    const assignedVehicles = Number(vehicleStats.assigned || 0);
    const utilizationRate = totalVehicles > 0 ? Math.round((assignedVehicles / totalVehicles) * 100) : 0;

    return {
      vehicles: {
        total: totalVehicles,
        available: Number(vehicleStats.available || 0),
        assigned: assignedVehicles,
        maintenance: Number(vehicleStats.maintenance || 0),
        inactive: Number(vehicleStats.inactive || 0),
        utilization_rate: utilizationRate
      },
      drivers: {
        total: Number(driverStats.total || 0),
        available: Number(driverStats.available || 0),
        assigned: Number(driverStats.assigned || 0),
        unavailable: Number(driverStats.unavailable || 0)
      },
      deliveries: {
        total: Number(deliveryStats.total || 0),
        pending: Number(deliveryStats.pending || 0),
        active: Number(deliveryStats.active || 0),
        assigned: Number(deliveryStats.assigned || 0),
        in_transit: Number(deliveryStats.in_transit || 0),
        completed: Number(deliveryStats.completed || 0),
        cancelled: Number(deliveryStats.cancelled || 0)
      },
      breakdowns: {
        by_status: deliveriesByStatus,
        by_priority: deliveriesByPriority
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new DashboardService();

