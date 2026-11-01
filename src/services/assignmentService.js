const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const deliveryRepository = require('../repositories/deliveryRepository');
const assignmentRepository = require('../repositories/assignmentRepository');
const vehicleRepository = require('../repositories/vehicleRepository');
const auditService = require('./auditService');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

class AssignmentService {
  assignDelivery(deliveryId, vehicleId, driverId, performedByOrOptions = 'dispatcher', possibleOptions = {}) {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    if (!vehicleId) throw new BadRequestError('Vehicle ID is required');
    if (!driverId) throw new BadRequestError('Driver ID is required');

    let performedBy;
    let options;
    if (typeof performedByOrOptions === 'object' && performedByOrOptions !== null) {
      options = performedByOrOptions;
      performedBy = options.performedBy || 'dispatcher';
    } else {
      performedBy = performedByOrOptions || 'dispatcher';
      options = possibleOptions || {};
    }

    const db = getDb();

    // Atomic transaction with immediate lock to prevent race conditions
    db.exec('BEGIN IMMEDIATE');

    try {
      // 1. Verify delivery eligibility
      const deliveryStmt = db.prepare('SELECT * FROM deliveries WHERE id = ?');
      const delivery = deliveryStmt.get(deliveryId);

      if (!delivery) {
        throw new NotFoundError(`Delivery with ID '${deliveryId}' not found`);
      }

      if (delivery.status !== 'pending') {
        throw new ConflictError(
          `Delivery '${deliveryId}' cannot be assigned because its status is '${delivery.status}' (must be 'pending')`
        );
      }

      // Check if delivery already has an active assignment
      const existingDeliveryAssign = db.prepare(`
        SELECT 1 FROM assignments WHERE delivery_id = ? AND is_active = 1
      `).get(deliveryId);
      if (existingDeliveryAssign) {
        throw new ConflictError(`Delivery '${deliveryId}' already has an active assignment`);
      }

      // 2. Verify vehicle eligibility
      const vehicleStmt = db.prepare('SELECT * FROM vehicles WHERE id = ?');
      const vehicle = vehicleStmt.get(vehicleId);

      if (!vehicle) {
        throw new NotFoundError(`Vehicle with ID '${vehicleId}' not found`);
      }

      if (vehicle.status !== 'available') {
        throw new ConflictError(
          `Vehicle '${vehicle.registration_number}' is not available for assignment (current status: '${vehicle.status}')`
        );
      }

      const activeVehAssign = db.prepare(`
        SELECT a.id, a.delivery_id, d.status
        FROM assignments a
        JOIN deliveries d ON d.id = a.delivery_id
        WHERE a.vehicle_id = ? AND a.is_active = 1 AND d.status IN ('assigned', 'in_transit')
        LIMIT 1
      `).get(vehicleId);

      if (activeVehAssign) {
        throw new ConflictError(
          `Vehicle '${vehicle.registration_number}' is already assigned to active delivery '${activeVehAssign.delivery_id}' (status: '${activeVehAssign.status}')`
        );
      }

      // Enhancement 1: Validate vehicle capacity requirement
      const reqCapacity = Number(delivery.required_capacity || 0);
      if (reqCapacity > 0 && vehicle.capacity < reqCapacity) {
        throw new ConflictError(
          `Vehicle '${vehicle.registration_number}' capacity (${vehicle.capacity} kg) is insufficient for delivery requirement (${reqCapacity} kg)`
        );
      }

      // Enhancement 1: Validate vehicle type requirement
      if (delivery.required_vehicle_type && delivery.required_vehicle_type.trim()) {
        const requiredType = delivery.required_vehicle_type.trim().toLowerCase();
        if (!vehicle.type.toLowerCase().includes(requiredType)) {
          throw new ConflictError(
            `Vehicle '${vehicle.registration_number}' type '${vehicle.type}' does not match required delivery vehicle type '${delivery.required_vehicle_type}'`
          );
        }
      }

      // Check overdue maintenance: warn and require override with reason
      const hasOverdue = db.prepare(`
        SELECT ms.id, ms.service_type, ms.due_date, ms.due_odometer
        FROM maintenance_schedules ms
        WHERE ms.vehicle_id = ?
          AND (
            ms.status = 'overdue'
            OR (ms.status = 'pending' AND (
                 (ms.due_date IS NOT NULL AND ms.due_date <= DATE('now'))
              OR (ms.due_odometer IS NOT NULL AND ms.due_odometer <= ?)
            ))
          )
        LIMIT 1
      `).get(vehicleId, Number(vehicle.odometer || 0));

      let overdueOverrideApproved = false;
      if (hasOverdue) {
        if (!options.override_overdue_maintenance) {
          throw new ConflictError(
            `Vehicle '${vehicle.registration_number}' has overdue maintenance ('${hasOverdue.service_type}'). Operational override with reason required.`
          );
        }
        if (!options.override_reason || typeof options.override_reason !== 'string' || options.override_reason.trim().length < 10) {
          throw new BadRequestError('An override reason of at least 10 characters is required to assign a vehicle with overdue maintenance');
        }
        overdueOverrideApproved = true;
      }

      // 3. Verify driver eligibility
      const driverStmt = db.prepare('SELECT * FROM drivers WHERE id = ?');
      const driver = driverStmt.get(driverId);

      if (!driver) {
        throw new NotFoundError(`Driver with ID '${driverId}' not found`);
      }

      if (driver.availability_status !== 'available') {
        throw new ConflictError(
          `Driver '${driver.name}' is not available for assignment (current status: '${driver.availability_status}')`
        );
      }

      const activeDriverAssign = db.prepare(`
        SELECT a.id, a.delivery_id, d.status
        FROM assignments a
        JOIN deliveries d ON d.id = a.delivery_id
        WHERE a.driver_id = ? AND a.is_active = 1 AND d.status IN ('assigned', 'in_transit')
        LIMIT 1
      `).get(driverId);

      if (activeDriverAssign) {
        throw new ConflictError(
          `Driver '${driver.name}' is already assigned to active delivery '${activeDriverAssign.delivery_id}' (status: '${activeDriverAssign.status}')`
        );
      }

      // 4. Create assignment record
      const assignmentId = `ASG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO assignments (id, delivery_id, vehicle_id, driver_id, assigned_at, is_active)
        VALUES (?, ?, ?, ?, DATETIME('now'), 1)
      `).run(assignmentId, deliveryId, vehicleId, driverId);

      // 5. Update statuses atomically
      db.prepare(`
        UPDATE deliveries SET status = 'assigned', updated_at = DATETIME('now') WHERE id = ?
      `).run(deliveryId);

      db.prepare(`
        UPDATE vehicles SET status = 'assigned', updated_at = DATETIME('now') WHERE id = ?
      `).run(vehicleId);

      db.prepare(`
        UPDATE drivers SET availability_status = 'assigned', updated_at = DATETIME('now') WHERE id = ?
      `).run(driverId);

      // Enqueue notification outbox record in the SAME atomic transaction
      try {
        const notificationService = require('./notificationService');
        notificationService.enqueueNotification(db, {
          deliveryId,
          event: 'delivery_assigned'
        });
      } catch (_) {}

      db.exec('COMMIT');

      // Audit log
      auditService.log({
        entity_type: 'assignment',
        entity_id: assignmentId,
        action: 'assigned',
        old_state: null,
        new_state: { delivery_id: deliveryId, vehicle_id: vehicleId, driver_id: driverId },
        performed_by: performedBy,
        details: `Assigned vehicle ${vehicle.registration_number} (${vehicle.type}) and driver ${driver.name} to delivery ${deliveryId}`
      });

      if (overdueOverrideApproved) {
        auditService.log({
          entity_type: 'assignment',
          entity_id: assignmentId,
          action: 'ASSIGNMENT_OVERDUE_OVERRIDE',
          old_state: null,
          new_state: { delivery_id: deliveryId, vehicle_id: vehicleId },
          performed_by: performedBy,
          details: `Overdue maintenance override approved: ${options.override_reason.trim()}`
        });
      }

      // Fetch fresh updated records
      const updatedDelivery = deliveryRepository.findById(deliveryId);
      const updatedVehicle = vehicleRepository.findById(vehicleId);

      // Real-time Event Emission (POST-COMMIT only)
      try {
        const events = require('../realtime/events');
        events.emitDeliveryAssigned(updatedDelivery);
        events.emitVehicleStatusChanged(updatedVehicle);
      } catch (_) {}

      // Return updated delivery object
      return updatedDelivery;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_rollbackErr) {
        // Rollback error ignored if already rolled back
      }

