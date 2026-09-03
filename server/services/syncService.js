'use strict';

const mcp = require('../mcp/client');
const syncRepo = require('../repos/sync');
const territoriesRepo = require('../repos/territories');
const territoryMapping = require('./territoryMappingService');
const itemMapping = require('./itemMappingService');
const territoryTargetService = require('./territoryTargetService');
const metadataService = require('./metadataService');
const usersRepo = require('../repos/users');
const { getDb } = require('../db');
const logger = require('../logger');
const config = require('../config');
const dates = require('../lib/dates');

let cache = null;
let running = false;
let runPromise = null;

const LOOKBACK_DAYS = int(process.env.SYNC_LOOKBACK_DAYS, 730);
const RECENT_DAYS = int(process.env.SYNC_RECENT_DAYS, 3);
const GITHUB_SNAPSHOT_URL = process.env.GITHUB_SNAPSHOT_URL || 'https://raw.githubusercontent.com/rafshan0jony/akij-sales-control-tower/snapshot/data/snapshot.json';
const GITHUB_METADATA_URL = process.env.GITHUB_METADATA_URL || 'https://raw.githubusercontent.com/rafshan0jony/akij-sales-control-tower/snapshot/data/metadata-backup.json';

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function normalizeOrders(rows) {
  const out = [];
  for (const r of rows || []) {
    const pm = itemMapping.resolveProduct(r.item);
    if (!pm) continue; // exclude by-products / unmapped items
    const tm = territoryMapping.resolve(r.territory);
    out.push({
      date: dates.toDateStr(r.date),
      orderNo: r.orderNo == null ? null : String(r.orderNo),
      customer: r.customer == null ? null : String(r.customer),
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      systemTerritory: tm.systemTerritory,
      status: r.status == null ? null : String(r.status),
      item: r.item == null ? null : String(r.item),
      product: pm.product,
      uom: r.uom == null ? null : String(r.uom),
      weight: pm.weight,
      quantity: num(r.quantity),
      mt: num(r.quantity) * pm.weight / 1000,
      value: num(r.value),
      price: num(r.price),
      rate50: pm.weight > 0 ? (num(r.price) * 50) / pm.weight : null,
      deliveredQty: r.deliveredQty == null ? null : num(r.deliveredQty),
      undeliveredQty: r.undeliveredQty == null ? null : num(r.undeliveredQty),
      undeliveredValue: r.undeliveredValue == null ? null : num(r.undeliveredValue),
    });
  }
  return out;
}

function normalizeDeliveries(rows) {
  const out = [];
  for (const r of rows || []) {
    const pm = itemMapping.resolveProduct(r.item);
    if (!pm) continue;
    const tm = territoryMapping.resolve(r.territory);
    out.push({
      date: dates.toDateStr(r.date),
      customer: r.customer == null ? null : String(r.customer),
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      systemTerritory: tm.systemTerritory,
      status: r.status == null ? 'Delivered' : String(r.status),
      orderNo: r.orderNo == null ? null : String(r.orderNo),
      item: r.item == null ? null : String(r.item),
      product: pm.product,
      uom: r.uom == null ? null : String(r.uom),
      weight: pm.weight,
      quantity: num(r.quantity),
      mt: num(r.quantity) * pm.weight / 1000,
      value: num(r.value),
    });
  }
  return out;
}

