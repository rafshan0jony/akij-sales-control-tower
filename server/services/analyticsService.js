'use strict';

const dates = require('../lib/dates');
const configRepo = require('../repos/config');
const targetsRepo = require('../repos/targets');
const territoriesRepo = require('../repos/territories');
const permissionService = require('./permissionService');
const monthProgress = require('./monthProgressService');
const rateService = require('./rateService');
const territoryTargetService = require('./territoryTargetService');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function keyOf(...parts) {
  return parts.map((p) => (p == null ? '' : String(p).toLowerCase().trim())).join('\u0001');
}

function groupSum(rows, keyFn, valueFn, qtyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { value: 0, qty: 0, count: 0 });
    const e = map.get(k);
    e.value += num(valueFn(r));
    e.qty += num(qtyFn ? qtyFn(r) : r.quantity);
    e.count += 1;
  }
  return map;
}

function sortedEntries(map, sortBy = 'value') {
  return [...map.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b[sortBy] - a[sortBy]);
}

function territoryName(fact) {
  return fact.territory ? String(fact.territory).trim() : 'Unassigned';
}

function customerName(fact) {
  return fact.customer ? String(fact.customer).trim() : 'Unknown';
}

function itemName(fact) {
  return fact.item ? String(fact.item).trim() : 'Unknown';
}

function productName(fact) {
  return fact.product ? String(fact.product).trim() : itemName(fact);
}

/** Apply scope + date filter to cached facts. */
function scopedFacts(data, scope, from, to) {
  if (!data) return { orders: [], deliveries: [] };
  const filter = permissionService.makeFactFilter(scope);
  const orders = data.orders.filter((o) => o.date >= from && o.date <= to && filter(o));
  const deliveries = data.deliveries.filter((d) => d.date >= from && d.date <= to && filter(d));
  return { orders, deliveries };
}

// ---------------------------------------------------------------------------
// Pending computation
// ---------------------------------------------------------------------------

/**
 * Derive pending rows. If deliveries reference an order, pending is computed
 * per order line; otherwise it falls back to (territory+customer+item) grain.
 * Returns { rows, totalQty, totalValue, orderCount }.
 */
