/* ── API helper ──────────────────────────────────────────────── */

const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch('/api' + path, opts);

    // If access denied, redirect to home
    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (data.error === 'ACCESS_DENIED') {
        window.location.href = '/';
        return;
      }
      if (data.error === 'PRIVATE') {
        throw { status: 403, code: 'PRIVATE', message: data.message };
      }
    }
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      throw { status: 401, code: data.error, message: data.message };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(
        err.error ||
        err.message ||
        (err.code ? `Request failed (${err.code})` : `Request failed (${res.status})`)
      );
    }
    return res.json();
  },

  get:    (path)        => API.request('GET',    path),
  post:   (path, body)  => API.request('POST',   path, body),
  put:    (path, body)  => API.request('PUT',    path, body),
  delete: (path)        => API.request('DELETE', path),

  // Projects
  getProjects:    ()      => API.get('/projects'),
  getProject:     (id)    => API.get(`/projects/${id}`),
  createProject:  (data)  => API.post('/projects', data),
  updateProject:  (id, d) => API.put(`/projects/${id}`, d),
  deleteProject:  (id)    => API.delete(`/projects/${id}`),

  // Board
  getBoard:       (pid)   => API.get(`/projects/${pid}/board`),
  createCard:     (pid,d) => API.post(`/projects/${pid}/cards`, d),
  updateCard:     (pid,id,d) => API.put(`/projects/${pid}/cards/${id}`, d),
  deleteCard:     (pid,id)   => API.delete(`/projects/${pid}/cards/${id}`),
  createCategory: (pid,d) => API.post(`/projects/${pid}/categories`, d),
  updateCategory: (pid,id,d) => API.put(`/projects/${pid}/categories/${id}`, d),
  deleteCategory: (pid,id)   => API.delete(`/projects/${pid}/categories/${id}`),
  createStatus:   (pid,d) => API.post(`/projects/${pid}/statuses`, d),
  updateStatus:   (pid,id,d) => API.put(`/projects/${pid}/statuses/${id}`, d),
  deleteStatus:   (pid,id)   => API.delete(`/projects/${pid}/statuses/${id}`),

  // Notes
  getNotes:       (pid)   => API.get(`/projects/${pid}/notes`),
  saveNotes:      (pid,c) => API.put(`/projects/${pid}/notes`, { content: c }),

  // Share
  shareAuth:       (pid, pw) => API.post(`/share/${pid}/auth`, { password: pw }),
  setPermission:   (pid, p)  => API.put(`/share/${pid}/permission`, { permission: p }),
  revokeGuests:    (pid)     => API.delete(`/share/${pid}/revoke`),
};

/* ── Toast ───────────────────────────────────────────────────── */
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'warn' ? ' toast-warn' : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Modal helpers ───────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

/* ── Date formatter ──────────────────────────────────────────── */
function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function timeAgo(str) {
  if (!str) return '';
  const diff = Date.now() - new Date(str);
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
