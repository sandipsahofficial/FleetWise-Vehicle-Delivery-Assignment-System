const path = require('node:path');
const { z } = require('zod');
require('dotenv').config();

// Auto-detect test runner context so NODE_ENV === 'test' is reliably set across platforms
if (
  process.execArgv.includes('--test') ||
  process.argv.some(arg => arg.includes('tests') || arg.endsWith('.test.js'))
) {
  process.env.NODE_ENV = 'test';
  if (process.env.ALLOW_DEMO_SEED === undefined) {
    process.env.ALLOW_DEMO_SEED = 'true';
  }
}

const DEFAULT_JWT_SECRET = 'supersecret_fleetwise_jwt_access_token_key_change_in_production';
const DEFAULT_REFRESH_SECRET = 'supersecret_fleetwise_jwt_refresh_token_key_change_in_production';
const DEFAULT_OTP_HMAC_SECRET = 'supersecret_fleetwise_otp_hmac_secret_key_change_in_production';

const PLACEHOLDER_PATTERNS = [
  'supersecret',
  'change-me',
  'changeme',
  'your-secret',
  'yoursecret',
  'default',
  'placeholder'
];

function containsPlaceholder(val) {
  if (!val || typeof val !== 'string') return true;
  const lower = val.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(pattern => lower.includes(pattern));
}

function isStrongPassword(pwd) {
  if (!pwd || typeof pwd !== 'string' || pwd.length < 12) return false;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasDigit = /[0-9]/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

/**
 * Zod schema for production environment variables
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().optional(),
  STORAGE_DIR: z.string().optional(),
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  OTP_HMAC_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  NOTIFICATIONS_ENABLED: z.string().default('true'),
  NOTIFICATION_PROVIDER: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  OSRM_URL: z.string().default('http://router.project-osrm.org'),
  ROUTING_AVG_SPEED_KMH: z.coerce.number().default(40),
  ROUTING_TIMEOUT_MS: z.coerce.number().default(3000)
});

function validateEnvironment(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  if (!isProd) {
    // Non-production modes use defaults or test values if not provided
    return;
  }

  // Strict Production Validations
  if (!env.JWT_SECRET || env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (env.JWT_SECRET.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters long in production.');
  }
  if (containsPlaceholder(env.JWT_SECRET)) {
    throw new Error('FATAL: JWT_SECRET contains an insecure placeholder or default pattern.');
  }

  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET === DEFAULT_REFRESH_SECRET) {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be at least 32 characters long in production.');
  }
  if (containsPlaceholder(env.JWT_REFRESH_SECRET)) {
    throw new Error('FATAL: JWT_REFRESH_SECRET contains an insecure placeholder or default pattern.');
  }

  if (!env.OTP_HMAC_SECRET || env.OTP_HMAC_SECRET === DEFAULT_OTP_HMAC_SECRET) {
    throw new Error('FATAL: OTP_HMAC_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (env.OTP_HMAC_SECRET.length < 32) {
    throw new Error('FATAL: OTP_HMAC_SECRET must be at least 32 characters long in production.');
  }
  if (containsPlaceholder(env.OTP_HMAC_SECRET)) {
    throw new Error('FATAL: OTP_HMAC_SECRET contains an insecure placeholder or default pattern.');
  }

  // Ensure secrets are mutually distinct
  if (
    env.JWT_SECRET === env.JWT_REFRESH_SECRET ||
    env.JWT_SECRET === env.OTP_HMAC_SECRET ||
    env.JWT_REFRESH_SECRET === env.OTP_HMAC_SECRET
  ) {
    throw new Error('FATAL: JWT_SECRET, JWT_REFRESH_SECRET, and OTP_HMAC_SECRET must be mutually distinct.');
  }

  // Admin password validation in production
  if (env.ADMIN_PASSWORD && !isStrongPassword(env.ADMIN_PASSWORD)) {
    throw new Error('FATAL: ADMIN_PASSWORD must be strong in production (min 12 chars with upper, lower, number, and symbol).');
  }

  // Notifications validation in production
  const notificationsEnabled = env.NOTIFICATIONS_ENABLED !== 'false';
  const notificationProvider = env.NOTIFICATION_PROVIDER || 'smtp';

  if (notificationsEnabled) {
    if (notificationProvider === 'console') {
      throw new Error('FATAL: NOTIFICATION_PROVIDER cannot be "console" in production. Configure a valid SMTP provider or explicitly set NOTIFICATIONS_ENABLED=false.');
    }
    if (notificationProvider === 'smtp') {
      if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
        throw new Error('FATAL: SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured in production when notifications are enabled.');
      }
    }
  }
}

// Execute startup validation
validateEnvironment(process.env);

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const jwtSecret = process.env.JWT_SECRET || (isTest ? 'test_jwt_secret_key_12345' : DEFAULT_JWT_SECRET);
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || (isTest ? 'test_jwt_refresh_secret_key_12345' : DEFAULT_REFRESH_SECRET);
const otpHmacSecret = process.env.OTP_HMAC_SECRET || (isTest ? 'test_otp_hmac_secret_key_12345' : DEFAULT_OTP_HMAC_SECRET);

const notificationsEnabled = process.env.NOTIFICATIONS_ENABLED !== 'false';
const notificationProvider = process.env.NOTIFICATION_PROVIDER || (isProd ? 'smtp' : 'console');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProd,
  isTest,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fleetwise.db'),
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'proofs'),
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'),
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
module.exports.configSchema = configSchema;
module.exports.validateEnvironment = validateEnvironment;
module.exports.isStrongPassword = isStrongPassword;
module.exports.containsPlaceholder = containsPlaceholder;