function computePending(orders, deliveries, uptoStr = dates.todayStr()) {
  const buckets = configRepo.get('pendingAgingBuckets');

  // Pending is challan-based: deliveredQty/undeliveredQty come from the
  // challan'd delivery quantity (order - challan'd), not numUndeliveryQuantity.
  const hasDwhPending = orders.some((o) => o.undeliveredQty != null);
  let rows;
  if (hasDwhPending) {
    rows = orders
      .filter((o) => num(o.undeliveredQty) > 0.0001)
      .map((o) => ({
        orderNo: o.orderNo,
        orderDate: o.date,
        customer: customerName(o),
        territory: territoryName(o),
        item: itemName(o),
        product: productName(o),
        uom: o.uom,
        orderQty: num(o.quantity),
        orderMt: num(o.mt),
        deliveredQty: num(o.deliveredQty),
        deliveredMt: o.weight > 0 ? (num(o.deliveredQty) * o.weight) / 1000 : 0,
        pendingQty: num(o.undeliveredQty),
        pendingMt: o.weight > 0 ? (num(o.undeliveredQty) * o.weight) / 1000 : 0,
        pendingValue: num(o.undeliveredValue),
        pendingDays: Math.max(dates.diffDays(o.date, uptoStr), 0),
      }));
  } else {
    const hasOrderRef = deliveries.some((d) => d.orderNo != null);
    if (hasOrderRef) {
    const deliv = groupSum(
      deliveries,
      (d) => keyOf(d.orderNo, d.item, d.uom),
      (d) => d.value,
      (d) => d.quantity
    );
    rows = [];
    for (const o of orders) {
      const d = deliv.get(keyOf(o.orderNo, o.item, o.uom)) || { value: 0, qty: 0 };
      const pq = num(o.quantity) - d.qty;
      const pv = num(o.value) - d.value;
      if (pq > 0.0001) {
        rows.push({
          orderNo: o.orderNo,
          orderDate: o.date,
          customer: customerName(o),
          territory: territoryName(o),
          item: itemName(o),
          uom: o.uom,
          orderQty: num(o.quantity),
          deliveredQty: d.qty,
          pendingQty: pq,
          pendingValue: pv,
          pendingDays: Math.max(dates.diffDays(o.date, uptoStr), 0),
        });
      }
    }
  } else {
    const ord = groupSum(
      orders,
      (o) => keyOf(o.territory, o.customer, o.item, o.uom),
      (o) => o.value,
      (o) => o.quantity
    );
    const deliv = groupSum(
      deliveries,
      (d) => keyOf(d.territory, d.customer, d.item, d.uom),
      (d) => d.value,
      (d) => d.quantity
    );
    rows = [];
    for (const [k, ov] of ord.entries()) {
      const dv = deliv.get(k) || { value: 0, qty: 0 };
      const pq = ov.qty - dv.qty;
      const pv = ov.value - dv.value;
      if (pq > 0.0001) {
        const [terr, cust, item, uom] = k.split('\u0001');
        const dates4 = orders.filter((o) => keyOf(o.territory, o.customer, o.item, o.uom) === k).map((o) => o.date).sort();
        rows.push({
          orderNo: null,
          orderDate: dates4[dates4.length - 1] || '',
          customer: cust,
          territory: terr,
          item,
          uom,
          orderQty: ov.qty,
          deliveredQty: dv.qty,
          pendingQty: pq,
          pendingValue: pv,
          pendingDays: dates4.length ? Math.max(dates.diffDays(dates4[dates4.length - 1], uptoStr), 0) : 0,
        });
      }
    }
  }
  }

  rows.forEach((r) => { r.priority = pendingPriority(r, buckets); r.bucket = agingBucket(r.pendingDays, buckets); });

  const totalQty = rows.reduce((s, r) => s + r.pendingQty, 0);
  const totalValue = rows.reduce((s, r) => s + r.pendingValue, 0);
  const totalMt = rows.reduce((s, r) => s + (r.pendingMt || 0), 0);
  return { rows, totalQty, totalValue, totalMt, orderCount: rows.length };
}

function agingBucket(days, buckets = configRepo.get('pendingAgingBuckets')) {
  for (const b of buckets) {
    if (days >= b.min && days <= b.max) return b.label;
  }
  return '30+ Days';
}

function pendingPriority(row, buckets = configRepo.get('pendingAgingBuckets')) {
  const critVal = num(configRepo.get('criticalPendingValue'));
  const highVal = num(configRepo.get('highPendingValue'));
  const critDays = num(configRepo.get('criticalPendingDays'));
  const highDays = num(configRepo.get('highPendingDays'));
  if (row.pendingValue >= critVal || row.pendingDays >= critDays) return 'Critical';
  if (row.pendingValue >= highVal || row.pendingDays >= highDays) return 'High';
  if (row.pendingValue >= critVal / 2 || row.pendingDays >= highDays / 2) return 'Medium';
  return 'Low';
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : '';
}

function resolveTargets(scope, month) {
  let ids;
  if (scope.scopeAll) {
    ids = territoriesRepo.list().filter((t) => t.active).map((t) => t.id);
  } else {
    ids = [...scope.territoryIds];
  }
  return targetsRepo.getByTerritoriesAndMonth(ids, month);
}

function sumTargets(targetRows) {
  return (targetRows || []).reduce((s, r) => s + num(r.target_value), 0);
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function dailySeries(orders, deliveries, from, to) {
  const days = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = dates.addDays(cur, 1);
  }
  const oMap = groupSum(orders, (o) => o.date, (o) => o.value, (o) => o.quantity);
  const dMap = groupSum(deliveries, (d) => d.date, (d) => d.value, (d) => d.quantity);
  return days.map((d) => {
    const o = oMap.get(d) || { value: 0, qty: 0 };
    const dv = dMap.get(d) || { value: 0, qty: 0 };
    return { date: d, salesValue: o.value, salesQty: o.qty, deliveryValue: dv.value, deliveryQty: dv.qty };
  });
}

