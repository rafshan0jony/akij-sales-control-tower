import { api, qs } from '../api.js';
import { el, money, compactMoney, pct, fmt, statusBadge, emptyState } from '../ui.js';
import { kpiGrid, card, chartCard } from './common.js';
import { lineChart, barChart } from '../charts.js';
import { dataTable } from '../ui.js';

const fmtMt = (v) => {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

export async function renderTarget(container, state) {
  const data = await api.get('/target-achievement?' + qs(state.query()));
  const m = data.metrics || {};

  const achPct = m.achievementMtPct != null ? m.achievementMtPct : m.achievementPct;

  container.appendChild(kpiGrid([
    { label: 'Target', value: fmt(m.targetMt, 0) + ' MT' },
    { label: 'Achievement (Delivery)', value: fmt(m.achievementMt, 0) + ' MT' },
    { label: 'Achievement %', value: pct(achPct), opts: { color: achColor(achPct) } },
    { label: 'Pending Target', value: fmt(m.pendingTargetMt, 0) + ' MT' },
    { label: 'Required Daily', value: fmt(m.requiredDaily, 1) + ' MT' },
    { label: 'Required Weekly', value: fmt(m.requiredWeekly, 1) + ' MT' },
    { label: 'Forecast', value: fmt(m.forecast, 0) + ' MT' },
    { label: 'Run Rate', value: pct(m.runRatePct) },
    { label: 'Month Progress', value: pct(m.monthProgressPct) },
  ]));

  // Matrix report: Region -> Area -> Territory x Product (Target/Delivery/Achv.%)
  if (data.matrix && data.matrix.rows && data.matrix.rows.length) {
    container.appendChild(matrixCard(data.matrix));
  }

  container.appendChild(el('div', { class: 'grid-2', style: 'margin-top:18px;' }, [
    card('Performance Status', el('div', { style: 'display:flex;gap:10px;align-items:center;' }, [
      statusBadge(m.status || 'Behind'),
      el('span', { class: 'muted', text: `Achievement ${pct(achPct)} vs month progress ${pct(m.monthProgressPct)}` }),
    ])),
    card('Target vs Achievement (MT)', el('div', { class: 'chart-box', style: 'height:140px;' }, [el('canvas', { id: 'ta-bar' })])),
  ]));

  const cumulative = data.cumulative || [];
  container.appendChild(chartCard('Daily Cumulative Achievement', 'ta-cum'));
  lineChart('ta-cum', cumulative.map((c) => c.date.slice(5)), [
    { label: 'Cumulative Achievement', data: cumulative.map((c) => c.achievement), color: '#0f766e' },
  ]);
  barChart('ta-bar', ['Target (MT)', 'Achievement (MT)'], [{ label: 'MT', data: [m.targetMt, m.achievementMt], color: '#2563eb' }], { stacked: false });

  // Product-wise target vs achievement (delivery MT)
  const products = data.byProduct || [];
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const pTgt = sum(products, 'targetMt');
  const pDel = sum(products, 'deliveryMt');
  const pSoMt = sum(products, 'salesMt');
  const pPend = sum(products, 'pendingMt');
  const productTotal = {
    __total: true,
    product: 'Total',
    targetMt: Math.round(pTgt * 10) / 10,
    deliveryMt: Math.round(pDel * 10) / 10,
    achievementPct: pTgt > 0 ? Math.round((pDel / pTgt) * 1000) / 10 : 0,
    remainingMt: Math.round(Math.max(0, pTgt - pDel) * 10) / 10,
    salesMt: Math.round(pSoMt * 10) / 10,
    pendingMt: Math.round(pPend * 10) / 10,
  };
  container.appendChild(card('Product-wise Target vs Achievement (Delivery MT)', dataTable({
    columns: [
      { label: 'Product', key: 'product' },
      { label: 'Target (MT)', key: 'targetMt', align: 'right', format: fmtMt },
      { label: 'Delivery (MT)', key: 'deliveryMt', align: 'right', format: fmtMt },
      { label: 'Achievement %', key: 'achievementPct', pct: true, align: 'right' },
      { label: 'Remaining (MT)', key: 'remainingMt', align: 'right', format: fmtMt },
      { label: 'Pending (MT)', key: 'pendingMt', align: 'right', format: fmtMt },
    ],
    rows: products.concat(productTotal),
  })));

  // Region-wise target vs achievement (delivery MT)
  container.appendChild(levelTable('Region Target vs Achievement', data.byRegion || [], 'region', 'Region'));

  // Area-wise target vs achievement (delivery MT)
  container.appendChild(levelTable('Area Target vs Achievement', data.byArea || [], 'area', 'Area'));

  // Territory-wise target vs achievement (delivery MT)
  const territories = data.byTerritory || [];
  const mpct = m.monthProgressPct || 0;
  const terrRows = territories.map((t) => ({ ...t, __warn: t.targetMt > 0 && t.achievementPct < mpct }));
  const tSum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const tTgt = tSum(territories, 'targetMt');
  const tDel = tSum(territories, 'deliveryMt');
  const tSales = tSum(territories, 'salesMt');
  const tPend = tSum(territories, 'pendingMt');
  const territoryTotal = {
    __total: true,
    territory: 'Total',
    targetMt: Math.round(tTgt * 10) / 10,
    deliveryMt: Math.round(tDel * 10) / 10,
    achievementPct: tTgt > 0 ? Math.round((tDel / tTgt) * 1000) / 10 : 0,
    remainingMt: Math.round(Math.max(0, tTgt - tDel) * 10) / 10,
    salesMt: Math.round(tSales * 10) / 10,
    orderAchievementPct: tTgt > 0 ? Math.round((tSales / tTgt) * 1000) / 10 : 0,
    pendingMt: Math.round(tPend * 10) / 10,
  };

  const roleCode = state.user && state.user.role ? state.user.role.code : '';
  const canDownload = roleCode === 'ADMIN' || roleCode === 'NATIONAL';

  const terrCard = el('div', { class: 'card', id: 'territory-report' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: 'Territory Target vs Achievement' }),
      canDownload ? el('div', {}, [el('button', { class: 'btn btn-sm', text: '⬇ Download Image', onclick: () => downloadTerritoryReport(m) })]) : null,
    ]),
    el('div', { class: 'card-body' }, [dataTable({
      columns: [
        { label: 'Territory', key: 'territory' },
        { label: 'Target (MT)', key: 'targetMt', align: 'right', format: fmtMt },
        { label: 'Delivery (MT)', key: 'deliveryMt', align: 'right', format: fmtMt },
        { label: 'Achievement %', key: 'achievementPct', pct: true, align: 'right' },
        { label: 'Remaining (MT)', key: 'remainingMt', align: 'right', format: fmtMt },
        { label: 'Pending (MT)', key: 'pendingMt', align: 'right', format: fmtMt },
      ],
      rows: terrRows.concat(territoryTotal),
    })]),
  ]);
  container.appendChild(terrCard);
}

