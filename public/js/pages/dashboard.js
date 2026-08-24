import { api, qs } from '../api.js';
import { el, money, compactMoney, pct, fmt, statusBadge, badge, emptyState, errorState } from '../ui.js';
import { kpiGrid, kpiCard, card, chartCard } from './common.js';
import { lineChart, barChart, donutChart } from '../charts.js';

export async function renderDashboard(container, state) {
  const data = await api.get('/dashboard/summary?' + qs(state.query()));

  const k = data.kpis || {};
  const achPct = k.achievementPct || 0;
  const achColor = achPct >= 100 ? 'var(--success)' : achPct >= k.monthProgressPct ? 'var(--primary)' : achPct >= k.monthProgressPct - 10 ? 'var(--warning)' : 'var(--danger)';

  container.appendChild(el('div', {}, [
    kpiGrid([
      { label: 'MTD Target', value: compactMoney(k.mtdTarget) },
      { label: 'MTD Sales', value: compactMoney(k.mtdSalesValue), opts: { sub: `Achievement ${money(k.achievement)}` } },
      { label: 'Achievement %', value: pct(achPct), opts: { color: achColor } },
      { label: 'Pending Target', value: compactMoney(k.pendingTarget) },
      { label: 'Delivery', value: compactMoney(k.deliveryValue) },
      { label: 'Pending Order', value: compactMoney(k.pendingOrderValue), opts: { sub: `${k.pendingOrders} orders` } },
      { label: 'Active Customers', value: fmt(k.activeCustomers) },
      { label: 'Run Rate', value: pct(k.runRatePct) },
      { label: 'Month Progress', value: pct(k.monthProgressPct) },
    ]),
  ]));

  const prog = data.monthProgress || {};
  const status = statusBadge(k.performanceStatus || 'Behind');
  container.appendChild(el('div', { class: 'grid-3', style: 'margin-top:18px;' }, [
    card('Month Progress', el('div', { class: 'stack' }, [
      el('div', {}, [status]),
      el('div', { class: 'muted', text: `${prog.elapsedBusiness} of ${prog.totalBusinessDays} business days elapsed · ${prog.remainingBusiness} remaining` }),
      el('div', { style: 'margin-top:8px;' }, [el('div', { class: 'progress' }, [el('span', { style: `width:${Math.min(prog.monthProgressPct, 100)}%` })])]),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;', text: `Achievement ${pct(achPct)} vs month progress ${pct(prog.monthProgressPct)}` }),
    ])),
    card('Pacing', el('div', { class: 'stack' }, [
      row('Required daily sales', compactMoney(k.requiredDaily)),
      row('Forecast achievement', compactMoney(k.forecast)),
      row('Run rate', pct(k.runRatePct)),
    ])),
    card('Pending Snapshot', el('div', { class: 'stack' }, [
      row('Pending value', money(k.pendingOrderValue)),
      row('Pending quantity', fmt(k.pendingOrderQty)),
      row('Pending orders', fmt(k.pendingOrders)),
    ])),
  ]));

  const daily = data.trend || [];
  container.appendChild(el('div', { class: 'grid-2', style: 'margin-top:18px;' }, [
    chartCard('Sales & Delivery Trend', 'dash-trend'),
    chartCard('Sales Value by Day', 'dash-bar'),
  ]));

  lineChart('dash-trend', daily.map((d) => d.date.slice(5)), [
    { label: 'Sales', data: daily.map((d) => d.salesValue), color: '#0f766e' },
    { label: 'Delivery', data: daily.map((d) => d.deliveryValue), color: '#2563eb' },
  ]);
  barChart('dash-bar', daily.map((d) => d.date.slice(5)), [{ label: 'Sales', data: daily.map((d) => d.salesValue), color: '#0f766e' }]);

  // Insights + recommendations preview
  const [ins, rec] = await Promise.all([
    api.get('/dashboard/insights?' + qs(state.query())).catch(() => ({ insights: [] })),
    api.get('/dashboard/recommendations?' + qs(state.query())).catch(() => ({ recommendations: [] })),
  ]);

  const insightCards = (ins.insights || []).slice(0, 4).map((i) =>
    el('div', { class: `insight-card sev-${i.severity}` }, [
      el('div', { class: 'insight-title', text: i.title }),
      el('div', { class: 'insight-desc', text: i.description }),
    ])
  );
  const recCards = (rec.recommendations || []).slice(0, 4).map((r) =>
    el('div', { class: 'insight-card sev-WARNING' }, [
      el('div', { class: 'insight-title', text: r.title }),
      el('div', { class: 'insight-desc', text: r.description }),
    ])
  );

  container.appendChild(el('div', { class: 'grid-2', style: 'margin-top:18px;' }, [
    card('Key Insights', insightCards.length ? el('div', { class: 'stack' }, insightCards) : emptyState('No insights yet')),
    card('Recommendations', recCards.length ? el('div', { class: 'stack' }, recCards) : emptyState('No recommendations yet')),
  ]));
}

function row(label, value) {
  return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
    el('span', { class: 'muted', text: label }),
    el('span', { style: 'font-weight:600;', text: value }),
  ]);
}
