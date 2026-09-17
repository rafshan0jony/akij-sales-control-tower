'use strict';

/**
 * Customer-code -> system-territory-name overrides.
 * Fixes DWH territory mistakes for specific customers: when the DWH sales
 * orders carry the wrong intTerritoryId, override the territory used for
 * reporting (sales / delivery / credit all honour this).
 */
const OVERRIDES = {
  '222133300': 'Narsingdi',
};

function territoryFor(customerCode) {
  if (customerCode == null) return null;
  return OVERRIDES[String(customerCode).trim()] || null;
}

module.exports = { territoryFor };
