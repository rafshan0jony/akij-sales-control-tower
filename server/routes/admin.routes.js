'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const { freshness } = require('./helpers');
const { badRequest, notFound } = require('../lib/errors');

const usersRepo = require('../repos/users');
const rolesRepo = require('../repos/roles');
const territoriesRepo = require('../repos/territories');
const userTerritoriesRepo = require('../repos/userTerritories');
const targetsRepo = require('../repos/targets');
const configRepo = require('../repos/config');
const auditRepo = require('../repos/audit');
const syncRepo = require('../repos/sync');
const syncService = require('../services/syncService');
const permissionService = require('../services/permissionService');
const { hashPassword } = require('../lib/passwords');

const router = express.Router();
router.use(authenticate);

function ip(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

function audit(req, action, entity, entityId, metadata) {
  auditRepo.log({ action, entity, entityId, metadata, userId: req.user.id, username: req.user.username, ip: ip(req) });
}

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', requireAnyPermission('MANAGE_USERS', 'MANAGE_ROLES', 'SYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  const users = usersRepo.list();
  const roles = rolesRepo.list();
  const territories = territoriesRepo.list();
  const sync = syncRepo.get();
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter((u) => u.status === 'active').length,
    inactiveUsers: users.filter((u) => u.status !== 'active').length,
    roles: roles.length,
    territories: territories.length,
    lastRefresh: sync ? sync.lastUpdated : null,
    lastSuccess: sync ? sync.lastSuccess : null,
    systemHealth: sync && sync.status === 'success' ? 'HEALTHY' : sync && sync.status === 'error' ? 'DEGRADED' : 'IDLE',
    failedSyncCount: sync ? sync.failedCount : 0,
    dataSource: sync ? sync.dataSource : 'MCP',
    ...freshness(),
  });
}));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
router.get('/users', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const users = usersRepo.list().map((u) => ({
    ...u,
    territories: userTerritoriesRepo.listForUser(u.id).map((t) => ({ id: t.id, name: t.name, level: t.level })),
  }));
  res.json({ users });
}));

router.post('/users', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const { username, email, name, employeeId, password, roleId, title } = req.body || {};
  if (!username || !name) throw badRequest('Username and name are required');
  if (usersRepo.findByUsername(username)) throw badRequest('Username already exists');
  const role = roleId ? rolesRepo.findById(roleId) : null;
  if (roleId && !role) throw badRequest('Invalid role');
  const user = usersRepo.create({
    username, email, name, employeeId,
    passwordHash: hashPassword(password || 'Welcome123'),
    plainPassword: password || 'Welcome123',
    title: title || null,
    roleId: role ? role.id : null,
  });
  audit(req, 'USER_CREATED', 'user', String(user.id), { username });
  res.status(201).json({ user });
}));

router.get('/users/:id', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const user = usersRepo.findById(Number(req.params.id));
  if (!user) throw notFound('User not found');
  res.json({ user, territories: userTerritoriesRepo.listForUser(user.id), scope: permissionService.resolveScope(user) });
}));

router.put('/users/:id', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!usersRepo.findById(id)) throw notFound('User not found');
  const { username, email, name, employeeId, roleId, status, title } = req.body || {};
  const fields = {};
  if (username !== undefined) fields.username = username;
  if (email !== undefined) fields.email = email || null;
  if (name !== undefined) fields.name = name;
  if (employeeId !== undefined) fields.employee_id = employeeId || null;
  if (roleId !== undefined) fields.role_id = roleId;
  if (status !== undefined) fields.status = status;
  if (title !== undefined) fields.title = title || null;
  const user = usersRepo.update(id, fields);
  audit(req, 'USER_UPDATED', 'user', String(id), { ...fields });
  res.json({ user });
}));

router.post('/users/:id/status', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = usersRepo.findById(id);
  if (!user) throw notFound('User not found');
  const status = req.body && req.body.status === 'active' ? 'active' : 'inactive';
  usersRepo.update(id, { status });
  audit(req, status === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'user', String(id));
  res.json({ user: usersRepo.findById(id) });
}));

