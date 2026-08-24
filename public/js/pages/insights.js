import { api, qs } from '../api.js';
import { el, money, compactMoney, fmt, badge, emptyState } from '../ui.js';
import { card } from './common.js';
import { dataTable } from '../ui.js';

export async function renderInsights(container, state, view) {
  if (view === 'insights') {
    const data = await api.get('/dashboard/insights?' + qs(state.query()));
    const items = data.insights || [];
    container.appendChild(card('Key Insights', items.length
      ? el('div', { class: 'stack' }, items.map((i) =>
          el('div', { class: `insight-card sev-${i.severity}` }, [
            el('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:flex-start;' }, [
              el('div', { class: 'insight-title', text: i.title }),
              badge(i.severity, i.severity),
            ]),
            el('div', { class: 'insight-desc', text: i.description }),
            el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;', text: `Metric: ${i.metric} · Dimension: ${i.dimension}` }),
            i.action ? el('div', { class: 'insight-action', text: '→ ' + i.action }) : null,
          ])
        ))
      : emptyState('No insights available yet')));
    return;
  }

  if (view === 'recommendations') {
    const data = await api.get('/dashboard/recommendations?' + qs(state.query()));
    const items = data.recommendations || [];
    container.appendChild(card('Recommendations', items.length
      ? el('div', { class: 'stack' }, items.map((r) =>
          el('div', { class: 'insight-card sev-' + (r.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING') }, [
            el('div', { style: 'display:flex;justify-content:space-between;gap:10px;' }, [
              el('div', { class: 'insight-title', text: r.title }),
              badge(r.severity, r.severity === 'CRITICAL' ? 'danger' : 'warning'),
            ]),
            el('div', { class: 'insight-desc', text: r.description }),
          ])
        ))
      : emptyState('No recommendations available yet')));
    return;
  }

  // Tour plan
  const data = await api.get('/dashboard/tour-plan?' + qs(state.query()));
  const rows = data.tourPlan || [];
  container.appendChild(card('Tour Plan Guide', dataTable({
    columns: [
      { label: 'Customer', key: 'customer' },
      { label: 'Priority Score', key: 'priorityScore' },
      { label: 'Priority', key: 'priority', badge: true },
      { label: 'Pending Value', key: 'pendingValue', money: true },
      { label: 'Days Since Activity', key: 'lastVisitDays' },
      { label: 'Recommended Action', key: 'recommendedAction' },
    ],
    rows,
  })));
}
