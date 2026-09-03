'use strict';

/**
 * Create/update users AND their territory assignments from the "User" tab of
 * the item-mapping Google Sheet via the deployed app's admin API.
 *
 * Sheet columns (header row):
 *   0 Employee Name | 1 Designation | 2 Email | 3 Password | 4 Assign Territory
 *
 * "Assign Territory" may be a single name or a comma-separated list of
 * territory / area / region names (matched against the app's territory
 * hierarchy by name, case-insensitive).
 *
 * Role mapping (existing roles only):
 *   Territory Officer -> TERRITORY
 *   Zonal Manager     -> TERRITORY
 *   Area Manager      -> AREA
 *   Regional Manager  -> REGION
 *   Manager           -> REGION
 *
 * The designation is stored as the user's `title`.
 *
 * Passwords: existing users are NEVER re-passworded, so a user's own password
 * change in the app is preserved. New users get the sheet password.
 *
 * Run: node server/scripts/create-users.js
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
  'Zonal Manager': 'TERRITORY',
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
    const territories = String(r[4] || '').trim();
    if (!name || !email) continue;
    users.push({ name, designation, email, password, territories });
  }
  return users;
}

async function main() {
  const users = await readUsers();
  console.log('sheet users:', users.length);

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const login = await loginRes.json();
  if (!login.token) throw new Error('admin login failed: ' + JSON.stringify(login));
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };

  const roles = (await (await fetch(BASE + '/api/admin/roles', { headers: auth })).json()).roles || [];
  const roleIdByCode = {};
  for (const r of roles) roleIdByCode[r.code] = r.id;

  const terrData = (await (await fetch(BASE + '/api/admin/territories', { headers: auth })).json());
  const territories = terrData.territories || [];
  const terrIdByName = new Map();
  for (const t of territories) terrIdByName.set(String(t.name || '').toLowerCase(), t.id);

  const existing = (await (await fetch(BASE + '/api/admin/users', { headers: auth })).json()).users || [];
  const userByUsername = new Map(existing.map((u) => [u.username, u]));

  let created = 0, updated = 0, assigned = 0, failed = 0;

  for (const u of users) {
    const roleCode = ROLE_MAP[u.designation] || null;
    const roleId = roleCode ? roleIdByCode[roleCode] : null;
    const username = u.email.split('@')[0].toLowerCase();

    let found = userByUsername.get(username);

    if (found) {
      const res = await fetch(BASE + '/api/admin/users/' + found.id, {
        method: 'PUT', headers: auth,
        body: JSON.stringify({ name: u.name, email: u.email, roleId, title: u.designation }),
      });
      if (res.ok) { updated++; console.log('UPDATED', username, '|', u.designation, '->', roleCode); }
      else { failed++; console.log('UPDATE FAILED', username, res.status); continue; }
    } else {
      const res = await fetch(BASE + '/api/admin/users', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ username, email: u.email, name: u.name, password: u.password, roleId, title: u.designation }),
      });
      if (res.status === 201) {
        created++;
        const createdUser = (await res.json()).user;
        found = createdUser;
        console.log('CREATED', username, '|', u.designation, '->', roleCode);
      } else { failed++; console.log('CREATE FAILED', username, res.status, await res.text()); continue; }
    }

    // Resolve "Assign Territory" names -> territory ids.
    const names = u.territories.split(',').map((s) => s.trim()).filter(Boolean);
    const targetIds = [];
    for (const n of names) {
      const id = terrIdByName.get(n.toLowerCase());
      if (id) targetIds.push(id);
      else console.log('  WARN unknown territory name:', JSON.stringify(n), 'for', username);
    }

    // Sync assignments: remove stale, then add the sheet's list.
    const cur = (await (await fetch(BASE + '/api/admin/users/' + found.id + '/territories', { headers: auth })).json()).territories || [];
    const targetSet = new Set(targetIds);
    for (const t of cur) {
      if (!targetSet.has(t.id)) {
        await fetch(BASE + '/api/admin/users/' + found.id + '/territories/' + t.id, { method: 'DELETE', headers: auth });
      }
    }
    if (targetIds.length) {
      const res = await fetch(BASE + '/api/admin/users/' + found.id + '/territories', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ territoryIds: targetIds }),
      });
      if (res.ok) { assigned++; console.log('  ASSIGNED', username, '->', names.join(' | ')); }
      else { failed++; console.log('  ASSIGN FAILED', username, res.status, await res.text()); }
    } else {
      console.log('  NO TERRITORY for', username);
    }
  }

  console.log(`\nDone: created=${created} updated=${updated} assigned=${assigned} failed=${failed}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
