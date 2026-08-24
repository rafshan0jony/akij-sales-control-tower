'use strict';

const dates = require('../lib/dates');
const analytics = require('./analyticsService');
const configRepo = require('../repos/config');
const { money } = require('../lib/format');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Contextual, data-driven recommendation engine.
 */
function generateRecommendations(data, scope, range) {
  if (!data) return [];
  const recs = [];
  const now = dates.todayStr();

  const summary = analytics.dashboardSummary(data, scope, range);
  const kpis = summary.kpis;

  // 1. Achievement pacing
  if (kpis.mtdTarget > 0) {
    const gap = kpis.achievementPct - kpis.monthProgressPct;
    const behindGap = num(configRepo.get('recommendations').behindGapPct || 10);
    if (gap < -behindGap) {
      recs.push({
        title: 'Increase daily sales coverage',
        description: `Achievement (${round1(kpis.achievementPct)}%) is ${round1(Math.abs(gap))} points below month progress. Required daily sales to close the gap: ${money(kpis.requiredDaily)}.`,
        severity: 'HIGH',
        target: 'Sales',
      });
    }
  }

  // 2. Pending conversion
  if (kpis.pendingOrderValue > num(configRepo.get('criticalPendingValue'))) {
    recs.push({
      title: 'Prioritize pending order conversion',
      description: `Pending order value is ${money(kpis.pendingOrderValue)} across ${kpis.pendingOrders} orders.`,
      severity: 'HIGH',
      target: 'Pending',
    });
  }

  // 3. Territory-level recommendations
  const territories = analytics.territoryPerformance(data, scope, range).filter((t) => t.target > 0);
  for (const t of territories.filter((x) => x.achievementPct < 85).slice(0, 5)) {
    recs.push({
      title: `Boost ${t.territory}`,
      description: `${t.territory} is at ${round1(t.achievementPct)}% of target. Increase market visits and focus on high-volume customers.`,
      severity: t.achievementPct < 60 ? 'CRITICAL' : 'MEDIUM',
      target: t.territory,
    });
  }

  // 4. Customer decline (compare recent 30d vs prior 30d)
  const recent = analytics.scopedFacts(data, scope, dates.addDays(now, -30), now);
  const prior = analytics.scopedFacts(data, scope, dates.addDays(now, -60), dates.addDays(now, -31));
  const recentByCust = new Map();
  const priorByCust = new Map();
  for (const o of recent.orders) recentByCust.set(o.customer, (recentByCust.get(o.customer) || 0) + num(o.value));
  for (const o of prior.orders) priorByCust.set(o.customer, (priorByCust.get(o.customer) || 0) + num(o.value));
  const declining = [];
  for (const [cust, val] of recentByCust.entries()) {
    const p = priorByCust.get(cust) || 0;
    if (p > 0) {
      const change = (val - p) / p * 100;
      if (change < -20) declining.push({ customer: cust, change });
    }
  }
  declining.sort((a, b) => a.change - b.change);
  for (const d of declining.slice(0, 3)) {
    recs.push({
      title: `Re-engage ${d.customer}`,
      description: `${d.customer} sales declined ${round1(Math.abs(d.change))}% over the last 30 days.`,
      severity: 'MEDIUM',
      target: d.customer,
    });
  }

  // 5. Delivery shortfall
  if (kpis.salesValue > 0 && kpis.deliveryValue / kpis.salesValue < 0.9) {
    recs.push({
      title: 'Improve delivery coordination',
      description: `Only ${round1(kpis.deliveryValue / kpis.salesValue * 100)}% of booked value has been delivered.`,
      severity: 'HIGH',
      target: 'Delivery',
    });
  }

  return recs;
}

module.exports = { generateRecommendations };
