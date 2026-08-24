import { api, qs } from '../api.js';
import { el, money, compactMoney, fmt, badge, statusBadge } from '../ui.js';
import { kpiGrid, card } from './common.js';
import { dataTable } from '../ui.js';
import { barChart } from '../charts.js';

export async function renderPending(container, state) {
  container.appendChild(el('div', { id: 'pend-kpis' }));
  container.appendChild(el('div', { id: 'pend-aging' }));
  container.appendChild(el('div', { id: 'pend-table' }));

  let page = 1, pageSize = 25, search = '', sort = 'pendingValue', order = 'desc';
  let timer = null;

  async function load(onlyTable = false) {
    const params = { ...state.query(), page, pageSize, search, sort, order };
    const data = await api.get('/pending?' + qs(params));

    if (!onlyTable) {
      const m = data.metrics || {};
      const kpiBox = document.getElementById('pend-kpis');
      kpiBox.innerHTML = '';
      kpiBox.appendChild(kpiGrid([
        { label: 'Pending Quantity (MT)', value: fmt(m.pendingMt, 1) },
        { label: 'Pending Value', value: compactMoney(m.pendingValue) },
        { label: 'Pending Orders', value: fmt(m.pendingOrders) },
        { label: 'Pending Customers', value: fmt(m.pendingCustomers) },
        { label: 'Avg Pending Days', value: fmt(m.avgPendingDays, 1) },
        { label: 'Critical Orders', value: fmt(m.criticalOrders), opts: { color: 'var(--danger)' } },
      ]));

      const aging = data.aging || [];
      const agingBox = document.getElementById('pend-aging');
      agingBox.innerHTML = '';
      agingBox.appendChild(card('Pending Aging Buckets', el('div', { class: 'chart-box', style: 'height:240px;' }, [el('canvas', { id: 'pend-aging-chart' })])));
      barChart('pend-aging-chart', aging.map((a) => a.label), [{ label: 'Pending Value', data: aging.map((a) => a.value), color: '#d97706' }]);
    }

    const tb = data.table || {};
    const tableBox = document.getElementById('pend-table');
    tableBox.innerHTML = '';
    tableBox.appendChild(card('Pending Orders', dataTable({
      columns: [
        { label: 'Order No', key: 'orderNo' },
        { label: 'Order Date', key: 'orderDate' },
        { label: 'Customer', key: 'customer' },
        { label: 'Territory', key: 'territory' },
        { label: 'Product', key: 'product' },
        { label: 'Order MT', key: 'orderMt', format: (v) => fmt(v, 2) },
        { label: 'Delivered MT', key: 'deliveredMt', format: (v) => fmt(v, 2) },
        { label: 'Pending MT', key: 'pendingMt', format: (v) => fmt(v, 2) },
        { label: 'Pending Value', key: 'pendingValue', money: true },
        { label: 'Days', key: 'pendingDays' },
        { label: 'Priority', key: 'priority', badge: true },
      ],
      rows: tb.rows || [],
      total: tb.total, page, totalPages: tb.totalPages,
      sort, order, search,
      onSort: (k) => { sort = k; order = order === 'asc' ? 'desc' : 'asc'; load(true); },
      onSearch: (s) => { search = s; page = 1; clearTimeout(timer); timer = setTimeout(() => load(true), 350); },
      onPage: (p) => { page = p; load(true); },
    })));
  }

  await load();
}
