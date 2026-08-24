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

router.get('/sales/orders', requirePermission('VIEW_SALES_ORDER'), asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const opts = {
    page: req.query.page, pageSize: req.query.pageSize, search: req.query.search,
    sort: req.query.sort, order: req.query.order,
    filter: pickFilter(req.query, ['territory', 'item', 'customer']),
  };
  const payload = analytics.salesOrders(data, req.scope, range, opts);
  res.json({ ...payload, ...freshness() });
}));

router.get('/delivery', requirePermission('VIEW_DELIVERY'), asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const opts = {
    page: req.query.page, pageSize: req.query.pageSize, search: req.query.search,
    sort: req.query.sort, order: req.query.order,
    filter: pickFilter(req.query, ['territory', 'item', 'customer']),
  };
  const payload = analytics.deliveryModule(data, req.scope, range, opts);
  res.json({ ...payload, ...freshness() });
}));

router.get('/pending', requirePermission('VIEW_PENDING'), asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const opts = {
    page: req.query.page, pageSize: req.query.pageSize, search: req.query.search,
    sort: req.query.sort, order: req.query.order,
    filter: pickFilter(req.query, ['territory', 'item', 'customer']),
  };
  const payload = analytics.pendingModule(data, req.scope, range, opts);
  res.json({ ...payload, ...freshness() });
}));

router.get('/target-achievement', requirePermission('VIEW_TARGET'), asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const payload = analytics.targetAchievement(data, req.scope, range);
  res.json({ ...payload, ...freshness() });
}));

function pickFilter(query, keys) {
  const out = {};
  for (const k of keys) {
    if (query[k] !== undefined && query[k] !== '') out[k] = query[k];
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = router;
