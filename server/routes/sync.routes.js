'use strict';

const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { badRequest } = require('../lib/errors');
const syncService = require('../services/syncService');
const syncRepo = require('../repos/sync');
const metadataService = require('../services/metadataService');

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
  const { orders, deliveries, territories, credit, territoryTarget } = req.body || {};
  if (!Array.isArray(orders) || !Array.isArray(deliveries)) {
    throw badRequest('orders and deliveries arrays are required');
  }
  await syncService.applyRemoteSnapshot({
    orders,
    deliveries,
    territories: Array.isArray(territories) ? territories : null,
    credit: Array.isArray(credit) ? credit : null,
    territoryTarget: territoryTarget || null,
  });
  res.json({ ok: true, sync: syncRepo.get() });
}));

router.get('/status', asyncHandler(async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Invalid sync secret' });
  res.json({ sync: syncRepo.get() });
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
  metadataService.importMetadata(meta);
  res.json({ ok: true, users: meta.users.length });
}));

module.exports = router;
