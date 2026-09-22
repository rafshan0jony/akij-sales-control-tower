import { api } from '../api.js';
import { el } from '../ui.js';
import { card } from './common.js';

export async function renderDeliverySchedule(container) {
  let rows = [];
  try {
    const data = await api.get('/delivery-schedules/pending');
    rows = data.rows || [];
  } catch (_) {
    rows = [];
  }

  const customerSelect = el('select', { class: 'form-control' }, [
    el('option', { value: '', text: 'Select customer' }),
    ...(() => {
      const customers = [...new Set(rows.map((r) => r.customer))].sort();
      return customers.map((customer) => el('option', { value: customer, text: customer }));
    })(),
  ]);
  const orderSelect = el('select', { class: 'form-control' }, [el('option', { value: '', text: 'Select sales order' })]);
  const date = el('input', { class: 'form-control', type: 'date' });
  const today = new Date();
  const iso = (value) => value.toISOString().slice(0, 10);
  date.min = iso(today);
  today.setDate(today.getDate() + 1);
  date.value = iso(today);

  const lineBox = el('div', { class: 'schedule-lines-empty', text: 'Select a customer and sales order to view pending line items.' });
  const cartBox = el('div', { class: 'schedule-lines-empty', text: 'No items added yet.' });
  const message = el('div', { class: 'form-help' });
  const inputs = new Map();
  const selected = [];
  const selectedKeys = new Set();

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
      const input = el('input', { class: 'form-control schedule-qty', type: 'number', min: '0', max: row.availableQtyBags, step: '0.01', placeholder: 'Bags' });
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
    const addAllBtn = el('button', { class: 'btn btn-primary', text: 'Add', onclick: addAllLines });
    lineBox.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        'Item', 'UOM', 'Order Qty (bags)', 'Pending Qty (bags)', 'Available (bags)', 'Schedule Qty (bags)',
      ].map((label) => el('th', { text: label })))]),
      body,
    ]));
    lineBox.appendChild(el('div', { class: 'schedule-add-row' }, [addAllBtn]));
  }

  function addAllLines() {
    const orderRows = rows.filter((r) => r.customer === customerSelect.value && r.orderNo === orderSelect.value);
    const errors = [];
    let hasQty = false;
    let added = 0;
    for (const row of orderRows) {
      const input = inputs.get(row.key);
      const qty = Number(input?.value || 0);
      if (qty <= 0) continue;
      hasQty = true;
      if (qty > row.availableQtyBags + 0.0001) { errors.push(`${row.item}: exceeds available (${row.availableQtyBags})`); continue; }
      if (selectedKeys.has(row.key)) { errors.push(`${row.item}: already added`); continue; }
      selected.push({ ...row, scheduleQtyBags: qty });
      selectedKeys.add(row.key);
      input.value = '';
      added++;
    }
    if (errors.length) message.textContent = errors.join('; ');
    else if (!hasQty) message.textContent = 'Enter schedule quantity for at least one item.';
    else message.textContent = '';
    if (added) renderCart();
  }

  function removeLine(key) {
    const idx = selected.findIndex((line) => line.key === key);
    if (idx >= 0) {
      selected.splice(idx, 1);
      selectedKeys.delete(key);
    }
    renderCart();
  }

  function renderCart() {
    if (!selected.length) {
      cartBox.className = 'schedule-lines-empty';
      cartBox.textContent = 'No items added yet.';
      return;
    }
    cartBox.className = 'schedule-lines';
    cartBox.innerHTML = '';
    const body = el('tbody');
    for (const line of selected) {
      body.appendChild(el('tr', {}, [
        el('td', { text: line.customer }),
        el('td', { text: line.orderNo }),
        el('td', { text: line.item }),
        el('td', { text: String(line.scheduleQtyBags) }),
        el('td', {}, [el('button', { class: 'btn btn-danger btn-sm', text: 'Remove', onclick: () => removeLine(line.key) })]),
      ]));
    }
    cartBox.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        'Customer', 'SO No', 'Item', 'Qty (bags)', '',
      ].map((label) => el('th', { text: label })))]),
      body,
    ]));
  }

  customerSelect.addEventListener('change', refreshOrders);
  orderSelect.addEventListener('change', renderLines);

  const submit = el('button', { class: 'btn btn-success', text: 'Submit schedule' });
  submit.onclick = async () => {
    if (!date.value) { message.textContent = 'Choose a delivery date.'; return; }
    if (!selected.length) { message.textContent = 'Add at least one item before submitting.'; return; }
    submit.disabled = true;
    try {
      const result = await api.post('/delivery-schedules', { deliveryDate: date.value, lines: selected });
      message.textContent = result.chatStatus === 'sent' ? 'Schedule submitted and posted to Google Chat.' : `Schedule submitted. Chat warning: ${result.warning}`;
      selected.length = 0;
      selectedKeys.clear();
      renderCart();
      const refreshed = await api.get('/delivery-schedules/pending');
      rows = refreshed.rows || [];
      refreshOrders();
    } catch (error) { message.textContent = error.message; }
    submit.disabled = false;
  };

  const form = el('div', { class: 'form-grid' }, [
    el('label', {}, ['Customer', customerSelect]), el('label', {}, ['Sales Order', orderSelect]),
    el('label', {}, ['Recommended Delivery Date', date]),
  ]);
  container.appendChild(card('Create Delivery Schedule', form));
  container.appendChild(card('Pending Line Items', lineBox));
  container.appendChild(card('Selected Items', cartBox));
  container.appendChild(submit);
  container.appendChild(message);
}
