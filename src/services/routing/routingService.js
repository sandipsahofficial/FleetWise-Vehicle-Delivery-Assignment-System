const OsrmProvider = require('./osrmProvider');
const HaversineProvider = require('./haversineProvider');
const logger = require('../../utils/logger');

class RoutingService {
  constructor(provider = null, maxCacheSize = 500, ttlMs = 3600000) {
    this.provider = provider || new OsrmProvider();
    this.haversine = new HaversineProvider();
    this.maxCacheSize = maxCacheSize;
    this.ttlMs = ttlMs;
    // Map preserves insertion order for LRU eviction
    this.cache = new Map();
  }

  _makeCacheKey(start, end) {
    const lat1 = Number(start.lat).toFixed(4);
    const lon1 = Number(start.lng).toFixed(4);
    const lat2 = Number(end.lat).toFixed(4);
    const lon2 = Number(end.lng).toFixed(4);
    return `${lat1},${lon1}:${lat2},${lon2}`;
  }

  _getCached(key) {
    if (!this.cache.has(key)) return null;
    const entry = this.cache.get(key);
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  _setCached(key, value) {
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest entry (first item in Map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Calculates route distance and ETA with bounded caching and non-blocking fallback.
   */
  async calculateRoute(start, end) {
    if (!start || !end || isNaN(start.lat) || isNaN(start.lng) || isNaN(end.lat) || isNaN(end.lng)) {
      return { distanceKm: 0, durationMinutes: 15, provider: 'default' };
    }

    const key = this._makeCacheKey(start, end);
    const cached = this._getCached(key);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.provider.getRoute(start, end);
      this._setCached(key, result);
      return result;
    } catch (err) {
      logger.debug({ error: err.message }, 'Routing provider threw error; falling back to Haversine');
      const fallbackResult = await this.haversine.getRoute(start, end);
      this._setCached(key, fallbackResult);
      return fallbackResult;
    }
  }

  /**
   * Formats a coarse human-readable ETA for public customer tracking.
   * Never exposes raw distance or internal routing telemetry.
   */
  formatCoarseEta(durationMinutes) {
    if (!durationMinutes || durationMinutes <= 2) {
      return 'arriving shortly';
    }
    if (durationMinutes >= 60) {
      const hours = Math.round(durationMinutes / 60);
      return `arriving in about ${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `arriving in about ${durationMinutes} minutes`;
  }
}

module.exports = new RoutingService();
module.exports.RoutingService = RoutingService;

