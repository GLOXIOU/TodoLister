/* ── API helper ──────────────────────────────────────────────── */

const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res  = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => null);

    // IP not whitelisted: let the server show its block page.
    if (res.status === 403 && data?.error === 'ACCESS_DENIED') {
      window.location.href = '/';
      return new Promise(() => {}); // page is navigating away
    }

    if (!res.ok) {
      const err  = new Error(data?.message || data?.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code   = data?.error;
      throw err;
    }
    return data;
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
  moveCard:       (pid,id,d) => API.post(`/projects/${pid}/cards/${id}/move`, d),
  deleteCard:     (pid,id)   => API.delete(`/projects/${pid}/cards/${id}`),
  createCategory: (pid,d) => API.post(`/projects/${pid}/categories`, d),
  updateCategory: (pid,id,d) => API.put(`/projects/${pid}/categories/${id}`, d),
  deleteCategory: (pid,id)   => API.delete(`/projects/${pid}/categories/${id}`),
  reorderCategories: (pid,ids) => API.put(`/projects/${pid}/categories/order`, { ids }),
  createStatus:   (pid,d) => API.post(`/projects/${pid}/statuses`, d),
  updateStatus:   (pid,id,d) => API.put(`/projects/${pid}/statuses/${id}`, d),
  deleteStatus:   (pid,id)   => API.delete(`/projects/${pid}/statuses/${id}`),
  reorderStatuses:   (pid,ids) => API.put(`/projects/${pid}/statuses/order`, { ids }),

  // Notes
  getNotes:       (pid)   => API.get(`/projects/${pid}/notes`),
  saveNotes:      (pid,c) => API.put(`/projects/${pid}/notes`, { content: c }),

  // Share
  shareAuth:       (pid, pw) => API.post(`/share/${pid}/auth`, { password: pw }),
  setPermission:   (pid, p)  => API.put(`/share/${pid}/permission`, { permission: p }),
  revokeGuests:    (pid)     => API.delete(`/share/${pid}/revoke`),
};

/* ── Access level (owner = whitelisted IP, else guest level) ── */
const ACCESS_LEVELS = { observer: 0, card_mover: 1, editor: 2, owner: 3 };
window._accessLevel = null; // unknown until the server tells us

function can(level) {
  const mine = ACCESS_LEVELS[window._accessLevel];
  return mine !== undefined && mine >= ACCESS_LEVELS[level];
}

/** Show/hide every element tagged data-requires="<level>". */
function applyAccessUI() {
  document.querySelectorAll('[data-requires]').forEach(el => {
    el.classList.toggle('hidden', !can(el.dataset.requires));
  });
  const notes = document.getElementById('sidebar-notes');
  notes.readOnly    = !can('editor');
  notes.placeholder = can('editor') ? '// your notes here...' : '// no notes yet';
  document.body.dataset.access = window._accessLevel || 'none';
}

function setAccessLevel(level) {
  window._accessLevel = level;
  applyAccessUI();
}

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
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  // A hidden modal must not keep focus (and blurring commits pending field edits).
  if (modal.contains(document.activeElement)) document.activeElement.blur();
}
// Close modal on overlay click or Escape
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
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

/* ── Escaping / sanitising helpers ───────────────────────────── */
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as hrefs (no javascript: URLs). */
function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#';
}

/** Only hex colors are injected into style attributes. */
function safeColor(color) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color || '') ? color : '#888888';
}
