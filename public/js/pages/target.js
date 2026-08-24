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
    { label: 'Target', value: fmt(m.targetMt, 0) + ' MT', opts: { sub: compactMoney(m.target) } },
    { label: 'Achievement', value: fmt(m.achievementMt, 0) + ' MT', opts: { sub: compactMoney(m.achievement) } },
    { label: 'Achievement %', value: pct(achPct), opts: { color: achColor(achPct) } },
    { label: 'Pending Target', value: fmt(m.pendingTargetMt, 0) + ' MT' },
    { label: 'Required Daily', value: compactMoney(m.requiredDaily) },
    { label: 'Required Weekly', value: compactMoney(m.requiredWeekly) },
    { label: 'Forecast', value: compactMoney(m.forecast) },
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

  // Product-wise target vs achievement (MT)
  const products = data.byProduct || [];
  container.appendChild(card('Product-wise Target vs Achievement (MT)', dataTable({
    columns: [
      { label: 'Product', key: 'product' },
      { label: 'Target (MT)', key: 'targetMt' },
      { label: 'Sales (MT)', key: 'salesMt' },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Sales Value', key: 'salesValue', money: true },
    ],
    rows: products,
  })));

  // Territory comparison table
  const territories = data.byTerritory || [];
  container.appendChild(card('Territory Comparison', dataTable({
    columns: [
      { label: 'Territory', key: 'territory' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Target', key: 'target', money: true },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Delivery', key: 'deliveryValue', money: true },
    ],
    rows: territories,
  })));
}

function achColor(p) {
  if (p >= 100) return 'var(--success)';
  if (p >= 90) return 'var(--warning)';
  return 'var(--danger)';
}
