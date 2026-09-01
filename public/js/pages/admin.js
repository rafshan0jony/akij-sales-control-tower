import { api, qs } from '../api.js';
import { el, money, fmt, pct, badge, statusBadge, emptyState, toast } from '../ui.js';
import { card, kpiGrid } from './common.js';
import { dataTable } from '../ui.js';

const LEVELS = [
  { value: 0, label: 'National' },
  { value: 1, label: 'Region' },
  { value: 2, label: 'Area' },
  { value: 3, label: 'Zone' },
  { value: 4, label: 'Territory' },
];

function levelLabel(n) {
  return (LEVELS.find((l) => l.value === n) || {}).label || String(n);
}

function modal(title, content, actions = []) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  root.appendChild(el('div', { class: 'modal-backdrop', onclick: close }));
  root.appendChild(el('div', { class: 'modal' }, [
    el('h3', { text: title }),
    content,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: close }),
      ...actions,
    ]),
  ]));
  return close;
}

export async function renderAdmin(container, state, view) {
  const fns = { overview: renderOverview, users: renderUsers, roles: renderRoles, territories: renderTerritories, targets: renderTargets, config: renderConfig, audit: renderAudit };
  await (fns[view] || renderOverview)(container);
}

// ---------------------------------------------------------------------------
async function renderOverview(container) {
  const data = await api.get('/admin/dashboard');
  container.appendChild(kpiGrid([
    { label: 'Total Users', value: fmt(data.totalUsers) },
    { label: 'Active Users', value: fmt(data.activeUsers) },
    { label: 'Inactive Users', value: fmt(data.inactiveUsers) },
    { label: 'Roles', value: fmt(data.roles) },
    { label: 'Territories', value: fmt(data.territories) },
    { label: 'Failed Syncs', value: fmt(data.failedSyncCount), opts: { color: data.failedSyncCount ? 'var(--danger)' : 'var(--success)' } },
  ]));
  container.appendChild(card('System Health', el('div', { class: 'stack' }, [
    row('System status', statusBadge(data.systemHealth || 'IDLE')),
    row('Data source', data.dataSource || 'MCP'),
    row('Last refresh', data.lastRefresh ? new Date(data.lastRefresh).toLocaleString() : 'Never'),
    row('Last success', data.lastSuccess ? new Date(data.lastSuccess).toLocaleString() : 'Never'),
    row('Failed sync count', String(data.failedSyncCount)),
  ])));
}

// ---------------------------------------------------------------------------
async function renderUsers(container) {
  const data = await api.get('/admin/users');
  const roles = (await api.get('/admin/roles')).roles;
  const territories = (await api.get('/admin/territories')).territories;
  const users = data.users || [];

  const table = card('Users', dataTable({
    columns: [
      { label: 'ID', key: 'id' },
      { label: 'Name', key: 'name' },
      { label: 'Username', key: 'username' },
      { label: 'Password', key: 'plainPassword' },
      { label: 'Employee ID', key: 'employeeId' },
      { label: 'Role', key: 'roleName' },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Territories', key: 'territories', format: (t) => t.map((x) => x.name).join(', ') || '—' },
      { label: 'Last Login', key: 'lastLoginAt', format: (v) => v ? new Date(v).toLocaleString() : '—' },
    ],
    rows: users.map((u) => ({ ...u, roleName: roles.find((r) => r.id === u.roleId)?.name || '—' })),
  }));

  const actions = el('div', { style: 'display:flex;gap:8px;' }, [
    el('button', { class: 'btn btn-primary btn-sm', text: '+ New User', onclick: () => openUserModal(null, users, roles, territories) }),
    el('button', { class: 'btn btn-sm', text: 'Assign Territories', onclick: () => assignTerritoryModal(users, territories) }),
  ]);

  container.appendChild(card('User Management', el('div', {}, [actions, table])));
}

