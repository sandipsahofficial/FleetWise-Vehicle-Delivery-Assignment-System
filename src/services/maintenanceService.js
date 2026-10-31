const { getDb } = require('../db/database');
const maintenanceRepository = require('../repositories/maintenanceRepository');
const vehicleRepository = require('../repositories/vehicleRepository');
const auditService = require('./auditService');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');

class MaintenanceService {
  /**
   * Schedules planned maintenance for a vehicle.
   */
  createSchedule(data, user) {
    const vehicle = vehicleRepository.findById(data.vehicle_id);
    if (!vehicle) {
      throw new NotFoundError(`Vehicle '${data.vehicle_id}' not found`);
    }

    const schedule = maintenanceRepository.createSchedule(data);
    auditService.log({
      entity_type: 'vehicle',
      entity_id: data.vehicle_id,
      action: 'maintenance_scheduled',
      old_state: null,
      new_state: { service_type: data.service_type, due_date: data.due_date, due_odometer: data.due_odometer },
      performed_by: user?.username || 'system',
      details: `Scheduled ${data.service_type} for vehicle ${vehicle.registration_number}`
    });

    return schedule;
  }

  listSchedules(filters) {
    return maintenanceRepository.listSchedules(filters);
  }

  /**
   * Retrieves overdue maintenance schedules based on current date or current odometer.
   */
  getOverdueMaintenance() {
    const schedules = maintenanceRepository.listSchedules({ status: 'pending' });
    const today = new Date().toISOString().split('T')[0];

    return schedules.filter((s) => {
      const dateOverdue = s.due_date && s.due_date <= today;
      const odoOverdue = s.due_odometer && s.current_odometer >= s.due_odometer;
      return dateOverdue || odoOverdue;
    });
  }

  /**
   * Records completed maintenance. Performs monotonic odometer update in an atomic transaction.
   */
  recordMaintenance(data, user) {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');

    try {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(data.vehicle_id);
      if (!vehicle) {
        throw new NotFoundError(`Vehicle '${data.vehicle_id}' not found`);
      }

      if (data.odometer < vehicle.odometer) {
        throw new BadRequestError(
          `Maintenance odometer reading (${data.odometer}) cannot be less than current vehicle odometer (${vehicle.odometer})`
        );
      }

      const record = maintenanceRepository.createRecord({
        ...data,
        performed_by: user?.username || data.performed_by || 'technician'
      });

      // Update vehicle odometer to new reading
      db.prepare(`
        UPDATE vehicles
        SET odometer = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `).run(data.odometer, data.vehicle_id);

      db.exec('COMMIT');

      auditService.log({
        entity_type: 'vehicle',
        entity_id: data.vehicle_id,
        action: 'maintenance_recorded',
        old_state: { odometer: vehicle.odometer },
        new_state: { odometer: data.odometer, service_type: data.service_type, cost: data.cost },
        performed_by: user?.username || 'system',
        details: `Recorded ${data.service_type} ($${data.cost}) for ${vehicle.registration_number}`
      });

      return record;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }

  /**
   * Records a fuel log.
   * Drivers can log fuel ONLY for their currently assigned active vehicle.
   * Atomic monotonic odometer update in the same transaction.
   */
  logFuel(data, user) {
    const db = getDb();

    // Enforce driver scoping
    if (user && user.role === 'driver') {
      if (!user.driver_id) {
        throw new ForbiddenError('Driver user profile has no associated driver record');
      }

      const activeAssignment = db.prepare(`
        SELECT vehicle_id FROM assignments
        WHERE driver_id = ? AND is_active = 1
        LIMIT 1
      `).get(user.driver_id);

      if (!activeAssignment || activeAssignment.vehicle_id !== data.vehicle_id) {
        throw new ForbiddenError('Drivers can only submit fuel logs for their currently assigned vehicle');
      }
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(data.vehicle_id);
      if (!vehicle) {
        throw new NotFoundError(`Vehicle '${data.vehicle_id}' not found`);
      }

      // Strict monotonic check
      if (data.odometer < vehicle.odometer) {
        throw new BadRequestError(
          `Fuel log odometer reading (${data.odometer}) cannot be less than current vehicle odometer (${vehicle.odometer})`
        );
      }

      const driverId = user?.driver_id || data.driver_id || 'SYSTEM';

      const fuelLog = maintenanceRepository.createFuelLog({
        vehicle_id: data.vehicle_id,
        driver_id: driverId,
        liters: data.liters,
        cost: data.cost,
        odometer: data.odometer,
        logged_at: data.logged_at
      });

      // Update vehicle odometer in the same transaction
      db.prepare(`
        UPDATE vehicles
        SET odometer = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `).run(data.odometer, data.vehicle_id);

      db.exec('COMMIT');

      auditService.log({
        entity_type: 'vehicle',
        entity_id: data.vehicle_id,
        action: 'fuel_logged',
        old_state: { odometer: vehicle.odometer },
        new_state: { odometer: data.odometer, liters: data.liters, cost: data.cost },
        performed_by: user?.username || 'system',
        details: `Logged ${data.liters}L ($${data.cost}) for ${vehicle.registration_number}`
      });

      return fuelLog;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }

  listFuelLogs(filters, user) {
    if (user && user.role === 'driver') {
      // Drivers only see their own fuel logs
      return maintenanceRepository.listFuelLogs({ ...filters, driver_id: user.driver_id });
    }
    return maintenanceRepository.listFuelLogs(filters);
  }
}

module.exports = new MaintenanceService();
