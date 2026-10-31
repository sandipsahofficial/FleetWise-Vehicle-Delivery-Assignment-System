const RoutingProvider = require('./routingProvider');
const config = require('../../config');

class HaversineProvider extends RoutingProvider {
  constructor(avgSpeedKmh = null) {
    super();
    this.avgSpeedKmh = avgSpeedKmh || config.routing.avgSpeedKmh || 40;
  }

  /**
   * Calculates Haversine distance and duration based on average speed.
   */
  async getRoute(start, end) {
    const lat1 = Number(start.lat);
    const lon1 = Number(start.lng);
    const lat2 = Number(end.lat);
    const lon2 = Number(end.lng);

    const R = 6371; // Earth radius in kilometers
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = Math.round(R * c * 100) / 100;

    const durationMinutes = Math.max(1, Math.round((distanceKm / this.avgSpeedKmh) * 60));

    return {
      distanceKm,
      durationMinutes,
      provider: 'haversine'
    };
  }
}

module.exports = HaversineProvider;