function normalizeCredit(rows) {
  const today = dates.todayStr();
  return (rows || []).map((r) => {
    const tm = territoryMapping.resolve(r.territory);
    const creditDays = num(r.creditDays);
    const lastDeliveryDate = r.lastDeliveryDate ? dates.toDateStr(r.lastDeliveryDate) : null;
    const lastPaymentDate = r.lastPaymentDate ? dates.toDateStr(r.lastPaymentDate) : null;
    const deliveryGap = lastDeliveryDate ? Math.max(0, dates.diffDays(lastDeliveryDate, today)) : null;
    const paymentGap = lastPaymentDate ? Math.max(0, dates.diffDays(lastPaymentDate, today)) : null;
    // EXACT ledger balance straight from the accounting journal
    // (fin.tblAccountingJournalArc), matching the ERP customer-ledger report.
    const ledgerBalance = Math.round(num(r.ledgerBalance) * 100) / 100;
    const daysBaseOverdue = Math.round(Math.max(0, ledgerBalance - num(r.deliveryWithinCreditDays)) * 100) / 100;
    return {
      partnerCode: r.partnerCode == null ? null : String(r.partnerCode).trim(),
      partnerName: r.partnerName == null ? null : String(r.partnerName).trim(),
      creditDays,
      ledgerBalance,
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      lastDeliveryDate,
      lastPaymentDate,
      deliveryGap,
      paymentGap,
      daysBaseOverdue,
    };
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchWindow(from, to) {
  const [orders, deliveries, credit] = await Promise.all([
    mcp.getSalesOrders(from, to),
    mcp.getDeliveries(from, to),
    mcp.getCreditStatus(),
  ]);
  return {
    orders: normalizeOrders(orders),
    deliveries: normalizeDeliveries(deliveries),
    credit: normalizeCredit(credit),
  };
}

/**
 * Import the territory hierarchy (National -> Region -> Area -> Territory)
 * from the static mapping (server/data/territoryMapping.json). Idempotent —
 * node codes are stable ("R:..", "A:..", "T:..") so user assignments persist.
 */
function importTerritories() {
  const national = territoriesRepo.findByName('National') || territoriesRepo.findByCode('NATIONAL');
  if (!national) return 0;

  territoriesRepo.removeNonMapping();

  const mappingRows = territoryMapping.list();
  const regionMap = new Map();
  const areaMap = new Map();
  let count = 0;

  for (const r of mappingRows) {
    let region = regionMap.get(r.region);
    if (!region) {
      region = territoriesRepo.upsertByCode({ code: 'R:' + r.region, name: r.region, level: 1, parentId: national.id, channelId: config.app.channelId });
      regionMap.set(r.region, region);
      count++;
    }
    let area = areaMap.get(r.area);
    if (!area) {
      area = territoriesRepo.upsertByCode({ code: 'A:' + r.area, name: r.area, level: 2, parentId: region.id, channelId: config.app.channelId });
      areaMap.set(r.area, area);
      count++;
    }
    territoriesRepo.upsertByCode({ code: 'T:' + r.territory, name: r.territory, level: 4, parentId: area.id, channelId: config.app.channelId });
    count++;
  }
  return count;
}

/** Full refresh of the entire lookback window. */
async function fullRefresh() {
  const today = dates.todayStr();
  const from = dates.addDays(today, -LOOKBACK_DAYS);
  const started = Date.now();
  const data = await fetchWindow(from, today);

  let territoryCount = 0;
  try {
    territoryCount = await importTerritories();
  } catch (e) {
    logger.warn('[sync] territory import failed:', e.message);
  }

  cache = {
    ...data,
    syncedAt: new Date().toISOString(),
    dataSource: 'MCP',
    from,
    to: today,
  };
  syncRepo.set({
    status: 'success',
    lastUpdated: cache.syncedAt,
    lastSuccess: cache.syncedAt,
    error: null,
    dataSource: 'MCP',
    counts: { orders: data.orders.length, deliveries: data.deliveries.length, territories: territoryCount },
    startedAt: new Date(started).toISOString(),
    finishedAt: cache.syncedAt,
    durationMs: Date.now() - started,
  });
  try { syncRepo.saveSnapshot(cache); } catch (e) { logger.warn('[sync] snapshot save failed:', e.message); }
  logger.info(`[sync] full refresh OK: ${data.orders.length} order rows, ${data.deliveries.length} delivery rows, ${territoryCount} territories (${Date.now() - started}ms)`);
  return cache;
}

/** Incremental refresh of the recent window, merged into the existing cache. */
async function incrementalRefresh() {
  if (!cache) return fullRefresh();
  const today = dates.todayStr();
  const recentFrom = dates.addDays(today, -RECENT_DAYS);
  const started = Date.now();
  const data = await fetchWindow(recentFrom, today);
  const keepOrders = cache.orders.filter((o) => o.date < recentFrom);
  const keepDeliveries = cache.deliveries.filter((d) => d.date < recentFrom);
  cache = {
    orders: keepOrders.concat(data.orders),
    deliveries: keepDeliveries.concat(data.deliveries),
    syncedAt: new Date().toISOString(),
    dataSource: 'MCP',
    from: cache.from,
    to: today,
  };
  syncRepo.set({
    status: 'success',
    lastUpdated: cache.syncedAt,
    lastSuccess: cache.syncedAt,
    error: null,
    dataSource: 'MCP',
    counts: { orders: cache.orders.length, deliveries: cache.deliveries.length },
    startedAt: new Date(started).toISOString(),
    finishedAt: cache.syncedAt,
    durationMs: Date.now() - started,
  });
  return cache;
}

async function refresh() {
  if (running) return runPromise;
  running = true;
  runPromise = (async () => {
    try {
      if (cache) return await incrementalRefresh();
      return await fullRefresh();
    } catch (err) {
      logger.error('[sync] refresh failed:', err.message);
      const prev = syncRepo.get();
      syncRepo.set({
        status: 'error',
        lastUpdated: new Date().toISOString(),
        error: err.message,
        failedCount: (prev ? prev.failedCount : 0) + 1,
        dataSource: 'MCP',
      });
      if (cache) return cache;
      throw err;
    } finally {
      running = false;
      runPromise = null;
    }
  })();
  return runPromise;
}

/** Run a blocking refresh; throw on failure (used at startup). */
async function bootstrap() {
  try {
    await refresh();
    await loadRemoteMetadata();
    return { ok: true };
  } catch (err) {
    const restored = await loadRemoteSnapshot();
    if (restored) {
      await loadRemoteMetadata();
      return { ok: true, source: 'github-snapshot' };
    }
    await loadRemoteMetadata();
    return { ok: false, error: err.message };
  }
}

function getData() {
  if (!cache) loadSnapshot();
  return cache;
}

/**
 * Apply a snapshot pushed by the external sync bridge (used when the DWH is
 * not reachable from the app host, e.g. on Vercel). Normalizes raw rows,
 * imports territories and updates sync status.
 */
async function applyRemoteSnapshot({ orders, deliveries, territories, credit, territoryTarget }) {
  const today = dates.todayStr();
  const normOrders = normalizeOrders(orders || []);
  const normDeliveries = normalizeDeliveries(deliveries || []);
  const normCredit = normalizeCredit(credit || []);
  if (territoryTarget && territoryTarget.rows) territoryTargetService.setData(territoryTarget);
  let from = today;
  for (const o of normOrders) if (o.date < from) from = o.date;
  for (const d of normDeliveries) if (d.date < from) from = d.date;

  let territoryCount = 0;
  try { territoryCount = await importTerritories(territories); } catch (e) { logger.warn('[sync] territory import failed:', e.message); }

  const syncedAt = new Date().toISOString();
  cache = {
    orders: normOrders,
    deliveries: normDeliveries,
    credit: normCredit,
    territoryTarget: territoryTarget && territoryTarget.rows ? territoryTarget : (cache && cache.territoryTarget) || null,
    syncedAt,
    dataSource: 'BRIDGE',
    from,
    to: today,
  };
  syncRepo.set({
    status: 'success',
    lastUpdated: syncedAt,
    lastSuccess: syncedAt,
    error: null,
    dataSource: 'BRIDGE',
    counts: { orders: normOrders.length, deliveries: normDeliveries.length, credit: normCredit.length, territories: territoryCount },
    finishedAt: syncedAt,
  });
  try { syncRepo.saveSnapshot(cache); } catch (e) { logger.warn('[sync] snapshot save failed:', e.message); }
  logger.info(`[sync] remote snapshot applied: ${normOrders.length} orders, ${normDeliveries.length} deliveries, ${normCredit.length} credit, ${territoryCount} territories`);
  return cache;
}

/**
 * Restore the last persisted snapshot into memory (used at startup so data
 * survives restarts/cold-starts). Returns true if restored.
 */
function loadSnapshot() {
  if (cache) return false;
  const snap = syncRepo.loadSnapshot();
  if (snap && snap.orders && snap.deliveries) {
    cache = snap;
    if (snap.territoryTarget && snap.territoryTarget.rows) territoryTargetService.setData(snap.territoryTarget);
    logger.info(`[sync] restored snapshot from disk: ${snap.orders.length} orders, ${snap.deliveries.length} deliveries (synced ${snap.syncedAt})`);
    return true;
  }
  return false;
}

/**
 * Recover the last bridge snapshot from GitHub when the local database is
 * empty (e.g. after a host redeploy while the office PC is switched off).
 * The raw snapshot is normalized through applyRemoteSnapshot.
 */
async function loadRemoteSnapshot() {
  try {
    const res = await fetch(GITHUB_SNAPSHOT_URL, { headers: { 'User-Agent': 'akij-sales-control-tower' } });
    if (!res.ok) return false;
    const raw = await res.json();
    if (!raw || !raw.orders || !raw.deliveries) return false;
    await applyRemoteSnapshot(raw);
    logger.info(`[sync] restored snapshot from GitHub (${cache.orders.length} orders, ${cache.deliveries.length} deliveries)`);
    return true;
  } catch (err) {
    logger.warn('[sync] GitHub snapshot restore failed:', err.message);
    return false;
  }
}

/**
 * Recover user/role/territory-assignment metadata from GitHub when the local
 * database has been reset (only the seeded admin remains). Runs only after the
 * territory hierarchy has been imported so assignments resolve by code.
 */
async function loadRemoteMetadata() {
  try {
    const res = await fetch(GITHUB_METADATA_URL, { headers: { 'User-Agent': 'akij-sales-control-tower' } });
    if (!res.ok) return false;
    const meta = await res.json();
    if (!meta || !Array.isArray(meta.users) || meta.users.length <= 1) return false;

    // Skip only when local users AND their territory assignments are already
    // intact. A lossy bridge restore can re-seed users without their territory
    // assignments (territories not yet imported) — in that case re-restore.
    const localUsers = usersRepo.list().length;
    const localAssigned = getDb().prepare('SELECT COUNT(DISTINCT user_id) AS c FROM user_territories').get().c;
    const metaAssigned = Object.keys(meta.userTerritories || {}).length;
    if (localUsers > 1 && localAssigned >= metaAssigned) return false;

    try { await importTerritories(); } catch (e) { logger.warn('[sync] territory import before metadata restore failed:', e.message); }
    metadataService.importMetadata(meta);
    logger.info(`[sync] restored metadata from GitHub (${meta.users.length} users, ${metaAssigned} with territories)`);
    return true;
  } catch (err) {
    logger.warn('[sync] metadata restore from GitHub failed:', err.message);
    return false;
  }
}

function lastUpdated() {
  return cache ? cache.syncedAt : (syncRepo.get() ? syncRepo.get().lastUpdated : null);
}

module.exports = { refresh, bootstrap, getData, lastUpdated, fullRefresh, incrementalRefresh, applyRemoteSnapshot, loadSnapshot, loadRemoteSnapshot, loadRemoteMetadata, importTerritories };
