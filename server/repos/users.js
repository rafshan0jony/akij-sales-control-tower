'use strict';

const { getDb } = require('../db');

const now = () => new Date().toISOString();

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    name: r.name,
    employeeId: r.employee_id,
    roleId: r.role_id,
    status: r.status,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function findByUsername(username) {
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE username = ?').get(username));
}

function findByEmail(email) {
  if (!email) return null;
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE email = ?').get(email));
}

function findById(id) {
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function list() {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY id').all();
  return rows.map(rowToUser);
}

function create(data) {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO users (username, email, name, employee_id, password_hash, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(data.username, data.email || null, data.name, data.employeeId || null, data.passwordHash, data.roleId, data.status || 'active', now());
  return findById(info.lastInsertRowid);
}

function update(id, fields) {
  const db = getDb();
  const allowed = ['username', 'email', 'name', 'employee_id', 'role_id', 'status'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return findById(id);
  sets.push('updated_at = ?');
  vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findById(id);
}

function setPasswordHash(id, hash) {
  getDb().prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?')
    .run(hash, now(), id);
}

function setResetToken(id, token, expiresAt) {
  getDb().prepare('UPDATE users SET reset_token = ?, reset_token_expires_at = ?, updated_at = ? WHERE id = ?')
    .run(token, expiresAt, now(), id);
}

function findByIdentifier(idOrUsername) {
  const byId = findById(Number(idOrUsername));
  if (byId) return byId;
  return findByUsername(idOrUsername);
}

function setLastLogin(id, ts) {
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(ts || now(), id);
}

module.exports = {
  list, create, update, findById, findByUsername, findByEmail, findByIdentifier,
  setPasswordHash, setResetToken, setLastLogin,
};
