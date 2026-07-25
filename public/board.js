/* ── Board state ─────────────────────────────────────────────── */
let boardData = { categories: [], statuses: [], cards: [] };
let hiddenCategories = new Set();
let hiddenStatuses   = new Set();

/* ── Load board ──────────────────────────────────────────────── */
async function loadBoard(projectId) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '<div class="loader"><span class="spinner"></span> Loading board...</div>';
  try {
    boardData = await API.getBoard(projectId);
    renderBoard();
    renderToggles();
  } catch (e) {
    boardEl.innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><p>${e.message}</p></div>`;
  }
}

/* ── Render board ────────────────────────────────────────────── */
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  const pid = window._currentProject?.id;

  boardData.categories.forEach(cat => {
    const col = document.createElement('div');
    col.className = 'category-col' + (hiddenCategories.has(cat.id) ? ' hidden' : '');
    col.dataset.catId = cat.id;

    // Category header
    col.innerHTML = `
      <div class="category-header">
        <div class="category-header-left">
          <span class="category-dot" style="background:${cat.color}"></span>
          <span class="category-name">${esc(cat.name)}</span>
        </div>
        <div class="category-actions">
          <button class="k-card-btn" title="Delete category" onclick="confirmDeleteCategory(${cat.id})">✕</button>
        </div>
      </div>
    `;

    // One group per status
    boardData.statuses.forEach(st => {
      const group = document.createElement('div');
      group.className = 'status-group' + (hiddenStatuses.has(st.id) ? ' hidden' : '');
      group.dataset.statusId = st.id;

      const label = document.createElement('div');
      label.className = 'status-label';
      label.innerHTML = `<span><span class="status-label-dot" style="background:${st.color}"></span>${esc(st.name)}</span>`;
      group.appendChild(label);

      const zone = document.createElement('div');
      zone.className = 'drop-zone';
      zone.dataset.catId    = cat.id;
      zone.dataset.statusId = st.id;

      // Cards for this cat+status
      const cards = boardData.cards.filter(c => c.category_id === cat.id && c.status_id === st.id);
      cards.sort((a, b) => a.position - b.position);
      cards.forEach(card => zone.appendChild(makeCardEl(card)));

      // Add card button
      const addBtn = document.createElement('button');
      addBtn.className = 'add-card-btn';
      addBtn.textContent = '+ Add card';
      addBtn.onclick = () => openAddCard(cat.id, st.id);
      zone.appendChild(addBtn);

      setupDropZone(zone, pid);
      group.appendChild(zone);
      col.appendChild(group);
    });

    boardEl.appendChild(col);
  });
}

/* ── Card element ────────────────────────────────────────────── */
function makeCardEl(card) {
  const el = document.createElement('div');
  el.className = 'k-card';
  el.draggable = true;
  el.dataset.cardId = card.id;

  el.innerHTML = `
    <div class="k-card-title">${esc(card.title)}</div>
    ${card.description ? `<div class="k-card-desc">${esc(card.description)}</div>` : ''}
    <div class="k-card-footer">
      <span class="k-card-priority ${card.priority}">${card.priority}</span>
      <div class="k-card-actions">
        <button class="k-card-btn" onclick="openEditCard(${card.id})" title="Edit">✎</button>
      </div>
    </div>
  `;

  // Drag events
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('cardId', card.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  return el;
}

/* ── Drag & Drop ─────────────────────────────────────────────── */
function setupDropZone(zone, pid) {
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const cardId    = parseInt(e.dataTransfer.getData('cardId'));
    const catId     = parseInt(zone.dataset.catId);
    const statusId  = parseInt(zone.dataset.statusId);
    if (!cardId) return;

    // Update locally
    const card = boardData.cards.find(c => c.id === cardId);
    if (!card) return;
    card.category_id = catId;
    card.status_id   = statusId;

    // Optimistic re-render
    renderBoard();

    try {
      await API.updateCard(pid, cardId, { category_id: catId, status_id: statusId });
    } catch (e) {
      toast('Failed to move card: ' + e.message, 'error');
      loadBoard(pid); // reload on fail
    }
  });
}

/* ── Toggles ─────────────────────────────────────────────────── */
function renderToggles() {
  const catToggle = document.getElementById('category-toggles');
  const stToggle  = document.getElementById('status-toggles');

  catToggle.innerHTML = '';
  boardData.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm ' + (hiddenCategories.has(cat.id) ? 'btn-ghost' : 'btn-outline');
    btn.style.borderColor = hiddenCategories.has(cat.id) ? '' : cat.color;
    btn.style.color       = hiddenCategories.has(cat.id) ? '' : cat.color;
    btn.textContent = cat.name;
    btn.onclick = () => {
      if (hiddenCategories.has(cat.id)) hiddenCategories.delete(cat.id);
      else hiddenCategories.add(cat.id);
      renderBoard(); renderToggles();
    };
    catToggle.appendChild(btn);
  });

  stToggle.innerHTML = '';
  boardData.statuses.forEach(st => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm ' + (hiddenStatuses.has(st.id) ? 'btn-ghost' : 'btn-outline');
    btn.style.borderColor = hiddenStatuses.has(st.id) ? '' : st.color;
    btn.style.color       = hiddenStatuses.has(st.id) ? '' : st.color;
    btn.textContent = st.name;
    btn.onclick = () => {
      if (hiddenStatuses.has(st.id)) hiddenStatuses.delete(st.id);
      else hiddenStatuses.add(st.id);
      renderBoard(); renderToggles();
    };
    stToggle.appendChild(btn);
  });
}

/* ── Add / Edit card ─────────────────────────────────────────── */
function openAddCard(catId, statusId) {
  document.getElementById('modal-card-title').textContent = 'New Card';
  document.getElementById('card-edit-id').value = '';
  document.getElementById('card-category-id').value = catId;
  document.getElementById('card-status-id').value   = statusId;
  document.getElementById('card-form-title').value  = '';
  document.getElementById('card-form-desc').value   = '';
  document.getElementById('card-form-priority').value = 'medium';
  document.getElementById('card-delete-btn').classList.add('hidden');

  populateCardSelects(catId, statusId);
  openModal('modal-card');
  setTimeout(() => document.getElementById('card-form-title').focus(), 50);
}

function openEditCard(cardId) {
  const card = boardData.cards.find(c => c.id === cardId);
  if (!card) return;
  document.getElementById('modal-card-title').textContent = 'Edit Card';
  document.getElementById('card-edit-id').value   = card.id;
  document.getElementById('card-form-title').value = card.title;
  document.getElementById('card-form-desc').value  = card.description || '';
  document.getElementById('card-form-priority').value = card.priority;
  document.getElementById('card-delete-btn').classList.remove('hidden');

  populateCardSelects(card.category_id, card.status_id);
  openModal('modal-card');
}

function populateCardSelects(catId, statusId) {
  const catSel = document.getElementById('card-form-category');
  const stSel  = document.getElementById('card-form-status');
  catSel.innerHTML = boardData.categories.map(c =>
    `<option value="${c.id}" ${c.id == catId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  stSel.innerHTML  = boardData.statuses.map(s =>
    `<option value="${s.id}" ${s.id == statusId ? 'selected' : ''}>${esc(s.name)}</option>`
  ).join('');
}

async function saveCard() {
  const pid   = window._currentProject?.id;
  const id    = document.getElementById('card-edit-id').value;
  const title = document.getElementById('card-form-title').value.trim();
  if (!title) { toast('Title is required.', 'error'); return; }

  const data = {
    title,
    description: document.getElementById('card-form-desc').value.trim() || null,
    category_id: parseInt(document.getElementById('card-form-category').value),
    status_id:   parseInt(document.getElementById('card-form-status').value),
    priority:    document.getElementById('card-form-priority').value,
  };

  try {
    if (id) {
      await API.updateCard(pid, id, data);
      const idx = boardData.cards.findIndex(c => c.id == id);
      if (idx > -1) boardData.cards[idx] = { ...boardData.cards[idx], ...data };
      toast('Card updated ✓');
    } else {
      const res = await API.createCard(pid, data);
      boardData.cards.push({ id: res.id, ...data, position: 0 });
      toast('Card created ✓');
    }
    closeModal('modal-card');
    renderBoard();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteCard() {
  const pid = window._currentProject?.id;
  const id  = document.getElementById('card-edit-id').value;
  if (!id || !confirm('Delete this card?')) return;
  try {
    await API.deleteCard(pid, id);
    boardData.cards = boardData.cards.filter(c => c.id != id);
    closeModal('modal-card');
    renderBoard();
    toast('Card deleted');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Add category ────────────────────────────────────────────── */
function openAddCategory() {
  document.getElementById('cat-form-name').value  = '';
  document.getElementById('cat-form-color').value = '#00ff88';
  openModal('modal-category');
  setTimeout(() => document.getElementById('cat-form-name').focus(), 50);
}

async function saveCategory() {
  const pid  = window._currentProject?.id;
  const name = document.getElementById('cat-form-name').value.trim();
  if (!name) { toast('Name required.', 'error'); return; }
  const color = document.getElementById('cat-form-color').value;
  try {
    const res = await API.createCategory(pid, { name, color });
    boardData.categories.push({ id: res.id, name, color, hidden: 0, position: boardData.categories.length });
    closeModal('modal-category');
    renderBoard(); renderToggles();
    toast('Category created ✓');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function confirmDeleteCategory(catId) {
  const cat = boardData.categories.find(c => c.id === catId);
  if (!confirm(`Delete category "${cat?.name}"? All cards in it will be deleted.`)) return;
  const pid = window._currentProject?.id;
  try {
    await API.deleteCategory(pid, catId);
    boardData.categories = boardData.categories.filter(c => c.id !== catId);
    boardData.cards      = boardData.cards.filter(c => c.category_id !== catId);
    renderBoard(); renderToggles();
    toast('Category deleted');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Add status ──────────────────────────────────────────────── */
function openAddStatus() {
  document.getElementById('status-form-name').value  = '';
  document.getElementById('status-form-color').value = '#555555';
  openModal('modal-status');
  setTimeout(() => document.getElementById('status-form-name').focus(), 50);
}

async function saveStatus() {
  const pid  = window._currentProject?.id;
  const name = document.getElementById('status-form-name').value.trim();
  if (!name) { toast('Name required.', 'error'); return; }
  const color = document.getElementById('status-form-color').value;
  try {
    const res = await API.createStatus(pid, { name, color });
    boardData.statuses.push({ id: res.id, name, color, hidden: 0, position: boardData.statuses.length });
    closeModal('modal-status');
    renderBoard(); renderToggles();
    toast('Status created ✓');
  } catch (e) {
    toast(e.message, 'error');
  }
}
