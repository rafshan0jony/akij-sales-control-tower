'use strict';

const dates = require('../lib/dates');
const syncRepo = require('../repos/sync');

/** Narrow a user's scope to a single territory (when a territory is selected). */
function narrowScope(scope, territory) {
  if (!scope) return scope;
  if (!territory || territory === 'All' || territory === '') return scope;
  const name = String(territory).toLowerCase().trim();
  if (scope.scopeAll) {
    return { ...scope, scopeAll: false, territoryNames: new Set([name]) };
  }
  if (scope.territoryNames.has(name)) {
    return { ...scope, scopeAll: false, territoryNames: new Set([name]) };
  }
  return scope;
}

/** Parse ?filter= and ?from=&to= into a resolved date range. */
function parseRange(req) {
  const filter = req.query.filter || 'this_month';
  const custom = req.query.from && req.query.to ? { from: req.query.from, to: req.query.to } : null;
  const territory = req.query.territory || '';
  return {
    filter,
    custom,
    range: dates.resolveRange(filter, custom),
    territory,
    scope: narrowScope(req.scope, territory),
  };
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

module.exports = { parseRange, freshness, narrowScope };
