import { api } from '../api.js';
import { el, money, fmt } from '../ui.js';
import { card } from './common.js';
import { dataTable } from '../ui.js';

export async function renderCreditStatus(container, state) {
  const data = await api.get('/credit-status');
  const credit = data.credit || [];

  container.appendChild(card('Customer Credit Status — Positive Ledger Balance (' + credit.length + ')', dataTable({
    columns: [
      { label: 'Partner Code', key: 'partnerCode' },
      { label: 'Partner Name', key: 'partnerName' },
      { label: 'Credit Days', key: 'creditDays' },
      { label: 'Ledger Balance', key: 'ledgerBalance', money: true },
      { label: 'Product Delivery Gap (Day)', key: 'deliveryGap', format: (v) => v == null ? '—' : fmt(v, 0) },
      { label: 'Payment Gap (Day)', key: 'paymentGap', format: (v) => v == null ? '—' : fmt(v, 0) },
      { label: 'Territory', key: 'territory' },
    ],
    rows: credit,
  })));
}
