'use strict';

process.env.APP_DB_PATH = ':memory:';
process.env.SYNC_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../server/db').getDb();
const usersRepo = require('../server/repos/users');
const rolesRepo = require('../server/repos/roles');
const territoriesRepo = require('../server/repos/territories');
const userTerritoriesRepo = require('../server/repos/userTerritories');
const permissionService = require('../server/services/permissionService');
const { hashPassword } = require('../server/lib/passwords');

function setupHierarchy() {
  const national = territoriesRepo.findByName('National');
  const mk = (code, name, level, parentId) => territoriesRepo.findByCode(code) || territoriesRepo.create({ code, name, level, parentId });
  const region = mk('R1', 'Region 1', 1, national.id);
  const zone = mk('Z1', 'Zone 1', 3, region.id);
  const tA = mk('T001', 'Dhaka North', 4, zone.id);
  const tB = mk('T002', 'Dhaka South', 4, zone.id);
  return { national, region, zone, tA, tB };
}

test('hierarchical scope: region manager sees all descendant territories', () => {
  const { region, tA, tB } = setupHierarchy();
  const role = rolesRepo.findByCode('REGION');
  const user = usersRepo.create({ username: 'rmgr', name: 'R Manager', passwordHash: hashPassword('x'), roleId: role.id });
  userTerritoriesRepo.assign(user.id, region.id);

  const scope = permissionService.resolveScope(user);
  assert.strictEqual(scope.scopeAll, false);
  assert.ok(scope.territoryNames.has('dhaka north'));
  assert.ok(scope.territoryNames.has('dhaka south'));
});

test('territory scope: user with Dhaka North must NOT see Dhaka South', () => {
  const { tA, tB } = setupHierarchy();
  const role = rolesRepo.findByCode('TERRITORY');
  const user = usersRepo.create({ username: 'tuser', name: 'T User', passwordHash: hashPassword('x'), roleId: role.id });
  userTerritoriesRepo.assign(user.id, tA.id);

  const scope = permissionService.resolveScope(user);
  assert.ok(scope.territoryNames.has('dhaka north'));
  assert.ok(!scope.territoryNames.has('dhaka south'));

  const filter = permissionService.makeFactFilter(scope);
  const facts = [
    { territory: 'Dhaka North', value: 100 },
    { territory: 'Dhaka South', value: 200 },
    { territory: '', value: 300 },
  ];
  const allowed = facts.filter(filter);
  assert.strictEqual(allowed.length, 1);
  assert.strictEqual(allowed[0].territory, 'Dhaka North');
});

test('national role with no assignment sees everything', () => {
  setupHierarchy();
  const role = rolesRepo.findByCode('NATIONAL');
  const user = usersRepo.create({ username: 'nmg', name: 'N Manager', passwordHash: hashPassword('x'), roleId: role.id });
  const scope = permissionService.resolveScope(user);
  assert.strictEqual(scope.scopeAll, true);
});

test('admin has full permissions', () => {
  const admin = usersRepo.findByUsername('admin');
  const perms = permissionService.permissionsForUser(admin);
  assert.ok(perms.includes('SYSTEM_ADMIN'));
  assert.ok(permissionService.hasPermission(admin, 'MANAGE_USERS'));
});

test('permissions are enforced per role', () => {
  const role = rolesRepo.findByCode('TERRITORY');
  const user = usersRepo.create({ username: 't2', name: 'T2', passwordHash: hashPassword('x'), roleId: role.id });
  assert.ok(permissionService.hasPermission(user, 'VIEW_SALES_ORDER'));
  assert.ok(!permissionService.hasPermission(user, 'MANAGE_USERS'));
});
