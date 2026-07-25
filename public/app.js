/* ── Router ──────────────────────────────────────────────────── */
const router = {
  current: null,

  go(page, param) {
    // Hide all pages
    document.querySelectorAll('[id^="page-"]').forEach(el => el.classList.add('hidden'));

    if (page === 'dashboard') {
      this.current = 'dashboard';
      document.title = 'TodoLister';
      history.pushState({ page }, '', '/');
      document.getElementById('page-dashboard').classList.remove('hidden');
      renderTopbar('dashboard');
      loadDashboard();

    } else if (page === 'project') {
      this.current = 'project';
      document.getElementById('page-project').classList.remove('hidden');
      loadProjectPage(param);

    } else if (page === 'guest') {
      this.current = 'guest';
      document.getElementById('page-guest').classList.remove('hidden');
      renderTopbar('guest');
      document.getElementById('guest-project-name').textContent =
        `Enter the password to access this project.`;
      window._guestProjectId = param;

    } else if (page === 'access-denied') {
      document.getElementById('page-dashboard').classList.remove('hidden');
      document.getElementById('page-dashboard').innerHTML = `
        <div class="empty" style="padding:8rem">
          <div class="empty-icon">🚫</div>
          <h2 class="text-red" style="margin-bottom:.5rem">Access Denied</h2>
          <p>This project is private and you are not authorized to view it.</p>
        </div>`;
    }
  }
};

/* ── Topbar render ───────────────────────────────────────────── */
function renderTopbar(page) {
  const el = document.getElementById('topbar-actions');
  if (page === 'dashboard') {
    el.innerHTML = '';
  } else {
    el.innerHTML = '';
  }
}

/* ── Load project page ───────────────────────────────────────── */
async function loadProjectPage(projectId) {
  window._currentProject = null;
  document.getElementById('proj-name').textContent = 'Loading...';
  document.getElementById('proj-meta').innerHTML   = '';
  document.getElementById('board').innerHTML       = '<div class="loader"><span class="spinner"></span></div>';

  try {
    const project = await API.getProject(projectId);
    window._currentProject = project;
    document.title = `${project.name} — TodoLister`;
    renderProjectHeader(project);
    await Promise.all([
      loadBoard(projectId),
      loadNotes(projectId)
    ]);
    // Reset hidden sets when switching projects
    hiddenCategories.clear();
    hiddenStatuses.clear();
    renderToggles();
  } catch (err) {
    if (err.status === 401 && err.code === 'PASSWORD_REQUIRED') {
      router.go('guest', projectId);
    } else if (err.status === 403 && err.code === 'PRIVATE') {
      router.go('access-denied');
    } else {
      toast(err.message || String(err), 'error');
      router.go('dashboard');
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

function renderProjectHeader(p) {
  document.getElementById('proj-name').textContent = p.name;
  const st  = STATUS_MAP[p.status] || { label: p.status, cls: '' };
  const vis = p.visibility === 'public' ? '🌐 Public' : '🔒 Private';
  document.getElementById('proj-meta').innerHTML = `
    <span class="badge ${st.cls}">${st.label}</span>
    <span class="badge badge-${p.visibility}">${vis}</span>
    ${p.repo_url ? `<a href="${esc(p.repo_url)}" target="_blank" class="text-sm text-muted" style="display:flex;align-items:center;gap:.3rem">⌥ Repo</a>` : ''}
  `;

  // Update sidebar info
  document.getElementById('info-status').innerHTML    = `<span class="badge ${st.cls}">${st.label}</span>`;
  document.getElementById('info-visibility').innerHTML = `<span class="badge badge-${p.visibility}">${vis}</span>`;
  document.getElementById('info-created').textContent = fmtDate(p.created_at);
  document.getElementById('info-updated').textContent = fmtDate(p.updated_at);
  if (p.repo_url) {
    document.getElementById('info-repo').innerHTML = `<a href="${esc(p.repo_url)}" target="_blank">${esc(p.repo_url)}</a>`;
  } else {
    document.getElementById('info-repo').textContent = '—';
  }
}

/* ── Notes ───────────────────────────────────────────────────── */
let _notesTimer = null;

async function loadNotes(projectId) {
  try {
    const data = await API.getNotes(projectId);
    document.getElementById('sidebar-notes').value = data.content || '';
  } catch (_) {}
}

document.getElementById('sidebar-notes').addEventListener('input', () => {
  clearTimeout(_notesTimer);
  _notesTimer = setTimeout(async () => {
    const pid = window._currentProject?.id;
    if (!pid) return;
    const content = document.getElementById('sidebar-notes').value;
    try {
      await API.saveNotes(pid, content);
    } catch (_) {}
  }, 800);
});

/* ── Sidebar ─────────────────────────────────────────────────── */
let _sidebarOpen = true;
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('mobile-open');
}

function switchSidebarTab(tab, btn) {
  document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sidebar-notes-panel').classList.toggle('hidden', tab !== 'notes');
  document.getElementById('sidebar-info-panel').classList.toggle('hidden', tab !== 'info');
}

/* ── Guest auth ──────────────────────────────────────────────── */
async function submitGuestAuth() {
  const pid = window._guestProjectId;
  const pw  = document.getElementById('guest-password').value;
  const errEl = document.getElementById('guest-error');
  errEl.classList.add('hidden');

  if (!pw) { errEl.textContent = 'Password required.'; errEl.classList.remove('hidden'); return; }

  try {
    await API.shareAuth(pid, pw);
    router.go('project', pid);
  } catch (e) {
    errEl.textContent = e.message || 'Wrong password.';
    errEl.classList.remove('hidden');
  }
}

/* ── Initial routing ─────────────────────────────────────────── */
function init() {
  const path = window.location.pathname;

  // /share/:projectId — guest access
  const shareMatch = path.match(/^\/share\/(\d+)/);
  if (shareMatch) {
    router.go('guest', parseInt(shareMatch[1]));
    return;
  }

  // /project/:id — direct project link (only for whitelisted)
  const projMatch = path.match(/^\/project\/(\d+)/);
  if (projMatch) {
    router.go('project', parseInt(projMatch[1]));
    return;
  }

  // Default: dashboard
  router.go('dashboard');
}

// Browser back/forward
window.addEventListener('popstate', () => init());

// Start
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
