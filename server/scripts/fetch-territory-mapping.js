'use strict';

/**
 * Fetch the "Territory Maping" tab and write server/data/territoryMapping.json.
 * Columns: System Territory | Actual Territory | Actual Area | Actual Region.
 *
 * Run (office PC):
 *   node server/scripts/fetch-territory-mapping.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const SHEET_ID = '1uVeCRFTTw2GI7eljLvs0yj9NXM51g89CChZInpYtJ4c';
const TOKEN_PATH = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'territoryMapping.json');

async function main() {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const oauth = new OAuth2Client(token.client_id, token.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Territory Maping')}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];

  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i] || [];
    const system = String(r[0] || '').trim();
    const territory = String(r[1] || '').trim();
    const area = String(r[2] || '').trim();
    const region = String(r[3] || '').trim();
    if (!system || !territory) continue;
    rows.push({ system, territory, area, region });
  }

  const out = { updatedAt: new Date().toISOString(), rows };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log('wrote', OUT_PATH, '| rows:', rows.length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
