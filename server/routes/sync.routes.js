'use strict';

const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { badRequest } = require('../lib/errors');
const syncService = require('../services/syncService');
const syncRepo = require('../repos/sync');
const metadataService = require('../services/metadataService');
const salesReportsRepo = require('../repos/salesReports');
const usersRepo = require('../repos/users');
const userTerritoriesRepo = require('../repos/userTerritories');
const deliverySchedulesRepo = require('../repos/deliverySchedules');

const router = express.Router();

function checkSecret(req) {
  const secret = req.headers['x-sync-secret'] || (req.body && req.body.secret);
  return secret && secret === config.sync.secret;
}

/**
 * Secure ingest endpoint for the external sync bridge.
 * The bridge (running where the DWH is reachable) POSTs snapshots here every
 * 5 minutes, so the app can serve data even when the DWH is not reachable
 * from the app host (e.g. Vercel serverless).
 */
router.post('/ingest', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const { orders, deliveries, territories, credit, territoryTarget, tourPlan } = req.body || {};
  if (!Array.isArray(orders) || !Array.isArray(deliveries)) {
    throw badRequest('orders and deliveries arrays are required');
  }
  await syncService.applyRemoteSnapshot({
    orders,
    deliveries,
    territories: Array.isArray(territories) ? territories : null,
    credit: Array.isArray(credit) ? credit : null,
    territoryTarget: territoryTarget || null,
    tourPlan: tourPlan || null,
  });
  res.json({ ok: true, sync: syncRepo.get() });
}));

router.get('/status', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  res.json({ sync: syncRepo.get() });
}));

// Export all sales reports (for the bridge to back up to Google Sheets).
router.get('/sales-reports', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const reports = salesReportsRepo.listAll();
  const users = usersRepo.list();
  const userById = new Map(users.map((u) => [u.id, u]));
  const enriched = reports.map((r) => {
    const u = userById.get(r.userId);
    return {
      ...r,
      name: u ? u.name : '',
      territory: userTerritoriesRepo.listForUser(r.userId).map((t) => t.name).join(', '),
    };
  });
  res.json({ reports: enriched });
}));

// Export delivery schedules for the office bridge's Google Sheet backup.
router.get('/delivery-schedules', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  res.json({ schedules: deliverySchedulesRepo.listAll() });
}));

// Restore delivery schedules from the Google Sheet backup after a DB reset.
router.post('/delivery-schedules/import', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const schedules = Array.isArray(req.body && req.body.schedules) ? req.body.schedules : [];
  const users = usersRepo.list();
  const byName = new Map(users.map((u) => [String(u.name).trim().toLowerCase(), u]));
  const num = (v) => (v == null || v === '' ? null : Number(v));
  let imported = 0;
  let skipped = 0;
  for (const s of schedules) {
    const user = byName.get(String(s.submittedBy || '').trim().toLowerCase());
    if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.deliveryDate || ''))) {
      skipped++;
      continue;
    }
    const lines = (Array.isArray(s.lines) ? s.lines : []).map((l) => ({
      orderNo: l.orderNo == null ? null : String(l.orderNo),
      customer: l.customer == null ? null : String(l.customer),
      territory: l.territory == null ? null : String(l.territory),
      item: l.item == null ? null : String(l.item),
      uom: l.uom == null ? null : String(l.uom),
      weight: num(l.weight),
      orderQtyBags: num(l.orderQtyBags),
      pendingQtyBags: num(l.pendingQtyBags),
      scheduleQtyBags: num(l.scheduleQtyBags),
    })).filter((l) => l.orderNo && l.item);
    if (!lines.length) {
      skipped++;
      continue;
    }
    deliverySchedulesRepo.restoreSchedule(user.id, s.deliveryDate, s.submittedAt || null, s.chatStatus || 'pending', lines, s.remarks || null);
    imported++;
  }
  res.json({ imported, skipped });
}));

// Restore sales reports from the Google Sheet backup after a DB reset.
router.post('/sales-reports/import', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const rows = Array.isArray(req.body && req.body.reports) ? req.body.reports : [];
  const users = usersRepo.list();
  const byName = new Map(users.map((u) => [String(u.name).trim().toLowerCase(), u]));
  let imported = 0;
  let skipped = 0;
  for (const r of rows) {
    const user = byName.get(String(r.name || r.employee || '').trim().toLowerCase());
    if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) {
      skipped++;
      continue;
    }
    const num = (v) => (v == null || v === '' ? null : Number(v));
    salesReportsRepo.upsert(user.id, r.date, {
      visitSchedule: r.visitSchedule == null ? null : String(r.visitSchedule),
      actualVisitPlan: r.actualVisitPlan == null ? null : String(r.actualVisitPlan),
      salesProjectionMt: num(r.salesProjectionMt),
      depositProjectionBdt: num(r.depositProjectionBdt),
      actualSalesMt: num(r.actualSalesMt),
      actualCollectionBdt: num(r.actualCollectionBdt),
      taDaDetails: r.taDaDetails == null ? null : String(r.taDaDetails),
      taDaBill: num(r.taDaBill),
      projectionSubmittedAt: r.projectionSubmittedAt || null,
      actualSubmittedAt: r.actualSubmittedAt || null,
    });
    imported++;
  }
  res.json({ imported, skipped });
}));

// Replace all sales reports (clear + import by name). Recovery tool.
router.post('/sales-reports/replace', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const rows = Array.isArray(req.body && req.body.reports) ? req.body.reports : [];
  salesReportsRepo.clearAll();
  const users = usersRepo.list();
  const byName = new Map(users.map((u) => [String(u.name).trim().toLowerCase(), u]));
  let imported = 0;
  let skipped = 0;
  for (const r of rows) {
    const user = byName.get(String(r.name || r.employee || '').trim().toLowerCase());
    if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) {
      skipped++;
      continue;
    }
    const num = (v) => (v == null || v === '' ? null : Number(v));
    salesReportsRepo.upsert(user.id, r.date, {
      visitSchedule: r.visitSchedule == null ? null : String(r.visitSchedule),
      actualVisitPlan: r.actualVisitPlan == null ? null : String(r.actualVisitPlan),
      salesProjectionMt: num(r.salesProjectionMt),
      depositProjectionBdt: num(r.depositProjectionBdt),
      actualSalesMt: num(r.actualSalesMt),
      actualCollectionBdt: num(r.actualCollectionBdt),
      taDaDetails: r.taDaDetails == null ? null : String(r.taDaDetails),
      taDaBill: num(r.taDaBill),
      projectionSubmittedAt: r.projectionSubmittedAt || null,
      actualSubmittedAt: r.actualSubmittedAt || null,
    });
    imported++;
  }
  res.json({ imported, skipped });
}));

// App metadata export (users/roles/territories/targets/config) for the bridge backup.
router.get('/metadata', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  res.json(metadataService.exportMetadata());
}));

// App metadata restore (bridge pushes the backup back after a DB reset).
router.post('/metadata', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  const meta = req.body || {};
  if (!Array.isArray(meta.users)) throw badRequest('users array is required');
  // Ensure the territory hierarchy exists before restoring assignments,
  // otherwise territory codes cannot resolve and assignments are lost.
  try { await syncService.importTerritories(); } catch (e) { /* non-fatal */ }
  metadataService.importMetadata(meta);
  res.json({ ok: true, users: meta.users.length });
}));

module.exports = router;
