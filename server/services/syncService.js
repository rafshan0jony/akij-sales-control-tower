'use strict';

const mcp = require('../mcp/client');
const syncRepo = require('../repos/sync');
const territoriesRepo = require('../repos/territories');
const territoryMapping = require('./territoryMappingService');
const itemMapping = require('./itemMappingService');
const logger = require('../logger');
const config = require('../config');
const dates = require('../lib/dates');

let cache = null;
let running = false;
let runPromise = null;

const LOOKBACK_DAYS = int(process.env.SYNC_LOOKBACK_DAYS, 730);
const RECENT_DAYS = int(process.env.SYNC_RECENT_DAYS, 3);

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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchWindow(from, to) {
  const [orders, deliveries] = await Promise.all([
    mcp.getSalesOrders(from, to),
    mcp.getDeliveries(from, to),
  ]);
  return {
    orders: normalizeOrders(orders),
    deliveries: normalizeDeliveries(deliveries),
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getData() {
  return cache;
}

/**
 * Apply a snapshot pushed by the external sync bridge (used when the DWH is
 * not reachable from the app host, e.g. on Vercel). Normalizes raw rows,
 * imports territories and updates sync status.
 */
async function applyRemoteSnapshot({ orders, deliveries, territories }) {
  const today = dates.todayStr();
  const normOrders = normalizeOrders(orders || []);
  const normDeliveries = normalizeDeliveries(deliveries || []);
  let from = today;
  for (const o of normOrders) if (o.date < from) from = o.date;
  for (const d of normDeliveries) if (d.date < from) from = d.date;

  let territoryCount = 0;
  try { territoryCount = await importTerritories(territories); } catch (e) { logger.warn('[sync] territory import failed:', e.message); }

  const syncedAt = new Date().toISOString();
  cache = {
    orders: normOrders,
    deliveries: normDeliveries,
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
    counts: { orders: normOrders.length, deliveries: normDeliveries.length, territories: territoryCount },
    finishedAt: syncedAt,
  });
  logger.info(`[sync] remote snapshot applied: ${normOrders.length} orders, ${normDeliveries.length} deliveries, ${territoryCount} territories`);
  return cache;
}

function lastUpdated() {
  return cache ? cache.syncedAt : (syncRepo.get() ? syncRepo.get().lastUpdated : null);
}

module.exports = { refresh, bootstrap, getData, lastUpdated, fullRefresh, incrementalRefresh, applyRemoteSnapshot };
