'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const { parseRange, freshness } = require('./helpers');
const syncService = require('../services/syncService');
const analytics = require('../services/analyticsService');

const router = express.Router();
router.use(authenticate);

router.get('/analytics/territories', requirePermission('VIEW_ANALYTICS'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ territories: analytics.territoryPerformance(data, scope, range), ...freshness() });
}));

router.get('/analytics/areas', requirePermission('VIEW_ANALYTICS'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ areas: analytics.areaPerformance(data, scope, range), ...freshness() });
}));

router.get('/analytics/regions', requirePermission('VIEW_ANALYTICS'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ regions: analytics.regionPerformance(data, scope, range), ...freshness() });
}));

router.get('/analytics/customers', requirePermission('VIEW_CUSTOMER'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ customers: analytics.customerSummary(data, scope, range), ...freshness() });
}));

router.get('/analytics/products', requirePermission('VIEW_PRODUCT'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ products: analytics.productSummary(data, scope, range), ...freshness() });
}));

router.get('/analytics/trends', requirePermission('VIEW_ANALYTICS'), asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  const f = analytics.scopedFacts(data, scope, range.from, range.to);
  const daily = analytics.dailySeries(f.orders, f.deliveries, range.from, range.to);
  res.json({ daily, weekly: analytics.weeklySeries(daily), ...freshness() });
}));

router.get('/analytics/drilldown', requirePermission('VIEW_ANALYTICS'), asyncHandler(async (req, res) => {
  // dimension: territory | customer | product
  const { range, scope } = parseRange(req);
  const dim = req.query.dimension || 'territory';
  const data = syncService.getData();
  const f = analytics.scopedFacts(data, scope, range.from, range.to);
  const breakdown = analytics.orderBreakdown(f.orders, dim);
  res.json({ dimension: dim, breakdown, ...freshness() });
}));

module.exports = router;
