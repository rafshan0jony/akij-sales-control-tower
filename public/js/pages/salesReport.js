import { api, qs } from '../api.js';
import { el, money, fmt, toast } from '../ui.js';

let selectedDate = null;
let selectedTerritory = 'All';

export async function renderSalesReport(container, state) {
  const params = { filter: state.filter };
  if (state.filter === 'custom' && state.custom) {
    params.from = state.custom.from;
    params.to = state.custom.to;
  }
  if (selectedDate) params.date = selectedDate;
  if (selectedTerritory && selectedTerritory !== 'All') params.territory = selectedTerritory;
  const q = qs(params);

  const data = await api.get('/dashboard/sales-report?' + q);
  const today = data.today || '';
  const canEnter = !!data.canEnter;
  const own = data.own || null;
  const reports = data.reports || [];
  const viewingToday = !selectedDate || selectedDate === today;

  const addBtn = (canEnter && viewingToday && !own)
    ? el('button', { class: 'btn btn-primary btn-sm', text: '+ Add', onclick: async () => {
        try { await api.post('/dashboard/sales-report', {}); toast('Report added', 'success'); location.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } })
    : null;

  const dateInput = el('input', {
    type: 'date',
    value: selectedDate || '',
    placeholder: 'All dates',
    onchange: (e) => { selectedDate = e.target.value || null; container.innerHTML = ''; renderSalesReport(container, state); },
  });

  const territorySelect = el('select', { class: 'select', style: 'min-width:200px;' });
  territorySelect.appendChild(el('option', { value: 'All', text: 'All Territories' }));
  try {
    const d = await api.get('/dashboard/territory-list');
    const regions = d.regions || [];
    const areas = d.areas || [];
    const territories = d.territories || [];
    if (regions.length) {
      const rg = el('optgroup', { label: 'Regions' });
      for (const r of regions) rg.appendChild(el('option', { value: r, text: r }));
      territorySelect.appendChild(rg);
    }
    if (areas.length) {
      const ag = el('optgroup', { label: 'Areas' });
      for (const a of areas) ag.appendChild(el('option', { value: a, text: a }));
      territorySelect.appendChild(ag);
    }
    const byRegion = new Map();
    for (const t of territories) {
      const r = t.region || 'Unassigned';
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r).push(t);
    }
    for (const [region, items] of byRegion) {
      const og = el('optgroup', { label: region });
      for (const t of items) og.appendChild(el('option', { value: t.territory, text: t.territory }));
      territorySelect.appendChild(og);
    }
  } catch (_) { /* ignore — keep the "All" option */ }
  territorySelect.value = selectedTerritory;
  territorySelect.addEventListener('change', (e) => {
    selectedTerritory = e.target.value;
    container.innerHTML = '';
    renderSalesReport(container, state);
  });

  const columns = ['Employee', 'Territory', 'Date', 'Visit Schedule', 'Actual Visit Plan', 'Sales Proj. (MT)', 'Deposit Proj. (BDT)', 'Actual Sales (MT)', 'Actual Collect. (BDT)', 'TA/DA Details', 'Total TA/DA Bill', 'Projection', 'Actual'];

  const thead = el('tr', {}, columns.map((c) => el('th', { text: c })));

  const rows = [];
  if (canEnter && viewingToday && own) rows.push(buildEditableRow(own));
  reports
    .filter((r) => !(viewingToday && own && r.id === own.id))
    .forEach((r) => rows.push(buildReadonlyRow(r)));

  const tbody = rows.length
    ? rows
    : el('tr', {}, [el('td', { colspan: columns.length, style: 'text-align:center;color:var(--text-muted);padding:24px;', text: (canEnter && viewingToday) ? 'Click + Add to create today\'s report' : 'No reports yet' })]);

  container.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: 'Daily Sales Report' }),
      el('div', { style: 'margin-left:auto;display:flex;gap:10px;align-items:center;' }, [
        territorySelect,
        dateInput,
        addBtn,
      ]),
    ]),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'data sales-report-table' }, [el('thead', {}, [thead]), el('tbody', {}, tbody)])]),
  ]));
}

