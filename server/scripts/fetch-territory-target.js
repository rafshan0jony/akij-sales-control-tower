'use strict';

/**
 * Fetch the "territory target" tab from the item-mapping Google Sheet and
 * write server/data/territoryTarget.json.
 *
 * Sheet layout:
 *   row 0: ["Month","",<product variant>,...]
 *   rows : ["September-2026","<territory>",<mt>,<mt>,...]  ("" = no target)
 *   last row per month is "National" (the national product totals).
 *
 * Run (office PC, needs Google Workspace credentials):
 *   node server/scripts/fetch-territory-target.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const SHEET_ID = '1uVeCRFTTw2GI7eljLvs0yj9NXM51g89CChZInpYtJ4c';
const TOKEN_PATH = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'territoryTarget.json');

const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

function normalizeMonth(s) {
  const str = String(s || '').trim();
  const m = str.match(/^([A-Za-z]+)[\s-]*(\d{4})$/);
  if (!m) return '';
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return '';
  return `${m[2]}-${String(mo).padStart(2, '0')}`;
}

function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const oauth = new OAuth2Client(token.client_id, token.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('territory target')}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];

  if (vals.length < 2) throw new Error('territory target tab is empty');

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
    for (let j = 0; j < products.length; j++) {
      targets[products[j]] = num(row[2 + j]);
    }
    rows.push({ month, territory, targets });
  }

  const months = [...new Set(rows.map((r) => r.month))].sort();

  const out = { updatedAt: new Date().toISOString(), months, products, rows };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log('wrote', OUT_PATH);
  console.log('months:', months.join(', '));
  console.log('products:', products.length, '| territories:', new Set(rows.map((r) => r.territory)).size, '| rows:', rows.length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
