import { api, qs } from '../api.js';
import { el, money, fmt, emptyState } from '../ui.js';
import { kpiGrid, card, chartCard } from './common.js';
import { lineChart, hbarChart, donutChart } from '../charts.js';
import { dataTable } from '../ui.js';

export async function renderSales(container, state) {
  container.appendChild(el('div', { id: 'sales-kpis' }));
  container.appendChild(el('div', { class: 'grid-3', id: 'sales-charts' }));
  container.appendChild(el('div', { id: 'sales-table' }));

  let page = 1, pageSize = 25, search = '', sort = 'date', order = 'desc';

  async function load(onlyTable = false) {
    const params = { ...state.query(), page, pageSize, search, sort, order };
    const data = await api.get('/sales/orders?' + qs(params));

    if (!onlyTable) {
      const m = data.metrics || {};
      const kpiBox = document.getElementById('sales-kpis');
      kpiBox.innerHTML = '';
      kpiBox.appendChild(kpiGrid([
        { label: 'Total Orders', value: fmt(m.totalOrders) },
        { label: 'Order Value', value: money(m.orderValue) },
        { label: 'Order Quantity (MT)', value: fmt(m.orderMt, 1) },
        { label: 'Customers', value: fmt(m.customers) },
        { label: 'Avg Order Value', value: money(m.avgOrderValue) },
      ]));

      const chartBox = document.getElementById('sales-charts');
      chartBox.innerHTML = '';
      chartBox.appendChild(chartCard('Daily Order Trend', 'sales-daily'));
      chartBox.appendChild(chartCard('Territory-wise Value', 'sales-terr'));
      chartBox.appendChild(chartCard('Product-wise Value', 'sales-prod'));

      const daily = data.daily || [];
      lineChart('sales-daily', daily.map((d) => d.date.slice(5)), [
        { label: 'Order Value', data: daily.map((d) => d.salesValue), color: '#0f766e' },
      ]);
      const terr = (data.byTerritory || []).slice(0, 8);
      hbarChart('sales-terr', terr.map((t) => t.name), terr.map((t) => t.value), '#2563eb');
      const prod = (data.byProduct || []).slice(0, 8);
      donutChart('sales-prod', prod.map((p) => p.name), prod.map((p) => p.value));
    }

    const tb = data.table || {};
    const tableBox = document.getElementById('sales-table');
    tableBox.innerHTML = '';
    tableBox.appendChild(card('Sales Orders', dataTable({
      columns: [
        { label: 'Date', key: 'date' },
        { label: 'Order No', key: 'orderNo' },
        { label: 'Customer', key: 'customer' },
        { label: 'Territory', key: 'territory' },
        { label: 'Product', key: 'product' },
        { label: 'MT', key: 'mt', format: (v) => fmt(v, 2) },
        { label: 'Rate/50kg', key: 'rate50', format: (v) => v == null ? '—' : fmt(v, 0) },
        { label: 'Value', key: 'value', money: true },
        { label: 'Status', key: 'status', badge: true },
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

let timer = null;
