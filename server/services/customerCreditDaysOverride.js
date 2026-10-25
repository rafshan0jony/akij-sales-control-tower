'use strict';

/**
 * Credit days override (source: hardcoded map).
 * Fixes ERP data entry errors where numRunningDayLimit is wrong.
 * Maps customerCode -> correct credit days.
 */
const OVERRIDES = {
  '22216504': 30, // M/S Nur-A-Nobobi Trading: ERP has 7, should be 30
};

function creditDaysFor(customerCode) {
  if (customerCode == null) return null;
  return OVERRIDES[String(customerCode).trim()] || null;
}

module.exports = { creditDaysFor };