function weeklySeries(daily) {
  const map = new Map();
  for (const d of daily) {
    const dt = new Date(d.date + 'T00:00:00Z');
    const weekStart = dates.addDays(d.date, -dt.getUTCDay());
    if (!map.has(weekStart)) map.set(weekStart, { date: weekStart, salesValue: 0, salesQty: 0, deliveryValue: 0, deliveryQty: 0 });
    const e = map.get(weekStart);
    e.salesValue += d.salesValue; e.salesQty += d.salesQty;
    e.deliveryValue += d.deliveryValue; e.deliveryQty += d.deliveryQty;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

function totals(orders, deliveries) {
  const o = orders.reduce((a, r) => a + num(r.value), 0);
  const oq = orders.reduce((a, r) => a + num(r.quantity), 0);
  const omt = orders.reduce((a, r) => a + num(r.mt), 0);
  const d = deliveries.reduce((a, r) => a + num(r.value), 0);
  const dq = deliveries.reduce((a, r) => a + num(r.quantity), 0);
  const dmt = deliveries.reduce((a, r) => a + num(r.mt), 0);
  const customers = new Set(orders.map(customerName).concat(deliveries.map(customerName)));
  return { salesValue: o, salesQty: oq, salesMt: omt, deliveryValue: d, deliveryQty: dq, deliveryMt: dmt, orderCount: orders.length, deliveryCount: deliveries.length, customerCount: customers.size };
}

/**
 * Executive dashboard summary for a scope + date range.
 */
function dashboardSummary(data, scope, range, opts = {}) {
  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const t = totals(orders, deliveries);

  const now = dates.todayStr();
  const { year, month } = dates.currentMonth(now);
  const mtdFrom = `${year}-${dates.pad(month)}-01`;
  const mtd = scopedFacts(data, scope, mtdFrom, now);
  const mtdTotals = totals(mtd.orders, mtd.deliveries);

  const prog = monthProgress.computeMonthProgress(year, month, now);
  const targetRows = resolveTargets(scope, monthKey(now));
  const target = sumTargets(targetRows);
  const selMonth = range.from ? range.from.slice(0, 7) : `${year}-${dates.pad(month)}`;
  const targetMt = territoryTargetService.nationalTotalMt(selMonth);

  const basis = (configRepo.get('targetBasis') || 'delivery').toLowerCase();
  const achievement = basis === 'sales' ? mtdTotals.salesValue : mtdTotals.deliveryValue;
  const achievementMt = basis === 'sales' ? mtdTotals.salesMt : mtdTotals.deliveryMt;
  const achievementPct = target > 0 ? (achievement / target) * 100 : 0;
  const achievementMtPct = targetMt > 0 ? (achievementMt / targetMt) * 100 : 0;
  const pendingScope = scopedFacts(data, scope, dates.monthsAgoStart(4, now), now);
  const pending = computePending(pendingScope.orders, pendingScope.deliveries, now);
  const pacing = monthProgress.computePacing(targetMt, achievementMt, prog);
  const status = monthProgress.performanceStatus(achievementMtPct, prog.monthProgressPct);

  const daily = dailySeries(orders, deliveries, range.from, range.to);

  return {
    kpis: {
      month: `${year}-${dates.pad(month)}`,
      salesValue: t.salesValue,
      salesQty: t.salesQty,
      mtdSalesValue: mtdTotals.salesValue,
      mtdSalesMt: round1(mtdTotals.salesMt),
      mtdTarget: target,
      mtdTargetMt: targetMt,
      achievement,
      achievementMt: round1(achievementMt),
      achievementPct: round1(achievementPct),
      achievementMtPct: round1(achievementMtPct),
      pendingTarget: Math.max(target - achievement, 0),
      pendingTargetMt: round1(Math.max(targetMt - achievementMt, 0)),
      deliveryValue: mtdTotals.deliveryValue,
      deliveryQty: mtdTotals.deliveryQty,
      deliveryMt: round1(mtdTotals.deliveryMt),
      pendingOrderValue: pending.totalValue,
      pendingOrderQty: pending.totalQty,
      pendingOrderMt: round1(pending.totalMt),
      pendingOrders: pending.orderCount,
      activeCustomers: t.customerCount,
      runRatePct: pacing.runRatePct,
      monthProgressPct: prog.monthProgressPct,
      performanceStatus: status,
      forecast: pacing.forecast,
      requiredDaily: pacing.requiredDaily,
    },
    monthProgress: prog,
    pacing,
    trend: daily,
    weeklyTrend: weeklySeries(daily),
    lastUpdated: data ? data.syncedAt : null,
  };
}

function orderBreakdown(orders, dim) {
  const fn = {
    territory: (o) => territoryName(o),
    product: (o) => productName(o),
    customer: (o) => customerName(o),
    region: (o) => o.region || 'Unassigned',
    area: (o) => o.area || 'Unassigned',
  }[dim] || ((o) => territoryName(o));
  const m = groupSum(orders, (o) => fn(o), (o) => o.value, (o) => o.quantity);
  return sortedEntries(m).map((e) => ({ name: e.key, value: e.value, quantity: e.qty, count: e.count }));
}

function deliveryBreakdown(deliveries, dim) {
  const fn = {
    territory: (d) => territoryName(d),
    product: (d) => productName(d),
    customer: (d) => customerName(d),
    region: (d) => d.region || 'Unassigned',
    area: (d) => d.area || 'Unassigned',
  }[dim] || ((d) => territoryName(d));
  const m = groupSum(deliveries, (d) => fn(d), (d) => d.value, (d) => d.quantity);
  return sortedEntries(m).map((e) => ({ name: e.key, value: e.value, quantity: e.qty, count: e.count }));
}

/**
 * Sales Order module payload (metrics + trend + breakdowns + paginated table).
 */
function salesOrders(data, scope, range, opts = {}) {
  const { orders } = scopedFacts(data, scope, range.from, range.to);
  const t = totals(orders, []);
  const daily = dailySeries(orders, [], range.from, range.to);
  const avgOrderValue = t.orderCount ? t.salesValue / t.orderCount : 0;

  const rows = orders.map((o) => ({
    date: o.date,
    orderNo: o.orderNo || '',
    customer: customerName(o),
    territory: territoryName(o),
    item: itemName(o),
    product: productName(o),
    uom: o.uom,
    quantity: num(o.quantity),
    mt: num(o.mt),
    value: num(o.value),
    rate50: o.rate50 == null ? null : num(o.rate50),
    status: o.status || 'Open',
  }));

  const page = paginate(rows, opts);
  return {
    metrics: {
      totalOrders: t.orderCount,
      orderValue: t.salesValue,
      orderQty: t.salesQty,
      orderMt: round1(t.salesMt),
      customers: new Set(orders.map(customerName)).size,
      avgOrderValue,
    },
    daily,
    weekly: weeklySeries(daily),
    byTerritory: orderBreakdown(orders, 'territory'),
    byProduct: orderBreakdown(orders, 'product'),
    byCustomer: orderBreakdown(orders, 'customer'),
    table: page,
  };
}

/**
 * Delivery module payload.
 */
function deliveryModule(data, scope, range, opts = {}) {
  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const t = totals(orders, deliveries);
  const daily = dailySeries([], deliveries, range.from, range.to);
  const achievementPct = t.salesValue > 0 ? (t.deliveryValue / t.salesValue) * 100 : 0;

  const rows = deliveries.map((d) => ({
    date: d.date,
    customer: customerName(d),
    territory: territoryName(d),
    item: itemName(d),
    product: productName(d),
    uom: d.uom,
    quantity: num(d.quantity),
    mt: num(d.mt),
    value: num(d.value),
    status: d.status || 'Delivered',
  }));

  const page = paginate(rows, opts);
  return {
    metrics: {
      deliveryValue: t.deliveryValue,
      deliveryQty: t.deliveryQty,
      deliveryMt: round1(t.deliveryMt),
      deliveredCustomers: new Set(deliveries.map(customerName)).size,
      deliveryAchievementPct: round1(achievementPct),
      deliveryCount: t.deliveryCount,
    },
    daily,
    weekly: weeklySeries(daily),
    byTerritory: deliveryBreakdown(deliveries, 'territory'),
    byProduct: deliveryBreakdown(deliveries, 'product'),
    table: page,
  };
}

/**
 * Pending module payload.
 */
function pendingModule(data, scope, range, opts = {}) {
  const now = dates.todayStr();
  const { orders, deliveries } = scopedFacts(data, scope, dates.monthsAgoStart(4, now), now);
  const pending = computePending(orders, deliveries, now);
  const buckets = configRepo.get('pendingAgingBuckets');

  const aging = buckets.map((b) => {
    const rows = pending.rows.filter((r) => r.bucket === b.label);
    return {
      label: b.label,
      value: rows.reduce((s, r) => s + r.pendingValue, 0),
      qty: rows.reduce((s, r) => s + r.pendingQty, 0),
      count: rows.length,
    };
  });

  const criticalCount = pending.rows.filter((r) => r.priority === 'Critical').length;
  const highCount = pending.rows.filter((r) => r.priority === 'High').length;

  const page = paginate(pending.rows, opts, ['priority', 'pendingValue', 'pendingDays']);

  return {
    metrics: {
      pendingQty: pending.totalQty,
      pendingMt: round1(pending.totalMt),
      pendingValue: pending.totalValue,
      pendingOrders: pending.orderCount,
      pendingCustomers: new Set(pending.rows.map((r) => r.customer)).size,
      avgPendingDays: pending.rows.length ? pending.rows.reduce((s, r) => s + r.pendingDays, 0) / pending.rows.length : 0,
      criticalOrders: criticalCount + highCount,
    },
    aging,
    table: page,
  };
}

/**
 * Target vs Achievement module.
 */
function targetAchievement(data, scope, range, opts = {}) {
  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const t = totals(orders, deliveries);
  const now = dates.todayStr();
  const { year, month } = dates.currentMonth(now);
  const selMonth = range.from ? range.from.slice(0, 7) : `${year}-${dates.pad(month)}`;
  const prog = monthProgress.computeMonthProgress(year, month, now);
  const targetMt = territoryTargetService.nationalTotalMt(selMonth);
  const achievementMt = t.deliveryMt;
  const achievementMtPct = targetMt > 0 ? (achievementMt / targetMt) * 100 : 0;
  const pacing = monthProgress.computePacing(targetMt, achievementMt, prog);
  const status = monthProgress.performanceStatus(achievementMtPct, prog.monthProgressPct);

  const cumulative = [];
  let acc = 0;
  const daily = dailySeries(orders, deliveries, `${year}-${dates.pad(month)}-01`, now);
  for (const d of daily) {
    acc += d.deliveryMt;
    cumulative.push({ date: d.date, achievement: acc, targetMt: targetMt * (d.date <= now ? 1 : 0) });
  }

  return {
    metrics: {
      targetMt,
      achievementMt: round1(achievementMt),
      achievementMtPct: round1(achievementMtPct),
      pendingTargetMt: round1(Math.max(targetMt - achievementMt, 0)),
      requiredDaily: pacing.requiredDaily,
      requiredWeekly: pacing.requiredDaily * 7,
      forecast: pacing.forecast,
      runRatePct: pacing.runRatePct,
      monthProgressPct: prog.monthProgressPct,
      status,
    },
    cumulative,
    monthlyTrend: [],
    byProduct: productTargetAchievement(data, scope, range, selMonth),
    byTerritory: territoryTargetAchievement(data, scope, range, selMonth),
  };
}

/** Product-wise target (MT) vs achievement (delivery MT) for a month. */
function productTargetAchievement(data, scope, range, selMonth) {
  const { deliveries } = scopedFacts(data, scope, range.from, range.to);
  const mtByProduct = new Map();
  const valueByProduct = new Map();
  for (const x of deliveries) {
    const k = productName(x);
    mtByProduct.set(k, (mtByProduct.get(k) || 0) + num(x.mt));
    valueByProduct.set(k, (valueByProduct.get(k) || 0) + num(x.value));
  }
  const rows = [];
  for (const p of territoryTargetService.productsList()) {
    const targetMt = territoryTargetService.nationalProductMt(selMonth, p);
    const delMt = mtByProduct.get(p) || 0;
    rows.push({
      product: p,
      targetMt,
      deliveryMt: round1(delMt),
      achievementPct: targetMt > 0 ? round1((delMt / targetMt) * 100) : 0,
      deliveryValue: valueByProduct.get(p) || 0,
    });
  }
  rows.sort((a, b) => b.targetMt - a.targetMt);
  return rows;
}

/** Territory target vs achievement (delivery MT) for a month. */
function territoryTargetAchievement(data, scope, range, selMonth) {
  const { deliveries } = scopedFacts(data, scope, range.from, range.to);
  const delMtByTerr = new Map();
  const delValByTerr = new Map();
  for (const d of deliveries) {
    const k = territoryName(d);
    delMtByTerr.set(k, (delMtByTerr.get(k) || 0) + num(d.mt));
    delValByTerr.set(k, (delValByTerr.get(k) || 0) + num(d.value));
  }
  return territoryTargetService.territoryTargets(selMonth).map((tt) => {
    const delMt = delMtByTerr.get(tt.territory) || 0;
    return {
      territory: tt.territory,
      targetMt: round1(tt.targetMt),
      deliveryMt: round1(delMt),
      deliveryValue: delValByTerr.get(tt.territory) || 0,
      achievementPct: tt.targetMt > 0 ? round1((delMt / tt.targetMt) * 100) : 0,
    };
  }).sort((a, b) => b.targetMt - a.targetMt);
}

function territoryPerformance(data, scope, range) {
  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const byTerr = groupSum(orders, (o) => territoryName(o), (o) => o.value, (o) => o.quantity);
  const dTerr = groupSum(deliveries, (d) => territoryName(d), (d) => d.value, (d) => d.quantity);
  const salesMtByTerr = new Map();
  const delMtByTerr = new Map();
  for (const o of orders) {
    const k = territoryName(o);
    salesMtByTerr.set(k, (salesMtByTerr.get(k) || 0) + num(o.mt));
  }
  for (const d of deliveries) {
    const k = territoryName(d);
    delMtByTerr.set(k, (delMtByTerr.get(k) || 0) + num(d.mt));
  }
  return [...byTerr.entries()].map(([k, v]) => ({
    territory: k,
    salesValue: v.value,
    salesMt: round1(salesMtByTerr.get(k) || 0),
    deliveryValue: dTerr.get(k) ? dTerr.get(k).value : 0,
    deliveryMt: round1(delMtByTerr.get(k) || 0),
    quantity: v.qty,
  })).sort((a, b) => b.salesValue - a.salesValue);
}

function regionPerformance(data, scope, range) {
  const { orders } = scopedFacts(data, scope, range.from, range.to);
  const m = groupSum(orders, (o) => o.region || 'Unassigned', (o) => o.value, (o) => o.quantity);
  return sortedEntries(m).map((e) => ({ region: e.key, salesValue: e.value, quantity: e.qty, orderCount: e.count }));
}

function areaPerformance(data, scope, range) {
  const { orders } = scopedFacts(data, scope, range.from, range.to);
  const m = groupSum(orders, (o) => o.area || 'Unassigned', (o) => o.value, (o) => o.quantity);
  return sortedEntries(m).map((e) => ({ area: e.key, salesValue: e.value, quantity: e.qty, orderCount: e.count }));
}

function creditStatus(data, scope) {
  if (!data || !data.credit) return [];
  const filter = permissionService.makeFactFilter(scope);
  return data.credit.filter((c) => filter({ territory: c.territory }));
}

function customerSummary(data, scope, range) {  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const o = groupSum(orders, (x) => customerName(x), (x) => x.value, (x) => x.quantity);
  const d = groupSum(deliveries, (x) => customerName(x), (x) => x.value, (x) => x.quantity);
  return [...o.entries()].map(([k, v]) => ({
    customer: k,
    salesValue: v.value,
    quantity: v.qty,
    orderCount: v.count,
    deliveryValue: d.get(k) ? d.get(k).value : 0,
    avgOrderValue: v.count ? v.value / v.count : 0,
  })).sort((a, b) => b.salesValue - a.salesValue);
}

function productSummary(data, scope, range) {
  const { orders, deliveries } = scopedFacts(data, scope, range.from, range.to);
  const o = groupSum(orders, (x) => productName(x), (x) => x.value, (x) => x.quantity);
  const d = groupSum(deliveries, (x) => productName(x), (x) => x.value, (x) => x.quantity);
  const salesMtByProduct = new Map();
  const delMtByProduct = new Map();
  for (const x of orders) {
    const k = productName(x);
    salesMtByProduct.set(k, (salesMtByProduct.get(k) || 0) + num(x.mt));
  }
  for (const x of deliveries) {
    const k = productName(x);
    delMtByProduct.set(k, (delMtByProduct.get(k) || 0) + num(x.mt));
  }
  return [...o.entries()].map(([k, v]) => {
    const salesMt = salesMtByProduct.get(k) || 0;
    const deliveryMt = delMtByProduct.get(k) || 0;
    const targetMt = territoryTargetService.nationalProductMt(range.from ? range.from.slice(0, 7) : '', k);
    return {
      product: k,
      salesValue: v.value,
      quantity: v.qty,
      orderCount: v.count,
      deliveryValue: d.get(k) ? d.get(k).value : 0,
      salesMt: round1(salesMt),
      deliveryMt: round1(deliveryMt),
      targetMt,
      achievementPct: targetMt > 0 ? round1((deliveryMt / targetMt) * 100) : 0,
    };
  }).sort((a, b) => b.salesValue - a.salesValue);
}

function paginate(rows, opts = {}, sortable = ['date', 'value', 'quantity']) {
  const page = num(opts.page) || 1;
  const pageSize = Math.min(num(opts.pageSize) || 25, 500);
  const sort = opts.sort || sortable[0];
  const order = opts.order === 'asc' ? 1 : -1;

  let arr = [...rows];
  if (opts.search) {
    const s = String(opts.search).toLowerCase();
    arr = arr.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(s)));
  }
  if (opts.filter && typeof opts.filter === 'object') {
    for (const [k, v] of Object.entries(opts.filter)) {
      if (v === undefined || v === null || v === '') continue;
      arr = arr.filter((r) => r[k] != null && String(r[k]).toLowerCase() === String(v).toLowerCase());
    }
  }
  arr.sort((a, b) => {
    const av = a[sort]; const bv = b[sort];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * order;
    return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * order;
  });

  const total = arr.length;
  const start = (page - 1) * pageSize;
  const items = arr.slice(start, start + pageSize);
  return { rows: items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

module.exports = {
  scopedFacts,
  computePending,
  dashboardSummary,
  salesOrders,
  deliveryModule,
  pendingModule,
  targetAchievement,
  territoryTargetAchievement,
  territoryPerformance,
  customerSummary,
  productSummary,
  regionPerformance,
  areaPerformance,
  creditStatus,
  orderBreakdown,
  deliveryBreakdown,
  dailySeries,
  weeklySeries,
  paginate,
};
