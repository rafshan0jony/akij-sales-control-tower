'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

function ts() {
  return new Date().toISOString();
}

function write(level, args) {
  const line = `[${ts()}] [${level}] ${args.map((a) => (typeof a === 'string' ? a : safe(a))).join(' ')}`;
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, line + '\n');
  } catch (_) {
    /* logging must never crash the app */
  }
}

function safe(obj) {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => (process.env.NODE_ENV === 'development' ? write('DEBUG', a) : undefined),
};
