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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Tour Plan Guide.
 * Scores customers by weighted factors and recommends a visit priority.
 * Factors (configurable weights): pending value, sales decline, target gap,
 * last-visit days, delivery issue.
 */
function generateTourPlan(data, scope, range) {
  if (!data) return [];
  const now = dates.todayStr();
  const weights = configRepo.get('tourWeights') || {};
  const W = {
    pending: num(weights.pending ?? 30),
    salesDecline: num(weights.salesDecline ?? 25),
    targetGap: num(weights.targetGap ?? 20),
    lastVisitDays: num(weights.lastVisitDays ?? 15),
    deliveryIssue: num(weights.deliveryIssue ?? 10),
  };
  const totalWeight = W.pending + W.salesDecline + W.targetGap + W.lastVisitDays + W.deliveryIssue;

  const full = analytics.scopedFacts(data, scope, range.from, range.to);
  const customers = new Set(full.orders.map((o) => o.customer).filter(Boolean));

  // pending by customer (April-onwards, matching report)
  const pendingScope = analytics.scopedFacts(data, scope, dates.monthsAgoStart(4, now), now);
  const pending = analytics.computePending(pendingScope.orders, pendingScope.deliveries, now);
  const pendByCust = new Map();
  const deliveryIssueByCust = new Map();
  for (const r of pending.rows) {
    pendByCust.set(r.customer, (pendByCust.get(r.customer) || 0) + r.pendingValue);
    if (r.pendingDays >= (num(configRepo.get('highPendingDays')) || 15)) {
      deliveryIssueByCust.set(r.customer, (deliveryIssueByCust.get(r.customer) || 0) + 1);
    }
  }

  // sales decline: recent 30d vs prior 30d
  const recent = analytics.scopedFacts(data, scope, dates.addDays(now, -30), now);
  const prior = analytics.scopedFacts(data, scope, dates.addDays(now, -60), dates.addDays(now, -31));
  const salesByCust = (facts, out) => {
    for (const o of facts.orders) out.set(o.customer, (out.get(o.customer) || 0) + num(o.value));
    return out;
  };
  const recentMap = salesByCust(recent, new Map());
  const priorMap = salesByCust(prior, new Map());

  // last activity date per customer
  const lastDate = new Map();
  for (const o of full.orders) {
    const cur = lastDate.get(o.customer) || '';
    if (o.date > cur) lastDate.set(o.customer, o.date);
  }
  for (const d of full.deliveries) {
    const cur = lastDate.get(d.customer) || '';
    if (d.date > cur) lastDate.set(d.customer, d.date);
  }

  // max pending value for normalization
  const maxPend = Math.max(1, ...[...pendByCust.values()]);
  const maxLastVisit = 30;

  const rows = [...customers].map((cust) => {
    const pendVal = pendByCust.get(cust) || 0;
    const priorVal = priorMap.get(cust) || 0;
    const recentVal = recentMap.get(cust) || 0;
    const decline = priorVal > 0 ? clamp((priorVal - recentVal) / priorVal, 0, 1) : 0;
    const lastDateStr = lastDate.get(cust) || '';
    const lastVisitDays = lastDateStr ? clamp(dates.diffDays(lastDateStr, now), 0, 365) : maxLastVisit;
    const issueCount = deliveryIssueByCust.get(cust) || 0;

    const score = (
      (clamp(pendVal / maxPend, 0, 1) * W.pending) +
      (decline * W.salesDecline) +
      (clamp(lastVisitDays / maxLastVisit, 0, 1) * W.lastVisitDays) +
      (clamp(issueCount / 5, 0, 1) * W.deliveryIssue)
    ) / totalWeight * 100;

    const reasons = [];
    if (pendVal > 0) reasons.push(`pending value ${money(pendVal)}`);
    if (decline > 0.2) reasons.push(`sales down ${round1(decline * 100)}%`);
    if (lastVisitDays >= 7) reasons.push(`${lastVisitDays} days since last activity`);
    if (issueCount > 0) reasons.push('delivery backlog');

    return {
      customer: cust,
      priorityScore: Math.round(score),
      pendingValue: pendVal,
      lastVisitDays,
      reasons,
      recommendedAction: buildAction(reasons),
      priority: score >= 70 ? 'Critical' : score >= 50 ? 'High' : score >= 30 ? 'Medium' : 'Low',
    };
  });

  rows.sort((a, b) => b.priorityScore - a.priorityScore);
  return rows;
}

function buildAction(reasons) {
  if (reasons.length === 0) return 'Routine courtesy visit.';
  return `Visit this customer — ${reasons.join(' + ')}.`;
}

module.exports = { generateTourPlan };
