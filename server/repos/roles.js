'use strict';

const { getDb } = require('../db');

const now = () => new Date().toISOString();

function rowToRole(r) {
  if (!r) return null;
  return { id: r.id, code: r.code, name: r.name, level: r.level, active: !!r.active, createdAt: r.created_at };
}

function list() {
  return getDb().prepare('SELECT * FROM roles ORDER BY level').all().map(rowToRole);
}

function findById(id) {
  return rowToRole(getDb().prepare('SELECT * FROM roles WHERE id = ?').get(id));
}

function findByCode(code) {
  return rowToRole(getDb().prepare('SELECT * FROM roles WHERE code = ?').get(code));
}

function create(data) {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO roles (code, name, level, active, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(data.code, data.name, data.level, data.active === false ? 0 : 1, now());
  return findById(info.lastInsertRowid);
}

function update(id, fields) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const key of ['code', 'name', 'level']) {
    if (key in fields) { sets.push(`${key} = ?`); vals.push(fields[key]); }
  }
  if ('active' in fields) { sets.push('active = ?'); vals.push(fields.active ? 1 : 0); }
  if (!sets.length) return findById(id);
  vals.push(id);
  db.prepare(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findById(id);
}

function getPermissions(roleId) {
  return getDb().prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(roleId).map((r) => r.permission);
}

function setPermissions(roleId, permissions) {
  const db = getDb();
  const del = db.prepare('DELETE FROM role_permissions WHERE role_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)');
  const tx = db.exec('BEGIN');
  try {
    del.run(roleId);
    for (const p of permissions) ins.run(roleId, p);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function listAllPermissions() {
  return getDb().prepare('SELECT code, label FROM permissions ORDER BY code').all();
}

module.exports = { list, findById, findByCode, create, update, getPermissions, setPermissions, listAllPermissions };
