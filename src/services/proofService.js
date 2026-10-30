const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { getDb } = require('../db/database');
const deliveryRepository = require('../repositories/deliveryRepository');
const proofRepository = require('../repositories/proofRepository');
const trackingRepository = require('../repositories/trackingRepository');
const auditService = require('./auditService');
const events = require('../realtime/events');
const { detectImageMime, stripJpegExif } = require('../utils/fileValidation');
const {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} = require('../utils/errors');

class ProofService {
  /**
   * Generates a secure 6-digit numeric OTP, computes its HMAC-SHA256, and saves it.
   */
  generateOtp(deliveryId) {
    // Generate 6-digit number between 100000 and 999999
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHmac('sha256', config.jwt.secret).update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24 hours

    proofRepository.upsertOtp({
      delivery_id: deliveryId,
      otp_hash: otpHash,
      otp_expires_at: expiresAt
    });

    return { otp, expires_at: expiresAt };
  }

  /**
   * Regenerates an OTP for an active delivery (admin/dispatcher only).
   */
  regenerateOtp(deliveryId, user) {
    if (user.role !== 'admin' && user.role !== 'dispatcher') {
      throw new ForbiddenError('Only dispatchers and administrators can regenerate delivery OTPs');
    }

    const delivery = deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    if (delivery.status !== 'in_transit') {
      throw new ConflictError(`Cannot regenerate OTP for delivery in '${delivery.status}' state. Delivery must be 'in_transit'.`);
    }

    const result = this.generateOtp(deliveryId);

    auditService.log({
      entity_type: 'delivery',
      entity_id: deliveryId,
      action: 'otp_regenerated',
      performed_by: user.username,
      details: 'Regenerated one-time delivery verification code'
    });

    return {
      delivery_id: deliveryId,
      otp: result.otp,
      expires_at: result.expires_at
    };
  }

  /**
   * Complete delivery using customer OTP.
   * Atomic attempt counting, lockout after 5 failures, constant-time HMAC comparison.
   */
  completeWithOtp(deliveryId, { otp, lat = null, lng = null }, user) {
    const db = getDb();

    // Enforce driver ownership if called by a driver
    if (user.role === 'driver') {
      const del = db.prepare('SELECT id FROM deliveries WHERE id = ?').get(deliveryId);
      if (!del) throw new NotFoundError(`Delivery '${deliveryId}' not found`);
      const assign = db.prepare('SELECT driver_id FROM assignments WHERE delivery_id = ? ORDER BY id DESC LIMIT 1').get(deliveryId);
      if (!user.driver_id || !assign || assign.driver_id !== user.driver_id) {
        throw new ForbiddenError('Access denied. Drivers can only complete their own assigned deliveries.');
      }
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
      if (!delivery) {
        throw new NotFoundError(`Delivery '${deliveryId}' not found`);
      }

      if (delivery.status === 'delivered') {
        throw new ConflictError('Delivery has already been completed');
      }

      if (delivery.status !== 'in_transit') {
        throw new ConflictError(`Cannot complete delivery in '${delivery.status}' state. Must be 'in_transit'.`);
      }

      const proof = proofRepository.getProof(deliveryId);
      if (!proof || !proof.otp_hash) {
        throw new BadRequestError('No OTP was generated for this delivery. Contact dispatch.');
      }

      if (proof.otp_locked === 1 || proof.otp_attempts >= 5) {
        throw new ForbiddenError('OTP verification locked due to excessive failed attempts (maximum 5 attempts). Contact dispatch for assistance.');
      }

      if (proof.otp_expires_at && new Date(proof.otp_expires_at) < new Date()) {
        throw new BadRequestError('OTP code has expired. Please contact dispatch to regenerate.');
      }

      // Constant-time HMAC comparison
      const computedHash = crypto.createHmac('sha256', config.jwt.secret).update(String(otp).trim()).digest('hex');
      const bufA = Buffer.from(computedHash, 'hex');
      const bufB = Buffer.from(proof.otp_hash, 'hex');
      const match = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

      if (!match) {
        // Increment attempts atomically
        const attempts = proofRepository.incrementOtpAttempts(deliveryId);
        if (attempts >= 5) {
          proofRepository.lockOtp(deliveryId);
          db.exec('COMMIT');
          throw new ForbiddenError('OTP verification locked: 5 incorrect attempts reached. Contact dispatch.');
        }
        db.exec('COMMIT');
        const remaining = 5 - attempts;
        throw new BadRequestError(`Invalid OTP code. ${remaining} attempt(s) remaining before lockout.`);
      }

      // Record successful OTP proof
      proofRepository.recordOtpCompletion({ delivery_id: deliveryId, lat, lng });

      // Execute resource release & delivery state transition within the same transaction
      this._releaseResourcesAndCompleteDelivery(db, deliveryId, user.username || 'driver');

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }

    // Post-commit actions
    trackingRepository.updateExpiryOnCompletion(deliveryId, 48);

    const updated = deliveryRepository.findById(deliveryId);
    try {
      events.emitDeliveryStatusChanged(updated);
      if (updated.assignment?.vehicle?.id) {
        const vehicleRepo = require('../repositories/vehicleRepository');
        const veh = vehicleRepo.findById(updated.assignment.vehicle.id);
        if (veh) events.emitVehicleStatusChanged(veh);
      }
    } catch (_) {}

    return updated;
  }

