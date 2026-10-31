/**
 * Abstract Routing Provider Interface
 */
class RoutingProvider {
  /**
   * Calculates distance and estimated duration between two coordinate pairs.
   * @param {{ lat: number, lng: number }} start
   * @param {{ lat: number, lng: number }} end
   * @returns {Promise<{ distanceKm: number, durationMinutes: number, provider: string }>}
   */
  async getRoute(start, end) {
    throw new Error('getRoute must be implemented by concrete routing provider');
  }
}

module.exports = RoutingProvider;
