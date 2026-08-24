'use strict';

const dates = require('../lib/dates');
const syncRepo = require('../repos/sync');

/** Parse ?filter= and ?from=&to= into a resolved date range. */
function parseRange(req) {
  const filter = req.query.filter || 'this_month';
  const custom = req.query.from && req.query.to ? { from: req.query.from, to: req.query.to } : null;
  return { filter, custom, range: dates.resolveRange(filter, custom) };
}

/** Freshness metadata attached to every data response. */
function freshness() {
  const s = syncRepo.get();
  if (!s) return { lastUpdated: null, dataSource: 'MCP', refreshStatus: 'IDLE' };
  return {
    lastUpdated: s.lastUpdated,
    dataSource: s.dataSource,
    refreshStatus: (s.status || 'IDLE').toUpperCase(),
  };
}

module.exports = { parseRange, freshness };