function buildEditableRow(own) {
  const projLocked = !!own.projectionSubmittedAt;
  const actLocked = !!own.actualSubmittedAt;

  const makeInput = (field, type, val, locked) => {
    const inp = el('input', { type, value: val == null ? '' : val, disabled: locked ? '' : null, 'data-field': field, style: 'width:105px;padding:6px;' });
    return el('td', {}, [inp]);
  };

  const save = async (submitProjection, submitActual) => {
    const read = (field) => {
      const inp = document.querySelector('[data-field="' + field + '"]');
      return inp ? inp.value : null;
    };
    const body = {
      actualVisitPlan: read('actualVisitPlan'),
      salesProjectionMt: read('salesProjectionMt'),
      depositProjectionBdt: read('depositProjectionBdt'),
      actualSalesMt: read('actualSalesMt'),
      actualCollectionBdt: read('actualCollectionBdt'),
      taDaDetails: read('taDaDetails'),
      taDaBill: read('taDaBill'),
      submitProjection,
      submitActual,
    };
    try { await api.post('/dashboard/sales-report', body); toast('Saved', 'success'); location.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const submitProjBtn = el('button', {
    class: 'btn btn-sm ' + (projLocked ? 'btn-ghost' : 'btn-primary'),
    text: projLocked ? '✓ Submitted' : 'Submit',
    disabled: projLocked ? '' : null,
    onclick: () => save(true, false),
  });
  const submitActBtn = el('button', {
    class: 'btn btn-sm ' + (actLocked ? 'btn-ghost' : 'btn-primary'),
    text: actLocked ? '✓ Submitted' : 'Submit',
    disabled: actLocked ? '' : null,
    onclick: () => save(false, true),
  });

  return el('tr', {}, [
    el('td', { text: own.userName || '' }),
    el('td', { class: 'muted wrap-cell', text: (own.territory || []).join(', ') || '—' }),
    el('td', { text: own.date }),
    el('td', { class: 'muted wrap-cell', text: own.visitSchedule || '—' }),
    // Actual Visit Plan renders as plain text (like Visit Schedule) once projection is submitted.
    projLocked
      ? el('td', { class: 'muted wrap-cell', text: own.actualVisitPlan || '—' })
      : makeInput('actualVisitPlan', 'text', own.actualVisitPlan, false),
    makeInput('salesProjectionMt', 'number', own.salesProjectionMt, projLocked),
    makeInput('depositProjectionBdt', 'number', own.depositProjectionBdt, projLocked),
    makeInput('actualSalesMt', 'number', own.actualSalesMt, actLocked),
    makeInput('actualCollectionBdt', 'number', own.actualCollectionBdt, actLocked),
    makeInput('taDaDetails', 'text', own.taDaDetails, actLocked),
    makeInput('taDaBill', 'number', own.taDaBill, actLocked),
    el('td', {}, [submitProjBtn]),
    el('td', {}, [submitActBtn]),
  ]);
}

function buildReadonlyRow(r) {
  return el('tr', {}, [
    el('td', { text: r.userName || '' }),
    el('td', { class: 'muted wrap-cell', text: (r.territory || []).join(', ') || '—' }),
    el('td', { text: r.date }),
    el('td', { class: 'muted wrap-cell', text: r.visitSchedule || '—' }),
    el('td', { class: 'wrap-cell', text: r.actualVisitPlan || '—' }),
    el('td', { text: r.salesProjectionMt == null ? '—' : fmt(r.salesProjectionMt, 2) }),
    el('td', { text: r.depositProjectionBdt == null ? '—' : money(r.depositProjectionBdt) }),
    el('td', { text: r.actualSalesMt == null ? '—' : fmt(r.actualSalesMt, 2) }),
    el('td', { text: r.actualCollectionBdt == null ? '—' : money(r.actualCollectionBdt) }),
    el('td', { class: 'wrap-cell', text: r.taDaDetails || '—' }),
    el('td', { text: r.taDaBill == null ? '—' : money(r.taDaBill) }),
    el('td', { text: r.projectionSubmittedAt ? '✓ ' + r.projectionSubmittedAt.slice(11, 16) : '—' }),
    el('td', { text: r.actualSubmittedAt ? '✓ ' + r.actualSubmittedAt.slice(11, 16) : '—' }),
  ]);
}
