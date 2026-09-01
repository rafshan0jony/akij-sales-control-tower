'use strict';

/**
 * Create users from the "User" tab of the item-mapping Google Sheet via the
 * deployed app's admin API.
 *
 * Run: node server/scripts/create-users.js
 *
 * Role mapping (existing roles only):
 *   Territory Officer -> TERRITORY
 *   Zonal Manager     -> AREA
 *   Area Manager      -> AREA
 *   Regional Manager  -> REGION
 *   Manager           -> REGION (default; to be adjusted manually)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const SHEET_ID = '1uVeCRFTTw2GI7eljLvs0yj9NXM51g89CChZInpYtJ4c';
const TOKEN = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');
const BASE = process.env.APP_URL || 'https://akij-sales-control-tower.onrender.com';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

const ROLE_MAP = {
  'Territory Officer': 'TERRITORY',
  'Zonal Manager': 'AREA',
  'Area Manager': 'AREA',
  'Regional Manager': 'REGION',
  'Manager': 'REGION',
};

async function readUsers() {
  const tok = JSON.parse(fs.readFileSync(TOKEN, 'utf8'));
  const oauth = new OAuth2Client(tok.client_id, tok.client_secret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('user')}`, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];
  const users = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i] || [];
    const name = String(r[0] || '').trim();
    const designation = String(r[1] || '').trim();
    const email = String(r[2] || '').trim().toLowerCase();
    const password = String(r[3] || '').trim() || '123456';
    if (!name || !email) continue;
    users.push({ name, designation, email, password });
  }
  return users;
}

async function main() {
  const users = await readUsers();
  console.log('sheet users:', users.length);

  // login as admin
  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const login = await loginRes.json();
  if (!login.token) throw new Error('admin login failed: ' + JSON.stringify(login));
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };

  // get roles
  const rolesRes = await fetch(BASE + '/api/admin/roles', { headers: auth });
  const roles = (await rolesRes.json()).roles || [];
  const roleIdByCode = {};
  for (const r of roles) roleIdByCode[r.code] = r.id;
  console.log('roles:', roles.map((r) => r.code).join(', '));

  let created = 0, skipped = 0, failed = 0;
  for (const u of users) {
    const roleCode = ROLE_MAP[u.designation] || null;
    const roleId = roleCode ? roleIdByCode[roleCode] : null;
    const username = u.email.split('@')[0].toLowerCase();

    const body = {
      username,
      email: u.email,
      name: u.name,
      password: u.password,
      roleId,
    };

    const res = await fetch(BASE + '/api/admin/users', {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    if (res.status === 201) {
      created++;
      console.log('CREATED', username, '|', u.name, '|', u.designation, '->', roleCode || '(none)');
    } else {
      const err = await res.json().catch(() => ({}));
      if (String(err.error || '').toLowerCase().includes('already exists')) {
        skipped++;
        console.log('SKIP (exists)', username);
      } else {
        failed++;
        console.log('FAILED', username, '->', res.status, err.error || '');
      }
    }
  }
  console.log(`\nDone: created=${created} skipped=${skipped} failed=${failed}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
