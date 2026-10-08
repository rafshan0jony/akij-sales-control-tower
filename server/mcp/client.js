'use strict';

const sql = require('mssql');
const config = require('../config');
const logger = require('../logger');
const { TABLES, COLUMNS } = require('./schema');
const territoryMapping = require('../services/territoryMappingService');
const customerTerritoryOverride = require('../services/customerTerritoryOverride');

const H = COLUMNS.salesOrderHeader;
const R = COLUMNS.salesOrderRow;
const DH = COLUMNS.deliveryHeader;
const DR = COLUMNS.deliveryRow;
const TI = COLUMNS.territoryInfo;

let lastError = null;

/** Resolve a raw ERP territory name (after customer-code override) to its final reporting territory. */
function resolveTerritoryName(rawTerritory, customerCode) {
  const tm = territoryMapping.resolve(customerTerritoryOverride.territoryFor(customerCode) || rawTerritory);
  return tm ? tm.territory : (rawTerritory == null ? null : rawTerritory);
}

const API_URL = process.env.ENTERPRISE_API_URL || 'https://enterprise-api-gateway.ibos.agency/mcp';
const API_KEY = process.env.ENTERPRISE_API_KEY || 'ak_live_agJ16x8qFRq0OIGFMbIC8ipv_OcYTGMZYehTPp1VZlU';
const DEVICE_ID = process.env.ENTERPRISE_DEVICE_ID || '948716142c1d4cdd8bb947b13179161f';
let _reqId = 0;

async function mcpCall(method, params) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + API_KEY,
      'X-Device-Id': DEVICE_ID,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_reqId, method, params }),
  });
  if (!res.ok) throw new Error('MCP HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'MCP error');
  return json.result;
}

function close() {
  // HTTP-based client has no persistent connection to close.
}

