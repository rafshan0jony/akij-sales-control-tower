'use strict';

const sql = require('mssql');
const config = require('../config');
const logger = require('../logger');
const { TABLES, COLUMNS } = require('./schema');

const H = COLUMNS.salesOrderHeader;
const R = COLUMNS.salesOrderRow;
const DH = COLUMNS.deliveryHeader;
const DR = COLUMNS.deliveryRow;
const TI = COLUMNS.territoryInfo;

let pool = null;
let connecting = null;
let lastError = null;

function poolConfig() {
  return {
    server: config.mssql.server,
    port: config.mssql.port,
    user: config.mssql.user,
    password: config.mssql.password,
    database: config.mssql.database,
    options: {
      encrypt: config.mssql.encrypt,
      trustServerCertificate: config.mssql.trustServerCertificate,
      enableArithAbort: true,
    },
    connectionTimeout: config.mssql.connectionTimeout,
    requestTimeout: config.mssql.requestTimeout,
    pool: { max: 10, min: 0, idleTimeoutMillis: 60000 },
  };
}

async function getPool() {
  if (pool) return pool;
  if (!connecting) {
    connecting = (async () => {
      const p = new sql.ConnectionPool(poolConfig());
      p.on('error', (err) => {
        logger.error('[mcp] pool error', err.message);
        pool = null;
      });
      try {
        await p.connect();
        pool = p;
        return p;
      } catch (err) {
        try { await p.close(); } catch (_) { /* ignore */ }
        throw err;
      } finally {
        connecting = null;
      }
    })();
  }
  return connecting;
}

function close() {
  if (pool) { pool.close().catch(() => {}); pool = null; }
}

async function query(text, inputs = []) {
  const p = await getPool();
  const req = p.request();
  for (const { name, type, value } of inputs) req.input(name, type, value);
  const result = await req.query(text);
  return result.recordset;
}

async function queryOne(text, inputs = []) {
  const rows = await query(text, inputs);
  return rows && rows.length ? rows[0] : null;
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
    LEFT JOIN (
      SELECT dr.[${DR.orderId}] AS salesOrderId, dr.[${DR.salesOrderRowId}] AS salesOrderRowId,
             SUM(dr.[${DR.quantity}]) AS challanQty
      FROM ${TABLES.deliveryHeader} dh
      INNER JOIN ${TABLES.deliveryRow} dr ON dh.[${DH.id}] = dr.[${DR.deliveryId}]
      WHERE dh.[${DH.channel}] = @channel AND dh.[${DH.active}] = 1 AND dh.[${DH.shipmentPosted}] = 1
      GROUP BY dr.[${DR.orderId}], dr.[${DR.salesOrderRowId}]
    ) d ON d.salesOrderId = h.[${H.id}] AND d.salesOrderRowId = r.[${R.rowId}]
    WHERE h.[${H.channel}] = @channel
      AND h.[${H.date}] >= @from AND h.[${H.date}] <= @to
      AND h.[${H.active}] = 1
    ORDER BY h.[${H.date}], h.[${H.orderNo}]
  `;
  return query(q, [
    { name: 'channel', type: sql.BigInt, value: channelId },
    { name: 'from', type: sql.NVarChar, value: from },
    { name: 'to', type: sql.NVarChar, value: to },
  ]);
}

/**
 * Delivery facts for a date range.
 * Territory resolved via the delivery row -> sales order -> territory join.
 */
async function getDeliveries(from, to, channelId = config.app.channelId) {
  const q = `
    SELECT
      CONVERT(varchar(10), h.[${DH.date}], 120) AS date,
      h.[${DH.customer}] AS customer,
      t.[${TI.name}] AS territory,
      'Delivered' AS status,
      r.[${DR.orderNo}] AS orderNo,
      r.[${DR.item}] AS item,
      r.[${DR.uom}] AS uom,
      r.[${DR.quantity}] AS quantity,
      r.[${DR.value}] AS value
    FROM ${TABLES.deliveryHeader} h
    INNER JOIN ${TABLES.deliveryRow} r ON h.[${DH.id}] = r.[${DR.deliveryId}]
    LEFT JOIN ${TABLES.salesOrderHeader} so ON so.[${H.id}] = r.[${DR.orderId}]
    LEFT JOIN ${TABLES.territoryInfo} t ON t.[${TI.id}] = so.[${H.territoryId}]
    WHERE h.[${DH.channel}] = @channel
      AND h.[${DH.date}] >= @from AND h.[${DH.date}] <= @to
      AND h.[${DH.active}] = 1
      AND h.[${DH.shipmentPosted}] = 1
    ORDER BY h.[${DH.date}]
  `;
  return query(q, [
    { name: 'channel', type: sql.BigInt, value: channelId },
    { name: 'from', type: sql.NVarChar, value: from },
    { name: 'to', type: sql.NVarChar, value: to },
  ]);
}

/**
 * Territory hierarchy for a channel.
 * Returns rows: { national, regionId, region, zoneId, zone, territoryId, territory }.
 * Levels: L1 national, L5 region, L6 zone, L7 territory.
 */
async function getTerritoryHierarchy(channelId = config.app.channelId) {
  const q = `
    SELECT DISTINCT
      NL1 AS nationalName,
      L5 AS regionId, NL5 AS region,
      L6 AS zoneId, NL6 AS zone,
      L7 AS territoryId, NL7 AS territory
    FROM ${TABLES.territorySetup}
    WHERE intChannelId = @channel AND intLevelId = 7 AND isActive = 1
      AND NL7 IS NOT NULL
    ORDER BY region, zone, territory
  `;
  return query(q, [{ name: 'channel', type: sql.BigInt, value: channelId }]);
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
      terr.strTerritoryName AS territory,
      d.lastDeliveryDate,
      pc.lastPaymentDate,
      dd.deliveryWithinCreditDays
    FROM prt.tblBusinessPartnerSalesArc s
    INNER JOIN prt.tblBusinessPartnerArc p ON p.intBusinessPartnerId = s.intBusinessPartnerId
    LEFT JOIN (
      SELECT strSubGlCode, SUM(numAmount) AS ledgerBalance
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
      GROUP BY strSubGlCode
    ) gl ON gl.strSubGlCode = p.strBusinessPartnerCode
    LEFT JOIN (
      SELECT intSoldToPartnerId, MAX(dteLastActionDateTime) AS lastDeliveryDate
      FROM sms.tblDeliveryHeaderArc
      WHERE intDistributionChannelId = @channel AND isActive = 1 AND isShipmentPosted = 1
      GROUP BY intSoldToPartnerId
    ) d ON d.intSoldToPartnerId = p.intBusinessPartnerId
    LEFT JOIN (
      SELECT intSoldToPartnerId, MAX(dteCollectionDate) AS lastPaymentDate
      FROM sms.tblDeliveryHeaderArc
      WHERE intDistributionChannelId = @channel AND isActive = 1
        AND dteCollectionDate IS NOT NULL AND dteCollectionDate <= CAST(GETDATE() AS date)
      GROUP BY intSoldToPartnerId
    ) pc ON pc.intSoldToPartnerId = p.intBusinessPartnerId
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
  return query(q, [{ name: 'channel', type: sql.BigInt, value: channelId }]);
}

module.exports = {
  getPool,
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
