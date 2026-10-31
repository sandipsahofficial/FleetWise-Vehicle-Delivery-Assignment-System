const crypto = require('node:crypto');
const notificationRepository = require('../repositories/notificationRepository');
const trackingRepository = require('../repositories/trackingRepository');
const proofRepository = require('../repositories/proofRepository');
const emailProvider = require('./notifications/providers/email');
const smsProvider = require('./notifications/providers/sms');
const waProvider = require('./notifications/providers/wa');
const { escapeHtml, sanitizeHeader } = require('./notifications/providers/email');
const logger = require('../utils/logger');
const config = require('../config');
const { BadRequestError, NotFoundError } = require('../utils/errors');

class NotificationService {
  /**
   * Registers or updates customer contact details for a delivery.
   * Consent defaults to 0 (off) unless explicitly opted in.
   */
  registerContact(deliveryId, { name, email, phone = null, consent = 0 }, recordedBy = 'dispatcher') {
    if (!deliveryId) throw new BadRequestError('Delivery ID is required');
    if (!name || !name.trim()) throw new BadRequestError('Customer name is required');
    if (!email || !email.includes('@')) throw new BadRequestError('Valid email address is required');

    return notificationRepository.upsertContact({
      delivery_id: deliveryId,
      name: sanitizeHeader(name),
      email: sanitizeHeader(email).toLowerCase(),
      phone: phone ? sanitizeHeader(phone) : null,
      consent: consent ? 1 : 0,
      recorded_by: recordedBy || 'dispatcher'
    });
  }

  getContact(deliveryId) {
    const contact = notificationRepository.findByDeliveryId(deliveryId);
    if (!contact) {
      throw new NotFoundError(`Customer contact for delivery '${deliveryId}' not found`);
    }
    return contact;
  }

  anonymizeContact(deliveryId) {
    const contact = notificationRepository.findByDeliveryId(deliveryId);
    if (!contact) {
      throw new NotFoundError(`Customer contact for delivery '${deliveryId}' not found`);
    }
    return notificationRepository.anonymizeByDeliveryId(deliveryId);
  }

  /**
   * Enqueues an outbox row within an existing DB transaction.
   * Respects config.notifications.enabled and customer consent.
   * Never stores raw plaintext OTPs or sensitive tokens in the database parameters.
   */
  enqueueNotification(db, { deliveryId, event, channel = 'email', template }) {
    if (config.notifications && config.notifications.enabled === false) {
      return null;
    }

    const contact = notificationRepository.findByDeliveryId(deliveryId);
    if (!contact || contact.consent !== 1) {
      // Respect consent: never enqueue if opted out or no contact registered
      return null;
    }

    const recipient = channel === 'email' ? contact.email : (contact.phone || contact.email);
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${deliveryId}:${event}:${channel}`)
      .digest('hex');

    // Only non-sensitive reference params stored
    const params = {
      customer_name: contact.name,
      delivery_id: deliveryId
    };

    return notificationRepository.insertOutboxRow(db, {
      delivery_id: deliveryId,
      event,
      channel,
      recipient,
      template: template || event,
      params,
      idempotency_key: idempotencyKey
    });
  }

  /**
   * Renders and dispatches a single outbox record at worker send time.
   */
  async processOutboxEntry(entry) {
    const channel = entry.channel;
    const event = entry.event;
    const recipient = entry.recipient;
    const params = entry.params_json ? JSON.parse(entry.params_json) : {};
    const safeName = escapeHtml(params.customer_name || 'Valued Customer');

    let subject = 'FleetWise Delivery Update';
    let htmlText = '';
    let plainText = '';

    if (event === 'delivery_assigned') {
      subject = 'Your FleetWise Shipment is Scheduled';
      htmlText = `<h2>Shipment Scheduled</h2><p>Hello ${safeName},</p><p>Your delivery <strong>${escapeHtml(entry.delivery_id)}</strong> has been assigned to a courier and is preparing for dispatch.</p>`;
      plainText = `Hello ${params.customer_name || 'Customer'},\nYour delivery ${entry.delivery_id} has been scheduled and assigned.`;
    } else if (event === 'trip_started') {
      subject = 'Your Driver is On the Way!';

      // Retrieve dynamic active tracking link and OTP at render time (never stored in outbox)
      const trackingLink = trackingRepository.findActiveByDeliveryId(entry.delivery_id);
      const trackingUrl = trackingLink ? `/t/${trackingLink.token_hash.slice(0, 16)}` : null;

      htmlText = `<h2>Driver Dispatched</h2><p>Hello ${safeName},</p><p>Your order is out for delivery!`;
      if (trackingUrl) {
        htmlText += `<p><a href="${trackingUrl}">Track your vehicle live on our interactive map</a>.</p>`;
      }
      htmlText += `<p>Please be ready to receive your delivery.</p>`;
      plainText = `Hello ${params.customer_name || 'Customer'},\nYour order is on the way!`;
    } else if (event === 'delivered') {
      subject = 'Your Delivery Has Arrived!';
      htmlText = `<h2>Delivery Complete</h2><p>Hello ${safeName},</p><p>Your delivery has arrived and was completed successfully. Thank you for choosing FleetWise.</p>`;
      plainText = `Hello ${params.customer_name || 'Customer'},\nYour shipment ${entry.delivery_id} was successfully delivered.`;
    } else {
      subject = `Shipment Update: ${event}`;
      htmlText = `<p>Hello ${safeName},</p><p>Update on delivery ${escapeHtml(entry.delivery_id)}: ${escapeHtml(event)}.</p>`;
      plainText = `Update on delivery ${entry.delivery_id}: ${event}`;
    }

    if (channel === 'email') {
      return emailProvider.send({
        to: recipient,
        subject,
        htmlText,
        text: plainText,
        event
      });
    } else if (channel === 'sms') {
      return smsProvider.send({ to: recipient, text: plainText, event });
    } else if (channel === 'whatsapp') {
      return waProvider.send({ to: recipient, text: plainText, event });
    }

    throw new Error(`Unsupported notification channel: ${channel}`);
  }
}

module.exports = new NotificationService();

