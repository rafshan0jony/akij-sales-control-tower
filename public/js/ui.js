export function fmt(n, dec = 0) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function money(n, dec = 0) {
  return '৳ ' + fmt(n, dec);
}

export function compact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return fmt(v);
}

export function pct(n, dec = 1) {
  return fmt(Number(n) || 0, dec) + '%';
}

export function compactMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return '৳ ' + (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '৳ ' + (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '৳ ' + (v / 1e3).toFixed(1) + 'K';
  return '৳ ' + fmt(v);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) { node.innerHTML = ''; return node; }

export function badge(text, type = 'neutral') {
  return el('span', { class: `badge badge-${type}`, text });
}

export function statusBadge(status) {
  const map = {
    'On Track': 'success', 'Exceeding': 'info', 'At Risk': 'warning', 'Behind': 'danger',
    Critical: 'critical', High: 'danger', Medium: 'warning', Low: 'neutral',
    active: 'success', inactive: 'neutral', Delivered: 'success', Open: 'warning',
    SUCCESS: 'success', WARNING: 'warning', CRITICAL: 'danger', INFO: 'info', IDLE: 'neutral',
  };
  return badge(status, map[status] || 'neutral');
}

export function progressBar(value, max = 100, color) {
  const pctv = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bar = el('div', { class: 'progress' }, [
    el('span', { style: `width:${pctv}%;background:${color || 'var(--primary)'}` }),
  ]);
  return bar;
}

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${type === 'info' ? '' : type}`, text: message });
  root.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export function skeletonRows(cols, rows = 5) {
  const wrap = el('div');
  for (let i = 0; i < rows; i++) {
    const r = el('div', { style: 'display:grid;gap:12px;padding:12px;' });
    for (let j = 0; j < cols; j++) r.appendChild(el('div', { class: 'skeleton', style: 'height:14px;' }));
    wrap.appendChild(r);
  }
  return wrap;
}

export function emptyState(message = 'No data available') {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'big', text: '📊' }),
    el('div', { text: message }),
  ]);
}

export function errorState(message = 'Failed to load data') {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'big', text: '⚠️' }),
    el('div', { text: message }),
  ]);
}

/** Build a reusable data table with search/sort/pagination hooks. */
export function dataTable({ columns, rows, onSort, sort, order, onPage, page, totalPages, total, search, onSearch }) {
  const table = el('table', { class: 'data' });
  const thead = el('thead');
  const tr = el('tr');
  for (const c of columns) {
    const key = c.key || c.label.toLowerCase();
    const arrow = sort === key ? (order === 'asc' ? ' ▲' : ' ▼') : '';
    tr.appendChild(el('th', { text: c.label + arrow, onclick: onSort ? () => onSort(key) : undefined }));
  }
  thead.appendChild(tr);
  const tbody = el('tbody');
  if (!rows.length) {
    const td = el('td', { colspan: columns.length, text: 'No records', style: 'text-align:center;color:var(--text-muted);padding:24px;' });
    tbody.appendChild(el('tr', {}, [td]));
  } else {
    for (const row of rows) {
      const r = el('tr');
      for (const c of columns) {
        let v = row[c.key];
        if (c.format) v = c.format(v, row);
        else if (c.money) v = money(v);
        else if (c.pct) v = pct(v);
        else if (c.badge) v = statusBadge(v);
        else if (v == null) v = '—';
        r.appendChild(el('td', {}, [v]));
      }
      tbody.appendChild(r);
    }
  }
  table.appendChild(thead);
  table.appendChild(tbody);

  const tools = el('div', { class: 'table-tools' }, [
    search !== undefined
      ? el('input', { type: 'search', placeholder: 'Search…', value: search, oninput: (e) => onSearch && onSearch(e.target.value) })
      : null,
    el('span', { class: 'muted', text: `${total != null ? total + ' records' : rows.length + ' rows'}` }),
  ]);

  let pager = null;
  if (page && totalPages > 1) {
    pager = el('div', { class: 'pagination' }, [
      el('button', { class: 'btn btn-sm', text: '‹ Prev', onclick: () => onPage(page - 1), disabled: page <= 1 ? '' : null }),
      el('span', { text: `Page ${page} / ${totalPages}` }),
      el('button', { class: 'btn btn-sm', text: 'Next ›', onclick: () => onPage(page + 1), disabled: page >= totalPages ? '' : null }),
    ]);
  }

  return el('div', { class: 'card' }, [
    el('div', { class: 'table-wrap' }, [table]),
    tools,
    pager,
  ].filter(Boolean));
}
