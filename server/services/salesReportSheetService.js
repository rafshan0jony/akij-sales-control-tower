'use strict';

const salesReportsRepo = require('../repos/salesReports');
const usersRepo = require('../repos/users');
const userTerritoriesRepo = require('../repos/userTerritories');
const googleSheets = require('./googleSheetsService');

const HEADER = ['Date', 'Employee', 'Territory', 'Visit Schedule', 'Actual Visit Plan', 'Sales Projection (MT)', 'Deposit Projection (BDT)', 'Actual Sales (MT)', 'Actual Collection (BDT)', 'TA/DA Details', 'TA/DA Bill', 'Projection Submitted', 'Actual Submitted'];

function enrichedReports() {
  const users = usersRepo.list();
  const userById = new Map(users.map((u) => [u.id, u]));
  return salesReportsRepo.listAll().map((r) => {
    const u = userById.get(r.userId);
    return {
      ...r,
      name: u ? u.name : '',
      territory: userTerritoriesRepo.listForUser(r.userId).map((t) => t.name).join(', '),
    };
  });
}

function toRows(reports) {
  return reports.map((r) => [
    r.date || '',
    r.name || '',
    r.territory || '',
    r.visitSchedule || '',
    r.actualVisitPlan || '',
    r.salesProjectionMt == null ? '' : r.salesProjectionMt,
    r.depositProjectionBdt == null ? '' : r.depositProjectionBdt,
    r.actualSalesMt == null ? '' : r.actualSalesMt,
    r.actualCollectionBdt == null ? '' : r.actualCollectionBdt,
    r.taDaDetails || '',
    r.taDaBill == null ? '' : r.taDaBill,
    r.projectionSubmittedAt || '',
    r.actualSubmittedAt || '',
  ]);
}

async function syncToSheet() {
  await googleSheets.overwriteSalesReports(HEADER, toRows(enrichedReports()));
}

module.exports = { HEADER, enrichedReports, toRows, syncToSheet };
