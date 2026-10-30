const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Authentication Middleware.
 * - In non-test environments (NODE_ENV !== 'test'): strictly requires a valid signed JWT Bearer token.
 * - When NODE_ENV === 'test': permits legacy X-User-Role header and default-to-admin fallback
 *   to preserve existing test suites.
 */
function authenticate(options = { optional: false }) {
  return (req, res, next) => {
    // Check if app has dynamic config override (e.g. from createApp factory in tests)
    const activeConfig = req.app?.locals?.config || config;
    const isTestMode = activeConfig.nodeEnv === 'test' && process.env.NODE_ENV === 'test';

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const decoded = jwt.verify(token, activeConfig.jwt.secret);
        req.user = {
          id: decoded.sub,
          username: decoded.username,
          role: decoded.role === 'fleet_manager' ? 'admin' : decoded.role,
          driver_id: decoded.driver_id || null
        };
        req.userRole = req.user.role;
        req.performedBy = req.user.username;
        return next();
      } catch (err) {
        if (options.optional) return next();
        return next(new UnauthorizedError(
          err.name === 'TokenExpiredError' 
            ? 'Access token has expired' 
            : 'Invalid authentication token'
        ));
      }
    }

    // STRICT IN ALL NON-TEST ENVIRONMENTS: refuse fallback, even if legacy X-User-Role header is present
    if (!isTestMode) {
      if (options.optional) return next();
      return next(new UnauthorizedError('Authentication required. Missing Bearer token.'));
    }

    // TEST ENVIRONMENT FALLBACK ONLY (when NODE_ENV === 'test')
    const rawRole = req.headers['x-user-role'];
    const testRole = rawRole 
      ? (rawRole.toLowerCase().trim() === 'fleet_manager' ? 'admin' : rawRole.toLowerCase().trim())
      : 'admin';

    req.user = {
      id: 'test-env-user',
      username: `test-${testRole}`,
      role: testRole,
      driver_id: req.headers['x-driver-id'] || null
    };
    req.userRole = testRole;
    req.performedBy = req.user.username;

    next();
  };
}

module.exports = {
  authenticate
};
