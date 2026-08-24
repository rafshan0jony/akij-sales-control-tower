'use strict';

const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { badRequest } = require('../lib/errors');
const syncService = require('../services/syncService');
const syncRepo = require('../repos/sync');

const router = express.Router();

/**
 * Secure ingest endpoint for the external sync bridge.
 * The bridge (running where the DWH is reachable) POSTs snapshots here every
 * 5 minutes, so the app can serve data even when the DWH is not reachable
 * from the app host (e.g. Vercel serverless).
 */
router.post('/ingest', asyncHandler(async (req, res) => {
  const secret = req.headers['x-sync-secret'] || (req.body && req.body.secret);
  if (!secret || secret !== config.sync.secret) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  const { orders, deliveries, territories } = req.body || {};
  if (!Array.isArray(orders) || !Array.isArray(deliveries)) {
    throw badRequest('orders and deliveries arrays are required');
  }
  await syncService.applyRemoteSnapshot({ orders, deliveries, territories: Array.isArray(territories) ? territories : null });
  res.json({ ok: true, sync: syncRepo.get() });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const secret = req.headers['x-sync-secret'];
  if (!secret || secret !== config.sync.secret) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  res.json({ sync: syncRepo.get() });
}));

module.exports = router;
