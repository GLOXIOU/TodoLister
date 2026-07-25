/* ── Dashboard ───────────────────────────────────────────────── */

let allProjects = [];

async function loadDashboard() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<div class="loader"><span class="spinner"></span> Loading...</div>';
  try {
    allProjects = await API.getProjects();
    renderProjects(allProjects);
  } catch (e) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><p>${e.message}</p></div>`;
  }
}

const STATUS_LABELS = {
  in_dev:   '🔵 In Dev',
  to_fix:   '🟠 To Fix',
  in_prod:  '🟢 In Prod',
  paused:   '⚫ Paused',
  archived: '📦 Archived'
};

function renderProjects(projects) {
  const grid = document.getElementById('projects-grid');
  const count = document.getElementById('project-count');
  count.textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;

  if (!projects.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
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
          <span class="badge badge-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
          <span class="badge badge-${p.visibility}">${p.visibility === 'public' ? '🌐' : '🔒'}</span>
        </div>
      </div>
      ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}
      <div class="project-card-footer">
        ${p.repo_url ? `<div class="project-card-repo">
          <span>⌥</span>
          <a href="${esc(p.repo_url)}" target="_blank" onclick="event.stopPropagation()" title="${esc(p.repo_url)}">
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

function toggleSharePwField() {
  const vis = document.getElementById('proj-form-visibility').value;
  document.getElementById('share-pw-field').style.display = vis === 'public' ? '' : 'none';
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

  try {
    if (id) {
      await API.updateProject(id, data);
      toast('Project updated ✓');
      // Refresh project header if we're on the project page
      if (window._currentProject) {
        window._currentProject = { ...window._currentProject, ...data };
        renderProjectHeader(window._currentProject);
      }
    } else {
      const res = await API.createProject(data);
      toast('Project created ✓');
      closeModal('modal-project');
      router.go('project', res.id);
      return;
    }
    closeModal('modal-project');
    if (router.current === 'dashboard') loadDashboard();
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

function openFilterModal() {
  // Simple inline filter by status for now
  const statuses = ['all', 'in_dev', 'to_fix', 'in_prod', 'paused', 'archived'];
  const current  = window._dashFilter || 'all';
  const next     = statuses[(statuses.indexOf(current) + 1) % statuses.length];
  window._dashFilter = next;
  const filtered = next === 'all' ? allProjects : allProjects.filter(p => p.status === next);
  renderProjects(filtered);
  toast(next === 'all' ? 'Showing all projects' : `Filtered: ${STATUS_LABELS[next]}`, 'warn');
}

/* ── Share modal ─────────────────────────────────────────────── */
function openShareModal() {
  const p = window._currentProject;
  if (!p) return;

  const statusEl = document.getElementById('share-current-status');
  statusEl.innerHTML = `
    <div class="flex gap-2 items-center">
      <span class="badge badge-${p.visibility}">${p.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span>
      ${p.visibility === 'private'
        ? '<span class="text-sm text-muted">This project is private. Only whitelisted IPs can access it.</span>'
        : '<span class="text-sm text-muted">Anyone with the link and password can access this project.</span>'}
    </div>
  `;

  const link = `${window.location.origin}/share/${p.id}`;
  document.getElementById('share-link').value = link;
  openModal('modal-share');
}

function copyShareLink() {
  const input = document.getElementById('share-link');
  navigator.clipboard.writeText(input.value).then(() => toast('Link copied ✓'));
}

async function saveShareSettings() {
  const p = window._currentProject;
  if (!p) return;
  const perm = document.getElementById('share-permission').value;
  try {
    await API.setPermission(p.id, perm);
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
    await API.revokeGuests(p.id);
    toast('All guest sessions revoked');
    closeModal('modal-share');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Escape helper ───────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
