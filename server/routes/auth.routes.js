'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { authLimiter } = require('../middleware/rateLimit');
const authService = require('../services/authService');
const permissionService = require('../services/permissionService');
const auditRepo = require('../repos/audit');
const usersRepo = require('../repos/users');
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
  const s = req.scope;
  res.json({
    user: authService.userPayload(req.user),
    scope: {
      scopeAll: s.scopeAll,
      level: s.level,
      territoryIds: [...(s.territoryIds || [])],
      territoryNames: [...(s.territoryNames || [])],
      role: s.role ? { code: s.role.code, name: s.role.name, level: s.role.level } : null,
    },
  });
});

// Upload / remove the current user's profile photo (DP).
router.post('/photo', authenticate, asyncHandler(async (req, res) => {
  const { photo } = req.body || {};
  if (photo != null && photo !== '' && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(photo)) {
    throw badRequest('Invalid image format');
  }
  if (photo && photo.length > 500000) throw badRequest('Image too large (max 500KB)');
  usersRepo.setPhoto(req.user.id, photo || null);
  auditRepo.log({ action: 'PHOTO_UPDATED', userId: req.user.id, username: req.user.username, ip: ip(req) });
  res.json({ ok: true, photo: photo || null });
}));

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
