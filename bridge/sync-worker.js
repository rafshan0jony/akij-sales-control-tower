'use strict';

/**
 * Akij Sales Control Tower — Sync Bridge
 *
 * Runs on a machine that CAN reach the DWH (e.g. your office PC). Reads the
 * operational data and pushes it to the deployed app's /api/sync/ingest
 * endpoint every 5 minutes. This keeps the database private — the app host
 * never connects to the DWH directly.
 *
 * Run from the project root:
 *   node bridge/sync-worker.js
 *
 * Required env (see bridge/.env.example):
 *   MSSQL_*            (DWH connection)
 *   SYNC_TARGET_URL    (deployed app URL, e.g. https://your-app.vercel.app)
 *   SYNC_SECRET        (shared secret — must match the app's SYNC_SECRET)
 */

const config = require('../server/config');
const mcp = require('../server/mcp/client');
const dates = require('../server/lib/dates');
const territoryTargetService = require('../server/services/territoryTargetService');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL = (process.env.SYNC_TARGET_URL || '').replace(/\/$/, '');
const SECRET = config.sync.secret;
const LOOKBACK_DAYS = parseInt(process.env.SYNC_LOOKBACK_DAYS || '730', 10);
const INTERVAL_MS = config.sync.intervalMs;
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'metadata-backup.json');

function log(...a) {
  console.log(`[${new Date().toISOString()}] [bridge]`, ...a);
}

async function collectSnapshot() {
  const today = dates.todayStr();
  const from = dates.addDays(today, -LOOKBACK_DAYS);
  const [orders, deliveries, territories, credit, territoryTarget] = await Promise.all([
    mcp.getSalesOrders(from, today),
    mcp.getDeliveries(from, today),
    mcp.getTerritoryHierarchy(),
    mcp.getCreditStatus(),
    territoryTargetService.fetchFromSheet().catch((e) => { log('WARN: territory target fetch failed:', e.message); return null; }),
  ]);
  return { orders, deliveries, territories, credit, territoryTarget };
}

async function push(snapshot) {
  if (!TARGET_URL) throw new Error('SYNC_TARGET_URL is not set');
  const res = await fetch(TARGET_URL + '/api/sync/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': SECRET,
    },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ingest failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Backup / restore app metadata (users/roles/territories/targets/config) so
 * created users survive the host's ephemeral-database resets.
 */
async function backupRestoreMetadata() {
  if (!TARGET_URL) return;
  const get = await fetch(TARGET_URL + '/api/sync/metadata', { headers: { 'x-sync-secret': SECRET } });
  if (!get.ok) return;
  const current = await get.json();

  let backup = null;
  try { backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); } catch (_) {}

  const currentUsers = (current.users || []).length;
  const backupUsers = backup && Array.isArray(backup.users) ? backup.users.length : 0;

  if (currentUsers === 1 && backupUsers > 1) {
    // Host DB was reset (only admin re-seeded) — restore the backup.
    const res = await fetch(TARGET_URL + '/api/sync/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': SECRET },
      body: JSON.stringify(backup),
    });
    if (res.ok) {
      log(`restored metadata backup (${backupUsers} users)`);
    } else {
      log('WARN: metadata restore failed', res.status);
    }
  } else {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(current));
  }
}

async function runOnce() {
  const started = Date.now();
  log('collecting from DWH...');
  const snapshot = await collectSnapshot();
  log(`collected ${snapshot.orders.length} orders, ${snapshot.deliveries.length} deliveries in ${Date.now() - started}ms`);
  const result = await push(snapshot);
  log('pushed to', TARGET_URL, '->', JSON.stringify(result.sync && { status: result.sync.status, counts: result.sync.counts }));
  try { await backupRestoreMetadata(); } catch (err) { log('WARN: metadata backup failed:', err.message); }
}

async function main() {
  if (!TARGET_URL) {
    log('WARNING: SYNC_TARGET_URL not set — set it to the deployed app URL and re-run.');
  }
  log('bridge started. target =', TARGET_URL || '(unset)', '| interval =', INTERVAL_MS, 'ms | lookback =', LOOKBACK_DAYS, 'days');

  const loop = async () => {
    try {
      await runOnce();
    } catch (err) {
      log('ERROR:', err.message);
    }
  };

  // Frequent metadata backup/restore: recovers users/roles quickly whenever a
  // Render deploy resets the (ephemeral) app DB. Runs every 60s.
  const metaLoop = async () => {
    try {
      await backupRestoreMetadata();
    } catch (err) {
      log('WARN: metadata backup failed:', err.message);
    }
  };

  await loop();
  setInterval(loop, INTERVAL_MS);
  await metaLoop();
  setInterval(metaLoop, 60000);
}

main();
