'use strict';

const { getDb } = require('../db');

const now = () => new Date().toISOString();

function rowToTerritory(r) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    level: r.level,
    parentId: r.parent_id,
    channelId: r.channel_id,
    active: !!r.active,
    createdAt: r.created_at,
  };
}

function list() {
  return getDb().prepare('SELECT * FROM territories ORDER BY level, name').all().map(rowToTerritory);
}

function findById(id) {
  return rowToTerritory(getDb().prepare('SELECT * FROM territories WHERE id = ?').get(id));
}

function findByCode(code) {
  return rowToTerritory(getDb().prepare('SELECT * FROM territories WHERE code = ?').get(code));
}

function findByName(name) {
  return rowToTerritory(getDb().prepare('SELECT * FROM territories WHERE name = ? LIMIT 1').get(name));
}

function create(data) {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO territories (code, name, level, parent_id, channel_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(data.code || null, data.name, data.level, data.parentId || null, data.channelId || null, data.active === false ? 0 : 1, now());
  return findById(info.lastInsertRowid);
}

function update(id, fields) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const key of ['code', 'name', 'level', 'parent_id', 'channel_id']) {
    if (key in fields) { sets.push(`${key} = ?`); vals.push(fields[key]); }
  }
  if ('active' in fields) { sets.push('active = ?'); vals.push(fields.active ? 1 : 0); }
  if (!sets.length) return findById(id);
  vals.push(id);
  db.prepare(`UPDATE territories SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findById(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM territories WHERE id = ?').run(id);
}

/** Upsert a DWH-sourced territory by its stable code (the DWH id). */
function upsertByCode(data) {
  const db = getDb();
  const existing = data.code ? findByCode(data.code) : null;
  if (existing) {
    db.prepare('UPDATE territories SET name = ?, level = ?, parent_id = ?, channel_id = ?, active = 1 WHERE id = ?')
      .run(data.name, data.level, data.parentId || null, data.channelId || null, existing.id);
    return findById(existing.id);
  }
  return create(data);
}

function children(parentId) {
  return getDb().prepare('SELECT * FROM territories WHERE parent_id = ? ORDER BY name').all(parentId).map(rowToTerritory);
}

/**
 * Return the set of territory ids that are `id` plus all its descendants.
 */
function descendants(id) {
  const result = [id];
  let frontier = [id];
  while (frontier.length) {
    const rows = getDb().prepare(
      `SELECT id FROM territories WHERE parent_id IN (${frontier.map(() => '?').join(',')})`
    ).all(...frontier).map((r) => r.id);
    result.push(...rows);
    frontier = rows;
  }
  return result;
}

function ancestors(id) {
  const result = [];
  let cur = findById(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    result.push(cur);
    cur = cur.parentId ? findById(cur.parentId) : null;
  }
  return result;
}

/** Build the full hierarchy tree (nodes with `children`). */
function tree() {
  const all = list();
  const byId = new Map(all.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

module.exports = { list, findById, findByCode, findByName, create, update, remove, upsertByCode, children, descendants, ancestors, tree };
