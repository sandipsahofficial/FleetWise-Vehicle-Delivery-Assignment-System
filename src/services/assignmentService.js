const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const deliveryRepository = require('../repositories/deliveryRepository');
const assignmentRepository = require('../repositories/assignmentRepository');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

class AssignmentService {
  assignDelivery(deliveryId, vehicleId, driverId) {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    if (!vehicleId) throw new BadRequestError('Vehicle ID is required');
    if (!driverId) throw new BadRequestError('Driver ID is required');

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

      db.exec('COMMIT');

      // Return updated delivery object
      return deliveryRepository.findById(deliveryId);
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
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

  getAssignmentHistory(deliveryId) {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    return assignmentRepository.getHistoryByDeliveryId(deliveryId);
  }
}

module.exports = new AssignmentService();

