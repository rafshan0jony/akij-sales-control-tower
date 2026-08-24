'use strict';

/** Round to `dec` decimals, avoiding float noise. */
function round(n, dec = 2) {
  const k = Math.pow(10, dec);
  return Math.round((Number(n) || 0) * k) / k;
}

/** Compact number formatting: 1.2M, 850K. */
function compact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return round(v / 1e9, 2) + 'B';
  if (abs >= 1e6) return round(v / 1e6, 2) + 'M';
  if (abs >= 1e3) return round(v / 1e3, 1) + 'K';
  return round(v, 2).toString();
}

/** Currency formatting in BDT with lakh/crore-aware grouping disabled (western grouping). */
function money(n, opts = {}) {
  const v = Number(n) || 0;
  const { decimals = 0, symbol = '৳' } = opts;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return symbol === '' ? s : `${symbol} ${s}`;
}

/** Percentage (already a fraction of 100). */
function pct(n, dec = 1) {
  const v = Number(n) || 0;
  return round(v, dec).toFixed(dec) + '%';
}

function safeDiv(a, b) {
  const denom = Number(b) || 0;
  if (denom === 0) return 0;
  return (Number(a) || 0) / denom;
}

module.exports = { round, compact, money, pct, safeDiv };
