'use strict';

const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const { createApp } = require('./app');
const syncService = require('./services/syncService');
const mcp = require('./mcp/client');

let syncTimer = null;

async function main() {
  // Initialize the app database (creates schema + seeds admin/roles).
  getDb();
  logger.info('[boot] app database ready:', config.db.path);

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`[boot] ${config.app.company} — ${config.app.name} (${config.app.channel}) listening on :${config.port}`);
  });

  // Initial data sync (best effort — the app still serves if the source is down).
  const boot = await syncService.bootstrap();
  if (boot.ok) {
    logger.info('[boot] initial data sync complete');
  } else {
    logger.warn('[boot] initial data sync unavailable:', boot.error);
  }

  // 5-minute automatic refresh loop.
  if (config.sync.enabled) {
    syncTimer = setInterval(() => {
      syncService.refresh().catch(() => {});
    }, config.sync.intervalMs);
    syncTimer.unref?.();
    logger.info(`[boot] auto-refresh scheduled every ${config.sync.intervalMs}ms`);
  }

  const shutdown = () => {
    logger.info('[boot] shutting down');
    if (syncTimer) clearInterval(syncTimer);
    try { mcp.close(); } catch (_) { /* ignore */ }
    server.close(() => {});
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('[boot] fatal error:', err.stack || err.message);
  process.exit(1);
});
