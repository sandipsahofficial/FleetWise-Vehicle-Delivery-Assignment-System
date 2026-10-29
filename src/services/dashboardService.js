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

  getPerformanceAnalytics() {
    const db = getDb();

    // Fleet utilization
    const vehAgg = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance
      FROM vehicles
    `).get();

    const totalVeh = Number(vehAgg.total || 0);
    const assignedVeh = Number(vehAgg.assigned || 0);
    const fleetUtilPct = totalVeh > 0 ? Math.round((assignedVeh / totalVeh) * 100) : 0;

    // Driver utilization
    const drvAgg = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN availability_status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN availability_status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN availability_status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable
      FROM drivers
    `).get();

    const totalDrv = Number(drvAgg.total || 0);
    const assignedDrv = Number(drvAgg.assigned || 0);
    const driverUtilPct = totalDrv > 0 ? Math.round((assignedDrv / totalDrv) * 100) : 0;

    // Delivery completion metrics
    const delAgg = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status IN ('assigned', 'in_transit') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM deliveries
    `).get();

    const completed = Number(delAgg.completed || 0);
    const cancelled = Number(delAgg.cancelled || 0);
    const terminalCount = completed + cancelled;
    const completionRate = terminalCount > 0 ? Math.round((completed / terminalCount) * 100) : 0;
    const cancellationRate = terminalCount > 0 ? Math.round((cancelled / terminalCount) * 100) : 0;

    // Breakdown by vehicle type
    const vehicleTypeMetrics = db.prepare(`
      SELECT 
        type,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance,
        ROUND(AVG(capacity), 1) AS avg_capacity
      FROM vehicles
      GROUP BY type
      ORDER BY total DESC
    `).all().map(v => ({
      type: v.type,
      total: Number(v.total),
      active: Number(v.active),
      available: Number(v.available),
      maintenance: Number(v.maintenance),
      avg_capacity: Number(v.avg_capacity || 0),
      utilization_pct: Number(v.total) > 0 ? Math.round((Number(v.active) / Number(v.total)) * 100) : 0
    }));

    // Driver workload leaderboard
    const driverWorkload = db.prepare(`
      SELECT 
        d.id,
        d.name,
        d.phone,
        d.availability_status,
        COUNT(CASE WHEN del.status = 'delivered' THEN 1 END) AS completed_trips,
        COUNT(CASE WHEN del.status IN ('assigned', 'in_transit') THEN 1 END) AS active_trips
      FROM drivers d
      LEFT JOIN assignments a ON a.driver_id = d.id
      LEFT JOIN deliveries del ON del.id = a.delivery_id
      GROUP BY d.id
      ORDER BY completed_trips DESC, d.name ASC
    `).all().map(d => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      availability_status: d.availability_status,
      completed_trips: Number(d.completed_trips || 0),
      active_trips: Number(d.active_trips || 0)
    }));

    return {
      fleet_utilization: {
        total_vehicles: totalVeh,
        assigned_vehicles: assignedVeh,
        available_vehicles: Number(vehAgg.available || 0),
        maintenance_vehicles: Number(vehAgg.maintenance || 0),
        utilization_rate_pct: fleetUtilPct
      },
      driver_utilization: {
        total_drivers: totalDrv,
        assigned_drivers: assignedDrv,
        available_drivers: Number(drvAgg.available || 0),
        unavailable_drivers: Number(drvAgg.unavailable || 0),
        utilization_rate_pct: driverUtilPct
      },
      delivery_performance: {
        total_deliveries: Number(delAgg.total || 0),
        completed_deliveries: completed,
        cancelled_deliveries: cancelled,
        active_deliveries: Number(delAgg.active || 0),
        pending_deliveries: Number(delAgg.pending || 0),
        completion_rate_pct: completionRate,
        cancellation_rate_pct: cancellationRate
      },
      vehicle_types: vehicleTypeMetrics,
      driver_workload: driverWorkload,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new DashboardService();

