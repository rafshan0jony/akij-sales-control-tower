'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { OAuth2Client } = require('google-auth-library');

const projectDir = path.join(__dirname, '..', '..');
const credentialsPath = process.env.GOOGLE_CHAT_CREDENTIALS || path.join(projectDir, '..', 'google-chat-credentials.json');
const tokenPath = process.env.GOOGLE_CHAT_TOKEN || path.join(projectDir, '..', 'token.json');
const space = process.env.DELIVERY_CHAT_SPACE || 'spaces/AAAAnG4FiIs';

function readJsonSecret(envName, filePath) {
  const value = process.env[envName];
  if (value) return JSON.parse(value);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function authToken() {
  const creds = process.env.GOOGLE_CHAT_CLIENT_ID
    ? { installed: { client_id: process.env.GOOGLE_CHAT_CLIENT_ID, client_secret: process.env.GOOGLE_CHAT_CLIENT_SECRET } }
    : readJsonSecret('GOOGLE_CHAT_CREDENTIALS_JSON', credentialsPath);
  const client = creds.installed || creds.web;
  const token = process.env.GOOGLE_CHAT_REFRESH_TOKEN
    ? { refresh_token: process.env.GOOGLE_CHAT_REFRESH_TOKEN }
    : readJsonSecret('GOOGLE_CHAT_TOKEN_JSON', tokenPath);
  const oauth = new OAuth2Client(client.client_id, client.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const result = await oauth.refreshAccessToken();
  return result.credentials.access_token;
}

async function sendDeliverySchedule({ deliveryDate, submittedBy, lines, remarks }) {
  const territories = [...new Set(lines.map((line) => line.territory).filter(Boolean))].join(', ');
  const accessToken = await authToken();
  const text = [
    'Delivery Schedule Submitted',
    '',
    `Customer: ${lines[0]?.customer || ''}`,
    `Sales Order: ${[...new Set(lines.map((line) => line.orderNo))].join(', ')}`,
    `Delivery Date: ${deliveryDate}`,
    '',
    'Items:',
    ...lines.map((line) => `- ${line.item} - ${line.scheduleQtyBags} bag(s)`),
    '',
    `Submitted by: ${submittedBy || ''}`,
    `Territory: ${territories}`,
    ...(remarks ? ['', `Remarks: ${remarks}`] : []),
  ].join('\n');
  const response = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google Chat ${response.status}: ${body.slice(0, 250)}`);
  return JSON.parse(body);
}

module.exports = { sendDeliverySchedule };
