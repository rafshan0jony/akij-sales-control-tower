'use strict';

/**
 * Fetch the "item maping" tab and write server/data/itemMapping.json.
 * Includes BOTH Rice and By-Product items (by-products map to variant
 * "By-Product" with their kg weight) so by-product achievement + target
 * can be shown.
 *
 * Run (office PC):
 *   node server/scripts/fetch-item-mapping.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const SHEET_ID = '1uVeCRFTTw2GI7eljLvs0yj9NXM51g89CChZInpYtJ4c';
const TOKEN_PATH = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'itemMapping.json');

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
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('item maping')}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];

  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const item = String(vals[i][0] || '').trim();
    const weight = num(vals[i][1]);
    const variant = String(vals[i][3] || '').trim();
    if (!item || !variant || weight <= 0) continue;
    rows.push({ item, weight: String(weight), variant });
  }

  const out = { updatedAt: new Date().toISOString(), rows };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  const byProd = rows.filter((r) => r.variant.toLowerCase() === 'by-product').length;
  console.log('wrote', OUT_PATH, '| total rows:', rows.length, '| by-product rows:', byProd);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
