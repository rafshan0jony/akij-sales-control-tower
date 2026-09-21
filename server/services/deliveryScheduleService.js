'use strict';

const dates = require('../lib/dates');
const syncService = require('./syncService');
const analytics = require('./analyticsService');
const itemMapping = require('./itemMappingService');
const deliverySchedulesRepo = require('../repos/deliverySchedules');
const { getDb } = require('../db');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function bags(qty, uom, weight) {
  if (/kg|kilogram/i.test(String(uom || '')) && num(weight) > 0) return num(qty) / num(weight);
  return num(qty);
}

function lineKey(orderNo, item, uom) {
  return [orderNo, item, uom || ''].map((value) => String(value == null ? '' : value).trim().toLowerCase()).join('\u0001');
}

function orderItemKey(orderNo, item) {
  return lineKey(orderNo, item, '');
}

function pendingRows(scope) {
  const data = syncService.getData();
  const from = dates.monthsAgoStart(4);
  const to = dates.todayStr();
  const scoped = analytics.scopedFacts(data, scope, from, to);
  const pending = analytics.computePending(scoped.orders, scoped.deliveries, to);
  return pending.rows.filter((r) => r.orderNo != null).map((r) => ({
    key: lineKey(r.orderNo, r.item, r.uom),
    orderItemKey: orderItemKey(r.orderNo, r.item),
    orderNo: String(r.orderNo),
    customer: r.customer || 'Unknown',
    territory: r.territory || 'Unassigned',
    item: r.item || 'Unknown',
    uom: r.uom || '',
    weight: num(itemMapping.resolveProduct(r.item)?.weight),
    orderQtyBags: bags(r.orderQty, r.uom, itemMapping.resolveProduct(r.item)?.weight),
    pendingQtyBags: bags(r.pendingQty, r.uom, itemMapping.resolveProduct(r.item)?.weight),
  }));
}

function scheduledByKey(scope) {
  const names = scope.scopeAll ? null : scope.territoryNames;
  const rows = getDb().prepare(
    `SELECT l.order_no AS orderNo, l.item, l.uom, l.territory, SUM(l.schedule_qty_bags) AS qty
     FROM delivery_schedule_lines l
     INNER JOIN delivery_schedules s ON s.id = l.schedule_id
     WHERE s.delivery_date >= date('now')
     GROUP BY l.order_no, l.item, l.uom, l.territory`
  ).all();
  return rows.filter((r) => !names || names.has(String(r.territory || '').toLowerCase()))
    .reduce((m, r) => m.set(lineKey(r.orderNo, r.item, r.uom), num(r.qty)), new Map());
}

function options(scope) {
  const scheduled = scheduledByKey(scope);
  return pendingRows(scope).map((r) => ({
    ...r,
    scheduledQtyBags: scheduled.get(r.key) || 0,
    availableQtyBags: Math.max(r.pendingQtyBags - (scheduled.get(r.key) || 0), 0),
  })).filter((r) => r.availableQtyBags > 0.0001);
}

function submit(userId, scope, deliveryDate, inputLines) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate || '')) || deliveryDate < dates.todayStr()) {
    throw new Error('A valid current or future delivery date is required');
  }
  const allowed = new Map(options(scope).map((r) => [r.key, r]));
  const allowedByOrderItem = new Map();
  for (const row of allowed.values()) {
    const key = row.orderItemKey;
    if (!allowedByOrderItem.has(key)) allowedByOrderItem.set(key, row);
    else allowedByOrderItem.set(key, null);
  }
  if (!Array.isArray(inputLines)) throw new Error('Schedule lines are required');
  const requested = new Map();
  for (const input of inputLines) {
    if (!input || typeof input !== 'object') throw new Error('Invalid schedule line');
    const key = lineKey(input.orderNo, input.item, input.uom);
    requested.set(key, num(requested.get(key)) + num(input.scheduleQtyBags));
  }
  const lines = [];
  for (const [key, qty] of requested) {
    const [orderNo, item, uom] = key.split('\u0001');
    const row = allowed.get(key) || allowedByOrderItem.get(orderItemKey(orderNo, item));
    if (!row || qty <= 0 || qty > row.availableQtyBags + 0.0001) {
      throw new Error(`Invalid schedule quantity for ${row?.orderNo || orderNo || 'unknown order'} / ${row?.item || item || 'unknown item'}`);
    }
    lines.push({ ...row, scheduleQtyBags: qty });
  }
  if (!lines.length) throw new Error('At least one schedule line is required');
  return { id: deliverySchedulesRepo.create(userId, deliveryDate, lines), lines };
}

module.exports = { options, submit, pendingRows };
