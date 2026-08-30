import { api, qs } from '../api.js';
import { el, money, fmt, pct } from '../ui.js';
import { kpiGrid, card, chartCard } from './common.js';
import { lineChart, hbarChart, donutChart } from '../charts.js';
import { dataTable } from '../ui.js';

export async function renderDelivery(container, state) {
  container.appendChild(el('div', { id: 'del-kpis' }));
  container.appendChild(el('div', { class: 'grid-3', id: 'del-charts' }));
  container.appendChild(el('div', { id: 'del-table' }));

  let page = 1, pageSize = 25, search = '', sort = 'date', order = 'desc';
  let timer = null;

  async function load(onlyTable = false) {
    const params = { ...state.query(), page, pageSize, search, sort, order };
    const data = await api.get('/delivery?' + qs(params));

    if (!onlyTable) {
      const m = data.metrics || {};
      const kpiBox = document.getElementById('del-kpis');
      kpiBox.innerHTML = '';
      kpiBox.appendChild(kpiGrid([
        { label: 'Delivery Value', value: money(m.deliveryValue) },
        { label: 'Delivery Quantity (MT)', value: fmt(m.deliveryMt, 1) },
        { label: 'Delivered Customers', value: fmt(m.deliveredCustomers) },
        { label: 'Delivery Achievement %', value: pct(m.deliveryAchievementPct) },
        { label: 'Deliveries', value: fmt(m.deliveryCount) },
      ]));

      const chartBox = document.getElementById('del-charts');
      chartBox.innerHTML = '';
      chartBox.appendChild(chartCard('Daily Delivery Trend', 'del-daily'));
      chartBox.appendChild(chartCard('Territory-wise Delivery', 'del-terr'));
      chartBox.appendChild(chartCard('Product-wise Delivery', 'del-prod'));

      const daily = data.daily || [];
      lineChart('del-daily', daily.map((d) => d.date.slice(5)), [
        { label: 'Delivery Value', data: daily.map((d) => d.deliveryValue), color: '#2563eb' },
      ]);
      const terr = (data.byTerritory || []).slice(0, 8);
      hbarChart('del-terr', terr.map((t) => t.name), terr.map((t) => t.value), '#0f766e');
      const prod = (data.byProduct || []).slice(0, 8);
      donutChart('del-prod', prod.map((p) => p.name), prod.map((p) => p.value));
    }

    const tb = data.table || {};
    const tableBox = document.getElementById('del-table');
    tableBox.innerHTML = '';
    tableBox.appendChild(card('Deliveries', dataTable({
      columns: [
        { label: 'Date', key: 'date' },
        { label: 'Customer', key: 'customer' },
        { label: 'Territory', key: 'territory' },
        { label: 'Product', key: 'product' },
        { label: 'MT', key: 'mt', format: (v) => fmt(v, 2) },
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
