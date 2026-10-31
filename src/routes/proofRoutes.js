const express = require('express');
const multer = require('multer');
const proofService = require('../services/proofService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { completeOtpSchema, completePhotoSchema } = require('../schemas/proofSchemas');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const handlePhotoUpload = (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError || err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'ValidationError',
            message: 'Photo exceeds maximum allowed size of 5MB'
          });
        }
        return res.status(400).json({
          error: 'ValidationError',
          message: err.message
        });
      }
      return next(err);
    }
    next();
  });
};

const router = express.Router();

// POST /deliveries/:id/complete-otp - Complete delivery using customer OTP
router.post(
  '/deliveries/:id/complete-otp',
  authenticate(),
  validate(completeOtpSchema),
  (req, res, next) => {
    try {
      const updated = proofService.completeWithOtp(
        req.params.id,
        {
          otp: req.body.otp,
          lat: req.body.lat,
          lng: req.body.lng
        },
        req.user
      );

      res.status(200).json({
        message: 'Delivery completed successfully with verified customer OTP',
        delivery: updated
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /deliveries/:id/complete-photo - Complete delivery using photo proof
router.post(
  '/deliveries/:id/complete-photo',
  authenticate(),
  handlePhotoUpload,
  validate(completePhotoSchema),
  (req, res, next) => {
    try {
      const updated = proofService.completeWithPhoto(
        req.params.id,
        req.file,
        {
          lat: req.body.lat,
          lng: req.body.lng
        },
        req.user
      );

      res.status(200).json({
        message: 'Delivery completed successfully with verified photo proof',
        delivery: updated
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries/:id/proof/photo - Authenticated photo proof streaming
router.get(
  '/deliveries/:id/proof/photo',
  authenticate(),
  (req, res, next) => {
    try {
      const { filePath, mimeType } = proofService.getProofPhoto(req.params.id, req.user);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  }
);

// POST /deliveries/:id/otp/regenerate - Admin/dispatcher regenerate OTP
router.post(
  '/deliveries/:id/otp/regenerate',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const result = proofService.regenerateOtp(req.params.id, req.user);
      res.status(200).json({
        message: 'Delivery OTP regenerated successfully',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
