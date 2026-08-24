const TOKEN_KEY = 'akij_token';
const USER_KEY = 'akij_user';

const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

const sessionUser = {
  get: () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  set: (u) => localStorage.setItem(USER_KEY, JSON.stringify(u)),
  clear: () => localStorage.removeItem(USER_KEY),
};

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401) {
    token.clear();
    if (!location.hash.includes('/login')) location.hash = '#/login';
    throw new Error(data?.error || 'Unauthorized');
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

function qs(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  return new URLSearchParams(clean).toString();
}

export { api, token, sessionUser, qs };
