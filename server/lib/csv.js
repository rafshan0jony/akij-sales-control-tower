'use strict';

/** Escape a single CSV cell. */
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Build a CSV string from an array of objects. */
function toCsv(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const header = cols.map((c) => escapeCell(typeof c === 'string' ? c : c.header)).join(',');
  const body = rows.map((row) =>
    cols.map((c) => escapeCell(typeof c === 'string' ? row[c] : row[c.key])).join(',')
  );
  return [header, ...body].join('\r\n');
}

module.exports = { toCsv, escapeCell };
