'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashPassword } = require('./lib/passwords');

function ensureDir(p) {
  const dir = path.dirname(p);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function open() {
  ensureDir(config.db.path);
  const db = new DatabaseSync(config.db.path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      name TEXT NOT NULL,
      employee_id TEXT,
      password_hash TEXT NOT NULL,
      role_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      reset_token TEXT,
      reset_token_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 4,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_id, permission)
    );

    CREATE TABLE IF NOT EXISTS territories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 4,
      parent_id INTEGER,
      channel_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_territories (
      user_id INTEGER NOT NULL,
      territory_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, territory_id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      territory_id INTEGER NOT NULL,
      product TEXT NOT NULL,
      month TEXT NOT NULL,
      target_value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (territory_id, product, month)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      metadata TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      last_updated TEXT,
      last_success TEXT,
      error TEXT,
      failed_count INTEGER NOT NULL DEFAULT 0,
      data_source TEXT NOT NULL DEFAULT 'MCP',
      counts TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_data (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

const PERMISSIONS = [
  ['VIEW_SALES_ORDER', 'View Sales Order'],
  ['VIEW_DELIVERY', 'View Delivery'],
  ['VIEW_PENDING', 'View Pending'],
  ['VIEW_TARGET', 'View Target vs Achievement'],
  ['VIEW_CUSTOMER', 'View Customer data'],
  ['VIEW_PRODUCT', 'View Product/SKU data'],
  ['VIEW_ANALYTICS', 'View Analytics'],
  ['VIEW_RECOMMENDATION', 'View Recommendations'],
  ['VIEW_TOUR_PLAN', 'View Tour Plan'],
  ['EXPORT_DATA', 'Export data'],
  ['VIEW_HIGHER_LEVEL_SUMMARY', 'View higher-level summary'],
  ['MANAGE_USERS', 'Manage users'],
  ['MANAGE_ROLES', 'Manage roles'],
  ['MANAGE_PERMISSIONS', 'Manage permissions'],
  ['MANAGE_TERRITORIES', 'Manage territories'],
  ['SYSTEM_ADMIN', 'System administration'],
];

const LEVELS = { NATIONAL: 0, REGION: 1, AREA: 2, ZONE: 3, TERRITORY: 4 };

function seed(db) {
  const now = new Date().toISOString();

  const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (code, label) VALUES (?, ?)');
  for (const [code, label] of PERMISSIONS) insPerm.run(code, label);

  const roleCount = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
  if (roleCount === 0) {
    const insRole = db.prepare('INSERT INTO roles (code, name, level, active, created_at) VALUES (?, ?, ?, 1, ?)');
    const defs = [
      ['ADMIN', 'Administrator', -1],
      ['NATIONAL', 'National Manager', LEVELS.NATIONAL],
      ['REGION', 'Region Manager', LEVELS.REGION],
      ['AREA', 'Area Manager', LEVELS.AREA],
      ['ZONE', 'Zone Manager', LEVELS.ZONE],
      ['TERRITORY', 'Territory Officer', LEVELS.TERRITORY],
    ];
    for (const [code, name, level] of defs) insRole.run(code, name, level, now);

    const getRole = db.prepare('SELECT id FROM roles WHERE code = ?');
    const grant = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)');

    const adminId = getRole.get('ADMIN').id;
    for (const [code] of PERMISSIONS) grant.run(adminId, code);

    const dashPermissions = [
      'VIEW_SALES_ORDER', 'VIEW_DELIVERY', 'VIEW_PENDING', 'VIEW_TARGET',
      'VIEW_CUSTOMER', 'VIEW_PRODUCT', 'VIEW_ANALYTICS', 'VIEW_RECOMMENDATION',
      'VIEW_TOUR_PLAN', 'EXPORT_DATA',
    ];
    const nationalId = getRole.get('NATIONAL').id;
    for (const p of dashPermissions) grant.run(nationalId, p);
    grant.run(nationalId, 'VIEW_HIGHER_LEVEL_SUMMARY');

    const regionId = getRole.get('REGION').id;
    for (const p of dashPermissions) grant.run(regionId, p);

    const areaId = getRole.get('AREA').id;
    for (const p of dashPermissions) grant.run(areaId, p);

    const zoneId = getRole.get('ZONE').id;
    for (const p of dashPermissions) grant.run(zoneId, p);

    const terrId = getRole.get('TERRITORY').id;
    for (const p of dashPermissions) grant.run(terrId, p);
  }

  const terrCount = db.prepare('SELECT COUNT(*) AS c FROM territories').get().c;
  if (terrCount === 0) {
    db.prepare(
      "INSERT INTO territories (code, name, level, parent_id, channel_id, active, created_at) VALUES ('NATIONAL', 'National', 0, NULL, ?, 1, ?)"
    ).run(config.app.channelId, now);
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const adminRole = db.prepare('SELECT id FROM roles WHERE code = ?').get('ADMIN');
    const national = db.prepare('SELECT id FROM territories WHERE level = 0 LIMIT 1').get();
    const pwd = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';
    db.prepare(
      'INSERT INTO users (username, email, name, employee_id, password_hash, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('admin', 'admin@akij.local', 'System Administrator', 'A0000', hashPassword(pwd), adminRole.id, 'active', now);
    if (national) {
      db.prepare('INSERT OR IGNORE INTO user_territories (user_id, territory_id) VALUES (?, ?)').run(1, national.id);
    }
  }
}

let _db = null;

function getDb() {
  if (!_db) _db = open();
  return _db;
}

module.exports = { open, getDb, LEVELS, PERMISSIONS };
