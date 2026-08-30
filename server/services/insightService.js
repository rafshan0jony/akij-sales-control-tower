'use strict';

const dates = require('../lib/dates');
const analytics = require('./analyticsService');
const { money, pct } = require('../lib/format');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Automated Key Insights engine.
 * Produces data-driven insights only — never generic statements.
 */
function generateInsights(data, scope, range) {
  if (!data) return [];
  const insights = [];
  const now = dates.todayStr();

  const summary = analytics.dashboardSummary(data, scope, range);
  const kpis = summary.kpis;

  // 1. Run-rate / target pacing (achievement = delivery)
  if (kpis.mtdTargetMt > 0) {
    const gapPts = round1(kpis.achievementMtPct - kpis.monthProgressPct);
    if (gapPts < -10) {
      insights.push({
        title: 'Target may be missed on current run rate',
        description: `Achievement ${pct(kpis.achievementMtPct)} (${kpis.achievementMt} MT delivered) trails month progress (${pct(kpis.monthProgressPct)}) by ${Math.abs(gapPts)} points.`,
        metric: pct(kpis.achievementMtPct),
        severity: gapPts < -20 ? 'CRITICAL' : 'WARNING',
        dimension: 'National',
        action: 'Increase delivery coordination and prioritize pending order conversion.',
      });
    } else if (gapPts >= 0) {
      insights.push({
        title: 'Performance ahead of plan',
        description: `Achievement ${pct(kpis.achievementMtPct)} (${kpis.achievementMt} MT delivered) is ${gapPts} points above month progress (${pct(kpis.monthProgressPct)}).`,
        metric: pct(kpis.achievementMtPct),
        severity: 'SUCCESS',
        dimension: 'National',
        action: 'Sustain momentum and reallocate effort to lagging territories.',
      });
    }
  }

  // 2. Territory delivery (achievement) outliers
  const territories = analytics.territoryPerformance(data, scope, range);
  const top = territories.slice(0, 3);
  const bottom = territories.slice(-3).reverse();
  for (const t of top) {
    insights.push({
      title: `${t.territory} is leading delivery`,
      description: `${t.territory} delivered ${t.deliveryMt} MT this period.`,
      metric: `${t.deliveryMt} MT`,
      severity: 'SUCCESS',
      dimension: t.territory,
      action: 'Identify winning practices to replicate across other territories.',
    });
  }
  for (const t of bottom) {
    insights.push({
      title: `${t.territory} has lowest delivery`,
      description: `${t.territory} delivered only ${t.deliveryMt} MT this period.`,
      metric: `${t.deliveryMt} MT`,
      severity: 'WARNING',
      dimension: t.territory,
      action: 'Review delivery bottlenecks and pending orders in this territory.',
    });
  }

  // 3. Pending trend vs previous week
  const curRange = { from: dates.addDays(now, -6), to: now };
  const prevRange = { from: dates.addDays(now, -13), to: dates.addDays(now, -7) };
  const curWeek = analytics.scopedFacts(data, scope, curRange.from, curRange.to);
  const prevWeek = analytics.scopedFacts(data, scope, prevRange.from, prevRange.to);
  const curPending = analytics.computePending(curWeek.orders, curWeek.deliveries, now).totalValue;
  const prevPending = analytics.computePending(prevWeek.orders, prevWeek.deliveries, now).totalValue;
  if (prevPending > 0) {
    const delta = (curPending - prevPending) / prevPending * 100;
    if (delta > 5) {
      insights.push({
        title: 'Pending orders increased week-over-week',
        description: `Pending value rose ${round1(delta)}% vs the previous week (${money(curPending)} now vs ${money(prevPending)}).`,
        metric: `${round1(delta)}%`,
        severity: delta > 15 ? 'CRITICAL' : 'WARNING',
        dimension: 'Pending',
        action: 'Prioritize pending order conversion and delivery coordination.',
      });
    }
  }

  // 4. Customer with highest pending value (April-onwards, matching report)
  const full = analytics.scopedFacts(data, scope, range.from, range.to);
  const pendScope = analytics.scopedFacts(data, scope, dates.monthsAgoStart(4, now), now);
  const pend = analytics.computePending(pendScope.orders, pendScope.deliveries, now);
  const pendByCust = new Map();
  for (const r of pend.rows) {
    pendByCust.set(r.customer, (pendByCust.get(r.customer) || 0) + r.pendingValue);
  }
  const topPendCust = [...pendByCust.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPendCust && topPendCust[1] > 0) {
    insights.push({
      title: `${topPendCust[0]} has the highest pending value`,
      description: `${topPendCust[0]} holds ${money(topPendCust[1])} in pending orders.`,
      metric: money(topPendCust[1]),
      severity: 'WARNING',
      dimension: topPendCust[0],
      action: 'Include this customer in the next tour plan and follow up on delivery.',
    });
  }

  // 5. Delivery vs order booking
  if (kpis.salesValue > 0) {
    const deliveryRatio = (kpis.deliveryValue / kpis.salesValue) * 100;
    if (deliveryRatio < 90) {
      insights.push({
        title: 'Delivery lags behind order booking',
        description: `Delivered value (${money(kpis.deliveryValue)}) is only ${round1(deliveryRatio)}% of booked value (${money(kpis.salesValue)}).`,
        metric: pct(deliveryRatio),
        severity: 'WARNING',
        dimension: 'Delivery',
        action: 'Coordinate logistics to convert booked orders into deliveries.',
      });
    }
  }

  // 6. Products sold below announced price (rate per 50 kg)
  const rateService = require('./rateService');
  const rateByProduct = new Map();
  const rateSum = new Map();
  for (const o of full.orders) {
    if (o.rate50 == null) continue;
    const k = o.product || o.item;
    rateByProduct.set(k, (rateByProduct.get(k) || 0) + num(o.rate50));
    rateSum.set(k, (rateSum.get(k) || 0) + 1);
  }
  for (const [product, count] of rateSum.entries()) {
    const announced = rateService.priceFor(product);
    if (!announced) continue;
    const avg = rateByProduct.get(product) / count;
    const below = (announced - avg) / announced * 100;
    if (below > 2) {
      insights.push({
        title: `${product} selling below announced price`,
        description: `${product} average rate is ${money(avg)} per 50kg vs announced ${money(announced)} (${round1(below)}% below).`,
        metric: `${money(avg)}/50kg`,
        severity: below > 5 ? 'WARNING' : 'INFO',
        dimension: product,
        action: 'Review pricing/authorization for below-rate sales.',
      });
    }
  }

  return insights;
}

module.exports = { generateInsights };
