'use strict';

/**
 * Territory target (source: Google Sheet "territory target" tab).
 * Provides monthly target (MT) per territory and per product variant.
 * A "National" row holds the national product totals for the month.
 * By-product targets are excluded from totals (matching the rest of the app).
 *
 * The data is dynamic: the sync bridge fetches the sheet and pushes the parsed
 * result to the app (see syncService.applyRemoteSnapshot -> setData). A static
 * snapshot (server/data/territoryTarget.json) is the fallback until then.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHEET_ID = '1uVeCRFTTw2GI7eljLvs0yj9NXM51g89CChZInpYtJ4c';
const TOKEN_PATH = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const BYPRODUCT = 'By-Product';
const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

let data = null;

function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeMonth(s) {
  const str = String(s || '').trim();
  const m = str.match(/^([A-Za-z]+)[\s-]*(\d{4})$/);
  if (!m) return '';
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return '';
  return `${m[2]}-${String(mo).padStart(2, '0')}`;
}

/** Parse the raw sheet values into { updatedAt, months, products, rows }. */
function parse(vals) {
  if (!vals || vals.length < 2) return { updatedAt: new Date().toISOString(), months: [], products: [], rows: [] };
  const header = vals[0];
  const products = [];
  for (let i = 2; i < header.length; i++) {
    const p = String(header[i] || '').trim();
    if (p) products.push(p);
  }
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i] || [];
    const month = normalizeMonth(row[0]);
    const territory = String(row[1] || '').trim();
    if (!month || !territory) continue;
    const targets = {};
    for (let j = 0; j < products.length; j++) targets[products[j]] = num(row[2 + j]);
    rows.push({ month, territory, targets });
  }
  const months = [...new Set(rows.map((r) => r.month))].sort();
  return { updatedAt: new Date().toISOString(), months, products, rows };
}

function load() {
  if (data) return data;
  try {
    data = require('../data/territoryTarget.json');
  } catch (_) {
    data = { updatedAt: '', months: [], products: [], rows: [] };
  }
  return data;
}

/** Replace the in-memory data (called when the bridge pushes fresh data). */
function setData(newData) {
  if (newData && newData.rows) data = newData;
}

/** Fetch + parse the "territory target" tab (runs on the office PC / bridge). */
async function fetchFromSheet() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('sheets token not found: ' + TOKEN_PATH);
  const { OAuth2Client } = require('google-auth-library');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const oauth = new OAuth2Client(token.client_id, token.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('territory target')}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];
  const parsed = parse(vals);
  data = parsed;
  return parsed;
}

function rowsForMonth(month) {
  return load().rows.filter((r) => r.month === month && r.territory !== 'National');
}

function nationalRow(month) {
  return load().rows.find((r) => r.month === month && r.territory === 'National') || null;
}

function productsList() {
  return load().products || [];
}

/** Sorted month list (YYYY-MM). */
function months() {
  return [...new Set(load().rows.map((r) => r.month))].sort();
}

/** Latest month available. */
function latestMonth() {
  const ms = months();
  return ms.length ? ms[ms.length - 1] : '';
}

/** Total target MT for a territory in a month (excluding By-Product). */
function territoryTotalMt(month, territory) {
  const r = load().rows.find((x) => x.month === month && x.territory === territory);
  if (!r) return 0;
  return productsList().reduce((s, p) => s + num(r.targets[p]), 0);
}

/** National total target MT for a month (excluding By-Product). */
function nationalTotalMt(month) {
  const r = nationalRow(month);
  if (!r) return 0;
  return productsList().reduce((s, p) => s + num(r.targets[p]), 0);
}

/** National target MT for a product in a month. */
function nationalProductMt(month, product) {
  const r = nationalRow(month);
  return r ? num(r.targets[product]) : 0;
}

/** Per-territory target MT for a month (excluding National & By-Product). */
function territoryTargets(month) {
  return rowsForMonth(month).map((r) => ({
    territory: r.territory,
    targetMt: productsList().reduce((s, p) => s + num(r.targets[p]), 0),
  }));
}

module.exports = {
  fetchFromSheet,
  setData,
  months,
  latestMonth,
  productsList,
  rowsForMonth,
  nationalRow,
  territoryTotalMt,
  nationalTotalMt,
  nationalProductMt,
  territoryTargets,
};
