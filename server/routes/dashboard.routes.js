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
const territoryMappingService = require('../services/territoryMappingService');

const router = express.Router();
router.use(authenticate);

router.get('/summary', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  const payload = analytics.dashboardSummary(data, scope, range);
  res.json({ ...payload, ...freshness() });
}));

router.get('/management-summary', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  const summary = analytics.dashboardSummary(data, scope, range);
  const territories = analytics.territoryPerformance(data, scope, range);
  const products = analytics.productSummary(data, scope, range);
  res.json({
    kpis: summary.kpis,
    topTerritories: territories.slice(0, 5),
    bottomTerritories: territories.slice(-5).reverse(),
    topProducts: products.slice(0, 5),
    ...freshness(),
  });
}));

router.get('/insights', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ insights: insightService.generateInsights(data, scope, range), ...freshness() });
}));

router.get('/recommendations', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ recommendations: recommendationService.generateRecommendations(data, scope, range), ...freshness() });
}));

router.get('/tour-plan', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const data = syncService.getData();
  res.json({ tourPlan: tourPlanService.generateTourPlan(data, scope, range), ...freshness() });
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
  // Structured list of territories (with area + region) visible to this user.
  const scope = req.scope;
  const detailed = territoryMappingService.territoriesDetailed();
  const territories = scope.scopeAll
    ? detailed
    : detailed.filter((t) => scope.territoryNames.has(t.territory.toLowerCase()));
  res.json({ scopeAll: scope.scopeAll, level: scope.level, territories });
}));

module.exports = router;
