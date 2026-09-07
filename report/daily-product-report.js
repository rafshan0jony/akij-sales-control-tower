'use strict';

/**
 * Daily per-user "Product-wise Target vs Achievement (Delivery MT)" report.
 *
 * For every field user (from the metadata backup), computes their scoped
 * product-wise target vs achievement table for the current month, renders it
 * as a JPG and sends it to their Google Chat direct message.
 *
 * Run: node report/daily-product-report.js [--user=email] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { OAuth2Client } = require('google-auth-library');

const mcp = require('../server/mcp/client');
const dates = require('../server/lib/dates');
const itemMapping = require('../server/services/itemMappingService');
const territoryMapping = require('../server/services/territoryMappingService');
const territoryTarget = require('../server/services/territoryTargetService');
const analytics = require('../server/services/analyticsService');
const { renderProductTable } = require('./render-product-table');

const PROJECT_DIR = path.join(__dirname, '..');
const META_BACKUP = path.join(PROJECT_DIR, 'data', 'metadata-backup.json');
const CHAT_CREDS = path.join(PROJECT_DIR, '..', 'google-chat-credentials.json');
const CHAT_TOKEN = path.join(PROJECT_DIR, '..', 'token.json');
const OUT_DIR = path.join(PROJECT_DIR, 'report', 'out');
const MARKER = path.join(PROJECT_DIR, 'data', 'daily-report-last-run.txt');

const log = (...a) => console.log(new Date().toISOString(), ...a);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const money = (n) => '৳' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const pct = (n) => r1(n) + '%';

// ---------------------------------------------------------------------------
// Normalize (mirrors server/services/syncService.js)
// ---------------------------------------------------------------------------
function normalizeOrders(rows) {
  const out = [];
  for (const r of rows || []) {
    const pm = itemMapping.resolveProduct(r.item);
    if (!pm) continue;
    const tm = territoryMapping.resolve(r.territory);
    out.push({
      date: dates.toDateStr(r.date),
      orderNo: r.orderNo == null ? null : String(r.orderNo),
      customer: r.customer == null ? null : String(r.customer),
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      status: r.status == null ? null : String(r.status),
      item: r.item == null ? null : String(r.item),
      product: pm.product,
      uom: r.uom == null ? null : String(r.uom),
      weight: pm.weight,
      quantity: num(r.quantity),
      mt: num(r.quantity) * pm.weight / 1000,
      value: num(r.value),
      price: num(r.price),
    });
  }
  return out;
}

function normalizeDeliveries(rows) {
  const out = [];
  for (const r of rows || []) {
    const pm = itemMapping.resolveProduct(r.item);
    if (!pm) continue;
    const tm = territoryMapping.resolve(r.territory);
    out.push({
      date: dates.toDateStr(r.date),
      customer: r.customer == null ? null : String(r.customer),
      territory: tm.territory,
      area: tm.area,
      region: tm.region,
      status: r.status == null ? 'Delivered' : String(r.status),
      orderNo: r.orderNo == null ? null : String(r.orderNo),
      item: r.item == null ? null : String(r.item),
      product: pm.product,
      uom: r.uom == null ? null : String(r.uom),
      weight: pm.weight,
      quantity: num(r.quantity),
      mt: num(r.quantity) * pm.weight / 1000,
      value: num(r.value),
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
    scopes.push({
      username: u.username,
      name: u.name || u.username,
      email: u.email.toLowerCase(),
      scopeAll,
      territoryNames: names,
      assignedRaw: codes,
    });
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
  const boundary = 'product_report_' + Date.now();
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
  { h: 'Product', w: 160, align: 'left' },
  { h: 'Target (MT)', w: 82, align: 'right' },
  { h: 'Delivery (MT)', w: 88, align: 'right' },
  { h: 'Achieve %', w: 78, align: 'right' },
  { h: 'Delivery Value', w: 118, align: 'right' },
  { h: 'Sales (MT)', w: 82, align: 'right' },
  { h: 'Sales Value', w: 118, align: 'right' },
];

function formatRows(byProduct) {
  const rows = byProduct.map((r) => ({
    'Product': r.product,
    'Target (MT)': Math.round(r.targetMt).toLocaleString('en-IN'),
    'Delivery (MT)': r1(r.deliveryMt).toLocaleString('en-IN'),
    'Achieve %': pct(r.achievementPct),
    'Delivery Value': money(r.deliveryValue),
    'Sales (MT)': r1(r.salesMt).toLocaleString('en-IN'),
    'Sales Value': money(r.salesValue),
  }));

  const tgt = byProduct.reduce((s, r) => s + num(r.targetMt), 0);
  const del = byProduct.reduce((s, r) => s + num(r.deliveryMt), 0);
  const delVal = byProduct.reduce((s, r) => s + num(r.deliveryValue), 0);
  const soMt = byProduct.reduce((s, r) => s + num(r.salesMt), 0);
  const soVal = byProduct.reduce((s, r) => s + num(r.salesValue), 0);

  rows.push({
    __total: true,
    'Product': 'Total',
    'Target (MT)': Math.round(tgt).toLocaleString('en-IN'),
    'Delivery (MT)': r1(del).toLocaleString('en-IN'),
    'Achieve %': tgt > 0 ? pct(del / tgt * 100) : '0%',
    'Delivery Value': money(delVal),
    'Sales (MT)': r1(soMt).toLocaleString('en-IN'),
    'Sales Value': money(soVal),
  });

  return rows;
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

  // Fresh territory target from the sheet (falls back to static JSON).
  try { await territoryTarget.fetchFromSheet(); log('territory target fetched'); }
  catch (e) { log('WARN territory target fetch failed:', e.message); }

  const today = dates.todayStr();
  const from = today.slice(0, 7) + '-01';
  log('fetching DWH data for', from, '..', today);

  const [rawOrders, rawDeliveries] = await Promise.all([
    mcp.getSalesOrders(from, today),
    mcp.getDeliveries(from, today),
  ]);
  const data = {
    orders: normalizeOrders(rawOrders),
    deliveries: normalizeDeliveries(rawDeliveries),
  };
  log('normalized:', data.orders.length, 'orders,', data.deliveries.length, 'deliveries');

  const monthLabel = new Date(today + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const at = dryRun ? null : await chatAuth();

  let sent = 0, failed = 0;
  for (const s of scopes) {
    try {
      const scope = { scopeAll: s.scopeAll, territoryNames: s.territoryNames };
      const range = { from, to: today };
      const result = analytics.targetAchievement(data, scope, range, {});
      const rows = formatRows(result.byProduct || []);

      const scopeLabel = s.scopeAll ? 'National' : [...s.territoryNames].map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
      const title = 'Product-wise Target vs Achievement (Delivery MT)';
      const subtitle = monthLabel + '  ·  ' + s.name + '  ·  ' + scopeLabel;

      const imgBuf = renderProductTable({ title, subtitle, columns: COLUMNS, rows });

      if (dryRun) {
        if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, s.username + '.jpg'), imgBuf);
        log('DRY RUN wrote', s.username + '.jpg', 'for', s.email);
      } else {
        const space = await findOrCreateDm(at, s.email);
        await sendImage(at, space, imgBuf, 'Daily Product-wise Target vs Achievement — ' + monthLabel);
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
