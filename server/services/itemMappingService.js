'use strict';

/**
 * Item mapping (source: Google Sheet "item maping").
 * Maps DWH item names to a product "variant". Only "Rice" (head rice) items
 * are included — By-Product items are excluded from all reporting.
 */
const mapping = require('../data/itemMapping.json');

const byItem = new Map();
for (const r of mapping.rows) {
  const name = String(r.item).trim().toLowerCase();
  if (name) byItem.set(name, r);
}

function lookup(itemName) {
  if (!itemName) return null;
  let name = String(itemName).trim().toLowerCase();
  let m = byItem.get(name);
  if (m) return m;
  const stripped = name.replace(/\s*\[[^\]]*\]\s*$/, '');
  if (stripped !== name) {
    m = byItem.get(stripped);
    if (m) return m;
  }
  if (/kataribhog\s*atop/.test(name)) return { item: name, weight: '25', variant: 'Katari Atop' };
  return null;
}

/**
 * Resolve an item to its head-rice product variant.
 * Returns { product, weight, raw } or null when the item is a by-product
 * (or unmapped) and should be excluded from reporting.
 */
function resolveProduct(itemName) {
  const m = lookup(itemName);
  if (!m) return null;
  const product = (m.variant && String(m.variant).trim()) || String(itemName).trim();
  return { product, weight: m.weight, raw: String(itemName).trim() };
}

module.exports = { lookup, resolveProduct };
