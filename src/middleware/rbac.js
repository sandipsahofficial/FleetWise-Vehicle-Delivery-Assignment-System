const { ForbiddenError } = require('../utils/errors');

/**
 * Role-Based Access Control Middleware.
 * Checks the X-User-Role request header.
 * Default role is 'fleet_manager' when omitted, ensuring backward compatibility.
 * 
 * @param {string[]} allowedRoles Array of permitted role names (e.g., ['fleet_manager'])
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const rawRole = req.headers['x-user-role'];
    const userRole = rawRole ? rawRole.toLowerCase().trim() : 'fleet_manager';

    req.userRole = userRole;
    req.performedBy = userRole;

    if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
      return next(
        new ForbiddenError(
          `Access denied. Role '${userRole}' is not authorized to perform this operation. Required: [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
}

module.exports = {
  requireRole
};