async function query(text, inputs = []) {
  // Strip the DWH "Arc" table suffix so the same queries run against live iBOS.
  let sqlText = text.replace(/Arc\b/g, '');
  for (const { name, value } of inputs) {
    const literal = (typeof value === 'number')
      ? String(value)
      : "'" + String(value).replace(/'/g, "''") + "'";
    sqlText = sqlText.replace(new RegExp('@' + name + '\\b', 'g'), literal);
  }
  const result = await mcpCall('tools/call', {
    name: 'execute_readonly_query',
    arguments: { sql: sqlText, limit: 500 },
  });
  const textPart = (result.content || []).find((c) => c.type === 'text');
  if (!textPart) return [];
  try {
    return JSON.parse(textPart.text).rows || [];
  } catch (_) {
    return [];
  }
}

/** Run a query with OFFSET/FETCH pagination to fetch all rows (beyond the 500 cap). */
async function queryAll(text, inputs = []) {
  const all = [];
  const batch = 500;
  let offset = 0;
  for (;;) {
    const rows = await query(`${text} OFFSET ${offset} ROWS FETCH NEXT ${batch} ROWS ONLY`, inputs);
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

async function queryOne(text, inputs = []) {
  const rows = await query(text, inputs);
  return rows && rows.length ? rows[0] : null;
}

/** Run a `WHERE col IN (...)` lookup across many ids, chunked to stay under the 500-row cap. */
async function queryChunkedIn(sqlPrefix, idList, sqlSuffix = '') {
  const unique = [...new Set(idList.filter((x) => x != null && x !== ''))];
  const all = [];
  for (let i = 0; i < unique.length; i += 450) {
    const chunk = unique.slice(i, i + 450).map(Number).join(',');
    const rows = await query(`${sqlPrefix} IN (${chunk})${sqlSuffix}`, []);
    all.push(...rows);
  }
  return all;
}

async function health() {
  try {
    await queryOne('SELECT 1 AS ok');
    lastError = null;
    return { ok: true };
  } catch (err) {
    lastError = err.message;
    return { ok: false, error: err.message };
  }
}

function getLastError() {
  return lastError;
}

// ---------------------------------------------------------------------------
// Normalized fact queries
// ---------------------------------------------------------------------------

/**
 * Sales-order facts for a date range.
 * Territory name resolved via rtm.tblTerritoryInfoArc.
 * Pending fields are challan-based: delivered = challan'd (isShipmentPosted=1)
 * quantity, pending = order quantity - challan'd quantity (so a DO created but
 * not yet challan'd still shows as pending).
 */
async function getSalesOrders(from, to, channelId = config.app.channelId) {
  const q = `
    SELECT
      CONVERT(varchar(10), h.[${H.date}], 120) AS date,
      h.[${H.orderNo}] AS orderNo,
      h.[${H.customer}] AS customer,
      bp.strBusinessPartnerCode AS customerCode,
      t.[${TI.name}] AS territory,
      CASE WHEN h.[${H.isRejected}] = 1 THEN 'Rejected'
           WHEN h.[${H.isCompleted}] = 1 THEN 'Completed'
           ELSE 'Open' END AS status,
      r.[${R.item}] AS item,
      r.[${R.uom}] AS uom,
      r.[${R.quantity}] AS quantity,
      r.[${R.value}] AS value,
      r.[${R.price}] AS price,
      ISNULL(d.challanQty, 0) AS deliveredQty,
      r.[${R.quantity}] - ISNULL(d.challanQty, 0) AS undeliveredQty,
      r.[${R.value}] - ISNULL(d.challanQty, 0) * r.[${R.price}] AS undeliveredValue
    FROM ${TABLES.salesOrderHeader} h
    INNER JOIN ${TABLES.salesOrderRow} r ON h.[${H.id}] = r.[${R.orderId}]
    LEFT JOIN ${TABLES.territoryInfo} t ON t.[${TI.id}] = h.[${H.territoryId}]
    LEFT JOIN prt.tblBusinessPartnerArc bp ON bp.intBusinessPartnerId = h.intSoldToPartnerId
    LEFT JOIN (
      SELECT dr.[${DR.orderId}] AS salesOrderId, dr.[${DR.salesOrderRowId}] AS salesOrderRowId,
             SUM(dr.[${DR.quantity}]) AS challanQty
      FROM ${TABLES.deliveryHeader} dh
      INNER JOIN ${TABLES.deliveryRow} dr ON dh.[${DH.id}] = dr.[${DR.deliveryId}]
      WHERE dh.[${DH.channel}] = @channel AND dh.[${DH.active}] = 1 AND dh.[${DH.shipmentPosted}] = 1
        AND dh.[${DH.date}] >= @from
      GROUP BY dr.[${DR.orderId}], dr.[${DR.salesOrderRowId}]
    ) d ON d.salesOrderId = h.[${H.id}] AND d.salesOrderRowId = r.[${R.rowId}]
    WHERE h.[${H.channel}] = @channel
      AND h.[${H.date}] >= @from AND h.[${H.date}] <= @to
      AND h.[${H.active}] = 1
    ORDER BY h.[${H.date}], h.[${H.orderNo}]
  `;
  const rows = await queryAll(q, [
    { name: 'channel', type: sql.BigInt, value: channelId },
    { name: 'from', type: sql.NVarChar, value: from },
    { name: 'to', type: sql.NVarChar, value: to },
  ]);
  return rows.map((r) => ({ ...r, territory: resolveTerritoryName(r.territory, r.customerCode) }));
}

/**
 * Delivery facts for a date range.
 * Territory resolved via the delivery row -> sales order -> territory join.
 */
async function getDeliveries(from, to, channelId = config.app.channelId) {
  // Delivery header + row only (unambiguous: delivery row has no intBusinessUnitId).
  const q = `
    SELECT
      CONVERT(varchar(10), h.[${DH.date}], 120) AS date,
      h.[${DH.customer}] AS customer,
      h.intSoldToPartnerId AS soldToPartnerId,
      r.intSalesOrderId AS salesOrderId,
      r.[${DR.orderNo}] AS orderNo,
      r.[${DR.item}] AS item,
      r.[${DR.uom}] AS uom,
      r.[${DR.quantity}] AS quantity,
      r.[${DR.value}] AS value
    FROM ${TABLES.deliveryHeader} h
    INNER JOIN ${TABLES.deliveryRow} r ON h.[${DH.id}] = r.[${DR.deliveryId}]
    WHERE h.[${DH.channel}] = @channel
      AND h.[${DH.date}] >= @from AND h.[${DH.date}] <= @to
      AND h.[${DH.active}] = 1
      AND h.[${DH.shipmentPosted}] = 1
    ORDER BY h.[${DH.date}]
  `;
  const rows = await queryAll(q, [
    { name: 'channel', type: sql.BigInt, value: channelId },
    { name: 'from', type: sql.NVarChar, value: from },
    { name: 'to', type: sql.NVarChar, value: to },
  ]);
  if (!rows.length) return [];

  const soIds = [...new Set(rows.map((r) => r.salesOrderId).filter((x) => x != null && x !== ''))];
  const partnerIds = [...new Set(rows.map((r) => r.soldToPartnerId).filter((x) => x != null && x !== ''))];

  // Territory: sales order -> territory id -> territory name (single-table queries).
  const terrIdBySo = new Map();
  if (soIds.length) {
    const soRows = await queryChunkedIn(
      `SELECT intSalesOrderId, intTerritoryId FROM ${TABLES.salesOrderHeader} WHERE intSalesOrderId`,
      soIds
    );
    for (const s of soRows) terrIdBySo.set(s.intSalesOrderId, s.intTerritoryId);
  }
  const terrNameById = new Map();
  const terrIds = [...new Set([...terrIdBySo.values()].filter((x) => x != null && x !== ''))];
  if (terrIds.length) {
    const terrRows = await queryChunkedIn(
      `SELECT intTerritoryId, strTerritoryName FROM ${TABLES.territoryInfo} WHERE intTerritoryId`,
      terrIds
    );
    for (const t of terrRows) terrNameById.set(t.intTerritoryId, t.strTerritoryName);
  }

  // Customer code (single-table business partner lookup).
  const codeByPartner = new Map();
  if (partnerIds.length) {
    const bpRows = await queryChunkedIn(
      `SELECT intBusinessPartnerId, strBusinessPartnerCode FROM prt.tblBusinessPartner WHERE intBusinessPartnerId`,
      partnerIds
    );
    for (const b of bpRows) codeByPartner.set(b.intBusinessPartnerId, b.strBusinessPartnerCode);
  }

  return rows.map((r) => ({
    date: r.date,
    customer: r.customer,
    customerCode: codeByPartner.get(r.soldToPartnerId) || null,
    territory: resolveTerritoryName(terrNameById.get(terrIdBySo.get(r.salesOrderId)) || null, codeByPartner.get(r.soldToPartnerId) || null),
    status: 'Delivered',
    orderNo: r.orderNo,
    item: r.item,
    uom: r.uom,
    quantity: r.quantity,
    value: r.value,
  }));
}

/**
 * Territory hierarchy for a channel.
 * Returns rows: { national, regionId, region, zoneId, zone, territoryId, territory }.
 * Levels: L1 national, L5 region, L6 zone, L7 territory.
 */
async function getTerritoryHierarchy() {
  // Territory hierarchy is derived from the static mapping (territoryMapping.json),
  // so this DWH query is no longer needed. Return empty.
  return [];
}

/**
 * Customer Credit Status for the Rice Bulk channel.
 * Returns partners who OWE money (positive ledger balance) with credit +
 * territory info.
 *
 * The ledger balance is the EXACT "Trade Receivable (Local)" sub-ledger
 * balance straight from the accounting journal (fin.tblAccountingJournalArc),
 * matching the ERP customer-ledger report 1:1:
 *   SUM(numAmount) where numAmount>0  -> Sales Journal (delivery) debit
 *                 where numAmount<0  -> Bank Receipts Journal (collection) credit
 * The stale numLedgerBalance field is NOT used. Delivery date / credit
 * window are challan-based (dteLastActionDateTime + isShipmentPosted=1).
 */
async function getCreditStatus(channelId = config.app.channelId) {
  const q = `
    SELECT
      p.strBusinessPartnerCode AS partnerCode,
      p.strBusinessPartnerName AS partnerName,
      s.numRunningDayLimit AS creditDays,
      gl.ledgerBalance AS ledgerBalance,
      CASE WHEN gl.ledgerBalance > ISNULL(rd.recentDebits, 0)
           THEN gl.ledgerBalance - ISNULL(rd.recentDebits, 0)
           ELSE 0 END AS overdue,
      terr.strTerritoryName AS territory,
      d.lastDeliveryDate,
      pc.lastPaymentDate,
      dd.deliveryWithinCreditDays
    FROM prt.tblBusinessPartnerSalesArc s
    INNER JOIN prt.tblBusinessPartnerArc p ON p.intBusinessPartnerId = s.intBusinessPartnerId
    LEFT JOIN (
      SELECT intSubGLId, SUM(numAmount) AS ledgerBalance
      FROM fin.tblAccountingJournalArc
      WHERE intGeneralLedgerId = (
        SELECT TOP 1 intGeneralLedgerId
        FROM fin.tblGeneralLedgerArc
        WHERE strGeneralLedgerCode = '1120001'
          AND strGeneralLedgerName = 'Trade Receivable (Local)'
          AND isActive = 1
        ORDER BY intGeneralLedgerId
      )
        AND isActive = 1
      GROUP BY intSubGLId
    ) gl ON gl.intSubGLId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT aj.intSubGLId, SUM(aj.numAmount) AS recentDebits
      FROM fin.tblAccountingJournalArc aj
      INNER JOIN prt.tblBusinessPartnerArc bp ON bp.intBusinessPartnerId = aj.intSubGLId
      INNER JOIN prt.tblBusinessPartnerSalesArc sc ON sc.intBusinessPartnerId = bp.intBusinessPartnerId
      WHERE aj.isActive = 1
        AND aj.intGeneralLedgerId = (
          SELECT TOP 1 intGeneralLedgerId
          FROM fin.tblGeneralLedgerArc
          WHERE strGeneralLedgerCode = '1120001'
            AND strGeneralLedgerName = 'Trade Receivable (Local)'
            AND isActive = 1
          ORDER BY intGeneralLedgerId
        )
        AND aj.numAmount > 0
        AND aj.dteTransactionDate > DATEADD(day, -ISNULL(sc.numRunningDayLimit, 0), CAST(GETDATE() AS date))
      GROUP BY aj.intSubGLId
    ) rd ON rd.intSubGLId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT intSoldToPartnerId, MAX(dteLastActionDateTime) AS lastDeliveryDate
      FROM sms.tblDeliveryHeaderArc
      WHERE intDistributionChannelId = @channel AND isActive = 1 AND isShipmentPosted = 1
      GROUP BY intSoldToPartnerId
    ) d ON d.intSoldToPartnerId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT aj.intSubGLId, MAX(aj.dteTransactionDate) AS lastPaymentDate
      FROM fin.tblAccountingJournalArc aj
      WHERE aj.intGeneralLedgerId = (
        SELECT TOP 1 intGeneralLedgerId
        FROM fin.tblGeneralLedgerArc
        WHERE strGeneralLedgerCode = '1120001'
          AND strGeneralLedgerName = 'Trade Receivable (Local)'
          AND isActive = 1
        ORDER BY intGeneralLedgerId
      )
        AND aj.isActive = 1
        AND aj.numAmount < 0
      GROUP BY aj.intSubGLId
    ) pc ON pc.intSubGLId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT h.intSoldToPartnerId,
             SUM(h.numTotalNetValue) AS deliveryWithinCreditDays
      FROM sms.tblDeliveryHeaderArc h
      INNER JOIN prt.tblBusinessPartnerSalesArc sc ON sc.intBusinessPartnerId = h.intSoldToPartnerId
      WHERE h.intDistributionChannelId = @channel AND h.isActive = 1 AND h.isShipmentPosted = 1
        AND h.dteLastActionDateTime >= DATEADD(day, -ISNULL(sc.numRunningDayLimit, 0), CAST(GETDATE() AS date))
      GROUP BY h.intSoldToPartnerId
    ) dd ON dd.intSoldToPartnerId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT x.intSoldToPartnerId, x.intTerritoryId
      FROM (
        SELECT intSoldToPartnerId, intTerritoryId,
               ROW_NUMBER() OVER (PARTITION BY intSoldToPartnerId ORDER BY dteSalesOrderDate DESC) AS rn
        FROM oms.tblSalesOrderHeaderArc
        WHERE intDistributionChannelId = @channel AND isActive = 1
      ) x
      WHERE x.rn = 1
    ) so ON so.intSoldToPartnerId = p.intBusinessPartnerId
    LEFT JOIN rtm.tblTerritoryInfoArc terr ON terr.intTerritoryId = so.intTerritoryId
    WHERE s.isActive = 1 AND gl.ledgerBalance > 0
      AND so.intSoldToPartnerId IS NOT NULL
      AND (s.strCreditFacilityType IS NULL OR s.strCreditFacilityType = 'Credit')
    ORDER BY gl.ledgerBalance DESC
  `;
  const rows = await query(q, [{ name: 'channel', type: sql.BigInt, value: channelId }]);
  return rows.map((r) => ({ ...r, territory: resolveTerritoryName(r.territory, r.partnerCode) }));
}

module.exports = {
  close,
  query,
  queryOne,
  health,
  getLastError,
  getSalesOrders,
  getDeliveries,
  getTerritoryHierarchy,
  getCreditStatus,
};
