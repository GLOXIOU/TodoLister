/* ── Router ──────────────────────────────────────────────────── */
const router = {
  current: null,

  /**
   * Show a page. `push: false` is used when reacting to back/forward, so we
   * don't add a new history entry for a URL the browser already shows.
   */
  go(page, param, { push = true } = {}) {
    // Guests only ever see their shared project — there is no dashboard for them.
    if (page === 'dashboard' && isShareUrl() && window._accessLevel !== 'owner') return;

    flushNotes();
    document.querySelectorAll('[id^="page-"]').forEach(el => el.classList.add('hidden'));

    if (page === 'dashboard') {
      this.current = 'dashboard';
      document.title = 'TodoLister';
      setUrl('/', push);
      document.getElementById('page-dashboard').classList.remove('hidden');
      loadDashboard();

    } else if (page === 'project') {
      this.current = 'project';
      // A guest stays on /share/:id; owners get a /project/:id permalink.
      if (location.pathname !== `/share/${param}`) setUrl(`/project/${param}`, push);
      document.getElementById('page-project').classList.remove('hidden');
      loadProjectPage(param);

    } else if (page === 'guest') {
      this.current = 'guest';
      setUrl(`/share/${param}`, push);
      setAccessLevel(null);
      document.title = 'Password required — TodoLister';
      document.getElementById('page-guest').classList.remove('hidden');
      document.getElementById('guest-password').value = '';
      document.getElementById('guest-error').classList.add('hidden');
      window._guestProjectId = param;
      setTimeout(() => document.getElementById('guest-password').focus(), 50);

    } else if (page === 'denied') {
      this.current = 'denied';
      setAccessLevel(null);
      document.getElementById('page-denied').classList.remove('hidden');
    }
  }
};

function isShareUrl() {
  return /^\/share\/\d+/.test(location.pathname);
}

function setUrl(url, push) {
  if (location.pathname === url) return;
  if (push) history.pushState({}, '', url);
  else history.replaceState({}, '', url);
}

/* ── Load project page ───────────────────────────────────────── */
async function loadProjectPage(projectId) {
  window._currentProject = null;
  document.getElementById('proj-name').textContent = 'Loading...';
  document.getElementById('proj-meta').innerHTML   = '';
  document.getElementById('board').innerHTML       = '<div class="loader"><span class="spinner"></span></div>';
  document.getElementById('sidebar-notes').value   = '';

  // Per-project view filters start fresh.
  hiddenCategories.clear();
  hiddenStatuses.clear();

  try {
    const project = await API.getProject(projectId);
    window._currentProject = project;
    setAccessLevel(project.access);
    document.title = `${project.name} — TodoLister`;
    renderProjectHeader(project);
    await Promise.all([
      loadBoard(projectId),
      loadNotes(projectId)
    ]);
  } catch (err) {
    if (err.status === 401 && err.code === 'PASSWORD_REQUIRED') {
      router.go('guest', projectId, { push: false });
    } else if (err.status === 403 && err.code === 'PRIVATE') {
      router.go('denied');
    } else if (err.status === 404) {
      toast('Project not found.', 'error');
      router.go('dashboard', null, { push: false });
    } else {
      toast(err.message || String(err), 'error');
      router.go('dashboard', null, { push: false });
    }
  }
}

/* ── Project header ──────────────────────────────────────────── */
const STATUS_MAP = {
  in_dev:   { label: '🔵 In Development', cls: 'badge-in_dev' },
  to_fix:   { label: '🟠 To Fix',         cls: 'badge-to_fix' },
  in_prod:  { label: '🟢 In Production',  cls: 'badge-in_prod' },
  paused:   { label: '⚫ Paused',          cls: 'badge-paused' },
  archived: { label: '📦 Archived',        cls: 'badge-archived' },
};

const GUEST_ACCESS_LABELS = {
  observer:   '👁 Read only',
  card_mover: '🖱 Can move cards',
  editor:     '✏ Can edit'
};

function renderProjectHeader(p) {
  document.getElementById('proj-name').textContent = p.name;
  const st  = STATUS_MAP[p.status] || { label: p.status, cls: '' };
  const vis = p.visibility === 'public' ? '🌐 Public' : '🔒 Private';
  const guestBadge = GUEST_ACCESS_LABELS[p.access]
    ? `<span class="badge badge-guest" title="Your access to this shared project">${GUEST_ACCESS_LABELS[p.access]}</span>`
    : '';
  document.getElementById('proj-meta').innerHTML = `
    <span class="badge ${st.cls}">${esc(st.label)}</span>
    <span class="badge badge-${esc(p.visibility)}">${vis}</span>
    ${guestBadge}
    ${p.repo_url ? `<a href="${esc(safeUrl(p.repo_url))}" target="_blank" rel="noopener noreferrer" class="text-sm text-muted" style="display:flex;align-items:center;gap:.3rem">⌥ Repo</a>` : ''}
  `;

  // Update sidebar info
  document.getElementById('info-status').innerHTML     = `<span class="badge ${st.cls}">${esc(st.label)}</span>`;
  document.getElementById('info-visibility').innerHTML = `<span class="badge badge-${esc(p.visibility)}">${vis}</span>`;
  document.getElementById('info-created').textContent  = fmtDate(p.created_at);
  document.getElementById('info-updated').textContent  = fmtDate(p.updated_at);
  if (p.repo_url) {
    document.getElementById('info-repo').innerHTML =
      `<a href="${esc(safeUrl(p.repo_url))}" target="_blank" rel="noopener noreferrer">${esc(p.repo_url)}</a>`;
  } else {
    document.getElementById('info-repo').textContent = '—';
  }
}

