/* ── Dashboard ───────────────────────────────────────────────── */

let allProjects = [];

async function loadDashboard() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<div class="loader"><span class="spinner"></span> Loading...</div>';
  try {
    allProjects = await API.getProjects();
    setAccessLevel('owner'); // only whitelisted IPs can list projects
    applyDashboardFilters();
  } catch (e) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><p>${esc(e.message)}</p></div>`;
  }
}

const STATUS_LABELS = {
  in_dev:   '🔵 In Dev',
  to_fix:   '🟠 To Fix',
  in_prod:  '🟢 In Prod',
  paused:   '⚫ Paused',
  archived: '📦 Archived'
};

/* ── Search & status filter ──────────────────────────────────── */
function applyDashboardFilters() {
  const query  = document.getElementById('dash-search').value.trim().toLowerCase();
  const status = document.getElementById('dash-status-filter').value;
  const filtered = allProjects.filter(p =>
    (status === 'all' || p.status === status) &&
    (!query || [p.name, p.description, p.repo_url].some(f => (f || '').toLowerCase().includes(query)))
  );
  renderProjects(filtered, { filtered: Boolean(query) || status !== 'all' });
}

document.getElementById('dash-search').addEventListener('input', applyDashboardFilters);
document.getElementById('dash-status-filter').addEventListener('change', applyDashboardFilters);

function renderProjects(projects, { filtered = false } = {}) {
  const grid  = document.getElementById('projects-grid');
  const count = document.getElementById('project-count');
  const total = allProjects.length;
  count.textContent = filtered
    ? `${projects.length} of ${total} project${total !== 1 ? 's' : ''}`
    : `${total} project${total !== 1 ? 's' : ''}`;

  if (!projects.length) {
    grid.innerHTML = filtered
      ? `<div class="empty" style="grid-column:1/-1">
           <div class="empty-icon">🔍</div>
           <p>No project matches these filters.</p>
         </div>`
      : `<div class="empty" style="grid-column:1/-1">
           <div class="empty-icon">📋</div>
           <p>No projects yet.<br>Create your first one!</p>
         </div>`;
    return;
  }

  grid.innerHTML = '';
  projects.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.style.animationDelay = `${i * 0.04}s`;
    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-card-name">${esc(p.name)}</div>
        <div class="flex gap-2">
          <span class="badge badge-${esc(p.status)}">${STATUS_LABELS[p.status] || esc(p.status)}</span>
          <span class="badge badge-${esc(p.visibility)}">${p.visibility === 'public' ? '🌐' : '🔒'}</span>
        </div>
      </div>
      ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}
      <div class="project-card-footer">
        ${p.repo_url ? `<div class="project-card-repo">
          <span>⌥</span>
          <a href="${esc(safeUrl(p.repo_url))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="${esc(p.repo_url)}">
            <span>${esc(p.repo_url.replace(/^https?:\/\//, ''))}</span>
          </a>
        </div>` : '<span></span>'}
        <span>${timeAgo(p.updated_at)}</span>
      </div>
    `;
    card.onclick = () => router.go('project', p.id);
    grid.appendChild(card);
  });
}

/* ── Create / Edit project modal ────────────────────────────── */
function openCreateProject() {
  document.getElementById('modal-project-title').textContent = 'New Project';
  document.getElementById('proj-edit-id').value = '';
  document.getElementById('proj-form-name').value = '';
  document.getElementById('proj-form-desc').value = '';
  document.getElementById('proj-form-repo').value = '';
  document.getElementById('proj-form-status').value = 'in_dev';
  document.getElementById('proj-form-visibility').value = 'private';
  document.getElementById('proj-form-sharepassword').value = '';
  toggleSharePwField();
  openModal('modal-project');
  setTimeout(() => document.getElementById('proj-form-name').focus(), 50);
}

function openEditProject() {
  const p = window._currentProject;
  if (!p) return;
  document.getElementById('modal-project-title').textContent = 'Edit Project';
  document.getElementById('proj-edit-id').value = p.id;
  document.getElementById('proj-form-name').value = p.name;
  document.getElementById('proj-form-desc').value = p.description || '';
  document.getElementById('proj-form-repo').value = p.repo_url || '';
  document.getElementById('proj-form-status').value = p.status;
  document.getElementById('proj-form-visibility').value = p.visibility;
  document.getElementById('proj-form-sharepassword').value = '';
  toggleSharePwField();
  openModal('modal-project');
}

