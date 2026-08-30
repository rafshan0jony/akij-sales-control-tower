'use strict';

const config = require('../config');

const TZ = config.app.timezone;
const FY_START_MONTH = config.app.financialYearStartMonth;
const WEEKEND = config.app.weekendDays;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Return {y,m,d,dateStr,hour,minute} for a Date in the app timezone. */
function tzParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const h = Number(get('hour')) % 24;
  const min = Number(get('minute'));
  const sec = Number(get('second'));
  return { y, m, d, dateStr: `${y}-${pad(m)}-${pad(d)}`, hour: h, minute: min, second: sec };
}

function todayStr() {
  return tzParts().dateStr;
}

function toDateStr(input) {
  if (!input) return '';
  if (input instanceof Date) return tzParts(input).dateStr;
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return tzParts(d).dateStr;
  return s.slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00Z');
  const b = new Date(toStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return WEEKEND.includes(d.getUTCDay());
}

/** Number of calendar days in a month (year 1-12 month). */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Business days (excluding configured weekend) in a month. */
function businessDaysInMonth(year, month) {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    if (!isWeekend(`${year}-${pad(month)}-${pad(d)}`)) count++;
  }
  return count;
}

/** Elapsed business days up to and including today (or given date). */
function elapsedBusinessDays(year, month, uptoStr = todayStr()) {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`;
    if (ds > uptoStr) break;
    if (!isWeekend(ds)) count++;
  }
  return count;
}

/** Remaining business days strictly after uptoStr in the month. */
function remainingBusinessDays(year, month, uptoStr = todayStr()) {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`;
    if (ds > uptoStr && !isWeekend(ds)) count++;
  }
  return count;
}

/** Current month as {year, month}. */
function currentMonth(refStr = todayStr()) {
  const [y, m] = refStr.split('-').map(Number);
  return { year: y, month: m };
}

/** Previous month, handling year rollover. */
function prevMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/** First day of the month `months` months before refStr (e.g. 4 from Aug -> Apr 1). */
function monthsAgoStart(months, refStr = todayStr()) {
  const [y, m] = refStr.split('-').map(Number);
  let py = y;
  let pm = m - months;
  while (pm <= 0) { pm += 12; py -= 1; }
  return `${py}-${pad(pm)}-01`;
}

/** Financial year for a given date (default today). FY start month is configurable. */
function financialYear(refStr = todayStr()) {
  const [y, m] = refStr.split('-').map(Number);
  const startYear = m >= FY_START_MONTH ? y : y - 1;
  const endYear = startYear + 1;
  const start = `${startYear}-${pad(FY_START_MONTH)}-01`;
  const endMonth = FY_START_MONTH === 1 ? 12 : FY_START_MONTH - 1;
  const end = `${endYear}-${pad(endMonth)}-${pad(daysInMonth(endYear, endMonth))}`;
  return { startYear, endYear, start, end, label: `FY${String(startYear).slice(2)}-${String(endYear).slice(2)}` };
}

/**
 * Resolve a date-filter key into an inclusive {from, to} range (YYYY-MM-DD).
 * Supported: today, yesterday, this_week, this_month, last_month, ytd, fy, custom.
 */
function resolveRange(filter, custom = null) {
  const today = todayStr();
  const { year, month } = currentMonth(today);
  const pv = prevMonth(year, month);
  switch (filter) {
    case 'today':
      return { from: today, to: today, label: 'Today' };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y, label: 'Yesterday' };
    }
    case 'this_week': {
      const d = new Date(today + 'T00:00:00Z');
      const dow = d.getUTCDay(); // 0=Sun
      const from = addDays(today, -dow);
      return { from, to: today, label: 'This Week' };
    }
    case 'this_month':
      return { from: `${year}-${pad(month)}-01`, to: today, label: 'This Month' };
    case 'last_month':
      return {
        from: `${pv.year}-${pad(pv.month)}-01`,
        to: `${pv.year}-${pad(pv.month)}-${pad(daysInMonth(pv.year, pv.month))}`,
        label: 'Last Month',
      };
    case 'ytd':
      return { from: `${year}-01-01`, to: today, label: 'YTD' };
    case 'fy':
      return { ...financialYear(today), label: financialYear(today).label };
    case 'custom':
      if (custom && custom.from && custom.to) {
        return { from: toDateStr(custom.from), to: toDateStr(custom.to), label: 'Custom' };
      }
      return { from: `${year}-${pad(month)}-01`, to: today, label: 'This Month' };
    default:
      return { from: `${year}-${pad(month)}-01`, to: today, label: 'This Month' };
  }
}

module.exports = {
  TZ,
  pad,
  tzParts,
  todayStr,
  toDateStr,
  addDays,
  diffDays,
  isWeekend,
  daysInMonth,
  businessDaysInMonth,
  elapsedBusinessDays,
  remainingBusinessDays,
  currentMonth,
  prevMonth,
  monthsAgoStart,
  financialYear,
  resolveRange,
};
