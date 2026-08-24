'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert');

const analytics = require('../server/services/analyticsService');
const insightService = require('../server/services/insightService');
const recommendationService = require('../server/services/recommendationService');
const tourPlanService = require('../server/services/tourPlanService');

function makeData() {
  // 3 customers across 2 territories, Aug 2026
  const orders = [];
  const deliveries = [];
  let so = 1;
  for (let day = 1; day <= 24; day++) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    orders.push({ date, orderNo: 'SO' + so, customer: 'Cust A', territory: 'Dhaka North', item: 'Rice X', uom: 'BAG', quantity: 20, value: 20000, status: 'Open' });
    so++;
    orders.push({ date, orderNo: 'SO' + so, customer: 'Cust B', territory: 'Dhaka North', item: 'Rice X', uom: 'BAG', quantity: 10, value: 10000, status: 'Open' });
    so++;
    orders.push({ date, orderNo: 'SO' + so, customer: 'Cust C', territory: 'Savar', item: 'Rice Y', uom: 'BAG', quantity: 5, value: 7500, status: 'Open' });
    so++;
    if (day % 3 === 0) {
      deliveries.push({ date, customer: 'Cust A', territory: 'Dhaka North', orderNo: 'SO' + (so - 3), item: 'Rice X', uom: 'BAG', quantity: 20, value: 20000 });
      deliveries.push({ date, customer: 'Cust B', territory: 'Dhaka North', orderNo: 'SO' + (so - 2), item: 'Rice X', uom: 'BAG', quantity: 10, value: 10000 });
    }
  }
  return { orders, deliveries, syncedAt: '2026-08-24T10:00:00+06:00' };
}

const scopeAll = { scopeAll: true, territoryIds: new Set(), territoryNames: new Set(), level: 0, role: { code: 'NATIONAL', level: 0 } };
const range = { from: '2026-08-01', to: '2026-08-24', label: 'This Month' };

test('dashboard summary computes KPIs', () => {
  const data = makeData();
  const s = analytics.dashboardSummary(data, scopeAll, range);
  assert.ok(s.kpis.salesValue > 0);
  assert.ok(s.kpis.deliveryValue > 0);
  assert.strictEqual(s.kpis.activeCustomers, 3);
  assert.ok(s.trend.length === 24);
});

test('territory breakdown separates territories', () => {
  const data = makeData();
  const t = analytics.territoryPerformance(data, scopeAll, range);
  const names = t.map((x) => x.territory).sort();
  assert.deepStrictEqual(names, ['Dhaka North', 'Savar']);
  const dn = t.find((x) => x.territory === 'Dhaka North');
  assert.ok(dn.salesValue > 0);
});

test('insights are data-driven and non-empty', () => {
  const data = makeData();
  const insights = insightService.generateInsights(data, scopeAll, range);
  assert.ok(insights.length > 0);
  for (const i of insights) {
    assert.ok(i.title && i.description && i.severity);
  }
});

test('recommendations are generated', () => {
  const data = makeData();
  const recs = recommendationService.generateRecommendations(data, scopeAll, range);
  assert.ok(Array.isArray(recs));
});

test('tour plan ranks customers with pending', () => {
  const data = makeData();
  const plan = tourPlanService.generateTourPlan(data, scopeAll, range);
  assert.ok(Array.isArray(plan));
  assert.ok(plan.length >= 3);
  assert.ok(plan[0].priorityScore >= plan[plan.length - 1].priorityScore);
});

test('pending aging buckets are returned', () => {
  const data = makeData();
  const p = analytics.pendingModule(data, scopeAll, range);
  assert.ok(Array.isArray(p.aging));
  assert.strictEqual(p.aging.length, 5);
});
