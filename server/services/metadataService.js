'use strict';

const db = require('../db').getDb;
const rolesRepo = require('../repos/roles');
const territoriesRepo = require('../repos/territories');
const configRepo = require('../repos/config');

/**
 * Export/import app metadata (users, roles assignments, territory assignments,
 * targets, config) using stable CODES (role code / territory code) so it
 * survives database resets where auto-increment ids change.
 */
function exportMetadata() {
  const d = db();

  const users = d.prepare('SELECT * FROM users ORDER BY id').all().map((u) => ({
    username: u.username,
    email: u.email,
    name: u.name,
    employeeId: u.employee_id,
    passwordHash: u.password_hash,
    plainPassword: u.plain_password,
    title: u.title,
    roleCode: u.role_id ? (rolesRepo.findById(u.role_id)?.code || null) : null,
    status: u.status,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  }));

  const utRows = d.prepare(
    'SELECT ut.user_id, ut.territory_id, u.username FROM user_territories ut INNER JOIN users u ON u.id = ut.user_id'
  ).all();
  const userTerritories = {};
  for (const ut of utRows) {
    const t = territoriesRepo.findById(ut.territory_id);
    if (!t) continue;
    if (!userTerritories[ut.username]) userTerritories[ut.username] = [];
    userTerritories[ut.username].push(t.code || t.name);
  }

  const targets = d.prepare('SELECT * FROM targets').all().map((t) => {
    const terr = territoriesRepo.findById(t.territory_id);
    return terr ? { territoryCode: terr.code || terr.name, product: t.product, month: t.month, targetValue: t.target_value } : null;
  }).filter(Boolean);

  const config = configRepo.all();

  return { users, userTerritories, targets, config };
}

function importMetadata(meta) {
  const d = db();
  const now = new Date().toISOString();

  d.prepare('DELETE FROM user_territories').run();
  d.prepare('DELETE FROM targets').run();
  d.prepare('DELETE FROM users').run();

  const insUser = d.prepare(
    'INSERT INTO users (username, email, name, employee_id, password_hash, plain_password, title, role_id, status, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const u of meta.users || []) {
    const role = u.roleCode ? rolesRepo.findByCode(u.roleCode) : null;
    insUser.run(
      u.username, u.email || null, u.name || u.username, u.employeeId || null,
      u.passwordHash, u.plainPassword || null, u.title || null, role ? role.id : null,
      u.status || 'active', u.lastLoginAt || null, u.createdAt || now
    );
  }

  const findUser = d.prepare('SELECT id FROM users WHERE username = ?');
  const insUT = d.prepare('INSERT OR IGNORE INTO user_territories (user_id, territory_id) VALUES (?, ?)');
  for (const [username, codes] of Object.entries(meta.userTerritories || {})) {
    const user = findUser.get(username);
    if (!user) continue;
    for (const code of codes) {
      const t = territoriesRepo.findByCode(code);
      if (t) insUT.run(user.id, t.id);
    }
  }

  const insTarget = d.prepare('INSERT INTO targets (territory_id, product, month, target_value, updated_at) VALUES (?, ?, ?, ?, ?)');
  for (const t of meta.targets || []) {
    const terr = territoriesRepo.findByCode(t.territoryCode);
    if (terr) insTarget.run(terr.id, t.product, t.month, t.targetValue, now);
  }

  d.prepare('DELETE FROM config').run();
  for (const [k, v] of Object.entries(meta.config || {})) {
    configRepo.set(k, v);
  }

  return true;
}

module.exports = { exportMetadata, importMetadata };
