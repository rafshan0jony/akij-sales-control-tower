import { api } from '../api.js';
import { el, money, fmt, toast, emptyState } from '../ui.js';

export async function renderSalesReport(container, state) {
  const data = await api.get('/dashboard/sales-report');
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

  const isManager = !canEnter;
  const columns = isManager
    ? ['Employee', 'Territory', 'Date', 'Visit Schedule', 'Actual Visit Plan', 'Sales Projection (MT)', 'Deposit Projection (BDT)', 'Actual Sales (MT)', 'Actual Collection (BDT)', 'Projection', 'Actual']
    : ['Date', 'Visit Schedule', 'Actual Visit Plan', 'Sales Projection (MT)', 'Deposit Projection (BDT)', 'Actual Sales (MT)', 'Actual Collection (BDT)', 'Submit Projection', 'Submit Actual'];

  const thead = el('tr', {}, columns.map((c) => el('th', { text: c })));

  let tbody;
  if (canEnter) {
    tbody = own ? buildEditableRow(own) : el('tr', {}, [el('td', { colspan: columns.length, style: 'text-align:center;color:var(--text-muted);padding:24px;', text: 'Click + Add to create today\'s report' })]);
  } else {
    tbody = reports.length
      ? reports.map((r) => buildReadonlyRow(r))
      : el('tr', {}, [el('td', { colspan: columns.length, style: 'text-align:center;color:var(--text-muted);padding:24px;', text: 'No reports yet' })]);
  }

  container.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: 'Daily Sales Report' }),
      el('div', { style: 'margin-left:auto;display:flex;gap:10px;align-items:center;' }, [
        el('input', { type: 'date', value: today, disabled: '' }),
        addBtn,
      ]),
    ]),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [el('thead', {}, [thead]), el('tbody', {}, tbody)])]),
  ]));
}

function buildEditableRow(own) {
  const inputs = {};
  const makeInput = (field, type, val) => {
    const inp = el('input', { type, value: val == null ? '' : val, 'data-field': field, style: 'width:110px;padding:6px;' });
    inputs[field] = inp;
    return el('td', {}, [inp]);
  };

  const save = async (submitProjection, submitActual) => {
    const body = {
      actualVisitPlan: inputs.actualVisitPlan.value,
      salesProjectionMt: inputs.salesProjectionMt.value,
      depositProjectionBdt: inputs.depositProjectionBdt.value,
      actualSalesMt: inputs.actualSalesMt.value,
      actualCollectionBdt: inputs.actualCollectionBdt.value,
      submitProjection,
      submitActual,
    };
    try { await api.post('/dashboard/sales-report', body); toast('Saved', 'success'); location.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const submitProjBtn = el('button', {
    class: 'btn btn-sm ' + (own.projectionSubmittedAt ? 'btn-ghost' : 'btn-primary'),
    text: own.projectionSubmittedAt ? '✓ Submitted' : 'Submit',
    onclick: () => save(true, false),
  });
  const submitActBtn = el('button', {
    class: 'btn btn-sm ' + (own.actualSubmittedAt ? 'btn-ghost' : 'btn-primary'),
    text: own.actualSubmittedAt ? '✓ Submitted' : 'Submit',
    onclick: () => save(false, true),
  });

  return el('tr', {}, [
    el('td', { text: own.date }),
    el('td', { class: 'muted', text: own.visitSchedule || '—' }),
    makeInput('actualVisitPlan', 'text', own.actualVisitPlan),
    makeInput('salesProjectionMt', 'number', own.salesProjectionMt),
    makeInput('depositProjectionBdt', 'number', own.depositProjectionBdt),
    makeInput('actualSalesMt', 'number', own.actualSalesMt),
    makeInput('actualCollectionBdt', 'number', own.actualCollectionBdt),
    el('td', {}, [submitProjBtn]),
    el('td', {}, [submitActBtn]),
  ]);
}

function buildReadonlyRow(r) {
  return el('tr', {}, [
    el('td', { text: r.userName || '' }),
    el('td', { class: 'muted', text: (r.territory || []).join(', ') || '—' }),
    el('td', { text: r.date }),
    el('td', { class: 'muted', text: r.visitSchedule || '—' }),
    el('td', { text: r.actualVisitPlan || '—' }),
    el('td', { text: r.salesProjectionMt == null ? '—' : fmt(r.salesProjectionMt, 2) }),
    el('td', { text: r.depositProjectionBdt == null ? '—' : money(r.depositProjectionBdt) }),
    el('td', { text: r.actualSalesMt == null ? '—' : fmt(r.actualSalesMt, 2) }),
    el('td', { text: r.actualCollectionBdt == null ? '—' : money(r.actualCollectionBdt) }),
    el('td', { text: r.projectionSubmittedAt ? '✓ ' + r.projectionSubmittedAt.slice(11, 16) : '—' }),
    el('td', { text: r.actualSubmittedAt ? '✓ ' + r.actualSubmittedAt.slice(11, 16) : '—' }),
  ]);
}
