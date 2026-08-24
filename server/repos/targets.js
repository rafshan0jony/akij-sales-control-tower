'use strict';

const { getDb } = require('../db');

const now = () => new Date().toISOString();

function upsert(territoryId, product, month, targetValue) {
  getDb().prepare(
    `INSERT INTO targets (territory_id, product, month, target_value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(territory_id, product, month) DO UPDATE SET target_value = excluded.target_value, updated_at = excluded.updated_at`
  ).run(territoryId, product, month, targetValue, now());
}

function bulkUpsert(rows) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO targets (territory_id, product, month, target_value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(territory_id, product, month) DO UPDATE SET target_value = excluded.target_value, updated_at = excluded.updated_at`
  );
  db.exec('BEGIN');
  try {
    for (const r of rows) stmt.run(r.territoryId, r.product, r.month, r.targetValue, now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getByTerritoryAndMonth(territoryId, month) {
  return getDb().prepare('SELECT * FROM targets WHERE territory_id = ? AND month = ?').all(territoryId, month);
}

function getByTerritoriesAndMonth(territoryIds, month) {
  if (!territoryIds.length) return [];
  const marks = territoryIds.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM targets WHERE territory_id IN (${marks}) AND month = ?`).all(...territoryIds, month);
}

module.exports = { upsert, bulkUpsert, getByTerritoryAndMonth, getByTerritoriesAndMonth };