  /**
   * Complete delivery using photo upload.
   * Validates content (magic bytes), strips JPEG EXIF, stores securely outside public.
   */
  completeWithPhoto(deliveryId, file, { lat = null, lng = null }, user) {
    if (!file || !file.buffer) {
      throw new BadRequestError('Proof photo file is required');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestError('File size exceeds the 5MB limit');
    }

    // Validate content by inspecting magic bytes
    const detectedMime = detectImageMime(file.buffer);
    if (!detectedMime) {
      throw new BadRequestError('Invalid file type: file content is not a valid JPEG, PNG, or WebP image');
    }

    // Enforce driver ownership if called by a driver
    if (user.role === 'driver') {
      const db = getDb();
      const del = db.prepare('SELECT id FROM deliveries WHERE id = ?').get(deliveryId);
      if (!del) throw new NotFoundError(`Delivery '${deliveryId}' not found`);
      const assign = db.prepare('SELECT driver_id FROM assignments WHERE delivery_id = ? ORDER BY id DESC LIMIT 1').get(deliveryId);
      if (!user.driver_id || !assign || assign.driver_id !== user.driver_id) {
        throw new ForbiddenError('Access denied. Drivers can only complete their own assigned deliveries.');
      }
    }

    // Strip EXIF from JPEG if applicable
    let finalBuffer = file.buffer;
    if (detectedMime === 'image/jpeg') {
      finalBuffer = stripJpegExif(file.buffer);
    }

    const ext = detectedMime === 'image/png' ? '.png' : detectedMime === 'image/webp' ? '.webp' : '.jpg';
    const filename = `${crypto.randomUUID()}${ext}`;
    const storageDir = path.join(__dirname, '..', '..', 'storage', 'proofs');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const filePath = path.join(storageDir, filename);

    // Write file to disk
    fs.writeFileSync(filePath, finalBuffer);

    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
      if (!delivery) {
        throw new NotFoundError(`Delivery '${deliveryId}' not found`);
      }

      if (delivery.status === 'delivered') {
        throw new ConflictError('Delivery has already been completed');
      }

      if (delivery.status !== 'in_transit') {
        throw new ConflictError(`Cannot complete delivery in '${delivery.status}' state. Must be 'in_transit'.`);
      }

      // Record photo proof in DB
      proofRepository.recordPhotoCompletion({
        delivery_id: deliveryId,
        photo_path: filename,
        photo_mime: detectedMime,
        photo_size: finalBuffer.length,
        lat,
        lng
      });

      // Execute resource release & delivery state transition within the same transaction
      this._releaseResourcesAndCompleteDelivery(db, deliveryId, user.username || 'driver');

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {}
      // Delete uploaded file if DB write fails to prevent orphan files
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
      throw err;
    }

    // Post-commit actions
    trackingRepository.updateExpiryOnCompletion(deliveryId, 48);