/** True when the project being edited already has a share password. */
function editedProjectHasPassword() {
  const id = document.getElementById('proj-edit-id').value;
  return Boolean(id && window._currentProject?.id == id && window._currentProject.has_share_password);
}

function toggleSharePwField() {
  const isPublic = document.getElementById('proj-form-visibility').value === 'public';
  document.getElementById('share-pw-field').style.display = isPublic ? '' : 'none';
  const hasPw = editedProjectHasPassword();
  document.getElementById('proj-form-sharepassword').placeholder =
    hasPw ? 'Leave empty to keep current password' : 'At least 4 characters (required)';
  document.getElementById('share-pw-hint').textContent =
    hasPw ? 'Changing the password logs out every connected guest.' : '';
}

async function saveProject() {
  const id   = document.getElementById('proj-edit-id').value;
  const name = document.getElementById('proj-form-name').value.trim();
  if (!name) { toast('Project name is required.', 'error'); return; }

  const data = {
    name,
    description:    document.getElementById('proj-form-desc').value.trim() || null,
    repo_url:       document.getElementById('proj-form-repo').value.trim() || null,
    status:         document.getElementById('proj-form-status').value,
    visibility:     document.getElementById('proj-form-visibility').value,
  };
  const pw = document.getElementById('proj-form-sharepassword').value.trim();
  if (pw) data.share_password = pw;

  if (data.visibility === 'public' && !pw && !editedProjectHasPassword()) {
    toast('Set a share password to make the project public.', 'error');
    document.getElementById('proj-form-sharepassword').focus();
    return;
  }
  if (data.repo_url && !/^https?:\/\//i.test(data.repo_url)) {
    toast('Repository URL must start with http:// or https://', 'error');
    return;
  }

  try {
    if (id) {
      const res = await API.updateProject(id, data);
      toast(res.guests_revoked ? 'Project updated ✓ — guest sessions were logged out' : 'Project updated ✓');
      closeModal('modal-project');
      // Refresh from the server so has_share_password etc. are accurate.
      if (window._currentProject?.id == id) {
        window._currentProject = await API.getProject(id);
        renderProjectHeader(window._currentProject);
      }
      if (router.current === 'dashboard') loadDashboard();
    } else {
      const res = await API.createProject(data);
      toast('Project created ✓');
      closeModal('modal-project');
      router.go('project', res.id);
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteProject() {
  const p = window._currentProject;
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
  try {
    await API.deleteProject(p.id);
    toast('Project deleted');
    router.go('dashboard');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Share modal ─────────────────────────────────────────────── */
function openShareModal() {
  const p = window._currentProject;
  if (!p || !can('owner')) return;

  const isPublic = p.visibility === 'public';
  document.getElementById('share-current-status').innerHTML = `
    <div class="flex gap-2 items-center">
      <span class="badge badge-${esc(p.visibility)}">${isPublic ? '🌐 Public' : '🔒 Private'}</span>
      <span class="text-sm text-muted">${isPublic
        ? 'Anyone with the link and password can access this project.'
        : 'This project is private. Only whitelisted IPs can access it.'}</span>
    </div>
  `;

  const warning = document.getElementById('share-warning');
  if (!isPublic) {
    warning.innerHTML = 'To share it, click <b>✎ Edit</b>, set the visibility to <b>Public</b> and choose a share password.';
    warning.classList.remove('hidden');
  } else if (!p.has_share_password) {
    warning.textContent = 'No share password is set — guests cannot unlock the project. Set one via ✎ Edit.';
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  document.getElementById('share-permission').value = p.guest_permission || 'observer';
  document.getElementById('share-link').value = `${window.location.origin}/share/${p.id}`;
  openModal('modal-share');
}

function copyShareLink() {
  const input = document.getElementById('share-link');
  navigator.clipboard.writeText(input.value)
    .then(() => toast('Link copied ✓'))
    .catch(() => { input.select(); toast('Press Ctrl+C to copy', 'warn'); });
}

async function saveShareSettings() {
  const p = window._currentProject;
  if (!p) return;
  const perm = document.getElementById('share-permission').value;
  try {
    await API.setPermission(p.id, perm);
    p.guest_permission = perm;
    toast('Permission updated ✓');
    closeModal('modal-share');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function revokeAllGuests() {
  const p = window._currentProject;
  if (!p) return;
  if (!confirm('Revoke all guest sessions for this project?')) return;
  try {
    const res = await API.revokeGuests(p.id);
    toast(`Guest sessions revoked (${res.revoked ?? 0})`);
    closeModal('modal-share');
  } catch (e) {
    toast(e.message, 'error');
  }
}