/** Render a Region/Area/Territory rollup target-vs-achievement table. */
function levelTable(title, rows, key, label) {
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const tTgt = sum(rows, 'targetMt');
  const tDel = sum(rows, 'deliveryMt');
  const tSales = sum(rows, 'salesMt');
  const tPend = sum(rows, 'pendingMt');
  const total = {
    __total: true,
    [key]: 'Total',
    targetMt: Math.round(tTgt * 10) / 10,
    deliveryMt: Math.round(tDel * 10) / 10,
    achievementPct: tTgt > 0 ? Math.round((tDel / tTgt) * 1000) / 10 : 0,
    remainingMt: Math.round(Math.max(0, tTgt - tDel) * 10) / 10,
    salesMt: Math.round(tSales * 10) / 10,
    orderAchievementPct: tTgt > 0 ? Math.round((tSales / tTgt) * 1000) / 10 : 0,
    pendingMt: Math.round(tPend * 10) / 10,
  };
  return card(title, dataTable({
    columns: [
      { label, key },
      { label: 'Target (MT)', key: 'targetMt', align: 'right', format: fmtMt },
      { label: 'Delivery (MT)', key: 'deliveryMt', align: 'right', format: fmtMt },
      { label: 'Achievement %', key: 'achievementPct', pct: true, align: 'right' },
      { label: 'Remaining (MT)', key: 'remainingMt', align: 'right', format: fmtMt },
      { label: 'Pending (MT)', key: 'pendingMt', align: 'right', format: fmtMt },
    ],
    rows: rows.concat(total),
  }));
}

