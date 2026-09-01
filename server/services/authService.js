'use strict';

const usersRepo = require('../repos/users');
const rolesRepo = require('../repos/roles');
const permissionService = require('./permissionService');
const auditRepo = require('../repos/audit');
const tokens = require('../lib/tokens');
const { hashPassword, verifyPassword, generateResetToken } = require('../lib/passwords');

function userPayload(user) {
  const role = permissionService.getRoleForUser(user);
  const perms = permissionService.permissionsForUser(user);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    employeeId: user.employeeId,
    role: role ? { id: role.id, code: role.code, name: role.name, level: role.level } : null,
    permissions: perms,
    status: user.status,
  };
}

async function login(identifier, password, ip) {
  const user = usersRepo.findByIdentifier(identifier) || usersRepo.findByEmail(identifier);
  if (!user) {
    auditRepo.log({ action: 'LOGIN_FAILED', username: identifier, ip, metadata: { reason: 'user_not_found' } });
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }
  const dbUser = require('../db').getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(password, dbUser.password_hash)) {
    auditRepo.log({ action: 'LOGIN_FAILED', userId: user.id, username: user.username, ip, metadata: { reason: 'bad_password' } });
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }
  if (user.status !== 'active') {
    auditRepo.log({ action: 'LOGIN_FAILED', userId: user.id, username: user.username, ip, metadata: { reason: 'inactive' } });
    return { ok: false, code: 'ACCOUNT_INACTIVE' };
  }
  usersRepo.setLastLogin(user.id);
  auditRepo.log({ action: 'LOGIN', userId: user.id, username: user.username, ip });
  const token = tokens.sign({ sub: user.id, username: user.username });
  return { ok: true, token, user: userPayload(user) };
}

function logout(user, ip) {
  auditRepo.log({ action: 'LOGOUT', userId: user ? user.id : null, username: user ? user.username : null, ip });
}

function changePassword(userId, currentPassword, newPassword) {
  const dbUser = require('../db').getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!dbUser) return { ok: false, code: 'NOT_FOUND' };
  if (!verifyPassword(currentPassword, dbUser.password_hash)) return { ok: false, code: 'INVALID_CREDENTIALS' };
  usersRepo.setPasswordHash(userId, hashPassword(newPassword), newPassword);
  return { ok: true };
}

function createResetToken(identifier) {
  const user = usersRepo.findByIdentifier(identifier) || usersRepo.findByEmail(identifier);
  if (!user) return null;
  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  usersRepo.setResetToken(user.id, token, expiresAt);
  return { token, user };
}

function resetPassword(token, newPassword) {
  const row = require('../db').getDb().prepare(
    'SELECT id, reset_token, reset_token_expires_at FROM users WHERE reset_token = ?'
  ).get(token);
  if (!row) return { ok: false, code: 'INVALID_TOKEN' };
  if (new Date(row.reset_token_expires_at).getTime() < Date.now()) return { ok: false, code: 'EXPIRED' };
  usersRepo.setPasswordHash(row.id, hashPassword(newPassword), newPassword);
  auditRepo.log({ action: 'PASSWORD_RESET', userId: row.id });
  return { ok: true };
}

module.exports = { login, logout, changePassword, createResetToken, resetPassword, userPayload };
