'use strict';

/**
 * Daily per-user "Customer Credit Status" report.
 *
 * For every field user (from the metadata backup), computes their scoped
 * credit status (positive ledger balance customers) and sends it as a JPG
 * to their Google Chat direct message.
 *
 * Run: node report/daily-credit-report.js [--user=email] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const mcp = require('../server/mcp/client');
const dates = require('../server/lib/dates');
const territoryMapping = require('../server/services/territoryMappingService');
const customerTerritoryOverride = require('../server/services/customerTerritoryOverride');
const analytics = require('../server/services/analyticsService');
const { renderProductTable } = require('./render-product-table');

const PROJECT_DIR = path.join(__dirname, '..');
const META_BACKUP = path.join(PROJECT_DIR, 'data', 'metadata-backup.json');
const CHAT_CREDS = path.join(PROJECT_DIR, '..', 'google-chat-credentials.json');
const CHAT_TOKEN = path.join(PROJECT_DIR, '..', 'token.json');
const OUT_DIR = path.join(PROJECT_DIR, 'report', 'out');
const MARKER = path.join(PROJECT_DIR, 'data', 'credit-report-last-run.txt');
const DASHBOARD_URL = 'https://akij-sales-control-tower.onrender.com';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n) => '৳' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// ---------------------------------------------------------------------------
// Normalize (mirrors server/services/syncService.js normalizeCredit)
// ---------------------------------------------------------------------------
function normalizeCredit(rows) {
  const today = dates.todayStr();
  const out = [];
  for (const r of rows || []) {
    const tm = territoryMapping.resolve(customerTerritoryOverride.territoryFor(r.partnerCode) || r.territory);
    if (!tm) continue;
    const creditDays = num(r.creditDays);
    const lastDeliveryDate = r.lastDeliveryDate ? dates.toDateStr(r.lastDeliveryDate) : null;
    const lastPaymentDate = r.lastPaymentDate ? dates.toDateStr(r.lastPaymentDate) : null;
    const deliveryGap = lastDeliveryDate ? Math.max(0, dates.diffDays(lastDeliveryDate, today)) : null;
    const paymentGap = lastPaymentDate ? Math.max(0, dates.diffDays(lastPaymentDate, today)) : null;
    out.push({
      partnerCode: r.partnerCode == null ? null : String(r.partnerCode).trim(),
      partnerName: r.partnerName == null ? null : String(r.partnerName).trim(),
      creditDays,
      ledgerBalance: Math.round(num(r.ledgerBalance) * 100) / 100,
      overdue: Math.round(num(r.overdue) * 100) / 100,
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      lastDeliveryDate,
      lastPaymentDate,
      deliveryGap,
      paymentGap,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scopes from the metadata backup
// ---------------------------------------------------------------------------
function buildScopes(meta) {
  const userTerritories = meta.userTerritories || {};
  const rows = territoryMapping.list();
  const byArea = new Map();
  const byRegion = new Map();
  for (const r of rows) {
    const t = String(r.territory).toLowerCase();
    if (!byArea.has(r.area)) byArea.set(r.area, new Set());
    byArea.get(r.area).add(t);
    if (!byRegion.has(r.region)) byRegion.set(r.region, new Set());
    byRegion.get(r.region).add(t);
  }

  const scopes = [];
  for (const u of meta.users || []) {
    if (!u.email || u.roleCode === 'ADMIN') continue;
    const codes = userTerritories[u.username] || [];
    if (!codes.length) continue;
    let scopeAll = false;
    const names = new Set();
    for (const code of codes) {
      if (code === 'NATIONAL') { scopeAll = true; break; }
      const prefix = code.slice(0, 2);
      const name = code.slice(2);
      if (prefix === 'T:') names.add(name.toLowerCase());
      else if (prefix === 'A:') for (const t of (byArea.get(name) || [])) names.add(t);
      else if (prefix === 'R:') for (const t of (byRegion.get(name) || [])) names.add(t);
    }
    scopes.push({ username: u.username, name: u.name || u.username, email: u.email.toLowerCase(), scopeAll, territoryNames: names });
  }
  return scopes;
}

// ---------------------------------------------------------------------------
// Google Chat
// ---------------------------------------------------------------------------
async function chatAuth() {
  const creds = JSON.parse(fs.readFileSync(CHAT_CREDS, 'utf8'));
  const cc = creds.installed || creds.web;
  const tok = JSON.parse(fs.readFileSync(CHAT_TOKEN, 'utf8'));
  const oauth = new OAuth2Client(cc.client_id, cc.client_secret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  const { credentials } = await oauth.refreshAccessToken();
  return credentials.access_token;
}

async function findOrCreateDm(at, email) {
  const find = await fetch('https://chat.googleapis.com/v1/spaces:findDirectMessage?name=' + encodeURIComponent('users/' + email), { headers: { Authorization: 'Bearer ' + at } });
  if (find.ok) return (await find.json()).name;
  const setup = await fetch('https://chat.googleapis.com/v1/spaces:setup', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ space: { spaceType: 'DIRECT_MESSAGE' }, memberships: [{ member: { name: 'users/' + email, type: 'HUMAN' } }] }),
  });
  if (!setup.ok) throw new Error('setup ' + setup.status + ' ' + (await setup.text()).slice(0, 200));
  return (await setup.json()).name;
}

async function sendImage(at, space, imgBuf, text) {
  const boundary = 'credit_report_' + Date.now();
  const meta = JSON.stringify({ filename: 'report.jpg' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: image/jpeg\r\n\r\n`),
    imgBuf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const up = await fetch('https://chat.googleapis.com/upload/v1/' + space + '/attachments:upload?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'content-type': 'multipart/related; boundary=' + boundary },
    body,
  });
  const upText = await up.text();
  if (!up.ok) throw new Error('upload ' + up.status + ' ' + upText.slice(0, 250));
  const attachmentDataRef = JSON.parse(upText).attachmentDataRef;

  const msg = await fetch('https://chat.googleapis.com/v1/' + space + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, attachment: [{ contentType: 'image/jpeg', attachmentDataRef }] }),
  });
  const msgText = await msg.text();
  if (!msg.ok) throw new Error('send ' + msg.status + ' ' + msgText.slice(0, 250));
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------
const COLUMNS = [
  { h: 'Partner Name', w: 230, align: 'left' },
  { h: 'Credit Days', w: 80, align: 'right' },
  { h: 'Ledger Balance', w: 118, align: 'right' },
  { h: 'Overdue', w: 118, align: 'right' },
  { h: 'Del. Gap (Day)', w: 92, align: 'right' },
  { h: 'Pay. Gap (Day)', w: 92, align: 'right' },
];

function formatRows(rows) {
  const out = rows.map((r) => ({
    'Partner Name': r.partnerName,
    'Credit Days': r.creditDays,
    'Ledger Balance': money(r.ledgerBalance),
    'Overdue': money(r.overdue),
    'Del. Gap (Day)': r.deliveryGap == null ? '' : r.deliveryGap,
    'Pay. Gap (Day)': r.paymentGap == null ? '' : r.paymentGap,
  }));

  const totalLedger = rows.reduce((s, r) => s + num(r.ledgerBalance), 0);
  const totalOverdue = rows.reduce((s, r) => s + num(r.overdue), 0);
  out.push({
    __total: true,
    'Partner Name': 'Total',
    'Credit Days': '',
    'Ledger Balance': money(totalLedger),
    'Overdue': money(totalOverdue),
    'Del. Gap (Day)': '',
    'Pay. Gap (Day)': '',
  });

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const userArg = args.find((a) => a.startsWith('--user='));
  const onlyEmail = userArg ? userArg.split('=')[1].toLowerCase() : null;

  if (!force && !dryRun && !onlyEmail) {
    try {
      if (fs.readFileSync(MARKER, 'utf8').trim() === dates.todayStr()) {
        log('already sent today, skipping (use --force to override)');
        return;
      }
    } catch (_) { /* no marker yet */ }
  }

  if (!fs.existsSync(META_BACKUP)) throw new Error('metadata backup not found: ' + META_BACKUP);
  const meta = JSON.parse(fs.readFileSync(META_BACKUP, 'utf8'));
  const scopes = buildScopes(meta);
  log('field users:', scopes.length, dryRun ? '(dry run)' : '');

  if (onlyEmail) {
    const i = scopes.findIndex((s) => s.email === onlyEmail);
    if (i === -1) throw new Error('user not found: ' + onlyEmail);
    const match = scopes[i];
    scopes.length = 0;
    scopes.push(match);
  }

  const today = dates.todayStr();
  log('fetching credit status...');
  const rawCredit = await mcp.getCreditStatus();
  const data = { credit: normalizeCredit(rawCredit) };
  log('normalized credit rows:', data.credit.length);

  const dateLabel = new Date(today + 'T00:00:00Z').toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const at = dryRun ? null : await chatAuth();

  let sent = 0, failed = 0;
  for (const s of scopes) {
    try {
      const scope = { scopeAll: s.scopeAll, territoryNames: s.territoryNames };
      const rows = analytics.creditStatus(data, scope);
      if (!rows.length) {
        log('SKIP (no credit rows)', s.email);
        continue;
      }
      const scopeLabel = s.scopeAll ? 'National' : [...s.territoryNames].map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
      const title = 'Customer Credit Status';
      const subtitle = dateLabel + '  ·  ' + s.name + '  ·  ' + scopeLabel;

      const imgBuf = renderProductTable({ title, subtitle, columns: COLUMNS, rows: formatRows(rows) });

      if (dryRun) {
        if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, 'credit-' + s.username + '.jpg'), imgBuf);
        log('DRY RUN wrote credit-' + s.username + '.jpg for', s.email);
      } else {
        const space = await findOrCreateDm(at, s.email);
        const sendText = 'Daily Customer Credit Status — ' + dateLabel
          + '\n\nFor detailed information please visit: ' + DASHBOARD_URL + '\n(log in to see your details)';
        await sendImage(at, space, imgBuf, sendText);
        log('SENT', s.email, '->', space);
      }
      sent++;
    } catch (e) {
      failed++;
      log('FAILED', s.email, '-', e.message);
    }
  }

  log('DONE sent=' + sent + ' failed=' + failed);
  if (!dryRun && sent > 0) fs.writeFileSync(MARKER, dates.todayStr());
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
