import { api, qs } from '../api.js';
import { el } from '../ui.js';
import { card, chartCard } from './common.js';
import { lineChart, barChart, donutChart } from '../charts.js';

export async function renderAnalytics(container, state, view) {
  if (view === 'trends') {
    const data = await api.get('/analytics/trends?' + qs(state.query()));
    const daily = data.daily || [];
    const weekly = data.weekly || [];
    container.appendChild(el('div', { class: 'grid-2' }, [
      chartCard('Daily Sales & Delivery Trend', 'tr-daily'),
      chartCard('Weekly Trend', 'tr-weekly'),
    ]));
    lineChart('tr-daily', daily.map((d) => d.date.slice(5)), [
      { label: 'Sales', data: daily.map((d) => d.salesValue), color: '#0f766e' },
      { label: 'Delivery', data: daily.map((d) => d.deliveryValue), color: '#2563eb' },
    ]);
    lineChart('tr-weekly', weekly.map((d) => d.date.slice(5)), [
      { label: 'Sales', data: weekly.map((d) => d.salesValue), color: '#0f766e' },
      { label: 'Delivery', data: weekly.map((d) => d.deliveryValue), color: '#2563eb' },
    ]);
    return;
  }

  // Drill down
  container.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [
    el('label', { class: 'muted', text: 'Dimension: ' }),
    el('select', { id: 'dd-dim', class: 'select' }, [
      el('option', { value: 'territory', text: 'Territory' }),
      el('option', { value: 'area', text: 'Area' }),
      el('option', { value: 'region', text: 'Region' }),
      el('option', { value: 'customer', text: 'Customer' }),
      el('option', { value: 'product', text: 'Product' }),
    ]),
  ])]));
  container.appendChild(el('div', { id: 'dd-result' }));

  async function load() {
    const dim = document.getElementById('dd-dim').value;
    const data = await api.get('/analytics/drilldown?' + qs({ ...state.query(), dimension: dim }));
    const breakdown = data.breakdown || [];
    const box = document.getElementById('dd-result');
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'grid-2' }, [
      chartCard('Value by ' + dim, 'dd-bar'),
      chartCard('Share', 'dd-donut'),
    ]));
    barChart('dd-bar', breakdown.slice(0, 12).map((b) => b.name), [{ label: 'Value', data: breakdown.slice(0, 12).map((b) => b.value), color: '#0f766e' }]);
    donutChart('dd-donut', breakdown.slice(0, 8).map((b) => b.name), breakdown.slice(0, 8).map((b) => b.value));
  }

  document.getElementById('dd-dim').addEventListener('change', load);
  await load();
}
