'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { OAuth2Client } = require('google-auth-library');

const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS || path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const spreadsheetId = process.env.SALES_REPORT_SHEET_ID || '1z6zYTsyL6TYqpFVfRdxyx1VKoTJ1RoifACpowRyvgls';
const range = 'Delivery Schedule';

function clientCreds() {
  if (process.env.GOOGLE_SHEETS_CLIENT_ID) {
    return { client_id: process.env.GOOGLE_SHEETS_CLIENT_ID, client_secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET };
  }
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  return { client_id: raw.client_id, client_secret: raw.client_secret };
}

function refreshToken() {
  if (process.env.GOOGLE_SHEETS_REFRESH_TOKEN) return process.env.GOOGLE_SHEETS_REFRESH_TOKEN;
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  return raw.refresh_token;
}

async function authToken() {
  const { client_id, client_secret } = clientCreds();
  const oauth = new OAuth2Client(client_id, client_secret);
  oauth.setCredentials({ refresh_token: refreshToken() });
  const { credentials } = await oauth.refreshAccessToken();
  return credentials.access_token;
}

async function appendSchedule({ submittedAt, deliveryDate, submittedBy, lines, chatStatus }) {
  const at = await authToken();
  const rows = lines.map((line) => [
    submittedAt || '',
    deliveryDate || '',
    submittedBy || '',
    line.customer || '',
    line.orderNo || '',
    line.territory || '',
    line.item || '',
    line.uom || '',
    line.orderQtyBags == null ? '' : line.orderQtyBags,
    line.pendingQtyBags == null ? '' : line.pendingQtyBags,
    line.scheduleQtyBags == null ? '' : line.scheduleQtyBags,
    chatStatus || '',
  ]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${body.slice(0, 250)}`);
  return JSON.parse(body);
}

module.exports = { appendSchedule };
