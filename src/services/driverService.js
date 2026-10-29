const crypto = require('node:crypto');
const driverRepository = require('../repositories/driverRepository');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const VALID_STATUSES = ['available', 'assigned', 'unavailable'];

class DriverService {
  createDriver(data) {
    const { id, name, phone, availability_status } = data || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BadRequestError('Driver name is required');
    }

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      throw new BadRequestError('Driver phone number is required');
    }
    const cleanPhone = phone.trim();

    const status = availability_status ? availability_status.toLowerCase() : 'available';
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Invalid driver availability status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    // Check unique phone number
    const existing = driverRepository.findByPhone(cleanPhone);
    if (existing) {
      throw new ConflictError(`Driver with phone number '${cleanPhone}' already exists`);
    }

    const driverId = id && id.trim() ? id.trim() : `DRV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Enforce unique driver ID
    const existingById = driverRepository.findById(driverId);
    if (existingById) {
      throw new ConflictError(`Driver with ID '${driverId}' already exists`);
    }

    const newDriver = {
      id: driverId,
      name: name.trim(),
      phone: cleanPhone,
      availability_status: status
    };

    return driverRepository.create(newDriver);
  }

  getDriverById(id) {
    if (!id) throw new BadRequestError('Driver ID is required');
    const driver = driverRepository.findById(id);
    if (!driver) {
      throw new NotFoundError(`Driver with ID '${id}' not found`);
    }
    return driver;
  }

  listDrivers(filters = {}) {
    if (filters.status && !VALID_STATUSES.includes(filters.status)) {
      throw new BadRequestError(`Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}`);
    }
    return driverRepository.findAll(filters);
  }

  updateDriverStatus(id, newStatus) {
    if (!newStatus || typeof newStatus !== 'string') {
      throw new BadRequestError('New availability status is required');
    }
    const targetStatus = newStatus.toLowerCase().trim();
    if (!VALID_STATUSES.includes(targetStatus)) {
      throw new BadRequestError(`Invalid availability status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const driver = this.getDriverById(id);

    // If driver is currently on an active assignment, prevent setting to unavailable
    if (targetStatus === 'unavailable') {
      if (driverRepository.hasActiveAssignment(id)) {
        throw new ConflictError(
          `Cannot transition driver '${id}' to unavailable while an active assignment exists`
        );
      }
    }

    // If changing to assigned manually without an assignment
    if (targetStatus === 'assigned' && !driverRepository.hasActiveAssignment(id)) {
      throw new BadRequestError('Cannot manually set driver status to assigned without an active delivery assignment');
    }

    return driverRepository.updateStatus(id, targetStatus);
  }

  updateDriver(id, data) {
    const existing = this.getDriverById(id);
    const { name, phone, availability_status } = data || {};

    const cleanName = name !== undefined ? name.trim() : existing.name;
    if (!cleanName) {
      throw new BadRequestError('Driver name cannot be empty');
    }

    const cleanPhone = phone !== undefined ? phone.trim() : existing.phone;
    if (!cleanPhone) {
      throw new BadRequestError('Phone number cannot be empty');
    }

    if (cleanPhone !== existing.phone) {
      const phoneConflict = driverRepository.findByPhone(cleanPhone);
      if (phoneConflict && phoneConflict.id !== id) {
        throw new ConflictError(`Driver with phone number '${cleanPhone}' already exists`);
      }
    }

    const targetStatus = availability_status !== undefined
      ? availability_status.toLowerCase().trim()
      : existing.availability_status;

    if (!VALID_STATUSES.includes(targetStatus)) {
      throw new BadRequestError(`Invalid availability status. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const hasActive = driverRepository.hasActiveAssignment(id);
    if (hasActive) {
      if (targetStatus === 'unavailable') {
        throw new ConflictError(
          `Cannot set driver '${id}' to unavailable while an active assignment exists`
        );
      }
      if (cleanPhone !== existing.phone) {
        throw new ConflictError(
          `Cannot modify phone number of driver '${id}' while an active assignment exists`
        );
      }
    }

    return driverRepository.update(id, {
      name: cleanName,
      phone: cleanPhone,
      availability_status: targetStatus
    });
  }

  deleteDriver(id) {
    this.getDriverById(id); // Throws NotFoundError if missing

    if (driverRepository.hasActiveAssignment(id)) {
      throw new ConflictError(`Cannot delete driver '${id}' while an active assignment exists`);
    }

    if (driverRepository.hasAnyAssignment(id)) {
      throw new ConflictError(`Cannot delete driver '${id}' with existing assignment records. Deletion would compromise historical dispatch logs.`);
    }

    return driverRepository.delete(id);
  }
}

module.exports = new DriverService();