router.post('/users/:id/reset-password', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = usersRepo.findById(id);
  if (!user) throw notFound('User not found');
  const newPassword = (req.body && req.body.newPassword) || 'Welcome123';
  usersRepo.setPasswordHash(id, hashPassword(newPassword), newPassword);
  audit(req, 'PASSWORD_RESET', 'user', String(id), { by: 'admin' });
  res.json({ ok: true, newPassword });
}));

router.get('/users/:id/territories', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  res.json({ territories: userTerritoriesRepo.listForUser(id) });
}));

router.post('/users/:id/territories', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!usersRepo.findById(id)) throw notFound('User not found');
  const { territoryIds } = req.body || {};
  if (!Array.isArray(territoryIds)) throw badRequest('territoryIds array required');
  for (const tid of territoryIds) {
    if (territoriesRepo.findById(tid)) userTerritoriesRepo.assign(id, tid);
  }
  audit(req, 'TERRITORY_ASSIGNED', 'user', String(id), { territoryIds });
  res.json({ territories: userTerritoriesRepo.listForUser(id) });
}));

router.delete('/users/:id/territories/:territoryId', requirePermission('MANAGE_USERS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const tid = Number(req.params.territoryId);
  userTerritoriesRepo.remove(id, tid);
  audit(req, 'TERRITORY_REMOVED', 'user', String(id), { territoryId: tid });
  res.json({ territories: userTerritoriesRepo.listForUser(id) });
}));

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
router.get('/roles', requirePermission('MANAGE_ROLES'), asyncHandler(async (req, res) => {
  const roles = rolesRepo.list().map((r) => ({ ...r, permissions: rolesRepo.getPermissions(r.id) }));
  res.json({ roles });
}));

router.post('/roles', requirePermission('MANAGE_ROLES'), asyncHandler(async (req, res) => {
  const { code, name, level } = req.body || {};
  if (!code || !name) throw badRequest('code and name required');
  if (rolesRepo.findByCode(code)) throw badRequest('Role code already exists');
  const role = rolesRepo.create({ code, name, level: Number(level ?? 4) });
  audit(req, 'ROLE_CREATED', 'role', String(role.id), { code });
  res.status(201).json({ role });
}));

router.put('/roles/:id', requirePermission('MANAGE_ROLES'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!rolesRepo.findById(id)) throw notFound('Role not found');
  const { code, name, level, active } = req.body || {};
  const fields = {};
  if (code !== undefined) fields.code = code;
  if (name !== undefined) fields.name = name;
  if (level !== undefined) fields.level = Number(level);
  if (active !== undefined) fields.active = active;
  const role = rolesRepo.update(id, fields);
  audit(req, 'ROLE_UPDATED', 'role', String(id), { ...fields });
  res.json({ role });
}));

router.get('/permissions', requirePermission('MANAGE_ROLES'), asyncHandler(async (req, res) => {
  res.json({ permissions: rolesRepo.listAllPermissions() });
}));

router.get('/roles/:id/permissions', requirePermission('MANAGE_ROLES'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!rolesRepo.findById(id)) throw notFound('Role not found');
  res.json({ permissions: rolesRepo.getPermissions(id) });
}));

router.put('/roles/:id/permissions', requirePermission('MANAGE_PERMISSIONS'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!rolesRepo.findById(id)) throw notFound('Role not found');
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) throw badRequest('permissions array required');
  const valid = rolesRepo.listAllPermissions().map((p) => p.code);
  const cleaned = permissions.filter((p) => valid.includes(p));
  rolesRepo.setPermissions(id, cleaned);
  audit(req, 'PERMISSIONS_UPDATED', 'role', String(id), { permissions: cleaned });
  res.json({ permissions: rolesRepo.getPermissions(id) });
}));

