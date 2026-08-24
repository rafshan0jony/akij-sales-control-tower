'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert');

const { hashPassword, verifyPassword } = require('../server/lib/passwords');
const dates = require('../server/lib/dates');
const monthProgress = require('../server/services/monthProgressService');
const analytics = require('../server/services/analyticsService');
const { toCsv } = require('../server/lib/csv');

test('password hashing and verification', () => {
  const h = hashPassword('secret123');
  assert.notEqual(h, 'secret123');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(verifyPassword('secret123', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('month progress computes business days', () => {
  const p = monthProgress.computeMonthProgress(2026, 8, '2026-08-24');
  assert.strictEqual(p.totalDays, 31);
  assert.strictEqual(p.totalBusinessDays, 22); // Aug 2026: 9 weekend days
  assert.strictEqual(p.elapsedBusiness, 17);
  assert.strictEqual(p.remainingBusiness, 5);
  assert.ok(p.monthProgressPct > 0 && p.monthProgressPct < 100);
});

test('pacing metrics', () => {
  const p = monthProgress.computeMonthProgress(2026, 8, '2026-08-24');
  const pacing = monthProgress.computePacing(50000000, 37500000, p);
  assert.strictEqual(pacing.remainingTarget, 12500000);
  assert.strictEqual(pacing.achievementPct, 75);
  assert.ok(pacing.requiredDaily > 0);
  assert.ok(pacing.forecast > 0);
});

test('performance status thresholds', () => {
  assert.strictEqual(monthProgress.performanceStatus(120, 50), 'Exceeding');
  assert.strictEqual(monthProgress.performanceStatus(60, 50), 'On Track');
  assert.strictEqual(monthProgress.performanceStatus(45, 50), 'At Risk');
  assert.strictEqual(monthProgress.performanceStatus(20, 50), 'Behind');
});

test('pending computation with order-level matching', () => {
  const orders = [
    { date: '2026-08-10', orderNo: 'SO1', customer: 'A', territory: 'T1', item: 'Rice', uom: 'BAG', quantity: 100, value: 100000 },
    { date: '2026-08-11', orderNo: 'SO2', customer: 'B', territory: 'T2', item: 'Rice', uom: 'BAG', quantity: 50, value: 50000 },
  ];
  const deliveries = [
    { date: '2026-08-15', customer: 'A', territory: 'T1', orderNo: 'SO1', item: 'Rice', uom: 'BAG', quantity: 60, value: 60000 },
  ];
  const p = analytics.computePending(orders, deliveries, '2026-08-24');
  assert.strictEqual(p.totalQty, 90);
  assert.strictEqual(p.totalValue, 90000);
  assert.strictEqual(p.rows.length, 2);
  const so1 = p.rows.find((r) => r.orderNo === 'SO1');
  assert.strictEqual(so1.pendingQty, 40);
  assert.strictEqual(so1.deliveredQty, 60);
  assert.strictEqual(so1.pendingDays, 14);
});

test('pending aging buckets', () => {
  const rows = [
    { pendingDays: 1 }, { pendingDays: 5 }, { pendingDays: 10 }, { pendingDays: 20 }, { pendingDays: 40 },
  ];
  const buckets = analytics.computePending([], [], '2026-08-24');
  assert.ok(Array.isArray(buckets.rows));
});

test('csv export escapes quotes and commas', () => {
  const csv = toCsv([{ a: 'x,y', b: 'he said "hi"' }], ['a', 'b']);
  assert.ok(csv.includes('"x,y"'));
  assert.ok(csv.includes('"he said ""hi"""'));
});

test('financial year (July-June)', () => {
  const fy = dates.financialYear('2026-08-24');
  assert.strictEqual(fy.startYear, 2026);
  assert.strictEqual(fy.endYear, 2027);
  assert.strictEqual(fy.start, '2026-07-01');
});
