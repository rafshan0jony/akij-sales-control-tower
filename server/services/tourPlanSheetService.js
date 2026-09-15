'use strict';

/**
 * Sales team tour plan (source: Google Sheet "Form Responses 1").
 * Each row is an employee's monthly plan: Month | Employee Name | Date 1..31
 * (tour locations) | Remarks | Employee Email | Super Visor | Line Manager | Sales Lead.
 *
 * The bridge fetches the sheet and pushes the parsed result to the app
 * (see syncService.applyRemoteSnapshot -> setData). A static snapshot
 * (server/data/tourPlan.json) is the fallback until then.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const usersRepo = require('../repos/users');
const userTerritoriesRepo = require('../repos/userTerritories');
const tourPlanEntriesRepo = require('../repos/tourPlanEntries');

const SHEET_ID = '1ZmJ8KY5IO3OIVQvGADHMdi8Srf6OcQPYfr1At8S977U';
const TOKEN_PATH = path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp', 'credentials', 'rafshan_at_akijresource_dot_com.json');

let data = null;

function load() {
  if (data) return data;
  try {
    data = require('../data/tourPlan.json');
  } catch (_) {
    data = { updatedAt: '', plans: [] };
  }
  return data;
}

function setData(newData) {
  if (newData && Array.isArray(newData.plans)) data = newData;
}

async function fetchFromSheet() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('sheets token not found: ' + TOKEN_PATH);
  const { OAuth2Client } = require('google-auth-library');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const oauth = new OAuth2Client(token.client_id, token.client_secret);
  oauth.setCredentials({ refresh_token: token.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Form Responses 1')}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + credentials.access_token } });
  if (!res.ok) throw new Error('sheets ' + res.status);
  const vals = (await res.json()).values || [];

  const plans = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i] || [];
    const month = String(row[1] || '').trim();
    const name = String(row[2] || '').trim();
    const email = String(row[35] || '').trim().toLowerCase();
    const supervisor = String(row[36] || '').trim().toLowerCase();
    const lineManager = String(row[37] || '').trim().toLowerCase();
    const remarks = String(row[34] || '').trim();
    if (!name || !month) continue;
    const days = [];
    for (let d = 0; d < 31; d++) days.push(String(row[3 + d] || '').trim());
    plans.push({ month, name, email, supervisor, lineManager, remarks, days });
  }
  data = { updatedAt: new Date().toISOString(), plans };
  return data;
}

/**
 * Build email (lowercase) -> Set of territory names (lowercase) from the app's
 * users + territory assignments.
 */
function buildEmailTerritoryMap() {
  const map = new Map();
  const users = usersRepo.list();
  for (const u of users) {
    if (!u.email) continue;
    const names = new Set();
    for (const t of userTerritoriesRepo.listForUser(u.id)) {
      if (t.name) names.add(String(t.name).toLowerCase());
    }
    if (names.size) map.set(u.email.toLowerCase(), names);
  }
  return map;
}

/**
 * Build email (lowercase) -> user id from the app's users.
 */
function buildEmailUserMap() {
  const map = new Map();
  for (const u of usersRepo.list()) {
    if (u.email) map.set(u.email.toLowerCase(), u.id);
  }
  return map;
}

/** Current month key (YYYY-MM) and name ("September") in Asia/Dhaka. */
function currentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return { key: `${y}-${String(m).padStart(2, '0')}`, name: now.toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Dhaka' }) };
}

/**
 * Return the tour plans for a scope + month, joined with the employee's
 * submitted entries (sales order MT, visit plan change, TA/DA details, TA/DA bill).
 */
function plansForScope(scope, month) {
  const { plans } = load();
  const emailMap = buildEmailTerritoryMap();
  const emailUserMap = buildEmailUserMap();
  const { key: monthKey, name: currentMonth } = currentMonthKey();
  const targetMonth = month || currentMonth;

  const entriesByUser = new Map();
  for (const e of tourPlanEntriesRepo.listForMonth(monthKey)) {
    if (!entriesByUser.has(e.userId)) entriesByUser.set(e.userId, new Map());
    entriesByUser.get(e.userId).set(e.day, e);
  }

  const out = [];
  for (const p of plans) {
    if (p.month.toLowerCase() !== targetMonth.toLowerCase()) continue;
    let terrNames = emailMap.get(p.email);
    if (!terrNames || !terrNames.size) terrNames = emailMap.get(p.supervisor);
    if (!terrNames || !terrNames.size) terrNames = emailMap.get(p.lineManager);
    if (!terrNames) terrNames = new Set();

    if (scope && !scope.scopeAll) {
      const match = [...terrNames].some((t) => scope.territoryNames.has(t));
      if (!match) continue;
    }

    const userId = emailUserMap.get(p.email) || null;
    const entries = userId && entriesByUser.has(userId) ? [...entriesByUser.get(userId).values()] : [];

    out.push({
      name: p.name,
      email: p.email,
      supervisor: p.supervisor,
      remarks: p.remarks,
      days: p.days,
      territories: [...terrNames],
      userId,
      entries,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

module.exports = { fetchFromSheet, setData, load, plansForScope, currentMonthKey };
