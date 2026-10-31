const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'req.query.token',
      'params.token',
      'token',
      'tracking_token',
      'token_hash',
      'otp',
      'otp_hash',
      'password',
      'refreshToken'
    ],
    censor: '[REDACTED]'
  },
  formatters: {
    level: (label) => ({ level: label })
  }
});

module.exports = logger;
