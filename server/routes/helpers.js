'use strict';

const dates = require('../lib/dates');
const syncRepo = require('../repos/sync');
const territoryMappingService = require('../services/territoryMappingService');

/**
 * Narrow a user's scope to the selected region / area / territory.
 * The selection resolves to the set of territory names under it (a region or
 * area expands to all its territories).
 */
function narrowScope(scope, territory) {
  if (!scope) return scope;
  if (!territory || territory === 'All' || territory === '') return scope;
  const sel = String(territory).toLowerCase().trim();

  const terrNames = new Set();
  for (const r of territoryMappingService.list()) {
    const terr = String(r.territory).toLowerCase();
    const area = String(r.area).toLowerCase();
    const region = String(r.region).toLowerCase();
    if (sel === region || sel === area || sel === terr) terrNames.add(terr);
  }
  if (!terrNames.size) terrNames.add(sel); // fallback: treat as a plain territory name

  if (scope.scopeAll) {
    return { ...scope, scopeAll: false, territoryNames: terrNames };
  }
  const permitted = new Set([...terrNames].filter((t) => scope.territoryNames.has(t)));
  return { ...scope, scopeAll: false, territoryNames: permitted };
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
