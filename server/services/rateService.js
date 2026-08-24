'use strict';

/**
 * Rate sheet (source: Google Sheet "Rate sheet").
 * Provides the monthly target (Forecast MT) and announced price per product
 * (variant). The latest data-change date's values are used.
 */
const sheet = require('../data/rateSheet.json');

function normalize(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const entries = (sheet.rows || []).map((r) => ({
  date: r.date,
  product: String(r.product).trim(),
  forecastMt: normalize(r.forecastMt),
  price: normalize(r.price),
}));

// Use the latest date's entries.
let latestDate = '';
for (const e of entries) if (e.date > latestDate) latestDate = e.date;
const active = entries.filter((e) => e.date === latestDate);

const byProduct = new Map();
for (const e of active) byProduct.set(e.product.toLowerCase(), e);

function totalTargetMt() {
  return active.reduce((s, e) => s + e.forecastMt, 0);
}

function forecastMt(product) {
  const e = byProduct.get(String(product || '').toLowerCase());
  return e ? e.forecastMt : 0;
}

function priceFor(product) {
  const e = byProduct.get(String(product || '').toLowerCase());
  return e ? e.price : 0;
}

function list() {
  return active;
}

module.exports = { totalTargetMt, forecastMt, priceFor, list };
