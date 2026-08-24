'use strict';

const { getDb } = require('../db');

function get() {
  const r = getDb().prepare('SELECT * FROM sync_status WHERE id = 1').get();
  if (!r) return null;
  return {
    status: r.status,
    lastUpdated: r.last_updated,
    lastSuccess: r.last_success,
    error: r.error,
    failedCount: r.failed_count,
    dataSource: r.data_source,
    counts: r.counts ? JSON.parse(r.counts) : {},
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
  };
}

function set(fields) {
  const cur = get() || {};
  const next = { ...cur, ...fields };
  getDb().prepare(
    `INSERT INTO sync_status (id, status, last_updated, last_success, error, failed_count, data_source, counts, started_at, finished_at, duration_ms)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       last_updated = excluded.last_updated,
       last_success = excluded.last_success,
       error = excluded.error,
       failed_count = excluded.failed_count,
       data_source = excluded.data_source,
       counts = excluded.counts,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms`
  ).run(
    next.status ?? 'idle',
    next.lastUpdated ?? null,
    next.lastSuccess ?? null,
    next.error ?? null,
    next.failedCount ?? 0,
    next.dataSource ?? 'MCP',
    next.counts ? JSON.stringify(next.counts) : null,
    next.startedAt ?? null,
    next.finishedAt ?? null,
    next.durationMs ?? null
  );
}

module.exports = { get, set };
