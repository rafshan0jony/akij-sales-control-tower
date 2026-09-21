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
  const itemSelect = el('select', { class: 'form-control' }, [el('option', { value: '', text: 'Select item' })]);
  const qty = el('input', { class: 'form-control', type: 'number', min: '0.01', step: '0.01', placeholder: 'Bags' });
  const date = el('input', { class: 'form-control', type: 'date' });
  const today = new Date();
  const iso = (value) => value.toISOString().slice(0, 10);
  date.min = iso(today);
  today.setDate(today.getDate() + 1);
  date.value = iso(today);
  const tableBody = el('tbody');
  const selected = [];

  function refreshOrders() {
    orderSelect.innerHTML = '';
    orderSelect.appendChild(el('option', { value: '', text: 'Select sales order' }));
    [...new Set(rows.filter((r) => r.customer === customerSelect.value).map((r) => r.orderNo))].forEach((order) => {
      orderSelect.appendChild(el('option', { value: order, text: order }));
    });
    refreshItems();
  }
  function refreshItems() {
    itemSelect.innerHTML = '';
    itemSelect.appendChild(el('option', { value: '', text: 'Select item' }));
    rows.filter((r) => r.customer === customerSelect.value && r.orderNo === orderSelect.value)
      .forEach((r) => itemSelect.appendChild(el('option', { value: r.key, text: `${r.item} (${r.availableQtyBags} bags available)` })));
  }
  function addLine() {
    const row = rows.find((r) => r.key === itemSelect.value);
    const value = Number(qty.value);
    if (!row || !Number.isFinite(value) || value <= 0 || value > row.availableQtyBags) return;
    if (selected.some((x) => x.key === row.key)) return;
    selected.push({ ...row, scheduleQtyBags: value });
    tableBody.appendChild(el('tr', {}, [
      el('td', { text: row.customer }), el('td', { text: row.orderNo }), el('td', { text: row.item }),
      el('td', { text: `${value} / ${row.availableQtyBags}` }),
      el('td', {}, [el('button', { class: 'btn btn-sm', text: 'Remove', onclick: (event) => {
        event.target.closest('tr').remove(); selected.splice(selected.indexOf(row), 1);
      } })]),
    ]));
    qty.value = '';
  }

  customerSelect.addEventListener('change', refreshOrders);
  orderSelect.addEventListener('change', refreshItems);
  const add = el('button', { class: 'btn btn-primary', text: 'Add item', onclick: addLine });
  const submit = el('button', { class: 'btn btn-success', text: 'Submit schedule' });
  const message = el('div', { class: 'form-help' });
  submit.onclick = async () => {
    if (!date.value || !selected.length) { message.textContent = 'Choose a delivery date and add at least one item.'; return; }
    submit.disabled = true;
    try {
      const result = await api.post('/delivery-schedules', { deliveryDate: date.value, lines: selected });
      message.textContent = result.chatStatus === 'sent' ? 'Schedule submitted and posted to Google Chat.' : `Schedule submitted. Chat warning: ${result.warning}`;
      selected.length = 0;
      tableBody.innerHTML = '';
    } catch (error) { message.textContent = error.message; }
    submit.disabled = false;
  };

  const form = el('div', { class: 'form-grid' }, [
    el('label', {}, ['Customer', customerSelect]), el('label', {}, ['Sales Order', orderSelect]),
    el('label', {}, ['Item', itemSelect]), el('label', {}, ['Schedule Quantity (bags)', qty]),
    el('label', {}, ['Recommended Delivery Date', date]), add,
  ]);
  const table = el('table', { class: 'data-table' }, [el('thead', {}, [el('tr', {}, ['Customer', 'SO No', 'Item', 'Schedule / Available', ''])]), tableBody]);
  container.appendChild(card('Create Delivery Schedule', form));
  container.appendChild(card('Selected Items', table));
  container.appendChild(message);
}
