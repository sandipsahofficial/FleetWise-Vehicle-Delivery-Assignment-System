const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const deliveryRepository = require('../repositories/deliveryRepository');
const assignmentRepository = require('../repositories/assignmentRepository');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled'];

// Allowed status transitions mapping
const ALLOWED_TRANSITIONS = {
  pending: ['assigned', 'cancelled'],
  assigned: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
};

class DeliveryService {
  createDelivery(data) {
    const { id, pickup_address, dropoff_address, scheduled_time, priority, notes } = data || {};

    if (!pickup_address || typeof pickup_address !== 'string' || !pickup_address.trim()) {
      throw new BadRequestError('Pickup address is required');
    }
    if (!dropoff_address || typeof dropoff_address !== 'string' || !dropoff_address.trim()) {
      throw new BadRequestError('Dropoff address is required');
    }
    if (!scheduled_time || typeof scheduled_time !== 'string' || !scheduled_time.trim()) {
      throw new BadRequestError('Scheduled time is required');
    }

    const priorityVal = priority ? priority.toLowerCase().trim() : 'medium';
    if (!VALID_PRIORITIES.includes(priorityVal)) {
      throw new BadRequestError(`Invalid priority. Allowed: ${VALID_PRIORITIES.join(', ')}`);
    }

    const deliveryId = id && id.trim() ? id.trim() : `DEL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const newDelivery = {
      id: deliveryId,
      pickup_address: pickup_address.trim(),
      dropoff_address: dropoff_address.trim(),
      scheduled_time: scheduled_time.trim(),
      priority: priorityVal,
      status: 'pending',
      notes: notes ? notes.trim() : null
    };

    return deliveryRepository.create(newDelivery);
  }

  getDeliveryById(id) {
    if (!id) throw new BadRequestError('Delivery ID is required');
    const delivery = deliveryRepository.findById(id);
    if (!delivery) {
      throw new NotFoundError(`Delivery with ID '${id}' not found`);
    }
    return delivery;
  }

  listDeliveries(filters = {}) {
    if (filters.status && !VALID_STATUSES.includes(filters.status)) {
      throw new BadRequestError(`Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}`);
    }
    if (filters.priority && !VALID_PRIORITIES.includes(filters.priority)) {
      throw new BadRequestError(`Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(', ')}`);
    }
    return deliveryRepository.findAll(filters);
  }

  updateDeliveryStatus(id, newStatus) {
    if (!newStatus || typeof newStatus !== 'string') {
      throw new BadRequestError('New status is required');
    }
    const targetStatus = newStatus.toLowerCase().trim();
    if (!VALID_STATUSES.includes(targetStatus)) {
      throw new BadRequestError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const db = getDb();

    // Use transaction for safe atomic status transition and resource release
    db.exec('BEGIN IMMEDIATE');
    try {
      // Fetch delivery within transaction
      const currentStmt = db.prepare('SELECT * FROM deliveries WHERE id = ?');
      const delivery = currentStmt.get(id);

      if (!delivery) {
        throw new NotFoundError(`Delivery with ID '${id}' not found`);
      }

      const currentStatus = delivery.status;

      // Check if trying to transition to the same status
      if (currentStatus === targetStatus) {
        db.exec('COMMIT');
        return deliveryRepository.findById(id);
      }

      // Validate lifecycle transition
      const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes(targetStatus)) {
        throw new ConflictError(
          `Invalid status transition from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowedNext.join(', ')}]`
        );
      }

      // If transition requires assignment (pending -> assigned directly via status patch without assigning vehicle/driver),
      // we reject with clear instruction to use the /assign endpoint.
      if (currentStatus === 'pending' && targetStatus === 'assigned') {
        throw new BadRequestError(
          "Cannot manually set delivery to 'assigned'. Use the POST /deliveries/{id}/assign endpoint to assign a vehicle and driver."
        );
      }

      // If entering terminal/release state (delivered or cancelled)
      if (targetStatus === 'delivered' || targetStatus === 'cancelled') {
        // Find active assignment
        const activeAssignStmt = db.prepare(`
          SELECT * FROM assignments WHERE delivery_id = ? AND is_active = 1
        `);
        const assignment = activeAssignStmt.get(id);

        if (assignment) {
          // Release assignment
          db.prepare(`
            UPDATE assignments 
            SET is_active = 0, released_at = DATETIME('now')
            WHERE id = ?
          `).run(assignment.id);

          // Recalculate vehicle status:
          // Check vehicle current status and remaining active assignments
          const vehRow = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(assignment.vehicle_id);
          if (vehRow) {
            const otherActiveVeh = db.prepare(`
              SELECT COUNT(*) AS count FROM assignments WHERE vehicle_id = ? AND is_active = 1
            `).get(assignment.vehicle_id);

            // Never overwrite maintenance or inactive with available!
            if (otherActiveVeh.count === 0 && vehRow.status === 'assigned') {
              db.prepare(`
                UPDATE vehicles SET status = 'available', updated_at = DATETIME('now') WHERE id = ?
              `).run(assignment.vehicle_id);
            }
          }

          // Recalculate driver status:
          // Check driver current status and remaining active assignments
          const drvRow = db.prepare('SELECT * FROM drivers WHERE id = ?').get(assignment.driver_id);
          if (drvRow) {
            const otherActiveDrv = db.prepare(`
              SELECT COUNT(*) AS count FROM assignments WHERE driver_id = ? AND is_active = 1
            `).get(assignment.driver_id);

            // Never overwrite unavailable with available!
            if (otherActiveDrv.count === 0 && drvRow.availability_status === 'assigned') {
              db.prepare(`
                UPDATE drivers SET availability_status = 'available', updated_at = DATETIME('now') WHERE id = ?
              `).run(assignment.driver_id);
            }
          }
        }
      }

      // Update delivery record
      db.prepare(`
        UPDATE deliveries 
        SET status = ?, updated_at = DATETIME('now') 
        WHERE id = ?
      `).run(targetStatus, id);

      db.exec('COMMIT');
      return deliveryRepository.findById(id);
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        // Rollback error ignored if already rolled back
      }
      throw err;
    }
  }

  updateDelivery(id, data) {
    const existing = this.getDeliveryById(id);

    // Business rule: Reject unsafe edits to active deliveries in progress or terminal states
    if (existing.status === 'assigned' || existing.status === 'in_transit') {
      throw new ConflictError(
        `Cannot edit core route details of active delivery '${id}' while status is '${existing.status}'`
      );
    }
    if (existing.status === 'delivered' || existing.status === 'cancelled') {
      throw new ConflictError(
        `Cannot edit terminal delivery '${id}' (status: '${existing.status}')`
      );
    }

    const { pickup_address, dropoff_address, scheduled_time, priority, notes } = data || {};

    const cleanPickup = pickup_address !== undefined ? pickup_address.trim() : existing.pickup_address;
    if (!cleanPickup) throw new BadRequestError('Pickup address cannot be empty');

    const cleanDropoff = dropoff_address !== undefined ? dropoff_address.trim() : existing.dropoff_address;
    if (!cleanDropoff) throw new BadRequestError('Dropoff address cannot be empty');

    const cleanTime = scheduled_time !== undefined ? scheduled_time.trim() : existing.scheduled_time;
    if (!cleanTime) throw new BadRequestError('Scheduled time cannot be empty');

    const cleanPriority = priority !== undefined ? priority.toLowerCase().trim() : existing.priority;
    if (!VALID_PRIORITIES.includes(cleanPriority)) {
      throw new BadRequestError(`Invalid priority. Allowed: ${VALID_PRIORITIES.join(', ')}`);
    }

    const cleanNotes = notes !== undefined ? (notes ? notes.trim() : null) : existing.notes;

    return deliveryRepository.update(id, {
      pickup_address: cleanPickup,
      dropoff_address: cleanDropoff,
      scheduled_time: cleanTime,
      priority: cleanPriority,
      notes: cleanNotes
    });
  }

  deleteDelivery(id) {
    const existing = this.getDeliveryById(id);

    if (existing.status === 'assigned' || existing.status === 'in_transit' || deliveryRepository.hasActiveAssignment(id)) {
      throw new ConflictError(`Cannot delete delivery '${id}' while an active assignment exists`);
    }

    if (deliveryRepository.hasAnyAssignment(id)) {
      throw new ConflictError(`Cannot delete delivery '${id}' with existing assignment records. Deletion would compromise historical dispatch logs.`);
    }

    return deliveryRepository.delete(id);
  }
}

module.exports = new DeliveryService();

