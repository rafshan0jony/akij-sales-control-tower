'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { authLimiter } = require('../middleware/rateLimit');
const authService = require('../services/authService');
const permissionService = require('../services/permissionService');
const auditRepo = require('../repos/audit');
const { badRequest } = require('../lib/errors');

const router = express.Router();

function ip(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { identifier, username, password } = req.body || {};
  const ident = identifier || username;
  if (!ident || !password) throw badRequest('Username and password are required');
  const result = await authService.login(ident, password, ip(req));
  if (!result.ok) {
    const status = result.code === 'ACCOUNT_INACTIVE' ? 403 : 401;
    return res.status(status).json({ error: result.code === 'ACCOUNT_INACTIVE' ? 'Account is inactive' : 'Invalid credentials' });
  }
  res.json(result);
}));

router.post('/logout', authenticate, (req, res) => {
  authService.logout(req.user, ip(req));
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: authService.userPayload(req.user), scope: req.scope });
});

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw badRequest('Current and new password required');
  if (String(newPassword).length < 6) throw badRequest('New password must be at least 6 characters');
  const result = authService.changePassword(req.user.id, currentPassword, newPassword);
  if (!result.ok) return res.status(400).json({ error: 'Current password is incorrect' });
  auditRepo.log({ action: 'PASSWORD_CHANGE', userId: req.user.id, username: req.user.username, ip: ip(req) });
  res.json({ ok: true });
}));

router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const { identifier } = req.body || {};
  if (!identifier) throw badRequest('Username or email required');
  const result = authService.createResetToken(identifier);
  // Always respond the same way to avoid user enumeration.
  res.json({ ok: true, message: 'If the account exists, a reset link has been generated.' });
}));

router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) throw badRequest('Token and new password required');
  const result = authService.resetPassword(token, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.code === 'EXPIRED' ? 'Reset token expired' : 'Invalid reset token' });
  res.json({ ok: true });
}));

router.get('/permissions', authenticate, (req, res) => {
  res.json({ permissions: permissionService.permissionsForUser(req.user) });
});

module.exports = router;
