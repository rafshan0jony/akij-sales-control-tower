'use strict';

const { getDb } = require('../db');

function listForUser(userId) {
  return getDb().prepare(
    'SELECT t.* FROM territories t INNER JOIN user_territories ut ON ut.territory_id = t.id WHERE ut.user_id = ? ORDER BY t.level, t.name'
  ).all(userId).map((r) => ({
    id: r.id, code: r.code, name: r.name, level: r.level, parentId: r.parent_id,
    channelId: r.channel_id, active: !!r.active, createdAt: r.created_at,
  }));
}

function assign(userId, territoryId) {
  getDb().prepare('INSERT OR IGNORE INTO user_territories (user_id, territory_id) VALUES (?, ?)').run(userId, territoryId);
}

function remove(userId, territoryId) {
  getDb().prepare('DELETE FROM user_territories WHERE user_id = ? AND territory_id = ?').run(userId, territoryId);
}

function has(userId, territoryId) {
  return !!getDb().prepare('SELECT 1 FROM user_territories WHERE user_id = ? AND territory_id = ?').get(userId, territoryId);
}

module.exports = { listForUser, assign, remove, has };
