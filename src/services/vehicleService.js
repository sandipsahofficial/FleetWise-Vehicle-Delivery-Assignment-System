const crypto = require('node:crypto');
const vehicleRepository = require('../repositories/vehicleRepository');
const auditService = require('./auditService');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const VALID_STATUSES = ['available', 'assigned', 'maintenance', 'inactive'];

class VehicleService {
  createVehicle(data) {
    const { id, registration_number, type, capacity, status } = data || {};

    if (!registration_number || typeof registration_number !== 'string' || !registration_number.trim()) {
      throw new BadRequestError('Registration number is required');
    }
    const cleanReg = registration_number.trim().toUpperCase();

    if (!type || typeof type !== 'string' || !type.trim()) {
      throw new BadRequestError('Vehicle type is required');
    }

    const numCapacity = Number(capacity);
    if (isNaN(numCapacity) || numCapacity <= 0) {
      throw new BadRequestError('Capacity must be a positive number');
    }

    const vehicleStatus = status ? status.toLowerCase() : 'available';
    if (!VALID_STATUSES.includes(vehicleStatus)) {
      throw new BadRequestError(`Invalid vehicle status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    // Check unique registration number
    const existing = vehicleRepository.findByRegistration(cleanReg);
    if (existing) {
      throw new ConflictError(`Vehicle with registration number '${cleanReg}' already exists`);
    }

    const vehicleId = id && id.trim() ? id.trim() : `VEH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const newVehicle = {
      id: vehicleId,
      registration_number: cleanReg,
      type: type.trim(),
      capacity: numCapacity,
      status: vehicleStatus
    };

    const created = vehicleRepository.create(newVehicle);
    auditService.log({
      entity_type: 'vehicle',
      entity_id: created.id,
      action: 'created',
      old_state: null,
      new_state: { registration_number: created.registration_number, status: created.status },
      performed_by: 'fleet_manager',
      details: `Created vehicle ${created.registration_number} (${created.type}, ${created.capacity}kg)`
    });
    return created;
  }

  getVehicleById(id) {
    if (!id) throw new BadRequestError('Vehicle ID is required');
    const vehicle = vehicleRepository.findById(id);
    if (!vehicle) {
      throw new NotFoundError(`Vehicle with ID '${id}' not found`);
    }
    return vehicle;
  }

  listVehicles(filters = {}) {
    if (filters.status && !VALID_STATUSES.includes(filters.status)) {
      throw new BadRequestError(`Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}`);
    }
    return vehicleRepository.findAll(filters);
  }

  updateVehicleStatus(id, newStatus) {
    if (!newStatus || typeof newStatus !== 'string') {
      throw new BadRequestError('New status is required');
    }
    const targetStatus = newStatus.toLowerCase().trim();
    if (!VALID_STATUSES.includes(targetStatus)) {
      throw new BadRequestError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const vehicle = this.getVehicleById(id);

    // Business rule: Prevent a vehicle from entering maintenance or inactive status while an active assignment exists
    if (targetStatus === 'maintenance' || targetStatus === 'inactive') {
      if (vehicleRepository.hasActiveAssignment(id)) {
        throw new ConflictError(
          `Cannot transition vehicle '${id}' to '${targetStatus}' while an active assignment exists`
        );
      }
    }

    // If changing to assigned manually without an assignment, that violates assignment business flow
    if (targetStatus === 'assigned' && !vehicleRepository.hasActiveAssignment(id)) {
      throw new BadRequestError('Cannot manually set vehicle status to assigned without an active delivery assignment');
    }

    const updated = vehicleRepository.updateStatus(id, targetStatus);
    auditService.log({
      entity_type: 'vehicle',
      entity_id: id,
      action: 'status_changed',
      old_state: { status: vehicle.status },
      new_state: { status: targetStatus },
      performed_by: 'fleet_manager',
      details: `Vehicle status transitioned from ${vehicle.status} to ${targetStatus}`
    });

    // Real-time Event Emission (POST-COMMIT only)
    try {
      const events = require('../realtime/events');
      events.emitVehicleStatusChanged(updated);
    } catch (_) {}

    return updated;
  }

  updateVehicle(id, data) {
    const existing = this.getVehicleById(id);
    const { registration_number, type, capacity, status } = data || {};

    const cleanReg = registration_number !== undefined
      ? registration_number.trim().toUpperCase()
      : existing.registration_number;

    if (!cleanReg) {
      throw new BadRequestError('Registration number cannot be empty');
    }

    if (cleanReg !== existing.registration_number) {
      const regConflict = vehicleRepository.findByRegistration(cleanReg);
      if (regConflict && regConflict.id !== id) {
        throw new ConflictError(`Vehicle with registration number '${cleanReg}' already exists`);
      }
    }

    const cleanType = type !== undefined ? type.trim() : existing.type;
    if (!cleanType) {
      throw new BadRequestError('Vehicle type cannot be empty');
    }

    const numCapacity = capacity !== undefined ? Number(capacity) : existing.capacity;
    if (isNaN(numCapacity) || numCapacity <= 0) {
      throw new BadRequestError('Capacity must be a positive number');
    }

    const targetStatus = status !== undefined ? status.toLowerCase().trim() : existing.status;
    if (!VALID_STATUSES.includes(targetStatus)) {
      throw new BadRequestError(`Invalid vehicle status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const hasActive = vehicleRepository.hasActiveAssignment(id);
    if (hasActive) {
      if (targetStatus === 'maintenance' || targetStatus === 'inactive') {
        throw new ConflictError(
          `Cannot set vehicle '${id}' to '${targetStatus}' while an active assignment exists`
        );
      }
      if (cleanReg !== existing.registration_number) {
        throw new ConflictError(
          `Cannot modify registration number of vehicle '${id}' while an active assignment exists`
        );
      }
    }

    const updated = vehicleRepository.update(id, {
      registration_number: cleanReg,
      type: cleanType,
      capacity: numCapacity,
      status: targetStatus
    });

    auditService.log({
      entity_type: 'vehicle',
      entity_id: id,
      action: 'updated',
      old_state: { status: existing.status, capacity: existing.capacity },
      new_state: { status: targetStatus, capacity: numCapacity },
      performed_by: 'fleet_manager',
      details: `Updated vehicle ${cleanReg}`
    });

    return updated;
  }

  deleteVehicle(id) {
    const vehicle = this.getVehicleById(id); // Throws NotFoundError if missing

    if (vehicleRepository.hasActiveAssignment(id)) {
      throw new ConflictError(`Cannot delete vehicle '${id}' while an active assignment exists`);
    }

    if (vehicleRepository.hasAnyAssignment(id)) {
      throw new ConflictError(`Cannot delete vehicle '${id}' with existing assignment records. Deletion would compromise historical dispatch logs.`);
    }

    const deleted = vehicleRepository.delete(id);
    auditService.log({
      entity_type: 'vehicle',
      entity_id: id,
      action: 'deleted',
      old_state: { registration_number: vehicle.registration_number },
      new_state: null,
      performed_by: 'fleet_manager',
      details: `Deleted vehicle ${vehicle.registration_number}`
    });
    return deleted;
  }
}

module.exports = new VehicleService();

