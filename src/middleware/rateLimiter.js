const rateLimit = require('express-rate-limit');
const config = require('../config');

// Stricter rate limiter for authentication endpoints (prevent brute-force password guessing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.isTest ? 10000 : 10, // 10 attempts per 15 min in prod, generous in test
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TooManyRequests',
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  },
  skip: (req) => config.isTest && req.headers['x-skip-rate-limit'] === 'true'
});

// Standard API rate limiter for general endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.isTest ? 100000 : 120, // 120 reqs/min in prod
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TooManyRequests',
    message: 'Rate limit exceeded. Too many requests, please slow down.'
  },
  skip: () => config.isTest
});

// Rate limiter for public customer tracking endpoint (per-IP limit)
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.isTest ? (process.env.TEST_TRACKING_RATE_LIMIT ? parseInt(process.env.TEST_TRACKING_RATE_LIMIT, 10) : 1000) : 30, // 30 reqs/min per IP in prod
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TooManyRequests',
    message: 'Rate limit exceeded for tracking link requests. Please try again later.'
  },
  skip: (req) => config.isTest && req.headers['x-skip-rate-limit'] === 'true'
});

module.exports = {
  authLimiter,
  apiLimiter,
  trackingLimiter
};