async function downloadTerritoryReport(m) {
  const cardEl = document.getElementById('territory-report');
  if (!cardEl || typeof html2canvas === 'undefined') return;
  const header = el('div', { style: 'padding:10px 16px;border-bottom:1px solid #e5e9f0;' }, [
    el('div', { style: 'font-weight:700;', text: 'Download Date: ' + new Date().toLocaleString('en-GB') }),
    el('div', { style: 'font-size:12px;color:#64748b;margin-top:2px;', text: 'Month Progress: ' + pct(m.monthProgressPct) }),
  ]);
  cardEl.insertBefore(header, cardEl.firstChild);
  try {
    const canvas = await html2canvas(cardEl, { scale: 2, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = 'territory-target-achievement-' + new Date().toISOString().slice(0, 10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    cardEl.removeChild(header);
  }
}

function achColor(p) {
  if (p >= 100) return 'var(--success)';
  if (p >= 90) return 'var(--warning)';
  return 'var(--danger)';
}

// ---------------------------------------------------------------------------
// Matrix report (Region -> Area -> Territory rows x Product columns)
// ---------------------------------------------------------------------------
function zeroVals(products) {
  const o = {};
  for (const p of products) o[p] = { targetMt: 0, deliveryMt: 0 };
  return o;
}

function sumVals(vals, products) {
  const acc = zeroVals(products);
  for (const v of vals) for (const p of products) {
    acc[p].targetMt += Number(v.values[p].targetMt) || 0;
    acc[p].deliveryMt += Number(v.values[p].deliveryMt) || 0;
  }
  const out = {};
  for (const p of products) {
    const t = acc[p].targetMt, d = acc[p].deliveryMt;
    out[p] = { targetMt: Math.round(t * 10) / 10, deliveryMt: Math.round(d * 10) / 10, achvPct: t > 0 ? Math.round((d / t) * 1000) / 10 : 0 };
  }
  return out;
}

/** Flatten to display rows: territory details first, then area/region subtotals below. */
function buildMatrixRows(matrix) {
  const products = matrix.products;
  const regions = new Map();
  for (const r of matrix.rows) {
    if (!regions.has(r.region)) regions.set(r.region, { name: r.region, areas: new Map(), rows: [] });
    const reg = regions.get(r.region);
    if (!reg.areas.has(r.area)) reg.areas.set(r.area, { name: r.area, rows: [] });
    reg.areas.get(r.area).rows.push(r);
    reg.rows.push(r);
  }
  const out = [];
  for (const reg of regions.values()) {
    for (const area of reg.areas.values()) {
      for (const t of area.rows) out.push({ kind: 'territory', region: reg.name, area: area.name, name: t.territory, values: t.values });
      out.push({ kind: 'area', region: reg.name, name: area.name, values: sumVals(area.rows, products) });
    }
    out.push({ kind: 'region', name: reg.name, values: sumVals(reg.rows, products) });
  }
  out.push({ kind: 'national', name: 'National', values: sumVals(matrix.rows, products) });
  return out;
}

function matrixCard(matrix) {
  const products = matrix.products;
  const rows = buildMatrixRows(matrix);

  let html = '<table class="data-table matrix-table"><thead>';
  html += '<tr><th class="sticky" rowspan="2">Region</th><th rowspan="2">Area</th><th rowspan="2">Territory</th>';
  for (const p of products) html += '<th colspan="3">' + p + '</th>';
  html += '</tr><tr>';
  for (const p of products) html += '<th>Target</th><th>Delivery</th><th>Achv.%</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    const cls = r.kind === 'national' ? 'matrix-national' : (r.kind === 'region' ? 'matrix-region' : (r.kind === 'area' ? 'matrix-area' : 'matrix-territory'));
    const bold = r.kind !== 'territory';
    let regionCell, areaCell, terrCell;
    if (r.kind === 'territory') { regionCell = r.region || ''; areaCell = r.area || ''; terrCell = r.name; }
    else if (r.kind === 'area') { regionCell = r.region || ''; areaCell = r.name; terrCell = 'TOTAL'; }
    else if (r.kind === 'region') { regionCell = r.name; areaCell = 'TOTAL'; terrCell = ''; }
    else { regionCell = r.name; areaCell = ''; terrCell = ''; }
    html += '<tr class="' + cls + '">';
    html += '<td>' + (bold ? '<strong>' : '') + regionCell + (bold ? '</strong>' : '') + '</td>';
    html += '<td>' + (bold ? '<strong>' : '') + areaCell + (bold ? '</strong>' : '') + '</td>';
    html += '<td>' + terrCell + '</td>';
    for (const p of products) {
      const v = r.values[p] || { targetMt: 0, deliveryMt: 0, achvPct: 0 };
      html += '<td>' + (bold ? '<strong>' : '') + (v.targetMt > 0 ? fmt(v.targetMt, 1) : '') + (bold ? '</strong>' : '') + '</td>';
      html += '<td>' + (bold ? '<strong>' : '') + (v.deliveryMt > 0 ? fmt(v.deliveryMt, 1) : '') + (bold ? '</strong>' : '') + '</td>';
      html += '<td>' + (bold ? '<strong>' : '') + (v.achvPct > 0 ? v.achvPct + '%' : '') + (bold ? '</strong>' : '') + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  const wrap = el('div', { class: 'matrix-scroll' });
  wrap.innerHTML = html;

  return el('div', { class: 'card', id: 'matrix-report' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: 'Target vs Achievement Matrix (Region → Area → Territory × Product)' }),
      el('div', {}, [el('button', { class: 'btn btn-sm', text: '⬇ Download Excel', onclick: () => downloadMatrixExcel(matrix) })]),
    ]),
    el('div', { class: 'card-body' }, [wrap]),
  ]);
}