function openUserModal(user, users, roles, territories) {
  const isNew = !user;
  const f = { username: '', email: '', name: '', employeeId: '', roleId: '', status: 'active' };
  if (user) Object.assign(f, user);

  const roleSel = el('select', { class: 'select' }, roles.map((r) => el('option', { value: r.id, text: r.name, selected: r.id === f.roleId ? '' : null })));
  const username = input(f.username);
  const name = input(f.name);
  const email = input(f.email);
  const emp = input(f.employeeId);
  const password = input('', 'password');

  const content = el('div', {}, [
    field('Username', username), field('Name', name), field('Email', email), field('Employee ID', emp),
    el('div', { class: 'form-row' }, [el('label', { text: 'Role' }), roleSel]),
    isNew ? field('Password', password) : null,
  ]);

  modal(isNew ? 'Create User' : 'Edit User', content, [
    el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => {
      try {
        const body = { username: username.value, name: name.value, email: email.value, employeeId: emp.value, roleId: Number(roleSel.value) };
        if (isNew) body.password = password.value || undefined;
        if (isNew) await api.post('/admin/users', body);
        else await api.put('/admin/users/' + user.id, body);
        toast('Saved', 'success');
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

function assignTerritoryModal(users, territories) {
  const userSel = el('select', { class: 'select' }, users.map((u) => el('option', { value: u.id, text: `${u.name} (${u.username})` })));
  const checkWrap = el('div', { class: 'check-list' });
  const selAll = el('button', { class: 'btn btn-sm', text: 'Select all', onclick: () => { document.querySelectorAll('.check-list input').forEach((c) => { c.checked = true; checked.add(Number(c.value)); }); } });
  const clrAll = el('button', { class: 'btn btn-sm', text: 'Clear all', onclick: () => { document.querySelectorAll('.check-list input').forEach((c) => { c.checked = false; checked.delete(Number(c.value)); }); } });
  let checked = new Set();

  async function loadAssigned() {
    const d = await api.get('/admin/users/' + userSel.value + '/territories');
    checked = new Set((d.territories || []).map((t) => t.id));
    checkWrap.innerHTML = '';
    const sorted = [...territories].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    for (const t of sorted) {
      checkWrap.appendChild(el('label', {}, [
        el('input', { type: 'checkbox', value: t.id, checked: checked.has(t.id) ? '' : null, onchange: (e) => { e.target.checked ? checked.add(t.id) : checked.delete(t.id); } }),
        el('span', { text: levelLabel(t.level) + ' · ' + t.name }),
      ]));
    }
  }
  userSel.addEventListener('change', loadAssigned);
  loadAssigned();

  modal('Assign Territories', el('div', {}, [
    el('div', { class: 'form-row' }, [el('label', { text: 'User' }), userSel]),
    el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' }, [selAll, clrAll]),
    el('label', { class: 'muted', text: 'Select territories (Region = সব child territory access)' }),
    checkWrap,
  ]), [
    el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => {
      try {
        const uid = userSel.value;
        const current = await api.get('/admin/users/' + uid + '/territories');
        const curIds = new Set((current.territories || []).map((t) => t.id));
        const toAdd = [...checked].filter((id) => !curIds.has(id));
        const toRemove = [...curIds].filter((id) => !checked.has(id));
        if (toAdd.length) await api.post('/admin/users/' + uid + '/territories', { territoryIds: toAdd });
        for (const id of toRemove) await api.del('/admin/users/' + uid + '/territories/' + id);
        toast('Territories saved', 'success');
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

// ---------------------------------------------------------------------------
async function renderRoles(container) {
  const [rolesData, permData] = await Promise.all([api.get('/admin/roles'), api.get('/admin/permissions')]);
  const roles = rolesData.roles || [];
  const perms = permData.permissions || [];

  const rows = roles.map((r) => ({ ...r, levelLabel: levelLabel(r.level), perms: r.permissions.join(', ') }));

  container.appendChild(card('Roles', dataTable({
    columns: [
      { label: 'Code', key: 'code' },
      { label: 'Name', key: 'name' },
      { label: 'Level', key: 'levelLabel' },
      { label: 'Status', key: 'active', format: (a) => a ? badge('Active', 'success') : badge('Inactive', 'neutral') },
      { label: 'Permissions', key: 'perms' },
    ],
    rows,
  })));

  container.appendChild(card('Actions', el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
    el('button', { class: 'btn btn-primary btn-sm', text: '+ New Role', onclick: () => openRoleModal(null, roles) }),
    el('button', { class: 'btn btn-sm', text: 'Edit Permissions', onclick: () => openPermModal(roles, perms) }),
  ])));
}

function openRoleModal(role, roles) {
  const isNew = !role;
  const code = input(role?.code || '');
  const name = input(role?.name || '');
  const levelSel = el('select', { class: 'select' }, LEVELS.map((l) => el('option', { value: l.value, text: l.label, selected: (role?.level === l.value) ? '' : null })));
  modal(isNew ? 'Create Role' : 'Edit Role', el('div', {}, [
    field('Code', code), field('Name', name),
    el('div', { class: 'form-row' }, [el('label', { text: 'Hierarchy Level' }), levelSel]),
  ]), [
    el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => {
      try {
        const body = { code: code.value, name: name.value, level: Number(levelSel.value) };
        if (isNew) await api.post('/admin/roles', body);
        else await api.put('/admin/roles/' + role.id, body);
        toast('Saved', 'success'); location.reload();
      } catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

function openPermModal(roles, perms) {
  const roleSel = el('select', { class: 'select' }, roles.map((r) => el('option', { value: r.id, text: r.name })));
  const checkWrap = el('div', { class: 'check-list' });
  let checked = new Set();

  async function loadPerms() {
    const d = await api.get('/admin/roles/' + roleSel.value + '/permissions');
    checked = new Set(d.permissions || []);
    checkWrap.innerHTML = '';
    for (const p of perms) {
      checkWrap.appendChild(el('label', {}, [
        el('input', { type: 'checkbox', value: p.code, checked: checked.has(p.code) ? '' : null, onchange: (e) => { e.target.checked ? checked.add(p.code) : checked.delete(p.code); } }),
        el('span', { text: p.code }),
      ]));
    }
  }
  roleSel.addEventListener('change', loadPerms);
  loadPerms();

  modal('Edit Permissions', el('div', {}, [
    el('div', { class: 'form-row' }, [el('label', { text: 'Role' }), roleSel]),
    el('label', { class: 'muted', text: 'Permissions' }),
    checkWrap,
  ]), [
    el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => {
      try {
        await api.put('/admin/roles/' + roleSel.value + '/permissions', { permissions: [...checked] });
        toast('Saved', 'success'); location.reload();
      } catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

// ---------------------------------------------------------------------------
async function renderTerritories(container) {
  const data = await api.get('/admin/territories');
  const territories = data.territories || [];
  const tree = data.tree || [];

  const rows = territories.map((t) => ({
    ...t,
    levelLabel: levelLabel(t.level),
    parentName: t.parentId ? territories.find((x) => x.id === t.parentId)?.name || '—' : '—',
  }));

  container.appendChild(card('Territory Hierarchy', dataTable({
    columns: [
      { label: 'Name', key: 'name' },
      { label: 'Code', key: 'code' },
      { label: 'Level', key: 'levelLabel' },
      { label: 'Parent', key: 'parentName' },
      { label: 'Status', key: 'active', format: (a) => a ? badge('Active', 'success') : badge('Inactive', 'neutral') },
    ],
    rows,
  })));

  container.appendChild(card('Actions', el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
    el('button', { class: 'btn btn-primary btn-sm', text: '+ New Territory', onclick: () => openTerritoryModal(null, territories) }),
    el('button', { class: 'btn btn-sm', text: 'Edit Territory', onclick: () => editTerritoryModal(territories) }),
  ])));
}

function openTerritoryModal(t, territories) {
  const isNew = !t;
  const name = input(t?.name || '');
  const code = input(t?.code || '');
  const levelSel = el('select', { class: 'select' }, LEVELS.map((l) => el('option', { value: l.value, text: l.label, selected: (t?.level === l.value) ? '' : null })));
  const parentSel = el('select', { class: 'select' }, [
    el('option', { value: '', text: '— None —' }),
    ...territories.filter((x) => x.id !== t?.id).map((x) => el('option', { value: x.id, text: x.name, selected: (t?.parentId === x.id) ? '' : null })),
  ]);
  modal(isNew ? 'Create Territory' : 'Edit Territory', el('div', {}, [
    field('Name', name), field('Code', code),
    el('div', { class: 'form-row' }, [el('label', { text: 'Level' }), levelSel]),
    el('div', { class: 'form-row' }, [el('label', { text: 'Parent' }), parentSel]),
  ]), [
    el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => {
      try {
        const body = { name: name.value, code: code.value, level: Number(levelSel.value), parentId: parentSel.value ? Number(parentSel.value) : null };
        if (isNew) await api.post('/admin/territories', body);
        else await api.put('/admin/territories/' + t.id, body);
        toast('Saved', 'success'); location.reload();
      } catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

function editTerritoryModal(territories) {
  const sel = el('select', { class: 'select' }, territories.map((t) => el('option', { value: t.id, text: t.name })));
  modal('Edit / Delete Territory', el('div', {}, [
    el('div', { class: 'form-row' }, [el('label', { text: 'Territory' }), sel]),
  ]), [
    el('button', { class: 'btn btn-primary', text: 'Edit', onclick: () => openTerritoryModal(territories.find((t) => t.id === Number(sel.value)), territories) }),
    el('button', { class: 'btn btn-danger', text: 'Delete', onclick: async () => {
      try { await api.del('/admin/territories/' + sel.value); toast('Deleted', 'success'); location.reload(); }
      catch (e) { toast(e.message, 'error'); }
    } }),
  ]);
}

// ---------------------------------------------------------------------------
async function renderTargets(container) {
  const month = new Date().toISOString().slice(0, 7);
  const [terrData, targetData] = await Promise.all([
    api.get('/admin/territories'),
    api.get('/admin/targets?month=' + month),
  ]);
  const territories = (terrData.territories || []).filter((t) => t.level >= 1 && t.active);
  const existing = targetData.targets || [];

  const inputs = new Map();
  for (const t of territories) {
    const found = existing.find((e) => e.territory_id === t.id);
    const inp = el('input', { type: 'number', value: found ? found.target_value : '' });
    inputs.set(t.id, inp);
  }

  const rows = territories.map((t) => ({
    name: `${levelLabel(t.level)} · ${t.name}`,
    input: inputs.get(t.id),
  }));

  const tbl = el('table', { class: 'data' });
  tbl.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: 'Territory' }), el('th', { text: `Target (${month})` })])]));
  const tbody = el('tbody');
  for (const r of rows) tbody.appendChild(el('tr', {}, [el('td', { text: r.name }), el('td', {}, [r.input])]));
  tbl.appendChild(tbody);

  container.appendChild(card('Monthly Targets (' + month + ')', el('div', {}, [
    el('div', { class: 'table-wrap' }, [tbl]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-primary', text: 'Save Targets', onclick: async () => {
        const rows = territories.map((t) => ({ territoryId: t.id, product: 'All', month, targetValue: Number(inputs.get(t.id).value) || 0 }));
        await api.put('/admin/targets', { rows });
        toast('Targets saved', 'success');
      } }),
    ]),
  ])));
}

// ---------------------------------------------------------------------------
async function renderConfig(container) {
  const data = await api.get('/admin/config');
  const cfg = data.config || {};
  const at = cfg.achievementThresholds || {};
  const tw = cfg.tourWeights || {};

  const critVal = input(cfg.criticalPendingValue ?? 500000, 'number');
  const highVal = input(cfg.highPendingValue ?? 200000, 'number');
  const critDays = input(cfg.criticalPendingDays ?? 30, 'number');
  const highDays = input(cfg.highPendingDays ?? 15, 'number');
  const exceeding = input(at.exceeding ?? 105, 'number');
  const onTrack = input(at.onTrack ?? 100, 'number');
  const atRisk = input(at.atRisk ?? 90, 'number');

  container.appendChild(card('Business Logic Configuration', el('div', { class: 'grid-2' }, [
    field('Critical pending value (৳)', critVal),
    field('High pending value (৳)', highVal),
    field('Critical pending days', critDays),
    field('High pending days', highDays),
    field('Exceeding threshold (%)', exceeding),
    field('On Track threshold (%)', onTrack),
    field('At Risk threshold (%)', atRisk),
  ])));

  container.appendChild(card('Save', el('div', { class: 'modal-actions' }, [
    el('button', { class: 'btn btn-primary', text: 'Save Configuration', onclick: async () => {
      await api.put('/admin/config', {
        criticalPendingValue: Number(critVal.value) || 0,
        highPendingValue: Number(highVal.value) || 0,
        criticalPendingDays: Number(critDays.value) || 0,
        highPendingDays: Number(highDays.value) || 0,
        achievementThresholds: { exceeding: Number(exceeding.value) || 105, onTrack: Number(onTrack.value) || 100, atRisk: Number(atRisk.value) || 90 },
      });
      toast('Configuration saved', 'success');
    } }),
  ])));
}

// ---------------------------------------------------------------------------
async function renderAudit(container) {
  const data = await api.get('/admin/audit?limit=200');
  const logs = data.logs || [];
  container.appendChild(card('Audit Logs (' + (data.total || logs.length) + ')', dataTable({
    columns: [
      { label: 'Time', key: 'createdAt', format: (v) => new Date(v).toLocaleString() },
      { label: 'User', key: 'username' },
      { label: 'Action', key: 'action' },
      { label: 'Entity', key: 'entity' },
      { label: 'Entity ID', key: 'entityId' },
      { label: 'IP', key: 'ip' },
    ],
    rows: logs,
  })));
}

// ---- helpers ----
function field(label, inputEl) {
  return el('div', { class: 'form-row' }, [el('label', { text: label }), inputEl]);
}
function input(value, type = 'text') {
  return el('input', { type, value: value ?? '' });
}
function row(label, value) {
  return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
    el('span', { class: 'muted', text: label }),
    el('span', { style: 'font-weight:600;' }, [value]),
  ]);
}
