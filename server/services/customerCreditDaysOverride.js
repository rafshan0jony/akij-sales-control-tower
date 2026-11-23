'use strict';

/**
 * Credit days override (source: hardcoded map).
 * Fixes ERP data entry errors where numRunningDayLimit is wrong.
 * Maps customerCode -> correct credit days.
 */
const OVERRIDES = {
  '22216504': 30, // M/S Nur-A-Nobobi Trading: ERP numRunningDayLimit=7, should be 30
  '222125277': 30, // Nokul Trader's: ERP numRunningDayLimit=7, should be 30
  '222115814': 30, // M/S Hazi Alauddin Rice Agnency: ERP numRunningDayLimit=0, should be 30
  '222110817': 30, // M/S Niloy Rice Agency: ERP numRunningDayLimit=0, should be 30
  '4398911': 7, // M/S Bhagabati Bhander COD: ERP numRunningDayLimit=0, should be 7
  '396217': 30, // M/S Ruposhi Bangla Traders COD: ERP facility=Cash/intCollectionDays=7, should be 30
};

function creditDaysFor(customerCode) {
  if (customerCode == null) return null;
  return OVERRIDES[String(customerCode).trim()] || null;
}

module.exports = { creditDaysFor };