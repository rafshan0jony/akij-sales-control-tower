'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.SYNC_SECRET = 'test-sync-secret';
process.env.SALES_REPORT_SHEET_SYNC = 'false';

const test = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');

const db = require('../server/db').getDb();
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

test('AREA manager sees team past-day reports (real territory names)', async () => {
  const national = territoriesRepo.findByName('National');

  // Mirror importTerritories for the relevant real-world nodes.
  const region = territoriesRepo.upsertByCode({ code: 'R:Dhaka East & North East Region', name: 'Dhaka East & North East Region', level: 1, parentId: national.id });
  const area = territoriesRepo.upsertByCode({ code: 'A:Dhaka North & Narayanganj Area', name: 'Dhaka North & Narayanganj Area', level: 2, parentId: region.id });
  const terrNarayanganj = territoriesRepo.upsertByCode({ code: 'T:Narayanganj Metro', name: 'Narayanganj Metro', level: 4, parentId: area.id });
  const terrBadda = territoriesRepo.upsertByCode({ code: 'T:Badda & Jatrabari', name: 'Badda & Jatrabari', level: 4, parentId: area.id });

  const areaRole = rolesRepo.findByCode('AREA');
  const terrRole = rolesRepo.findByCode('TERRITORY');

  const arjun = usersRepo.create({ username: 'arjun', email: 'arjun@x.com', name: 'Arjun Kumar Paul', passwordHash: hashPassword('pass123'), roleId: areaRole.id });
  userTerritoriesRepo.assign(arjun.id, area.id);

  const faizur = usersRepo.create({ username: 'faizur', email: 'faizur@x.com', name: 'Faizur Rahman', passwordHash: hashPassword('pass123'), roleId: terrRole.id });
  userTerritoriesRepo.assign(faizur.id, terrNarayanganj.id);

  const arif = usersRepo.create({ username: 'arif', email: 'arif@x.com', name: 'Md. Arif Uddin', passwordHash: hashPassword('pass123'), roleId: terrRole.id });
  userTerritoriesRepo.assign(arif.id, terrBadda.id);

  // Submit a PAST-DAY report for team members (direct repo write for yesterday).
  const salesReportsRepo = require('../server/repos/salesReports');
  const dates = require('../server/lib/dates');
  const yesterday = dates.addDays(dates.todayStr(), -1);
  salesReportsRepo.upsert(faizur.id, yesterday, { salesProjectionMt: 10, projectionSubmittedAt: new Date().toISOString() });
  salesReportsRepo.upsert(arif.id, yesterday, { salesProjectionMt: 20, projectionSubmittedAt: new Date().toISOString() });

  const al = await login('arjun', 'pass123');
  assert.strictEqual(al.status, 200);

  // View yesterday specifically (the past-day scenario).
  const res = await fetch(base + '/api/dashboard/sales-report?filter=this_month&date=' + yesterday, { headers: { Authorization: 'Bearer ' + al.body.token } });
  const body = await res.json();
  const names = (body.reports || []).map((r) => r.userName);
  assert.ok(names.includes('Faizur Rahman'), 'Arjun should see Faizur (Narayanganj Metro): ' + JSON.stringify(names));
  assert.ok(names.includes('Md. Arif Uddin'), 'Arjun should see Arif (Badda & Jatrabari): ' + JSON.stringify(names));
});