function downloadMatrixExcel(matrix) {
  const products = matrix.products;
  const rows = buildMatrixRows(matrix);

  // Build an HTML table (Excel opens HTML tables as a real .xls with grouped headers).
  let html = '<table border="1"><thead>';
  html += '<tr><th rowspan="2">Region</th><th rowspan="2">Area</th><th rowspan="2">Territory</th>';
  for (const p of products) html += '<th colspan="3">' + p + '</th>';
  html += '</tr><tr>';
  for (const p of products) html += '<th>Target</th><th>Delivery</th><th>Achv.%</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    let regionCell, areaCell, terrCell;
    if (r.kind === 'territory') { regionCell = r.region || ''; areaCell = r.area || ''; terrCell = r.name; }
    else if (r.kind === 'area') { regionCell = r.region || ''; areaCell = r.name; terrCell = 'TOTAL'; }
    else if (r.kind === 'region') { regionCell = r.name; areaCell = 'TOTAL'; terrCell = ''; }
    else { regionCell = r.name; areaCell = ''; terrCell = ''; }
    const bold = r.kind !== 'territory';
    html += '<tr>';
    html += '<td>' + (bold ? '<b>' : '') + regionCell + (bold ? '</b>' : '') + '</td>';
    html += '<td>' + (bold ? '<b>' : '') + areaCell + (bold ? '</b>' : '') + '</td>';
    html += '<td>' + (bold ? '<b>' : '') + terrCell + (bold ? '</b>' : '') + '</td>';
    for (const p of products) {
      const v = r.values[p] || { targetMt: 0, deliveryMt: 0, achvPct: 0 };
      const b = bold ? '<b>' : '', be = bold ? '</b>' : '';
      html += '<td>' + b + (v.targetMt > 0 ? v.targetMt : '') + be + '</td>';
      html += '<td>' + b + (v.deliveryMt > 0 ? v.deliveryMt : '') + be + '</td>';
      html += '<td>' + b + (v.achvPct > 0 ? v.achvPct : '') + be + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  const full = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  const blob = new Blob(['\uFEFF' + full], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.download = 'target-vs-achievement-matrix-' + new Date().toISOString().slice(0, 10) + '.xls';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
