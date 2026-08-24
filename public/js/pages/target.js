import { api, qs } from '../api.js';
import { el, money, compactMoney, pct, fmt, statusBadge, emptyState } from '../ui.js';
import { kpiGrid, card, chartCard } from './common.js';
import { lineChart, barChart } from '../charts.js';
import { dataTable } from '../ui.js';

export async function renderTarget(container, state) {
  const data = await api.get('/target-achievement?' + qs(state.query()));
  const m = data.metrics || {};

  container.appendChild(kpiGrid([
    { label: 'Target', value: compactMoney(m.target) },
    { label: 'Achievement', value: compactMoney(m.achievement) },
    { label: 'Achievement %', value: pct(m.achievementPct), opts: { color: achColor(m.achievementPct) } },
    { label: 'Gap', value: compactMoney(m.gap) },
    { label: 'Required Daily', value: compactMoney(m.requiredDaily) },
    { label: 'Required Weekly', value: compactMoney(m.requiredWeekly) },
    { label: 'Forecast', value: compactMoney(m.forecast) },
    { label: 'Run Rate', value: pct(m.runRatePct) },
    { label: 'Month Progress', value: pct(m.monthProgressPct) },
  ]));

  container.appendChild(el('div', { class: 'grid-2', style: 'margin-top:18px;' }, [
    card('Performance Status', el('div', { style: 'display:flex;gap:10px;align-items:center;' }, [
      statusBadge(m.status || 'Behind'),
      el('span', { class: 'muted', text: `Achievement ${pct(m.achievementPct)} vs month progress ${pct(m.monthProgressPct)}` }),
    ])),
    card('Target vs Achievement', el('div', { class: 'chart-box', style: 'height:140px;' }, [el('canvas', { id: 'ta-bar' })])),
  ]));

  const cumulative = data.cumulative || [];
  container.appendChild(chartCard('Daily Cumulative Achievement', 'ta-cum'));
  lineChart('ta-cum', cumulative.map((c) => c.date.slice(5)), [
    { label: 'Cumulative Achievement', data: cumulative.map((c) => c.achievement), color: '#0f766e' },
  ]);
  barChart('ta-bar', ['Target', 'Achievement'], [{ label: 'Value', data: [m.target, m.achievement], color: '#2563eb' }], { stacked: false });

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
