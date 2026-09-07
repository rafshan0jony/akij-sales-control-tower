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
  const pDelVal = sum(products, 'deliveryValue');
  const pSoMt = sum(products, 'salesMt');
  const pSoVal = sum(products, 'salesValue');
  const productTotal = {
    product: 'Total',
    targetMt: Math.round(pTgt * 10) / 10,
    deliveryMt: Math.round(pDel * 10) / 10,
    achievementPct: pTgt > 0 ? Math.round((pDel / pTgt) * 1000) / 10 : 0,
    deliveryValue: pDelVal,
    salesMt: Math.round(pSoMt * 10) / 10,
    salesValue: pSoVal,
  };
  container.appendChild(card('Product-wise Target vs Achievement (Delivery MT)', dataTable({
    columns: [
      { label: 'Product', key: 'product' },
      { label: 'Target (MT)', key: 'targetMt' },
      { label: 'Delivery (MT)', key: 'deliveryMt' },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Delivery Value', key: 'deliveryValue', money: true },
      { label: 'Sales Order (MT)', key: 'salesMt' },
      { label: 'Sales Order Value', key: 'salesValue', money: true },
    ],
    rows: products.concat(productTotal),
  })));

  // Territory-wise target vs achievement (delivery MT)
  const territories = data.byTerritory || [];
  container.appendChild(card('Territory Target vs Achievement', dataTable({
    columns: [
      { label: 'Territory', key: 'territory' },
      { label: 'Target (MT)', key: 'targetMt' },
      { label: 'Delivery (MT)', key: 'deliveryMt' },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Delivery Value', key: 'deliveryValue', money: true },
    ],
    rows: territories,
  })));
}

function achColor(p) {
  if (p >= 100) return 'var(--success)';
  if (p >= 90) return 'var(--warning)';
  return 'var(--danger)';
}