// ---------------------------------------------------------------------------
// Territories (hierarchy)
// ---------------------------------------------------------------------------
router.get('/territories', requirePermission('MANAGE_TERRITORIES'), asyncHandler(async (req, res) => {
  res.json({ territories: territoriesRepo.list(), tree: territoriesRepo.tree() });
}));

router.post('/territories', requirePermission('MANAGE_TERRITORIES'), asyncHandler(async (req, res) => {
  const { code, name, level, parentId, channelId } = req.body || {};
  if (!name) throw badRequest('name required');
  const t = territoriesRepo.create({ code, name, level: Number(level ?? 4), parentId: parentId || null, channelId: channelId || null });
  audit(req, 'TERRITORY_CREATED', 'territory', String(t.id), { name });
  res.status(201).json({ territory: t });
}));

router.put('/territories/:id', requirePermission('MANAGE_TERRITORIES'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!territoriesRepo.findById(id)) throw notFound('Territory not found');
  const { code, name, level, parentId, channelId, active } = req.body || {};
  const fields = {};
  if (code !== undefined) fields.code = code || null;
  if (name !== undefined) fields.name = name;
  if (level !== undefined) fields.level = Number(level);
  if (parentId !== undefined) fields.parent_id = parentId || null;
  if (channelId !== undefined) fields.channel_id = channelId || null;
  if (active !== undefined) fields.active = active;
  const t = territoriesRepo.update(id, fields);
  audit(req, 'TERRITORY_UPDATED', 'territory', String(id), { ...fields });
  res.json({ territory: t });
}));

router.delete('/territories/:id', requirePermission('MANAGE_TERRITORIES'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!territoriesRepo.findById(id)) throw notFound('Territory not found');
  if (territoriesRepo.children(id).length) throw badRequest('Remove child territories first');
  territoriesRepo.remove(id);
  audit(req, 'TERRITORY_DELETED', 'territory', String(id));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
router.get('/targets', requirePermission('MANAGE_PERMISSIONS'), asyncHandler(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const ids = territoriesRepo.list().filter((t) => t.active).map((t) => t.id);
  res.json({ month, targets: targetsRepo.getByTerritoriesAndMonth(ids, month) });
}));

router.put('/targets', requirePermission('MANAGE_PERMISSIONS'), asyncHandler(async (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows)) throw badRequest('rows array required');
  const cleaned = rows.map((r) => ({
    territoryId: Number(r.territoryId),
    product: String(r.product || 'All'),
    month: String(r.month),
    targetValue: Number(r.targetValue) || 0,
  })).filter((r) => r.territoryId && r.month);
  targetsRepo.bulkUpsert(cleaned);
  audit(req, 'TARGETS_UPDATED', 'target', null, { count: cleaned.length });
  res.json({ ok: true, count: cleaned.length });
}));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
router.get('/config', requirePermission('MANAGE_PERMISSIONS'), asyncHandler(async (req, res) => {
  res.json({ config: configRepo.all() });
}));

router.put('/config', requirePermission('MANAGE_PERMISSIONS'), asyncHandler(async (req, res) => {
  const updates = req.body || {};
  for (const [k, v] of Object.entries(updates)) configRepo.set(k, v);
  audit(req, 'CONFIG_UPDATED', 'config', null, { keys: Object.keys(updates) });
  res.json({ config: configRepo.all() });
}));

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
router.get('/audit', requirePermission('SYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  const { rows, total } = auditRepo.list({
    limit: Number(req.query.limit) || 200,
    offset: Number(req.query.offset) || 0,
    action: req.query.action,
    userId: req.query.userId,
  });
  res.json({ logs: rows, total });
}));

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
router.get('/sync', requirePermission('SYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  res.json({ sync: syncRepo.get() || { status: 'idle', dataSource: 'MCP' }, ...freshness() });
}));

router.post('/sync/refresh', requirePermission('SYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  try {
    await syncService.refresh();
    audit(req, 'SYNC_MANUAL', 'sync', null);
    res.json({ ok: true, sync: syncRepo.get() });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, sync: syncRepo.get() });
  }
}));

module.exports = router;