      // Map SQLite unique constraint violation (from partial unique indexes)
      if (err.message && err.message.includes('UNIQUE constraint failed: assignments')) {
        throw new ConflictError(
          'Assignment conflict: the selected vehicle or driver was simultaneously allocated to another active delivery'
        );
      }

      throw err;
    }
  }

  suggestResources(deliveryId) {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    const delivery = deliveryRepository.findById(deliveryId);
    if (!delivery) throw new NotFoundError(`Delivery with ID '${deliveryId}' not found`);

    const db = getDb();

    // 1. Find eligible vehicles
    // Must be available, no active assignment, capacity >= reqCapacity, and match type if specified
    const reqCap = Number(delivery.required_capacity || 0);
    const reqType = delivery.required_vehicle_type ? delivery.required_vehicle_type.trim().toLowerCase() : null;

    // Check overdue maintenance to rank overdue vehicles lower
    const overdueList = db.prepare(`
      SELECT DISTINCT vehicle_id
      FROM maintenance_schedules
      WHERE status = 'overdue'
         OR (status = 'pending' AND (
              (due_date IS NOT NULL AND due_date <= DATE('now'))
           OR (due_odometer IS NOT NULL AND due_odometer <= (SELECT odometer FROM vehicles WHERE id = maintenance_schedules.vehicle_id))
         ))
    `).all().map(r => r.vehicle_id);
    const overdueSet = new Set(overdueList);

    const availableVehicles = db.prepare(`
      SELECT v.*
      FROM vehicles v
      WHERE v.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM assignments a WHERE a.vehicle_id = v.id AND a.is_active = 1
        )
    `).all();

    const candidateVehicles = availableVehicles
      .filter(v => {
        if (reqCap > 0 && Number(v.capacity) < reqCap) return false;
        if (reqType && !v.type.toLowerCase().includes(reqType)) return false;
        return true;
      })
      .map(v => {
        const capacityDelta = Number(v.capacity) - reqCap;
        const isOverdue = overdueSet.has(v.id);
        return {
          id: v.id,
          registration_number: v.registration_number,
          type: v.type,
          capacity: Number(v.capacity),
          capacity_delta: capacityDelta,
          has_overdue_maintenance: isOverdue,
          score: capacityDelta + (isOverdue ? 10000 : 0), // Overdue vehicles ranked lower
          criteria: `Capacity ${v.capacity}kg matches requirement (${reqCap}kg). Best-fit delta: +${capacityDelta}kg${isOverdue ? ' [WARNING: Overdue maintenance scheduled]' : ''}`
        };
      })
      .sort((a, b) => a.score - b.score);

    // 2. Find eligible drivers with workload balancing
    const candidateDrivers = db.prepare(`
      SELECT 
        d.id,
        d.name,
        d.phone,
        d.availability_status,
        COUNT(CASE WHEN del.status = 'delivered' THEN 1 END) AS completed_deliveries
      FROM drivers d
      LEFT JOIN assignments a ON a.driver_id = d.id
      LEFT JOIN deliveries del ON del.id = a.delivery_id
      WHERE d.availability_status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM assignments act WHERE act.driver_id = d.id AND act.is_active = 1
        )
      GROUP BY d.id
      ORDER BY completed_deliveries ASC, d.created_at ASC
    `).all().map(d => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      completed_deliveries: Number(d.completed_deliveries || 0),
      criteria: `Available with balanced workload (${d.completed_deliveries} prior deliveries)`
    }));

    const topVehicle = candidateVehicles[0] || null;
    const topDriver = candidateDrivers[0] || null;

    return {
      delivery_id: deliveryId,
      delivery_requirements: {
        required_capacity: reqCap,
        required_vehicle_type: delivery.required_vehicle_type || 'any',
        priority: delivery.priority
      },
      recommended_pairing: (topVehicle && topDriver) ? {
        vehicle_id: topVehicle.id,
        vehicle_registration: topVehicle.registration_number,
        driver_id: topDriver.id,
        driver_name: topDriver.name,
        rationale: `Optimal capacity fit (${topVehicle.capacity}kg) and balanced driver workload (${topDriver.completed_deliveries} trips).`
      } : null,
      eligible_vehicles: candidateVehicles,
      eligible_drivers: candidateDrivers
    };
  }

  getAssignmentHistory(deliveryId) {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    return assignmentRepository.getHistoryByDeliveryId(deliveryId);
  }
}

module.exports = new AssignmentService();

