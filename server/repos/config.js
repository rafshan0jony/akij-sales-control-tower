'use strict';

const { getDb } = require('../db');

const DEFAULTS = {
  // Achievement is always based on DELIVERY (company rule: only delivered
  // quantity counts toward achievement, not booked orders).
  targetBasis: 'delivery',
  pendingAgingBuckets: [
    { label: '0-2 Days', min: 0, max: 2 },
    { label: '3-7 Days', min: 3, max: 7 },
    { label: '8-15 Days', min: 8, max: 15 },
    { label: '16-30 Days', min: 16, max: 30 },
    { label: '30+ Days', min: 31, max: Infinity },
  ],
  criticalPendingValue: 500000,
  highPendingValue: 200000,
  criticalPendingDays: 30,
  highPendingDays: 15,
  achievementThresholds: {
    exceeding: 105,
    onTrack: 100,
    atRisk: 90,
  },
  monthProgress: {
    mode: 'business',
  },
  tourWeights: {
    pending: 30,
    salesDecline: 25,
    targetGap: 20,
    lastVisitDays: 15,
    deliveryIssue: 10,
  },
  recommendations: {
    behindGapPct: 10,
  },
};

function get(key) {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
  try {
    return JSON.parse(row.value);
  } catch (_) {
    return row.value;
  }
}

function set(key, value) {
  getDb().prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

function all() {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch (_) { out[r.key] = r.value; }
  }
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (out[k] === undefined) out[k] = v;
  }
  return out;
}

function reset() {
  const db = getDb();
  db.prepare('DELETE FROM config').run();
}

module.exports = { get, set, all, reset, DEFAULTS };
