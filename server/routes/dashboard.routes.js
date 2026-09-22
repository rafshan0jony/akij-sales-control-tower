'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { parseRange, freshness } = require('./helpers');
const { forbidden, badRequest } = require('../lib/errors');
const dates = require('../lib/dates');
const logger = require('../logger');
const syncService = require('../services/syncService');
const analytics = require('../services/analyticsService');
const insightService = require('../services/insightService');
const recommendationService = require('../services/recommendationService');
const tourPlanService = require('../services/tourPlanService');
const tourPlanSheetService = require('../services/tourPlanSheetService');
const tourPlanEntriesRepo = require('../repos/tourPlanEntries');
const salesReportsRepo = require('../repos/salesReports');
const salesReportSheetService = require('../services/salesReportSheetService');
const usersRepo = require('../repos/users');
const userTerritoriesRepo = require('../repos/userTerritories');
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
  const isAdmin = permissionService.hasPermission(req.user, 'SYSTEM_ADMIN');
  const isManager = isAdmin || (req.scope.level != null && req.scope.level <= 2);
  res.json({
    tourPlan: tourPlanService.generateTourPlan(data, scope, range),
    sheetTourPlan: tourPlanSheetService.plansForScope(scope),
    today: t.d,
    hour: t.hour,
    isAdmin,
    isManager,
    currentUserId: req.user.id,
    ...freshness(),
  });
}));

// Employee submits/updates their daily tour-plan entry (sales order MT, visit
// plan change, TA/DA details, TA/DA bill). Employees edit their own entry for
// today; managers (national/region/area) and admins may also edit subordinates
// (and past dates). Visit plan change is locked after 2 PM for non-admins.
router.post('/tour-plan/entry', asyncHandler(async (req, res) => {
  const { day, userId, salesOrderMt, visitPlanChange, taDaDetails, taDaBill } = req.body || {};
  const dayNum = Number(day);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) throw badRequest('day must be 1-31');

  const t = dates.tzParts();
  const todayNum = t.d;
  const hour = t.hour;
  const monthKey = `${t.y}-${String(t.m).padStart(2, '0')}`;

  const currentUser = req.user;
  const isAdmin = permissionService.hasPermission(currentUser, 'SYSTEM_ADMIN');
  const isManager = isAdmin || (req.scope.level != null && req.scope.level <= 2);

  let targetUserId = currentUser.id;
  if (userId != null && userId !== '' && Number(userId) !== currentUser.id) {
    if (!isManager) throw forbidden('Only a manager or admin can edit another employee\'s entry');
    const target = usersRepo.findById(Number(userId));
    if (!target) throw badRequest('Target employee not found');
    if (!isAdmin && !req.scope.scopeAll) {
      const targetTerrs = userTerritoriesRepo.listForUser(target.id).map((x) => String(x.name).toLowerCase());
      const inScope = targetTerrs.some((name) => req.scope.territoryNames.has(name));
      if (!inScope) throw forbidden('Target employee is outside your territory scope');
    }
    targetUserId = target.id;
  }

  if (dayNum > todayNum) throw forbidden('Future dates cannot be edited');
  if (dayNum < todayNum && !isAdmin) throw forbidden('Past dates can only be changed by an admin');
  if (visitPlanChange != null && String(visitPlanChange).trim() !== '' && hour >= 14 && !isAdmin) {
    throw forbidden('Visit plan change is locked after 2 PM');
  }

  const entry = tourPlanEntriesRepo.upsert(targetUserId, monthKey, dayNum, {
    salesOrderMt: salesOrderMt == null || salesOrderMt === '' ? null : Number(salesOrderMt),
    visitPlanChange: visitPlanChange == null || visitPlanChange === '' ? null : String(visitPlanChange),
    taDaDetails: taDaDetails == null ? null : String(taDaDetails),
    taDaBill: taDaBill == null ? null : String(taDaBill),
  });
  res.json({ entry });
}));

