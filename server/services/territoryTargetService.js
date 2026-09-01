'use strict';

/**
 * Territory target (source: Google Sheet "territory target" tab).
 * Provides monthly target (MT) per territory and per product variant.
 * A "National" row holds the national product totals for the month.
 * By-product targets are excluded from totals (matching the rest of the app).
 */
const data = require('../data/territoryTarget.json');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const BYPRODUCT = 'By-Product';
const products = (data.products || []).filter((p) => p !== BYPRODUCT);

const byMonth = new Map();
for (const r of data.rows || []) {
  if (!byMonth.has(r.month)) byMonth.set(r.month, []);
  byMonth.get(r.month).push(r);
}

/** Sorted month list (YYYY-MM). */
function months() {
  return [...byMonth.keys()].sort();
}

/** Latest month available in the sheet. */
function latestMonth() {
  const ms = months();
  return ms.length ? ms[ms.length - 1] : '';
}

/** Product variants (excluding By-Product). */
function productsList() {
  return products;
}

/** Rows for a month (territory rows, excluding National). */
function rowsForMonth(month) {
  return (byMonth.get(month) || []).filter((r) => r.territory !== 'National');
}

/** National row for a month. */
function nationalRow(month) {
  return (byMonth.get(month) || []).find((r) => r.territory === 'National') || null;
}

/** Total target MT for a territory in a month (excluding By-Product). */
function territoryTotalMt(month, territory) {
  const r = (byMonth.get(month) || []).find((x) => x.territory === territory);
  if (!r) return 0;
  return products.reduce((s, p) => s + num(r.targets[p]), 0);
}

/** National total target MT for a month (excluding By-Product). */
function nationalTotalMt(month) {
  const r = nationalRow(month);
  if (!r) return 0;
  return products.reduce((s, p) => s + num(r.targets[p]), 0);
}

/** National target MT for a product in a month. */
function nationalProductMt(month, product) {
  const r = nationalRow(month);
  return r ? num(r.targets[product]) : 0;
}

/** Per-territory target MT for a month (excluding National & By-Product). */
function territoryTargets(month) {
  return rowsForMonth(month).map((r) => ({
    territory: r.territory,
    targetMt: products.reduce((s, p) => s + num(r.targets[p]), 0),
  }));
}

module.exports = {
  months,
  latestMonth,
  productsList,
  rowsForMonth,
  nationalRow,
  territoryTotalMt,
  nationalTotalMt,
  nationalProductMt,
  territoryTargets,
};
