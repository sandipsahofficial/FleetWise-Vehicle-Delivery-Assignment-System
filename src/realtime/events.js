const { getIO } = require('./socket');
const logger = require('../utils/logger');

/**
 * Real-time event dispatcher.
 * Emits events strictly AFTER database transactions are committed.
 * Automatically handles role-based room dispatching:
 * - Admins and dispatchers in 'ops_room' receive all operational events.
 * - Drivers receive events selectively in their private 'driver:<driverId>' room.
 */
class RealtimeEvents {
  emitDeliveryCreated(delivery) {
    const io = getIO();
    if (!io) return;
    try {
      io.to('ops_room').emit('delivery.created', delivery);
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to emit delivery.created event');
    }
  }

  emitDeliveryAssigned(delivery) {
    const io = getIO();
    if (!io) return;
    try {
      // 1. Broadcast to dispatchers/admins
      io.to('ops_room').emit('delivery.assigned', delivery);

      // 2. Broadcast selectively to the assigned driver's private room
      const driverId = delivery.assignment?.driver?.id || delivery.assignment?.driver_id;
      if (driverId) {
        io.to(`driver:${driverId}`).emit('delivery.assigned', delivery);
      }
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to emit delivery.assigned event');
    }
  }

  emitDeliveryStatusChanged(delivery) {
    const io = getIO();
    if (!io) return;
    try {
      // Broadcast to dispatchers
      io.to('ops_room').emit('delivery.status_changed', delivery);

      // Broadcast to assigned driver
      const driverId = delivery.assignment?.driver?.id || delivery.assignment?.driver_id;
      if (driverId) {
        io.to(`driver:${driverId}`).emit('delivery.status_changed', delivery);
      }
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to emit delivery.status_changed event');
    }
  }

  emitVehicleStatusChanged(vehicle) {
    const io = getIO();
    if (!io) return;
    try {
      io.to('ops_room').emit('vehicle.status_changed', vehicle);
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to emit vehicle.status_changed event');
    }
  }

  emitDriverLocationUpdated(location) {
    const io = getIO();
    if (!io) return;
    try {
      io.to('ops_room').emit('driver.location_updated', location);
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to emit driver.location_updated event');
    }
  }
}

module.exports = new RealtimeEvents();

