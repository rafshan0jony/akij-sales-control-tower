'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { parseRange, freshness } = require('./helpers');
const syncService = require('../services/syncService');
const analytics = require('../services/analyticsService');
const insightService = require('../services/insightService');
const recommendationService = require('../services/recommendationService');
const tourPlanService = require('../services/tourPlanService');
const syncRepo = require('../repos/sync');
const permissionService = require('../services/permissionService');

const router = express.Router();
router.use(authenticate);

router.get('/summary', asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const payload = analytics.dashboardSummary(data, req.scope, range);
  res.json({ ...payload, ...freshness() });
}));

router.get('/management-summary', asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  const summary = analytics.dashboardSummary(data, req.scope, range);
  const territories = analytics.territoryPerformance(data, req.scope, range);
  const products = analytics.productSummary(data, req.scope, range);
  res.json({
    kpis: summary.kpis,
    topTerritories: territories.slice(0, 5),
    bottomTerritories: territories.slice(-5).reverse(),
    topProducts: products.slice(0, 5),
    ...freshness(),
  });
}));

router.get('/insights', asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  res.json({ insights: insightService.generateInsights(data, req.scope, range), ...freshness() });
}));

router.get('/recommendations', asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  res.json({ recommendations: recommendationService.generateRecommendations(data, req.scope, range), ...freshness() });
}));

router.get('/tour-plan', asyncHandler(async (req, res) => {
  const { range } = parseRange(req);
  const data = syncService.getData();
  res.json({ tourPlan: tourPlanService.generateTourPlan(data, req.scope, range), ...freshness() });
}));

router.get('/sync-status', asyncHandler(async (req, res) => {
  const status = syncRepo.get();
  res.json({
    status: status || { status: 'idle', dataSource: 'MCP', failedCount: 0 },
    hasData: !!syncService.getData(),
    ...freshness(),
  });
}));

router.get('/territory-list', asyncHandler(async (req, res) => {
  // List of territories visible to this user (for filters / labels).
  const scope = req.scope;
  res.json({ scopeAll: scope.scopeAll, level: scope.level, territoryNames: [...scope.territoryNames] });
}));

module.exports = router;
