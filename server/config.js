'use strict';

const path = require('node:path');
const fs = require('node:fs');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function bool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function intList(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return String(v).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
}

loadDotEnv();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),

  app: {
    company: process.env.APP_COMPANY || 'Akij Essentials Ltd.',
    name: process.env.APP_NAME || 'Sales Control Tower',
    channel: process.env.APP_CHANNEL || 'Rice Bulk',
    channelId: int(process.env.APP_CHANNEL_ID, 145),
    timezone: process.env.APP_TIMEZONE || 'Asia/Dhaka',
    financialYearStartMonth: int(process.env.FINANCIAL_YEAR_START_MONTH, 7),
    weekendDays: intList(process.env.WEEKEND_DAYS, [5, 6]),
  },

  mssql: {
    server: process.env.MSSQL_SERVER || '203.202.241.211',
    port: int(process.env.MSSQL_PORT, 1433),
    user: process.env.MSSQL_USER || 'mcp_user',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DATABASE || 'DWH',
    encrypt: bool(process.env.MSSQL_ENCRYPT, false),
    trustServerCertificate: bool(process.env.MSSQL_TRUST_SERVER_CERTIFICATE, true),
    connectionTimeout: int(process.env.MSSQL_CONNECTION_TIMEOUT, 15000),
    requestTimeout: int(process.env.MSSQL_REQUEST_TIMEOUT, 30000),
  },

  db: {
    path: process.env.APP_DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  sync: {
    intervalMs: int(process.env.SYNC_INTERVAL_MS, 300000),
    enabled: bool(process.env.SYNC_ENABLED, true),
    secret: process.env.SYNC_SECRET || 'change-me-sync-secret',
  },

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
  },
};

module.exports = config;