/* ── Notes (autosaved) ───────────────────────────────────────── */
let _notesTimer   = null;
let _notesPending = null; // { pid, content } waiting to be saved

async function loadNotes(projectId) {
  try {
    const data = await API.getNotes(projectId);
    if (window._currentProject?.id === projectId) {
      document.getElementById('sidebar-notes').value = data.content || '';
    }
  } catch (_) {}
}

async function saveNotesNow() {
  clearTimeout(_notesTimer);
  const pending = _notesPending;
  _notesPending = null;
  if (!pending) return;
  try {
    await API.saveNotes(pending.pid, pending.content);
  } catch (e) {
    toast('Notes not saved: ' + e.message, 'error');
  }
}

/** Save pending notes right away (before switching project / leaving). */
function flushNotes() {
  if (_notesPending) saveNotesNow();
}

document.getElementById('sidebar-notes').addEventListener('input', e => {
  const pid = window._currentProject?.id;
  if (!pid || !can('editor')) return;
  // Bind the content to the project it was typed in.
  _notesPending = { pid, content: e.target.value };
  clearTimeout(_notesTimer);
  _notesTimer = setTimeout(saveNotesNow, 800);
});

// Closing the tab within the debounce window: send the last edit anyway.
window.addEventListener('pagehide', () => {
  if (!_notesPending) return;
  const { pid, content } = _notesPending;
  _notesPending = null;
  fetch(`/api/projects/${pid}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({ content })
  }).catch(() => {});
});

/* ── Sidebar ─────────────────────────────────────────────────── */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.matchMedia('(max-width: 768px)').matches) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

function switchSidebarTab(tab, btn) {
  document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sidebar-notes-panel').classList.toggle('hidden', tab !== 'notes');
  document.getElementById('sidebar-info-panel').classList.toggle('hidden', tab !== 'info');
}

/* ── Guest auth ──────────────────────────────────────────────── */
async function submitGuestAuth() {
  const pid   = window._guestProjectId;
  const pw    = document.getElementById('guest-password').value;
  const errEl = document.getElementById('guest-error');
  errEl.classList.add('hidden');

  if (!pw) { errEl.textContent = 'Password required.'; errEl.classList.remove('hidden'); return; }

  try {
    await API.shareAuth(pid, pw);
    router.go('project', pid, { push: false });
  } catch (e) {
    errEl.textContent = e.message || 'Wrong password.';
    errEl.classList.remove('hidden');
  }
}

/* ── Initial routing ─────────────────────────────────────────── */
function init() {
  const path = window.location.pathname;

  // /share/:id — try the project directly; falls back to the password form.
  // /project/:id — direct project link.
  const projMatch = path.match(/^\/(?:share|project)\/(\d+)/);
  if (projMatch) {
    router.go('project', parseInt(projMatch[1]), { push: false });
    return;
  }

  router.go('dashboard', null, { push: false });
}

// Browser back/forward
window.addEventListener('popstate', () => init());

// Start
applyAccessUI();
init();

/* ── Mobile navigation (PlaylistConverter-style) ─────────────── */
(function setupMobileMenu() {
  const mobileBtn = document.querySelector('.mobile-menu-btn');
  const overlay = document.querySelector('.mobile-menu-overlay');
  if (!mobileBtn || !overlay) return;

  function closeMenu() {
    mobileBtn.classList.remove('active');
    overlay.classList.remove('active');
    document.body.classList.remove('menu-open');
    mobileBtn.setAttribute('aria-expanded', 'false');
  }

  mobileBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = !overlay.classList.contains('active');
    if (opening) {
      mobileBtn.classList.add('active');
      overlay.classList.add('active');
      document.body.classList.add('menu-open');
      mobileBtn.setAttribute('aria-expanded', 'true');
    } else {
      closeMenu();
    }
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeMenu();
  });

  overlay.querySelectorAll('.mobile-menu-item').forEach(item => {
    item.addEventListener('click', () => closeMenu());
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) closeMenu();
  });
})();
