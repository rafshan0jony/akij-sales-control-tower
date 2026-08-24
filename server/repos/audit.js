'use strict';

const { getDb } = require('../db');

const now = () => new Date().toISOString();

function log(entry) {
  getDb().prepare(
    'INSERT INTO audit_logs (user_id, username, action, entity, entity_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    entry.userId ?? null,
    entry.username ?? null,
    entry.action,
    entry.entity ?? null,
    entry.entityId ?? null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    entry.ip ?? null,
    entry.createdAt || now()
  );
}

function list({ limit = 200, offset = 0, action = null, userId = null } = {}) {
  let where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(action); }
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb().prepare(
    `SELECT * FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset).map((r) => ({
    id: r.id, userId: r.user_id, username: r.username, action: r.action,
    entity: r.entity, entityId: r.entity_id, metadata: r.metadata ? safeParse(r.metadata) : null,
    ip: r.ip, createdAt: r.created_at,
  }));
  const count = getDb().prepare(`SELECT COUNT(*) AS c FROM audit_logs ${w}`).get(...params).c;
  return { rows, total: count };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return s; }
}

module.exports = { log, list };
