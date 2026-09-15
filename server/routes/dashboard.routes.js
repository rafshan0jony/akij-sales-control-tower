'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { parseRange, freshness } = require('./helpers');
const { forbidden, badRequest } = require('../lib/errors');
const dates = require('../lib/dates');
const syncService = require('../services/syncService');
const analytics = require('../services/analyticsService');
const insightService = require('../services/insightService');
const recommendationService = require('../services/recommendationService');
const tourPlanService = require('../services/tourPlanService');
const tourPlanSheetService = require('../services/tourPlanSheetService');
const tourPlanEntriesRepo = require('../repos/tourPlanEntries');
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
  const t = dates.tzParts();
  res.json({
    tourPlan: tourPlanService.generateTourPlan(data, scope, range),
    sheetTourPlan: tourPlanSheetService.plansForScope(scope),
    today: t.d,
    hour: t.hour,
    isAdmin: permissionService.hasPermission(req.user, 'SYSTEM_ADMIN'),
    currentUserId: req.user.id,
    ...freshness(),
  });
}));

// Employee submits/updates their daily tour-plan entry (sales order MT, visit
// plan change, TA/DA details, TA/DA bill). Past dates are admin-only; visit
// plan change is locked after 2 PM (Asia/Dhaka).
router.post('/tour-plan/entry', asyncHandler(async (req, res) => {
  const { day, salesOrderMt, visitPlanChange, taDaDetails, taDaBill } = req.body || {};
  const dayNum = Number(day);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) throw badRequest('day must be 1-31');

  const t = dates.tzParts();
  const todayNum = t.d;
  const hour = t.hour;
  const monthKey = `${t.y}-${String(t.m).padStart(2, '0')}`;
  const isAdmin = permissionService.hasPermission(req.user, 'SYSTEM_ADMIN');

  if (dayNum < todayNum && !isAdmin) throw forbidden('Past dates can only be changed by an admin');
  if (visitPlanChange != null && String(visitPlanChange).trim() !== '' && dayNum === todayNum && hour >= 14) {
    throw forbidden('Visit plan change is locked after 2 PM');
  }

  const entry = tourPlanEntriesRepo.upsert(req.user.id, monthKey, dayNum, {
    salesOrderMt: salesOrderMt == null || salesOrderMt === '' ? null : Number(salesOrderMt),
    visitPlanChange: visitPlanChange == null || visitPlanChange === '' ? null : String(visitPlanChange),
    taDaDetails: taDaDetails == null ? null : String(taDaDetails),
    taDaBill: taDaBill == null ? null : String(taDaBill),
  });
  res.json({ entry });
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
  const regions = [...new Set(territories.map((t) => t.region))].sort();
  const areas = [...new Set(territories.map((t) => t.area))].sort();
  res.json({ scopeAll: scope.scopeAll, level: scope.level, territories, regions, areas });
}));

module.exports = router;
