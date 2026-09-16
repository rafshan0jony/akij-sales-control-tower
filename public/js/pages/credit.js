import { api, qs } from '../api.js';
import { el, money, fmt } from '../ui.js';
import { card } from './common.js';
import { dataTable } from '../ui.js';

export async function renderCreditStatus(container, state) {
  const data = await api.get('/credit-status?' + qs(state.query()));
  const credit = data.credit || [];

  container.appendChild(card('Customer Credit Status — Positive Ledger Balance (' + credit.length + ')', dataTable({
    columns: [
      { label: 'Partner Code', key: 'partnerCode' },
      { label: 'Partner Name', key: 'partnerName' },
      { label: 'Credit Days', key: 'creditDays' },
      { label: 'Ledger Balance', key: 'ledgerBalance', money: true },
      { label: 'Overdue', key: 'overdue', money: true },
      { label: 'Product Delivery Gap (Day)', key: 'deliveryGap', format: (v) => v == null ? '—' : fmt(v, 0) },
      { label: 'Payment Gap (Day)', key: 'paymentGap', format: (v) => v == null ? '—' : fmt(v, 0) },
      { label: 'Territory', key: 'territory' },
    ],
    rows: credit,
  }), {
    actions: el('button', { class: 'btn btn-sm', text: '⬇ Download Excel', onclick: () => downloadCreditExcel(credit) }),
  }));
}

function downloadCreditExcel(credit) {
  const headers = ['Partner Code', 'Partner Name', 'Credit Days', 'Ledger Balance', 'Overdue', 'Product Delivery Gap (Day)', 'Payment Gap (Day)', 'Territory'];
  const lines = [headers.map(esc).join(',')];
  for (const c of credit) {
    lines.push([
      c.partnerCode, c.partnerName, c.creditDays, c.ledgerBalance, c.overdue,
      c.deliveryGap, c.paymentGap, c.territory,
    ].map(esc).join(','));
  }
  const csv = '\ufeff' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'credit-status-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function esc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
