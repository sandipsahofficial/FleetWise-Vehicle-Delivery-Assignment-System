const express = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema, refreshSchema } = require('../schemas/authSchemas');

const router = express.Router();

// POST /auth/register - admin only, creates user accounts
router.post('/register', authenticate(), requireRole(['admin']), validate(registerSchema), (req, res, next) => {
  try {
    const user = authService.register(req.body);
    res.status(201).json({
      message: 'User registered successfully',
      user
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login - public, strictly rate-limited
router.post('/login', authLimiter, validate(loginSchema), (req, res, next) => {
  try {
    const result = authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh - rotate refresh token and issue fresh access token
router.post('/refresh', validate(refreshSchema), (req, res, next) => {
  try {
    const result = authService.refresh(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout - revoke refresh token
router.post('/logout', (req, res, next) => {
  try {
    const result = authService.logout(req.body || {});
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /auth/me - inspect authenticated user profile
router.get('/me', authenticate(), (req, res) => {
  res.status(200).json({
    user: req.user
  });
});

module.exports = router;

