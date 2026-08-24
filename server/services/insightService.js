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

  // 1. Run-rate / target pacing
  if (kpis.mtdTarget > 0) {
    const gapPts = round1(kpis.achievementPct - kpis.monthProgressPct);
    if (gapPts < -10) {
      insights.push({
        title: 'Target may be missed on current run rate',
        description: `Achievement (${pct(kpis.achievementPct)}) trails month progress (${pct(kpis.monthProgressPct)}) by ${Math.abs(gapPts)} points.`,
        metric: pct(kpis.achievementPct),
        severity: gapPts < -20 ? 'CRITICAL' : 'WARNING',
        dimension: 'National',
        action: 'Increase daily sales coverage and prioritize high-potential customers.',
      });
    } else if (gapPts >= 0) {
      insights.push({
        title: 'Performance ahead of plan',
        description: `Achievement (${pct(kpis.achievementPct)}) is ${gapPts} points above month progress (${pct(kpis.monthProgressPct)}).`,
        metric: pct(kpis.achievementPct),
        severity: 'SUCCESS',
        dimension: 'National',
        action: 'Sustain momentum and reallocate effort to lagging territories.',
      });
    }
  }

  // 2. Territory performance outliers (only where targets are configured)
  const territories = analytics.territoryPerformance(data, scope, range).filter((t) => t.target > 0);
  const behind = territories.filter((t) => t.achievementPct < 80).sort((a, b) => a.achievementPct - b.achievementPct);
  const ahead = territories.filter((t) => t.achievementPct >= 105).sort((a, b) => b.achievementPct - a.achievementPct);
  for (const t of behind.slice(0, 3)) {
    insights.push({
      title: `${t.territory} is behind target`,
      description: `${t.territory} achieved ${pct(t.achievementPct)} of MTD target (${money(t.salesValue)} vs ${money(t.target)}).`,
      metric: pct(t.achievementPct),
      severity: t.achievementPct < 60 ? 'CRITICAL' : 'WARNING',
      dimension: t.territory,
      action: 'Increase market visits and focus on high-volume customers in this territory.',
    });
  }
  for (const t of ahead.slice(0, 3)) {
    insights.push({
      title: `${t.territory} is exceeding target`,
      description: `${t.territory} achieved ${pct(t.achievementPct)} of MTD target.`,
      metric: pct(t.achievementPct),
      severity: 'SUCCESS',
      dimension: t.territory,
      action: 'Identify winning practices to replicate across other territories.',
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

  // 4. Customer with highest pending value
  const full = analytics.scopedFacts(data, scope, range.from, range.to);
  const pend = analytics.computePending(full.orders, full.deliveries, now);
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

  return insights;
}

module.exports = { generateInsights };
