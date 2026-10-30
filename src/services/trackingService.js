const crypto = require('node:crypto');
const trackingRepository = require('../repositories/trackingRepository');
const deliveryRepository = require('../repositories/deliveryRepository');
const proofRepository = require('../repositories/proofRepository');
const { getDb } = require('../db/database');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

class TrackingService {
  /**
   * Generates or regenerates an unguessable 192-bit customer tracking token.
   * Stores only the SHA-256 hash. Returns the plain link ONCE.
   */
  generateTrackingLink(deliveryId, user) {
    if (user.role !== 'admin' && user.role !== 'dispatcher') {
      throw new ForbiddenError('Only dispatchers and administrators can manage customer tracking links');
    }

    const delivery = deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    // 192 bits of cryptographic randomness (24 bytes base64url encoded)
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Default expiry: 7 days if active, or 48 hours post-completion if already delivered
    const expiresAt = delivery.status === 'delivered'
      ? new Date(Date.now() + 48 * 3600 * 1000).toISOString()
      : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    trackingRepository.upsertTrackingLink({
      delivery_id: deliveryId,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    return {
      delivery_id: deliveryId,
      tracking_url: `/t/${rawToken}`,
      token: rawToken,
      expires_at: expiresAt
    };
  }

  /**
   * Revokes an existing tracking link.
   */
  revokeTrackingLink(deliveryId, user) {
    if (user.role !== 'admin' && user.role !== 'dispatcher') {
      throw new ForbiddenError('Only dispatchers and administrators can revoke customer tracking links');
    }

    const delivery = deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    trackingRepository.revokeByDeliveryId(deliveryId);
    return {
      message: 'Tracking link successfully revoked',
      delivery_id: deliveryId
    };
  }

  /**
   * Public tracking endpoint resolver.
   * Strict data minimization: returns only status, coarse progress, and vehicle position while in transit.
   * Identical 404 for invalid, expired, or revoked tokens.
   */
  getPublicTrackingData(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new NotFoundError('Tracking link not found or expired');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const link = trackingRepository.findByTokenHash(tokenHash);

    if (!link || link.revoked === 1) {
      throw new NotFoundError('Tracking link not found or expired');
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new NotFoundError('Tracking link not found or expired');
    }

    const stageMap = {
      pending: 'Order Confirmed',
      assigned: 'Driver Assigned & Preparing',
      in_transit: 'Out for Delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };

    let vehicleLocation = null;

    // Vehicle location is ONLY exposed when the delivery is actively in transit
    if (link.delivery_status === 'in_transit') {
      const db = getDb();
      const loc = db.prepare(`
        SELECT dl.lat, dl.lng, dl.speed, dl.heading, dl.updated_at
        FROM assignments a
        JOIN driver_locations dl ON dl.driver_id = a.driver_id
        WHERE a.delivery_id = ? AND a.is_active = 1
      `).get(link.delivery_id);

      if (loc) {
        vehicleLocation = {
          lat: loc.lat,
          lng: loc.lng,
          speed: loc.speed,
          heading: loc.heading,
          updated_at: loc.updated_at
        };
      }
    }

    let deliveredAt = null;
    if (link.delivery_status === 'delivered') {
      const proof = proofRepository.getProof(link.delivery_id);
      if (proof && proof.completed_at) {
        deliveredAt = proof.completed_at;
      }
    }

    return {
      status: link.delivery_status,
      progress_stage: stageMap[link.delivery_status] || 'Processing',
      pickup_address: link.pickup_address,
      dropoff_address: link.dropoff_address,
      scheduled_time: link.scheduled_time,
      delivered_at: deliveredAt,
      vehicle_location: vehicleLocation
    };
  }
}

module.exports = new TrackingService();
