const registry = new Map();

export function destroyChart(id) {
  const c = registry.get(id);
  if (c) { c.destroy(); registry.delete(id); }
}

export function destroyAll() {
  for (const [id, c] of registry) { try { c.destroy(); } catch {} }
  registry.clear();
}

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#a16207'];

function defaultOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
      y: { grid: { color: '#eef1f5' }, ticks: { callback: (v) => compact(v) } },
    },
  };
}

function compact(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v;
}

function render(id, cfg) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const chart = new Chart(canvas, cfg);
  registry.set(id, chart);
  return chart;
}

export function lineChart(id, labels, datasets) {
  return render(id, {
    type: 'line',
    data: { labels, datasets: datasets.map((d, i) => ({ label: d.label, data: d.data, borderColor: d.color || PALETTE[i % PALETTE.length], backgroundColor: (d.color || PALETTE[i]) + '22', fill: d.fill !== false, tension: 0.3, pointRadius: 0 })) },
    options: defaultOpts(),
  });
}

export function barChart(id, labels, datasets, { stacked = false } = {}) {
  return render(id, {
    type: 'bar',
    data: { labels, datasets: datasets.map((d, i) => ({ label: d.label, data: d.data, backgroundColor: d.color || PALETTE[i % PALETTE.length], stack: stacked ? 's' : undefined })) },
    options: { ...defaultOpts(), scales: { ...defaultOpts().scales, x: { grid: { display: false }, stacked }, y: { grid: { color: '#eef1f5' }, stacked, ticks: { callback: (v) => compact(v) } } } },
  });
}

export function hbarChart(id, labels, data, color) {
  return render(id, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Value', data, backgroundColor: color || PALETTE[0] }] },
    options: { ...defaultOpts(), indexAxis: 'y', scales: { x: { grid: { color: '#eef1f5' }, ticks: { callback: (v) => compact(v) } }, y: { grid: { display: false } } } },
  });
}

export function donutChart(id, labels, data) {
  return render(id, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } } },
  });
}
