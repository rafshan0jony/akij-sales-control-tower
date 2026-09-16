import { api, qs } from '../api.js';
import { el, money, compactMoney, fmt, badge, emptyState, toast } from '../ui.js';
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

  // Sales team tour plan (sheet + employee submissions)
  const sheetPlans = data.sheetTourPlan || [];
  const todayNum = data.today || new Date().getDate();
  const hour = data.hour;
  const isAdmin = !!data.isAdmin;
  const isManager = !!data.isManager;
  const currentUserId = data.currentUserId;

  container.appendChild(el('div', { class: 'card', style: 'margin-top:18px;' }, [
    el('div', { class: 'card-head' }, [el('div', { class: 'card-title', text: 'Sales Team Tour Plan (' + sheetPlans.length + ')' })]),
    el('div', { class: 'card-body p0' }, sheetPlans.length
      ? el('div', { class: 'stack' }, sheetPlans.map((p) => buildPlanCard(p, { todayNum, hour, isAdmin, isManager, currentUserId })))
      : emptyState('No tour plan submitted yet')),
  ]));
}

function buildPlanCard(p, opts) {
  const { todayNum, hour, isAdmin, isManager, currentUserId } = opts;
  const isSelf = p.userId === currentUserId;
  const entryByDay = new Map((p.entries || []).map((e) => [e.day, e]));

  const head = el('tr', {}, [
    el('th', { text: 'Date' }),
    el('th', { text: 'Visit Plan' }),
    el('th', { text: 'Sales Order (MT)' }),
    el('th', { text: 'Visit Plan Change' }),
    el('th', { text: 'TA/DA Details' }),
    el('th', { text: 'TA/DA Bill' }),
  ]);

  const bodyRows = [];
  for (let d = 1; d <= 31; d++) {
    const visitPlan = p.days[d - 1] || '';
    const entry = entryByDay.get(d) || {};
    const editable = (isSelf || isManager) && d === todayNum;
    const vpcLocked = d === todayNum && hour >= 14;

    bodyRows.push(el('tr', {}, [
      el('td', { text: 'Day ' + d }),
      el('td', { class: 'muted', text: visitPlan }),
      editable ? entryInput(d, 'salesOrderMt', 'number', entry.salesOrderMt, false, p.userId) : entryValue(entry.salesOrderMt),
      editable ? entryInput(d, 'visitPlanChange', 'text', entry.visitPlanChange, vpcLocked, p.userId) : entryValue(entry.visitPlanChange),
      editable ? entryInput(d, 'taDaDetails', 'text', entry.taDaDetails, false, p.userId) : entryValue(entry.taDaDetails),
      editable ? entryInput(d, 'taDaBill', 'text', entry.taDaBill, false, p.userId) : entryValue(entry.taDaBill),
    ]));
  }

  return el('div', { class: 'card', style: 'margin-bottom:12px;' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: p.name }),
      el('span', { class: 'muted', text: (p.territories || []).join(', ') || '—' }),
    ]),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [el('thead', {}, [head]), el('tbody', {}, bodyRows)])]),
  ]);
}

function entryInput(day, field, type, val, locked, userId) {
  const input = el('input', { type, value: val == null ? '' : val, 'data-field': field, disabled: locked ? '' : null, style: 'width:120px;padding:6px;' });
  input.addEventListener('change', async () => {
    const tr = input.closest('tr');
    const body = {
      day,
      userId,
      salesOrderMt: tr.querySelector('[data-field="salesOrderMt"]').value,
      visitPlanChange: tr.querySelector('[data-field="visitPlanChange"]').value,
      taDaDetails: tr.querySelector('[data-field="taDaDetails"]').value,
      taDaBill: tr.querySelector('[data-field="taDaBill"]').value,
    };
    try {
      await api.post('/dashboard/tour-plan/entry', body);
      toast('Saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return el('td', {}, [input]);
}

function entryValue(val) {
  return el('td', { text: val == null || val === '' ? '—' : val });
}
