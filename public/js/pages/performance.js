import { api, qs } from '../api.js';
import { el, money, compactMoney, pct, fmt } from '../ui.js';
import { card, chartCard } from './common.js';
import { hbarChart } from '../charts.js';
import { dataTable } from '../ui.js';

export async function renderPerformance(container, state, dim) {
  let endpoint, label, titleKey, columns, chartTitle;

  if (dim === 'territory') {
    endpoint = '/analytics/territories';
    label = 'territories';
    titleKey = 'territory';
    chartTitle = 'Territory Sales Value';
    columns = [
      { label: 'Territory', key: 'territory' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Target', key: 'target', money: true },
      { label: 'Achievement %', key: 'achievementPct', pct: true },
      { label: 'Delivery', key: 'deliveryValue', money: true },
    ];
  } else if (dim === 'area') {
    endpoint = '/analytics/areas';
    label = 'areas';
    titleKey = 'area';
    chartTitle = 'Area Sales Value';
    columns = [
      { label: 'Area', key: 'area' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Orders', key: 'orderCount' },
    ];
  } else if (dim === 'region') {
    endpoint = '/analytics/regions';
    label = 'regions';
    titleKey = 'region';
    chartTitle = 'Region Sales Value';
    columns = [
      { label: 'Region', key: 'region' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Orders', key: 'orderCount' },
    ];
  } else if (dim === 'customer') {
    endpoint = '/analytics/customers';
    label = 'customers';
    titleKey = 'customer';
    chartTitle = 'Customer Sales Value';
    columns = [
      { label: 'Customer', key: 'customer' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Orders', key: 'orderCount' },
      { label: 'Delivery', key: 'deliveryValue', money: true },
      { label: 'Avg Order', key: 'avgOrderValue', money: true },
    ];
  } else {
    endpoint = '/analytics/products';
    label = 'products';
    titleKey = 'product';
    chartTitle = 'Product Sales Value';
    columns = [
      { label: 'Product', key: 'product' },
      { label: 'Sales Value', key: 'salesValue', money: true },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Orders', key: 'orderCount' },
      { label: 'Delivery', key: 'deliveryValue', money: true },
    ];
  }

  const data = await api.get(endpoint + '?' + qs(state.query()));
  const rows = data[label] || [];

  container.appendChild(chartCard(chartTitle, 'perf-bar', 'sm'));
  hbarChart('perf-bar', rows.slice(0, 10).map((r) => r[titleKey]), rows.slice(0, 10).map((r) => r.salesValue), '#0f766e');

  container.appendChild(card(rows.length + ' records', dataTable({ columns, rows })));
}
