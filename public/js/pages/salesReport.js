import { api, qs } from '../api.js';
import { el, money, fmt, toast } from '../ui.js';

let selectedDate = null;

export async function renderSalesReport(container, state) {
  const q = qs(state.query()) + (selectedDate ? '&date=' + selectedDate : '');
  const data = await api.get('/dashboard/sales-report?' + q);
  const today = data.today || '';
  const canEnter = !!data.canEnter;
  const own = data.own || null;
  const reports = data.reports || [];

  const addBtn = (canEnter && !own)
    ? el('button', { class: 'btn btn-primary btn-sm', text: '+ Add', onclick: async () => {
        try { await api.post('/dashboard/sales-report', {}); toast('Report added', 'success'); location.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } })
    : null;

  // Calendar filter: disabled (today) for territory officers, selectable for managers.
  const dateInput = el('input', {
    type: 'date',
    value: selectedDate || today,
    disabled: canEnter ? '' : null,
    onchange: (e) => { selectedDate = e.target.value; container.innerHTML = ''; renderSalesReport(container, state); },
  });

  const isManager = !canEnter;
  const columns = isManager
    ? ['Employee', 'Territory', 'Date', 'Visit Schedule', 'Actual Visit Plan', 'Sales Proj. (MT)', 'Deposit Proj. (BDT)', 'Actual Sales (MT)', 'Actual Collect. (BDT)', 'TA/DA Details', 'Total TA/DA Bill', 'Projection', 'Actual']
    : ['Date', 'Visit Schedule', 'Actual Visit Plan', 'Sales Proj. (MT)', 'Deposit Proj. (BDT)', 'Actual Sales (MT)', 'Actual Collect. (BDT)', 'TA/DA Details', 'Total TA/DA Bill', 'Submit Projection', 'Submit Actual'];

  const thead = el('tr', {}, columns.map((c) => el('th', { text: c })));

  const rows = [];
  if (canEnter) {
    if (own) rows.push(buildEditableRow(own));
    reports.filter((r) => r.date !== today).forEach((r) => rows.push(buildReadonlyRow(r)));
  } else {
    reports.forEach((r) => rows.push(buildReadonlyRow(r)));
  }

  const tbody = rows.length
    ? rows
    : el('tr', {}, [el('td', { colspan: columns.length, style: 'text-align:center;color:var(--text-muted);padding:24px;', text: canEnter ? 'Click + Add to create today\'s report' : 'No reports yet' })]);

  container.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: 'Daily Sales Report' }),
      el('div', { style: 'margin-left:auto;display:flex;gap:10px;align-items:center;' }, [
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
    const body = {
      actualVisitPlan: document.querySelector('[data-field="actualVisitPlan"]')?.value ?? '',
      salesProjectionMt: document.querySelector('[data-field="salesProjectionMt"]')?.value ?? '',
      depositProjectionBdt: document.querySelector('[data-field="depositProjectionBdt"]')?.value ?? '',
      actualSalesMt: document.querySelector('[data-field="actualSalesMt"]')?.value ?? '',
      actualCollectionBdt: document.querySelector('[data-field="actualCollectionBdt"]')?.value ?? '',
      taDaDetails: document.querySelector('[data-field="taDaDetails"]')?.value ?? '',
      taDaBill: document.querySelector('[data-field="taDaBill"]')?.value ?? '',
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
    el('td', { text: own.date }),
    el('td', { class: 'muted wrap-cell', text: own.visitSchedule || '—' }),
    makeInput('actualVisitPlan', 'text', own.actualVisitPlan, projLocked),
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
