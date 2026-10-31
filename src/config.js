const path = require('node:path');
require('dotenv').config();

// Auto-detect test runner context so NODE_ENV === 'test' is reliably set across platforms
if (
  process.execArgv.includes('--test') ||
  process.argv.some(arg => arg.includes('tests') || arg.endsWith('.test.js'))
) {
  process.env.NODE_ENV = 'test';
}

const DEFAULT_JWT_SECRET = 'supersecret_fleetwise_jwt_access_token_key_change_in_production';
const DEFAULT_REFRESH_SECRET = 'supersecret_fleetwise_jwt_refresh_token_key_change_in_production';
const DEFAULT_OTP_HMAC_SECRET = 'supersecret_fleetwise_otp_hmac_secret_key_change_in_production';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const jwtSecret = process.env.JWT_SECRET || (isTest ? 'test_jwt_secret_key_12345' : DEFAULT_JWT_SECRET);
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || (isTest ? 'test_jwt_refresh_secret_key_12345' : DEFAULT_REFRESH_SECRET);
const otpHmacSecret = process.env.OTP_HMAC_SECRET || (isTest ? 'test_otp_hmac_secret_key_12345' : DEFAULT_OTP_HMAC_SECRET);

const notificationsEnabled = process.env.NOTIFICATIONS_ENABLED !== 'false';
const notificationProvider = process.env.NOTIFICATION_PROVIDER || (isProd ? 'smtp' : 'console');

if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET === DEFAULT_REFRESH_SECRET) {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (!process.env.OTP_HMAC_SECRET || process.env.OTP_HMAC_SECRET === DEFAULT_OTP_HMAC_SECRET) {
    throw new Error('FATAL: OTP_HMAC_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (notificationsEnabled) {
    if (notificationProvider === 'console') {
      throw new Error('FATAL: NOTIFICATION_PROVIDER cannot be "console" in production. Configure a valid SMTP provider or explicitly set NOTIFICATIONS_ENABLED=false.');
    }
    if (notificationProvider === 'smtp') {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('FATAL: SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured in production when notifications are enabled.');
      }
    }
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProd,
  isTest,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fleetwise.db'),
  jwt: {
    secret: jwtSecret,
    refreshSecret: jwtRefreshSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  otp: {
    hmacSecret: otpHmacSecret
  },
  routing: {
    osrmUrl: process.env.OSRM_URL || 'http://router.project-osrm.org',
    avgSpeedKmh: parseFloat(process.env.ROUTING_AVG_SPEED_KMH || '40'),
    timeoutMs: parseInt(process.env.ROUTING_TIMEOUT_MS || '3000', 10)
  },
  notifications: {
    enabled: notificationsEnabled,
    provider: notificationProvider,
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      },
      from: process.env.SMTP_FROM || 'FleetWise <no-reply@fleetwise.local>'
    }
  },
  adminSeed: {
    username: process.env.ADMIN_USERNAME || null,
    password: process.env.ADMIN_PASSWORD || null
  },
  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

module.exports = config;
