'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.SYNC_SECRET = 'test-sync-secret';
process.env.SALES_REPORT_SHEET_SYNC = 'false';

const test = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');

require('../server/db').getDb();
const { createApp } = require('../server/app');
const usersRepo = require('../server/repos/users');
const rolesRepo = require('../server/repos/roles');
const territoriesRepo = require('../server/repos/territories');
const userTerritoriesRepo = require('../server/repos/userTerritories');
const { hashPassword } = require('../server/lib/passwords');

let server, base;
test.before(async () => {
  server = createApp().listen(0);
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

async function login(identifier, password) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return { status: res.status, body: await res.json() };
}

test('sales report submit + show + dependency', async () => {
  const national = territoriesRepo.findByName('National');
  const mk = (code, name, level, parentId) => territoriesRepo.findByCode(code) || territoriesRepo.create({ code, name, level, parentId });
  const region = mk('SR-R1', 'SR Region 1', 1, national.id);
  const tA = mk('SR-T001', 'SR Dhaka North', 4, region.id);

  const terrRole = rolesRepo.findByCode('TERRITORY');
  const regionRole = rolesRepo.findByCode('REGION');

  const officer = usersRepo.create({ username: 'srofficer', email: 'srofficer@x.com', name: 'SR Officer', passwordHash: hashPassword('pass123'), roleId: terrRole.id });
  userTerritoriesRepo.assign(officer.id, tA.id);

  const mgr = usersRepo.create({ username: 'srmgr', email: 'srmgr@x.com', name: 'SR Manager', passwordHash: hashPassword('pass123'), roleId: regionRole.id });
  userTerritoriesRepo.assign(mgr.id, region.id);

  const ol = await login('srofficer', 'pass123');
  assert.strictEqual(ol.status, 200);
  const oToken = ol.body.token;

  // officer submits projection + actual
  const post = await fetch(base + '/api/dashboard/sales-report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + oToken },
    body: JSON.stringify({ salesProjectionMt: 10, depositProjectionBdt: 50000, actualSalesMt: 8, actualCollectionBdt: 40000, submitProjection: true, submitActual: true }),
  });
  assert.strictEqual(post.status, 200, JSON.stringify(await post.json()));

  // officer sees own report
  const oget = await fetch(base + '/api/dashboard/sales-report?filter=this_month', { headers: { Authorization: 'Bearer ' + oToken } });
  const obody = await oget.json();
  assert.ok(obody.own, 'officer own report should exist');
  assert.strictEqual(obody.own.salesProjectionMt, 10);

  // manager sees officer's report via dependency
  const ml = await login('srmgr', 'pass123');
  const mget = await fetch(base + '/api/dashboard/sales-report?filter=this_month', { headers: { Authorization: 'Bearer ' + ml.body.token } });
  const mbody = await mget.json();
  const names = (mbody.reports || []).map((r) => r.userName);
  assert.ok(names.includes('SR Officer'), 'manager should see officer report; got: ' + JSON.stringify(names));
});