// Sales report (daily projection vs actual). Any field employee (national/
// region/area/territory) enters their own report for today; managers/admin
// also view their scope's reports for the selected month + date.
router.get('/sales-report', asyncHandler(async (req, res) => {
  const { range, scope } = parseRange(req);
  const t = dates.tzParts();
  const today = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const month = range.from ? range.from.slice(0, 7) : today.slice(0, 7);
  const dateParam = req.query.date || '';
  const canEnter = req.scope.level >= 0;

  const users = usersRepo.list();
  const userById = new Map(users.map((u) => [u.id, u]));

  let own = salesReportsRepo.get(req.user.id, today);
  if (own) {
    own = { ...own, userName: req.user.name, territory: territoryNamesForUser(req.user.id) };
  }

  const all = dateParam ? salesReportsRepo.listForDate(dateParam) : salesReportsRepo.listForMonth(month);
  const reports = all
    .filter((r) => {
      if (scope.scopeAll) return true;
      return territoryNamesForUser(r.userId).some((name) => scope.territoryNames.has(name));
    })
    .map((r) => {
      const u = userById.get(r.userId);
      return {
        ...r,
        userName: u ? u.name : '',
        territory: territoryNamesForUser(r.userId),
      };
    });

  res.json({ today, canEnter, own, reports });
}));

router.post('/sales-report', asyncHandler(async (req, res) => {
  const t = dates.tzParts();
  const today = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  if (req.scope.level < 0) throw forbidden('Only field employees can enter a sales report');

  const { actualVisitPlan, salesProjectionMt, depositProjectionBdt, actualSalesMt, actualCollectionBdt, taDaDetails, taDaBill, submitProjection, submitActual } = req.body || {};
  const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

  const existing = salesReportsRepo.get(req.user.id, today);

  // Projection lock: after projection submit, projection fields can't change.
  if (existing && existing.projectionSubmittedAt) {
    const projChanged = (actualVisitPlan != null && String(actualVisitPlan) !== (existing.actualVisitPlan || ''))
      || (salesProjectionMt != null && salesProjectionMt !== '' && numOrNull(salesProjectionMt) !== existing.salesProjectionMt)
      || (depositProjectionBdt != null && depositProjectionBdt !== '' && numOrNull(depositProjectionBdt) !== existing.depositProjectionBdt);
    if (projChanged) throw forbidden('Projection is already submitted and cannot be changed');
  }
  // Actual lock: after actual submit, actual + TA/DA fields can't change.
  if (existing && existing.actualSubmittedAt) {
    const actualChanged = (actualSalesMt != null && actualSalesMt !== '' && numOrNull(actualSalesMt) !== existing.actualSalesMt)
      || (actualCollectionBdt != null && actualCollectionBdt !== '' && numOrNull(actualCollectionBdt) !== existing.actualCollectionBdt)
      || (taDaDetails != null && String(taDaDetails) !== (existing.taDaDetails || ''))
      || (taDaBill != null && String(taDaBill) !== (existing.taDaBill || ''));
    if (actualChanged) throw forbidden('Actual is already submitted and cannot be changed');
  }

  let visitSchedule = existing ? existing.visitSchedule : null;
  if (!existing) {
    const user = usersRepo.findById(req.user.id);
    visitSchedule = user ? tourPlanSheetService.visitScheduleForEmail(user.email, user.name, t.d) : '';
  }

  const now = new Date().toISOString();
  const report = salesReportsRepo.upsert(req.user.id, today, {
    visitSchedule,
    actualVisitPlan: actualVisitPlan == null ? null : String(actualVisitPlan),
    salesProjectionMt: numOrNull(salesProjectionMt),
    depositProjectionBdt: numOrNull(depositProjectionBdt),
    actualSalesMt: numOrNull(actualSalesMt),
    actualCollectionBdt: numOrNull(actualCollectionBdt),
    taDaDetails: taDaDetails == null ? null : String(taDaDetails),
    taDaBill: taDaBill == null ? null : String(taDaBill),
    projectionSubmittedAt: submitProjection ? now : (existing ? existing.projectionSubmittedAt : null),
    actualSubmittedAt: submitActual ? now : (existing ? existing.actualSubmittedAt : null),
  });

  // Push the full sales-report table to the Google Sheet immediately so the
  // backup is always current (no dependence on the office bridge's 5-min sync).
  if (process.env.SALES_REPORT_SHEET_SYNC !== 'false') {
    try {
      await salesReportSheetService.syncToSheet();
    } catch (e) {
      logger.warn('[sales-report] sheet sync failed:', e.message);
    }
  }

  res.json({ report });
}));

function territoryNamesForUser(userId) {
  return userTerritoriesRepo.listForUser(userId).map((t) => String(t.name).toLowerCase());
}

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
