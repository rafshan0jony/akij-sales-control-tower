import { el } from '../ui.js';

export function kpiCard(label, value, opts = {}) {
  return el('div', { class: 'kpi-card' }, [
    el('div', { class: 'kpi-label', text: label }),
    el('div', { class: 'kpi-value', style: opts.color ? `color:${opts.color}` : '', text: value }),
    opts.sub ? el('div', { class: 'kpi-sub', text: opts.sub }) : null,
    opts.trend ? el('div', { class: 'kpi-trend ' + (opts.trendClass || ''), text: opts.trend }) : null,
  ]);
}

export function kpiGrid(items) {
  return el('div', { class: 'kpi-grid' }, items.map((i) => kpiCard(i.label, i.value, i.opts)));
}

export function card(title, body, opts = {}) {
  const head = title
    ? el('div', { class: 'card-head' }, [
        el('div', { class: 'card-title', text: title }),
        opts.actions ? el('div', {}, [].concat(opts.actions)) : null,
      ])
    : null;
  return el('div', { class: 'card' }, [
    head,
    el('div', { class: 'card-body' + (opts.p0 ? ' p0' : ''), }, [body]),
  ].filter(Boolean));
}

export function chartCard(title, canvasId, heightClass = '') {
  return card(title, el('div', { class: 'chart-box ' + heightClass }, [el('canvas', { id: canvasId })]));
}

export function sectionTitle(text) {
  return el('h2', { class: 'card-title', text, style: 'font-size:16px;margin:0;' });
}
