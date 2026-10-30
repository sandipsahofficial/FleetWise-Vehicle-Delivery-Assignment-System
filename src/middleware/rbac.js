const { ForbiddenError, UnauthorizedError } = require('../utils/errors');
const config = require('../config');

/**
 * Role-Based Access Control Middleware.
 * Roles: 'admin', 'dispatcher', 'driver' (plus legacy 'fleet_manager' alias for 'admin').
 *
 * @param {string[]} allowedRoles Array of permitted role names
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    // Determine effective user role
    let role = req.user?.role;

    // Fallback in test mode if authenticate() was not called ahead of requireRole
    if (!role && config.isTest) {
      const raw = req.headers['x-user-role'];
      role = raw ? (raw.toLowerCase().trim() === 'fleet_manager' ? 'admin' : raw.toLowerCase().trim()) : 'admin';
      req.user = {
        id: 'test-env-user',
        username: `test-${role}`,
        role,
        driver_id: req.headers['x-driver-id'] || null
      };
      req.userRole = role;
      req.performedBy = req.user.username;
    }

    if (!role) {
      return next(new UnauthorizedError('Authentication required to verify permissions.'));
    }

    // Normalize roles (fleet_manager <-> admin)
    const normalizedUserRole = role === 'fleet_manager' ? 'admin' : role;
    const normalizedAllowed = allowedRoles.map(r => r === 'fleet_manager' ? 'admin' : r);

    if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(normalizedUserRole)) {
      return next(
        new ForbiddenError(
          `Access denied. Role '${role}' is not authorized to perform this operation. Required: [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
}

module.exports = {
  requireRole
};
