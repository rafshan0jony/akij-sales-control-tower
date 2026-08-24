'use strict';

const usersRepo = require('../repos/users');
const rolesRepo = require('../repos/roles');
const territoriesRepo = require('../repos/territories');
const userTerritoriesRepo = require('../repos/userTerritories');
const { LEVELS } = require('../db');

/**
 * Core RBAC + hierarchical territory scope resolution.
 * All access decisions derive from this single module and are enforced
 * server-side. The frontend NEVER decides what data a user may see.
 */

/** Get the user's assigned role (or null). */
function getRoleForUser(user) {
  if (!user || !user.roleId) return null;
  return rolesRepo.findById(user.roleId);
}

/** Permission codes granted to a user via their role. */
function permissionsForUser(user) {
  const role = getRoleForUser(user);
  if (!role) return [];
  return rolesRepo.getPermissions(role.id);
}

function hasPermission(user, permission) {
  if (!user) return false;
  const perms = permissionsForUser(user);
  if (perms.includes(permission)) return true;
  // SYSTEM_ADMIN implies everything.
  return perms.includes('SYSTEM_ADMIN');
}

function isAdmin(user) {
  return hasPermission(user, 'SYSTEM_ADMIN') || hasPermission(user, 'MANAGE_USERS');
}

/**
 * Resolve the effective territory scope for a user.
 * Returns:
 *  - scopeAll: true when the user may see the whole organization (admin/national).
 *  - territoryIds: Set of territory ids (assigned nodes + descendants).
 *  - territoryNames: lowercase Set of permitted territory names.
 *  - level: the role hierarchy level (-1 admin, 0 national .. 4 territory).
 */
function resolveScope(user) {
  const role = getRoleForUser(user);
  if (!role) return { scopeAll: false, territoryIds: new Set(), territoryNames: new Set(), level: 4, role: null };

  const level = role.level;
  const assigned = userTerritoriesRepo.listForUser(user.id);

  // Admin or national with no explicit restriction -> everything.
  const isAdminRole = role.code === 'ADMIN' || role.level < 0;
  const isNationalUnrestricted = level === LEVELS.NATIONAL && assigned.length === 0;

  if (isAdminRole || isNationalUnrestricted) {
    return { scopeAll: true, territoryIds: new Set(), territoryNames: new Set(), level, role };
  }

  if (level === LEVELS.NATIONAL && assigned.length > 0) {
    // National user restricted to specific nodes -> scopeAll still true in practice.
    const ids = new Set();
    const names = new Set();
    for (const t of assigned) {
      for (const d of territoriesRepo.descendants(t.id)) {
        ids.add(d);
        const node = territoriesRepo.findById(d);
        if (node) names.add(node.name.toLowerCase());
      }
    }
    return { scopeAll: true, territoryIds: ids, territoryNames: names, level, role };
  }

  const ids = new Set();
  const names = new Set();
  for (const t of assigned) {
    ids.add(t.id);
    names.add(t.name.toLowerCase());
    for (const d of territoriesRepo.descendants(t.id)) {
      ids.add(d);
      const node = territoriesRepo.findById(d);
      if (node) names.add(node.name.toLowerCase());
    }
  }
  return { scopeAll: false, territoryIds: ids, territoryNames: names, level, role };
}

/**
 * Filter a fact row by the user's territory scope.
 * A fact is kept if scopeAll is true, or if the fact's territory matches a
 * permitted name, or if the fact has no territory but the user's level is
 * high enough to see unassigned data (national/admin only).
 */
function makeFactFilter(scope) {
  if (scope.scopeAll) return () => true;
  return (fact) => {
    const terr = fact.territory ? String(fact.territory).toLowerCase().trim() : '';
    if (!terr) return false; // unassigned facts are invisible to scoped users
    return scope.territoryNames.has(terr);
  };
}

/** Resolve the list of permitted territory ids (or null = all). */
function permittedTerritoryIds(scope) {
  if (scope.scopeAll) return null;
  return [...scope.territoryIds];
}

module.exports = {
  getRoleForUser,
  permissionsForUser,
  hasPermission,
  isAdmin,
  resolveScope,
  makeFactFilter,
  permittedTerritoryIds,
  LEVELS,
};
