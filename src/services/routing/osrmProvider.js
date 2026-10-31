const RoutingProvider = require('./routingProvider');
const HaversineProvider = require('./haversineProvider');
const config = require('../../config');
const logger = require('../../utils/logger');

class OsrmProvider extends RoutingProvider {
  constructor(baseUrl = null, timeoutMs = null) {
    super();
    this.baseUrl = (baseUrl || config.routing.osrmUrl || 'http://router.project-osrm.org').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs || config.routing.timeoutMs || 3000;
    this.fallback = new HaversineProvider();
  }

  async getRoute(start, end) {
    const lon1 = Number(start.lng);
    const lat1 = Number(start.lat);
    const lon2 = Number(end.lng);
    const lat2 = Number(end.lat);

    const url = `${this.baseUrl}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;

    // Attempt request with 1 retry before falling back
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`OSRM responded with HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
          const route = data.routes[0];
          const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
          const durationMinutes = Math.max(1, Math.round(route.duration / 60));

          return {
            distanceKm,
            durationMinutes,
            provider: 'osrm'
          };
        }
        throw new Error(`OSRM route calculation failed with code: ${data.code}`);
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempt === 1) {
          // Quick retry after 100ms
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        logger.debug({ error: err.message, url }, 'OSRM routing request failed; using Haversine fallback');
      }
    }

    // Seamless fallback to Haversine
    return this.fallback.getRoute(start, end);
  }
}

module.exports = OsrmProvider;
