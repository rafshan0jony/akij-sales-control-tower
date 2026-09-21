'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { OAuth2Client } = require('google-auth-library');

const projectDir = path.join(__dirname, '..', '..');
const credentialsPath = process.env.GOOGLE_CHAT_CREDENTIALS || path.join(projectDir, '..', 'google-chat-credentials.json');
const tokenPath = process.env.GOOGLE_CHAT_TOKEN || path.join(projectDir, '..', 'token.json');
const space = process.env.DELIVERY_CHAT_SPACE || 'spaces/AAAAnG4FiIs';

async function authToken() {
  const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const client = creds.installed || creds.web;
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const oauth = new OAuth2Client(client.client_id, client.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const result = await oauth.refreshAccessToken();
  return result.credentials.access_token;
}

async function sendDeliverySchedule({ deliveryDate, lines }) {
  const accessToken = await authToken();
  const text = [
    'Delivery Schedule Submitted',
    `Delivery Date: ${deliveryDate}`,
    ...lines.map((line) => `- ${line.item} - ${line.scheduleQtyBags} bag(s) - SO ${line.orderNo}`),
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
