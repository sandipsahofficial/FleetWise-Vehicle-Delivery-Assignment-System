const crypto = require('node:crypto');
const logger = require('../utils/logger');

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Middleware that extracts or assigns a validated Request ID (X-Request-ID).
 * Injects req.id, sets X-Request-ID response header, and attaches a child logger with reqId context.
 */
function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];

  let id;
  if (typeof incomingId === 'string' && REQUEST_ID_REGEX.test(incomingId.trim())) {
    id = incomingId.trim();
  } else {
    id = crypto.randomUUID();
  }

  req.id = id;
  res.setHeader('X-Request-ID', id);

  // Attach child logger containing the request context
  req.log = logger.child({ reqId: id });

  next();
}

module.exports = requestIdMiddleware;