    const updated = deliveryRepository.findById(deliveryId);
    try {
      events.emitDeliveryStatusChanged(updated);
      if (updated.assignment?.vehicle?.id) {
        const vehicleRepo = require('../repositories/vehicleRepository');
        const veh = vehicleRepo.findById(updated.assignment.vehicle.id);
        if (veh) events.emitVehicleStatusChanged(veh);
      }
    } catch (_) {}

    return updated;
  }

  /**
   * Retrieves stored photo proof for authenticated viewing.
   */
  getProofPhoto(deliveryId, user) {
    const delivery = deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    // Check authorization: admin, dispatcher, or assigned driver
    if (user.role === 'driver') {
      const db = getDb();
      const assign = db.prepare('SELECT driver_id FROM assignments WHERE delivery_id = ? ORDER BY id DESC LIMIT 1').get(deliveryId);
      if (!user.driver_id || !assign || assign.driver_id !== user.driver_id) {
        throw new ForbiddenError('Access denied. Drivers can only view proof photos for their own assigned deliveries.');
      }
    } else if (user.role !== 'admin' && user.role !== 'dispatcher') {
      throw new ForbiddenError('Access denied. Insufficient permissions to view proof photos.');
    }

    const proof = proofRepository.getProof(deliveryId);
    if (!proof || proof.proof_type !== 'photo' || !proof.photo_path) {
      throw new NotFoundError(`Photo proof not found for delivery '${deliveryId}'`);
    }

    const storageDir = path.join(__dirname, '..', '..', 'storage', 'proofs');
    const fullPath = path.join(storageDir, proof.photo_path);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError('Stored photo proof file not found on disk');
    }

    return {
      filePath: fullPath,
      mimeType: proof.photo_mime || 'image/jpeg'
    };
  }

  /**
   * Internal helper to execute resource release & update delivery status in the open transaction.
   */
  _releaseResourcesAndCompleteDelivery(db, deliveryId, performedBy) {
    // 1. Find active assignment
    const activeAssignStmt = db.prepare('SELECT * FROM assignments WHERE delivery_id = ? AND is_active = 1');
    const assignment = activeAssignStmt.get(deliveryId);

    if (assignment) {
      // Deactivate assignment
      db.prepare(`
        UPDATE assignments 
        SET is_active = 0, released_at = DATETIME('now')
        WHERE id = ?
      `).run(assignment.id);

      // Recalculate vehicle status (never overwrite maintenance or inactive!)
      const vehRow = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(assignment.vehicle_id);
      if (vehRow) {
        const otherActiveVeh = db.prepare(`
          SELECT COUNT(*) AS count FROM assignments WHERE vehicle_id = ? AND is_active = 1
        `).get(assignment.vehicle_id);

        if (otherActiveVeh.count === 0 && vehRow.status === 'assigned') {
          db.prepare(`
            UPDATE vehicles SET status = 'available', updated_at = DATETIME('now') WHERE id = ?
          `).run(assignment.vehicle_id);
        }
      }

      // Recalculate driver status (never overwrite unavailable!)
      const drvRow = db.prepare('SELECT * FROM drivers WHERE id = ?').get(assignment.driver_id);
      if (drvRow) {
        const otherActiveDrv = db.prepare(`
          SELECT COUNT(*) AS count FROM assignments WHERE driver_id = ? AND is_active = 1
        `).get(assignment.driver_id);

        if (otherActiveDrv.count === 0 && drvRow.availability_status === 'assigned') {
          db.prepare(`
            UPDATE drivers SET availability_status = 'available', updated_at = DATETIME('now') WHERE id = ?
          `).run(assignment.driver_id);
        }
      }
    }

    // 2. Update delivery record to delivered
    db.prepare(`
      UPDATE deliveries 
      SET status = 'delivered', updated_at = DATETIME('now') 
      WHERE id = ?
    `).run(deliveryId);

    // 3. Write audit log
    const auditId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, performed_by, details, timestamp)
      VALUES (?, 'delivery', ?, 'delivery_completed', ?, 'Completed delivery with verified proof of delivery', DATETIME('now'))
    `).run(auditId, deliveryId, performedBy);
  }
}

module.exports = new ProofService();
