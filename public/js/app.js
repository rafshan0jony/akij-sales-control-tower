import { api, token, sessionUser } from './api.js';
import * as ui from './ui.js';
import * as charts from './charts.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderSales } from './pages/sales.js';
import { renderDelivery } from './pages/delivery.js';
import { renderPending } from './pages/pending.js';
import { renderTarget } from './pages/target.js';
import { renderPerformance } from './pages/performance.js';
import { renderAnalytics } from './pages/analytics.js';
import { renderInsights } from './pages/insights.js';
import { renderCreditStatus } from './pages/credit.js';
import { renderAdmin } from './pages/admin.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_START = { y: 2026, m: 9 }; // September 2026

// Month list: September 2026 -> current month (auto-grows as months pass).
function buildFilters() {
  const now = new Date();
  let endY = now.getFullYear();
  let endM = now.getMonth() + 1;
  if (endY < MONTH_START.y || (endY === MONTH_START.y && endM < MONTH_START.m)) { endY = MONTH_START.y; endM = MONTH_START.m; }
  const filters = [];
  let y = MONTH_START.y;
  let m = MONTH_START.m;
  while (y < endY || (y === endY && m <= endM)) {
    const mm = String(m).padStart(2, '0');
    filters.push({ key: 'month:' + y + '-' + mm, label: MONTH_NAMES[m - 1] + ' ' + y });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return filters.reverse();
}

const FILTERS = buildFilters();

const NAV = [
  { section: 'Overview' },
  { label: 'Dashboard', hash: '#/dashboard', ico: '▦' },
  { section: 'Sales' },
  { label: 'Sales Order', hash: '#/sales', ico: '🧾', perm: 'VIEW_SALES_ORDER' },
  { label: 'Delivery', hash: '#/delivery', ico: '🚚', perm: 'VIEW_DELIVERY' },
  { label: 'Pending', hash: '#/pending', ico: '⏳', perm: 'VIEW_PENDING' },
  { label: 'Credit Status', hash: '#/credit-status', ico: '💳' },
  { section: 'Performance' },
  { label: 'Target vs Achievement', hash: '#/target', ico: '🎯', perm: 'VIEW_TARGET' },
  { label: 'Region', hash: '#/region', ico: '🗺️', perm: 'VIEW_ANALYTICS' },
  { label: 'Area', hash: '#/area', ico: '📍', perm: 'VIEW_ANALYTICS' },
  { label: 'Territory', hash: '#/territory', ico: '📍', perm: 'VIEW_ANALYTICS' },
  { label: 'Customer', hash: '#/customer', ico: '👥', perm: 'VIEW_CUSTOMER' },
  { label: 'Product', hash: '#/product', ico: '📦', perm: 'VIEW_PRODUCT' },
  { section: 'Analytics' },
  { label: 'Trends', hash: '#/trends', ico: '📈', perm: 'VIEW_ANALYTICS' },
  { label: 'Drill Down', hash: '#/drilldown', ico: '🔍', perm: 'VIEW_ANALYTICS' },
  { section: 'Insights' },
  { label: 'Key Insights', hash: '#/insights', ico: '💡' },
  { label: 'Recommendations', hash: '#/recommendations', ico: '✅', perm: 'VIEW_RECOMMENDATION' },
  { label: 'Tour Plan', hash: '#/tour-plan', ico: '🗺️', perm: 'VIEW_TOUR_PLAN' },
  { section: 'Admin' },
  { label: 'Overview', hash: '#/admin', ico: '🛡️', admin: true },
  { label: 'Users', hash: '#/admin/users', ico: '👤', admin: true },
  { label: 'Roles', hash: '#/admin/roles', ico: '🔑', admin: true },
  { label: 'Territories', hash: '#/admin/territories', ico: '🌐', admin: true },
  { label: 'Targets', hash: '#/admin/targets', ico: '🎯', admin: true },
  { label: 'Config', hash: '#/admin/config', ico: '⚙️', admin: true },
  { label: 'Audit Logs', hash: '#/admin/audit', ico: '📜', admin: true },
];

const state = {
  user: null,
  scope: null,
  filter: (() => {
    const stored = localStorage.getItem('akij_filter');
    if (stored && FILTERS.some((f) => f.key === stored)) return stored;
    return FILTERS[0] ? FILTERS[0].key : 'month:2026-09';
  })(),
  custom: null,
  lastUpdated: null,
  refreshStatus: 'IDLE',
};

state.query = function () {
  const q = { filter: this.filter };
  if (this.filter === 'custom' && this.custom) {
    q.from = this.custom.from;
    q.to = this.custom.to;
  }
  return q;
};

function hasPerm(perm) {
  if (!state.user) return false;
  return state.user.permissions.includes(perm) || state.user.permissions.includes('SYSTEM_ADMIN');
}

function isAdmin() {
  return state.user && (state.user.permissions.includes('MANAGE_USERS') || state.user.permissions.includes('SYSTEM_ADMIN') || state.user.permissions.includes('MANAGE_ROLES'));
}

function renderNav() {
  const nav = document.getElementById('nav');
  ui.clear(nav);
  for (const item of NAV) {
    if (item.section) { nav.appendChild(ui.el('div', { class: 'nav-section', text: item.section })); continue; }
    if (item.perm && !hasPerm(item.perm)) continue;
    if (item.admin && !isAdmin()) continue;
    const active = location.hash === item.hash;
    nav.appendChild(ui.el('button', {
      class: 'nav-item' + (active ? ' active' : ''),
      onclick: () => { location.hash = item.hash; },
    }, [
      ui.el('span', { class: 'nav-ico', text: item.ico }),
      item.label,
    ]));
  }
}

function renderFilter() {
  const sel = document.getElementById('filter-select');
  if (sel.options.length === 0) {
    for (const f of FILTERS) sel.appendChild(ui.el('option', { value: f.key, text: f.label }));
  }
  sel.value = state.filter;
  document.getElementById('custom-range').classList.toggle('hidden', state.filter !== 'custom');
  if (state.filter === 'custom') {
    document.getElementById('filter-from').value = state.custom?.from || '';
    document.getElementById('filter-to').value = state.custom?.to || '';
  }
}

function renderUser() {
  const u = state.user;
  if (!u) return;
  document.getElementById('user-name').textContent = u.name;
  document.getElementById('user-role').textContent = u.role ? u.role.name : 'No role';
  document.getElementById('user-avatar').textContent = (u.name || '?').trim()[0].toUpperCase();
}

function renderSync() {
  const text = document.getElementById('sync-text');
  const dot = document.querySelector('#sync-pill .dot');
  if (state.lastUpdated) {
    const d = new Date(state.lastUpdated);
    text.textContent = 'Updated ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const cls = { SUCCESS: 'dot-green', ERROR: 'dot-red', IDLE: 'dot-gray', REFRESHING: 'dot-amber' }[state.refreshStatus] || 'dot-gray';
  dot.className = 'dot ' + cls;
  document.getElementById('last-updated').textContent = state.lastUpdated
    ? 'Data last updated: ' + new Date(state.lastUpdated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : '';
}

function setBreadcrumb(label) {
  document.getElementById('breadcrumb').innerHTML = '';
  const el = document.getElementById('breadcrumb');
  el.appendChild(ui.el('span', { class: 'crumb-muted', text: 'Akij Essentials / ' }));
  el.appendChild(ui.el('span', { text: label }));
}

const ROUTES = [
  ['#/dashboard', 'Dashboard', renderDashboard],
  ['#/sales', 'Sales Order', renderSales],
  ['#/delivery', 'Delivery', renderDelivery],
  ['#/pending', 'Pending', renderPending],
  ['#/credit-status', 'Credit Status', renderCreditStatus],
  ['#/target', 'Target vs Achievement', renderTarget],
  ['#/region', 'Region Performance', (c) => renderPerformance(c, state, 'region')],
  ['#/area', 'Area Performance', (c) => renderPerformance(c, state, 'area')],
  ['#/territory', 'Territory Performance', (c) => renderPerformance(c, state, 'territory')],
  ['#/customer', 'Customer Performance', (c) => renderPerformance(c, state, 'customer')],
  ['#/product', 'Product Performance', (c) => renderPerformance(c, state, 'product')],
  ['#/trends', 'Trends', (c) => renderAnalytics(c, state, 'trends')],
  ['#/drilldown', 'Drill Down', (c) => renderAnalytics(c, state, 'drilldown')],
  ['#/insights', 'Key Insights', (c) => renderInsights(c, state, 'insights')],
  ['#/recommendations', 'Recommendations', (c) => renderInsights(c, state, 'recommendations')],
  ['#/tour-plan', 'Tour Plan', (c) => renderInsights(c, state, 'tourplan')],
  ['#/admin', 'Admin Overview', (c) => renderAdmin(c, state, 'overview')],
  ['#/admin/users', 'Users', (c) => renderAdmin(c, state, 'users')],
  ['#/admin/roles', 'Roles', (c) => renderAdmin(c, state, 'roles')],
  ['#/admin/territories', 'Territories', (c) => renderAdmin(c, state, 'territories')],
  ['#/admin/targets', 'Targets', (c) => renderAdmin(c, state, 'targets')],
  ['#/admin/config', 'Config', (c) => renderAdmin(c, state, 'config')],
  ['#/admin/audit', 'Audit Logs', (c) => renderAdmin(c, state, 'audit')],
];

async function route() {
  charts.destroyAll();
  renderNav();
  let hash = location.hash || '#/dashboard';
  let match = ROUTES.find(([h]) => h === hash);
  if (!match) { location.hash = '#/dashboard'; return; }
  const [, label, render] = match;
  setBreadcrumb(label);
  document.getElementById('app').innerHTML = '';
  const container = document.getElementById('app');
  try {
    await render(container, state);
  } catch (err) {
    container.appendChild(ui.errorState(err.message));
  }
}

async function boot() {
  const t = token.get();
  if (!t) { showLogin(); return; }
  try {
    const me = await api.get('/auth/me');
    state.user = me.user;
    state.scope = me.scope;
    sessionUser.set(me.user);
    hideLogin();
    renderUser();
    renderFilter();
    startSyncPoll();
    route();
  } catch (_) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function hideLogin() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('shell').classList.remove('hidden');
}

function startSyncPoll() {
  const poll = async () => {
    try {
      const s = await api.get('/dashboard/sync-status');
      if (s.lastUpdated) state.lastUpdated = s.lastUpdated;
      state.refreshStatus = s.refreshStatus || 'IDLE';
      renderSync();
    } catch (_) {}
  };
  poll();
  setInterval(poll, 60000);
}

function setupEvents() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    try {
      const res = await api.post('/auth/login', { identifier, password });
      token.set(res.token);
      sessionUser.set(res.user);
      location.hash = '#/dashboard';
      boot();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try { await api.post('/auth/logout', {}); } catch (_) {}
    token.clear();
    location.hash = '';
    showLogin();
  });

  document.getElementById('user-btn').addEventListener('click', () => {
    document.getElementById('user-dropdown').classList.toggle('hidden');
  });

  document.getElementById('change-password-btn').addEventListener('click', () => openChangePassword());

  document.getElementById('nav-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  document.getElementById('filter-select').addEventListener('change', (e) => {
    state.filter = e.target.value;
    localStorage.setItem('akij_filter', state.filter);
    renderFilter();
    route();
  });
  document.getElementById('filter-from').addEventListener('change', syncCustom);
  document.getElementById('filter-to').addEventListener('change', syncCustom);

  window.addEventListener('hashchange', route);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) document.getElementById('user-dropdown').classList.add('hidden');
    if (e.target.closest('.sidebar a, .sidebar .nav-item')) document.querySelector('.sidebar').classList.remove('open');
  });
}

