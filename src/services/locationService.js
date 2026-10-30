const locationRepository = require('../repositories/locationRepository');
const driverRepository = require('../repositories/driverRepository');
const events = require('../realtime/events');
const { ForbiddenError, NotFoundError } = require('../utils/errors');

class LocationService {
  updateLocation(driverId, locationData, user) {
    // Role & Ownership check
    if (user.role === 'driver') {
      if (!user.driver_id || user.driver_id !== driverId) {
        throw new ForbiddenError('Access denied. Drivers can only post location updates for their own assigned driver account.');
      }
    }

    const driver = driverRepository.findById(driverId);
    if (!driver) {
      throw new NotFoundError(`Driver '${driverId}' not found`);
    }

    const updated = locationRepository.upsertLatestLocation({
      driver_id: driverId,
      lat: locationData.lat,
      lng: locationData.lng,
      speed: locationData.speed || 0,
      heading: locationData.heading || 0,
      timestamp: locationData.timestamp || new Date().toISOString()
    });

    // Real-time broadcast after successful save
    events.emitDriverLocationUpdated(updated);

    return updated;
  }

  getLatestLocations() {
    return locationRepository.getAllLatestLocations();
  }

  getDriverHistory(driverId, user) {
    if (user.role === 'driver') {
      if (!user.driver_id || user.driver_id !== driverId) {
        throw new ForbiddenError('Access denied. Drivers can only access their own location history.');
      }
    }

    return locationRepository.getDriverHistory(driverId);
  }
}

module.exports = new LocationService();
