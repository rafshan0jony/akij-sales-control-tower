'use strict';

/**
 * Territory mapping (source: Google Sheet "territory maping").
 * Maps the DWH "system territory" (column A) to the reporting hierarchy:
 *   system territory (A) -> actual territory (B) -> area (C) -> region (D)
 */
const mapping = require('../data/territoryMapping.json');

// Fallback for DWH territories present in the data but missing from the sheet.
// (Bogura Metro / Naogaon live in DWH "North Region > Rajshahi".)
// Confirm with the user and remove once the sheet is updated.
const FALLBACK = [
  { system: 'Bogura Metro', territory: 'Bogura Metro', area: 'Rajshahi Area', region: 'South & North Region' },
  { system: 'Naogaon', territory: 'Naogaon', area: 'Rajshahi Area', region: 'South & North Region' },
];

const allRows = [...mapping.rows, ...FALLBACK];

const bySystem = new Map();
for (const r of allRows) {
  bySystem.set(String(r.system).trim().toLowerCase(), r);
}

function map(systemName) {
  if (systemName == null) return null;
  return bySystem.get(String(systemName).trim().toLowerCase()) || null;
}

/** Return { territory, area, region, systemTerritory } for a raw DWH territory name. */
function resolve(rawName) {
  const m = map(rawName);
  const raw = rawName == null ? null : String(rawName).trim();
  if (!m) {
    return { territory: raw || 'Unassigned', area: 'Unassigned', region: 'Unassigned', systemTerritory: raw };
  }
  return { territory: m.territory, area: m.area, region: m.region, systemTerritory: raw };
}

function list() {
  return allRows;
}

function regions() {
  return [...new Set(allRows.map((r) => r.region))].sort();
}

function areas() {
  return [...new Set(allRows.map((r) => r.area))].sort();
}

function territories() {
  return [...new Set(allRows.map((r) => r.territory))].sort();
}

module.exports = { map, resolve, list, regions, areas, territories };
