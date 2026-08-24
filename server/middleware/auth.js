'use strict';

const tokens = require('../lib/tokens');
const usersRepo = require('../repos/users');
const permissionService = require('../services/permissionService');
const { unauthorized } = require('../lib/errors');

/**
 * Authenticate a request by verifying the JWT and loading the current user
 * and their effective territory scope onto `req`.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return next(unauthorized('Missing or invalid token'));

  let decoded;
  try {
    decoded = tokens.verify(match[1]);
  } catch (_) {
    return next(unauthorized('Invalid or expired token'));
  }

  const user = usersRepo.findById(decoded.sub);
  if (!user) return next(unauthorized('User no longer exists'));
  if (user.status !== 'active') return next(unauthorized('Account is inactive'));

  req.user = user;
  req.auth = decoded;
  req.scope = permissionService.resolveScope(user);
  next();
}

module.exports = { authenticate };
