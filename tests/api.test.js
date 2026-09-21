'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';
process.env.SYNC_SECRET = 'test-sync-secret';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');

require('../server/db').getDb();
const { createApp } = require('../server/app');
const usersRepo = require('../server/repos/users');
const rolesRepo = require('../server/repos/roles');
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

test('invalid credentials are rejected', async () => {
  const r = await login('admin', 'wrong-password');
  assert.strictEqual(r.status, 401);
});

test('admin can authenticate and access admin endpoints', async () => {
  const r = await login('admin', 'admin123');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.token);
  const token = r.body.token;
  const res = await fetch(base + '/api/admin/users', { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(res.status, 200);
  const scheduleRes = await fetch(base + '/api/delivery-schedules/pending', { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(scheduleRes.status, 200);
  assert.ok(Array.isArray((await scheduleRes.json()).rows));
});

test('territory user is forbidden from admin endpoints', async () => {
  const role = rolesRepo.findByCode('TERRITORY');
  usersRepo.create({ username: 'rep1', name: 'Rep One', passwordHash: hashPassword('pass123'), roleId: role.id });
  const r = await login('rep1', 'pass123');
  assert.strictEqual(r.status, 200);

  const token = r.body.token;
  const adminRes = await fetch(base + '/api/admin/users', { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(adminRes.status, 403);

  const salesRes = await fetch(base + '/api/sales/orders?filter=this_month', { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(salesRes.status, 200);
});

test('unauthenticated request is rejected', async () => {
  const res = await fetch(base + '/api/dashboard/summary');
  assert.strictEqual(res.status, 401);
});

test('delivery schedule endpoints require authentication', async () => {
  const pending = await fetch(base + '/api/delivery-schedules/pending');
  assert.strictEqual(pending.status, 401);
});

test('delivery schedule rejects invalid submissions before Chat delivery', async () => {
  const r = await login('admin', 'admin123');
  const res = await fetch(base + '/api/delivery-schedules', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + r.body.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryDate: 'not-a-date', lines: [] }),
  });
  assert.strictEqual(res.status, 400);
});

test('delivery schedules are exportable to the sync bridge', async () => {
  const res = await fetch(base + '/api/sync/delivery-schedules', {
    headers: { 'x-sync-secret': 'test-sync-secret' },
  });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray((await res.json()).schedules));
});
