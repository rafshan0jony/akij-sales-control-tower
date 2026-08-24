'use strict';

const permissionService = require('../services/permissionService');
const { forbidden } = require('../lib/errors');

/**
 * Require a permission code for a route.
 * Example: router.get('/', requirePermission('MANAGE_USERS'), handler)
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!permissionService.hasPermission(req.user, permission)) {
      return next(forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}

/** Require any of the given permissions. */
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    const ok = permissions.some((p) => permissionService.hasPermission(req.user, p));
    if (!ok) return next(forbidden('Insufficient permissions'));
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission };
