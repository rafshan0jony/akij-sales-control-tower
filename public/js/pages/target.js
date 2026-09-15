import { api, qs } from '../api.js';
import { el, money, compactMoney, pct, fmt, statusBadge, emptyState } from '../ui.js';
import { kpiGrid, card, chartCard } from './common.js';
import { lineChart, barChart } from '../charts.js';
import { dataTable } from '../ui.js';

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
      { label: 'Target (MT)', key: 'targetMt' },
      { label: 'Delivery (MT)', key: 'deliveryMt' },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Remaining (MT)', key: 'remainingMt' },
      { label: 'Sales Order (MT)', key: 'salesMt' },
      { label: 'Pending (MT)', key: 'pendingMt' },
    ],
    rows: products.concat(productTotal),
  })));

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
        { label: 'Target (MT)', key: 'targetMt' },
        { label: 'Delivery (MT)', key: 'deliveryMt' },
        { label: 'Achievement %', key: 'achievementPct', pct: true },
        { label: 'Remaining (MT)', key: 'remainingMt' },
        { label: 'Sales Order (MT)', key: 'salesMt' },
        { label: 'Achievement from Order', key: 'orderAchievementPct', pct: true },
        { label: 'Pending (MT)', key: 'pendingMt' },
      ],
      rows: terrRows.concat(territoryTotal),
    })]),
  ]);
  container.appendChild(terrCard);
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