function syncCustom() {
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  if (from && to) { state.custom = { from, to }; route(); }
}

function openChangePassword() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const current = ui.el('input', { type: 'password', placeholder: 'Current password' });
  const next = ui.el('input', { type: 'password', placeholder: 'New password (min 6 chars)' });
  const form = ui.el('div', {}, [
    ui.el('div', { class: 'form-row' }, [ui.el('label', { text: 'Current password' }), current]),
    ui.el('div', { class: 'form-row' }, [ui.el('label', { text: 'New password' }), next]),
    ui.el('div', { class: 'modal-actions' }, [
      ui.el('button', { class: 'btn', text: 'Cancel', onclick: () => root.innerHTML = '' }),
      ui.el('button', { class: 'btn btn-primary', text: 'Change', onclick: async () => {
        try {
          await api.post('/auth/change-password', { currentPassword: current.value, newPassword: next.value });
          ui.toast('Password changed', 'success');
          root.innerHTML = '';
        } catch (err) { ui.toast(err.message, 'error'); }
      } }),
    ]),
  ]);
  root.appendChild(ui.el('div', { class: 'modal-backdrop', onclick: () => root.innerHTML = '' }));
  root.appendChild(ui.el('div', { class: 'modal' }, [ui.el('h3', { text: 'Change password' }), form]));
}

setupEvents();
boot();

export { state, hasPerm, isAdmin };
