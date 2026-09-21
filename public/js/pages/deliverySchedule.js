import { api } from '../api.js';
import { el } from '../ui.js';
import { card } from './common.js';

export async function renderDeliverySchedule(container) {
  const data = await api.get('/delivery-schedules/pending');
  const rows = data.rows || [];
  const customers = [...new Set(rows.map((r) => r.customer))].sort();
  const customerSelect = el('select', { class: 'form-control' }, [
    el('option', { value: '', text: 'Select customer' }),
    ...customers.map((customer) => el('option', { value: customer, text: customer })),
  ]);
  const orderSelect = el('select', { class: 'form-control' }, [el('option', { value: '', text: 'Select sales order' })]);
  const date = el('input', { class: 'form-control', type: 'date' });
  const today = new Date();
  const iso = (value) => value.toISOString().slice(0, 10);
  date.min = iso(today);
  today.setDate(today.getDate() + 1);
  date.value = iso(today);
  const lineBox = el('div', { class: 'schedule-lines-empty', text: 'Select a customer and sales order to view pending line items.' });
  const inputs = new Map();

  function refreshOrders() {
    orderSelect.innerHTML = '';
    orderSelect.appendChild(el('option', { value: '', text: 'Select sales order' }));
    [...new Set(rows.filter((r) => r.customer === customerSelect.value).map((r) => r.orderNo))].forEach((order) => {
      orderSelect.appendChild(el('option', { value: order, text: order }));
    });
    renderLines();
  }

  function renderLines() {
    inputs.clear();
    const orderRows = rows.filter((r) => r.customer === customerSelect.value && r.orderNo === orderSelect.value);
    if (!orderRows.length) {
      lineBox.className = 'schedule-lines-empty';
      lineBox.textContent = 'Select a customer and sales order to view pending line items.';
      return;
    }
    lineBox.className = 'schedule-lines';
    lineBox.innerHTML = '';
    const body = el('tbody');
    for (const row of orderRows) {
      const input = el('input', { class: 'form-control schedule-qty', type: 'number', min: '0', max: row.availableQtyBags, step: '0.01', placeholder: 'Enter bags' });
      inputs.set(row.key, input);
      body.appendChild(el('tr', {}, [
        el('td', { text: row.item }),
        el('td', { text: row.uom || 'Bag' }),
        el('td', { text: String(row.orderQtyBags) }),
        el('td', { text: String(row.pendingQtyBags) }),
        el('td', { text: String(row.availableQtyBags) }),
        el('td', {}, [input]),
      ]));
    }
    lineBox.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        'Item', 'UOM', 'Order Qty (bags)', 'Pending Qty (bags)', 'Available (bags)', 'Schedule Qty (bags)',
      ].map((label) => el('th', { text: label })))]),
      body,
    ]));
  }

  customerSelect.addEventListener('change', refreshOrders);
  orderSelect.addEventListener('change', renderLines);
  const submit = el('button', { class: 'btn btn-success', text: 'Submit schedule' });
  const message = el('div', { class: 'form-help' });
  submit.onclick = async () => {
    const orderRows = rows.filter((r) => r.customer === customerSelect.value && r.orderNo === orderSelect.value);
    const selected = orderRows.map((row) => ({ ...row, scheduleQtyBags: Number(inputs.get(row.key)?.value || 0) })).filter((row) => row.scheduleQtyBags > 0);
    if (!date.value || !selected.length) { message.textContent = 'Choose a delivery date and enter schedule quantity for at least one item.'; return; }
    submit.disabled = true;
    try {
      const result = await api.post('/delivery-schedules', { deliveryDate: date.value, lines: selected });
      message.textContent = result.chatStatus === 'sent' ? 'Schedule submitted and posted to Google Chat.' : `Schedule submitted. Chat warning: ${result.warning}`;
      renderLines();
    } catch (error) { message.textContent = error.message; }
    submit.disabled = false;
  };

  const form = el('div', { class: 'form-grid' }, [
    el('label', {}, ['Customer', customerSelect]), el('label', {}, ['Sales Order', orderSelect]),
    el('label', {}, ['Recommended Delivery Date', date]),
  ]);
  container.appendChild(card('Create Delivery Schedule', form));
  container.appendChild(card('Pending Line Items', lineBox));
  container.appendChild(submit);
  container.appendChild(message);
}
