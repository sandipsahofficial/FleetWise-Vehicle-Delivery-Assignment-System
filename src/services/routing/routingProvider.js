/**
 * Interface / Base Class for Routing Service Providers
 */
class RoutingProvider {
  /**
   * Calculates distance in kilometers and estimated duration in minutes between coordinates.
   * @param {{ lat: number, lng: number }} _start
   * @param {{ lat: number, lng: number }} _end
   * @returns {Promise<{ distanceKm: number, durationMinutes: number, provider: string }>}
   */
  async getRoute(_start, _end) {
    throw new Error('RoutingProvider.getRoute() must be implemented by concrete subclass');
  }
}

module.exports = RoutingProvider;
