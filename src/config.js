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

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const jwtSecret = process.env.JWT_SECRET || (isTest ? 'test_jwt_secret_key_12345' : DEFAULT_JWT_SECRET);
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || (isTest ? 'test_jwt_refresh_secret_key_12345' : DEFAULT_REFRESH_SECRET);

if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET === DEFAULT_REFRESH_SECRET) {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable must be explicitly defined and cannot be the default value in production.');
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
  adminSeed: {
    username: process.env.ADMIN_USERNAME || null,
    password: process.env.ADMIN_PASSWORD || null
  },
  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

module.exports = config;
