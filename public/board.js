/* ── Board state ─────────────────────────────────────────────── */
let boardData = { categories: [], statuses: [], cards: [] };
let hiddenCategories = new Set();
let hiddenStatuses   = new Set();
let draggedCardId    = null;

const byPosition = (a, b) => (a.position - b.position) || (a.id - b.id);

/* ── Load board ──────────────────────────────────────────────── */
async function loadBoard(projectId) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '<div class="loader"><span class="spinner"></span> Loading board...</div>';
  try {
    boardData = await API.getBoard(projectId);
    renderBoard();
    renderToggles();
  } catch (e) {
    boardEl.innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><p>${esc(e.message)}</p></div>`;
  }
}

/* ── Render board ────────────────────────────────────────────── */
function renderBoard() {
  const boardEl  = document.getElementById('board');
  const canMove  = can('card_mover');
  const canEdit  = can('editor');
  boardEl.innerHTML = '';
  boardEl.classList.toggle('board-readonly', !canMove);

  if (!boardData.categories.length || !boardData.statuses.length) {
    boardEl.innerHTML = `
      <div class="empty" style="width:100%">
        <div class="empty-icon">🗂</div>
        <p>${canEdit
          ? 'This board needs at least one category and one status.<br>Use the buttons above to add them.'
          : 'This board is empty.'}</p>
      </div>`;
    return;
  }

  boardData.categories.forEach(cat => {
    const col = document.createElement('div');
    col.className = 'category-col' + (hiddenCategories.has(cat.id) ? ' hidden' : '');
    col.dataset.catId = cat.id;

    col.innerHTML = `
      <div class="category-header">
        <div class="category-header-left">
          <span class="category-dot" style="background:${safeColor(cat.color)}"></span>
          <span class="category-name">${esc(cat.name)}</span>
        </div>
        ${canEdit ? `
        <div class="category-actions">
          <button class="k-card-btn" title="Edit categories & statuses" onclick="openBoardSettings()">✎</button>
        </div>` : ''}
      </div>
    `;

    // One group per status
    boardData.statuses.forEach(st => {
      const group = document.createElement('div');
      group.className = 'status-group' + (hiddenStatuses.has(st.id) ? ' hidden' : '');
      group.dataset.statusId = st.id;

      const label = document.createElement('div');
      label.className = 'status-label';
      label.innerHTML = `<span><span class="status-label-dot" style="background:${safeColor(st.color)}"></span>${esc(st.name)}</span>`;
      group.appendChild(label);

      const zone = document.createElement('div');
      zone.className = 'drop-zone';
      zone.dataset.catId    = cat.id;
      zone.dataset.statusId = st.id;

      boardData.cards
        .filter(c => c.category_id === cat.id && c.status_id === st.id)
        .sort(byPosition)
        .forEach(card => zone.appendChild(makeCardEl(card, canMove, canEdit)));

      if (canEdit) {
        const addBtn = document.createElement('button');
        addBtn.className = 'add-card-btn';
        addBtn.textContent = '+ Add card';
        addBtn.onclick = () => openAddCard(cat.id, st.id);
        zone.appendChild(addBtn);
      }

      if (canMove) setupDropZone(zone);
      group.appendChild(zone);
      col.appendChild(group);
    });

    boardEl.appendChild(col);
  });
}

/* ── Card element ────────────────────────────────────────────── */
function makeCardEl(card, canMove, canEdit) {
  const el = document.createElement('div');
  el.className = 'k-card' + (canMove ? '' : ' k-card-static');
  el.draggable = canMove;
  el.dataset.cardId = card.id;

  el.innerHTML = `
    <div class="k-card-title">${esc(card.title)}</div>
    ${card.description ? `<div class="k-card-desc">${esc(card.description)}</div>` : ''}
    <div class="k-card-footer">
      <span class="k-card-priority ${esc(card.priority)}">${esc(card.priority)}</span>
      <div class="k-card-actions">
        <button class="k-card-btn" title="${canEdit ? 'Edit' : 'View'}">${canEdit ? '✎' : '👁'}</button>
      </div>
    </div>
  `;

  // Click opens the card (edit form for editors, read-only view otherwise).
  el.addEventListener('click', () => openCard(card.id));

  if (canMove) {
    el.addEventListener('dragstart', e => {
      draggedCardId = card.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(card.id));
      // Defer so the drag image is captured before the card fades.
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      draggedCardId = null;
      el.classList.remove('dragging');
      removeDropPlaceholder();
    });
  }

  return el;
}

/* ── Drag & Drop (move between lanes + reorder) ──────────────── */
let dropPlaceholder = null;

function removeDropPlaceholder() {
  dropPlaceholder?.remove();
  dropPlaceholder = null;
}

/** Index among the lane's other cards where the dragged card would land. */
function getDropIndex(zone, clientY) {
  const cards = [...zone.querySelectorAll('.k-card:not(.dragging)')];
  const i = cards.findIndex(c => {
    const box = c.getBoundingClientRect();
    return clientY < box.top + box.height / 2;
  });
  return { index: i === -1 ? cards.length : i, cards };
}

function setupDropZone(zone) {
  zone.addEventListener('dragover', e => {
    if (draggedCardId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');

    const { index, cards } = getDropIndex(zone, e.clientY);
    if (!dropPlaceholder) {
      dropPlaceholder = document.createElement('div');
      dropPlaceholder.className = 'drop-placeholder';
    }
    const before = cards[index] || zone.querySelector('.add-card-btn');
    if (before) zone.insertBefore(dropPlaceholder, before);
    else zone.appendChild(dropPlaceholder);
  });

  zone.addEventListener('dragleave', e => {
    if (zone.contains(e.relatedTarget)) return;
    zone.classList.remove('drag-over');
    if (dropPlaceholder?.parentNode === zone) removeDropPlaceholder();
  });

  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const cardId = draggedCardId;
    draggedCardId = null; // re-render below detaches the source, so dragend may never fire
    const { index } = getDropIndex(zone, e.clientY);
    removeDropPlaceholder();
    if (cardId === null) return;

    const catId    = parseInt(zone.dataset.catId);
    const statusId = parseInt(zone.dataset.statusId);
    const card     = boardData.cards.find(c => c.id === cardId);
    if (!card) return;

    // Optimistic local reorder, mirroring what the server does.
    const lane = boardData.cards
      .filter(c => c.category_id === catId && c.status_id === statusId && c.id !== cardId)
      .sort(byPosition);
    lane.splice(index, 0, card);
    card.category_id = catId;
    card.status_id   = statusId;
    lane.forEach((c, i) => { c.position = i; });
    renderBoard();

    const pid = window._currentProject?.id;
    try {
      await API.moveCard(pid, cardId, { category_id: catId, status_id: statusId, index });
    } catch (err) {
      toast('Failed to move card: ' + err.message, 'error');
      loadBoard(pid); // resync on failure
    }
  });
}

/* ── Toggles (local show/hide, per viewer) ───────────────────── */
function renderToggles() {
  renderToggleGroup('category-toggles', boardData.categories, hiddenCategories);
  renderToggleGroup('status-toggles',   boardData.statuses,   hiddenStatuses);
}

function renderToggleGroup(containerId, items, hiddenSet) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach(item => {
    const hidden = hiddenSet.has(item.id);
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm ' + (hidden ? 'btn-ghost' : 'btn-outline');
    btn.style.borderColor = hidden ? '' : safeColor(item.color);
    btn.style.color       = hidden ? '' : safeColor(item.color);
    btn.textContent = item.name;
    btn.title = hidden ? 'Show' : 'Hide';
    btn.onclick = () => {
      if (hidden) hiddenSet.delete(item.id);
      else hiddenSet.add(item.id);
      renderBoard(); renderToggles();
    };
    container.appendChild(btn);
  });
}

/* ── Add / Edit / View card ──────────────────────────────────── */
function setCardFormReadOnly(readOnly) {
  ['card-form-title', 'card-form-desc', 'card-form-category', 'card-form-status', 'card-form-priority']
    .forEach(id => { document.getElementById(id).disabled = readOnly; });
  document.getElementById('card-save-btn').classList.toggle('hidden', readOnly);
  document.getElementById('card-cancel-btn').textContent = readOnly ? 'Close' : 'Cancel';
}

function openAddCard(catId, statusId) {
  document.getElementById('modal-card-title').textContent = 'New Card';
  document.getElementById('card-edit-id').value = '';
  document.getElementById('card-category-id').value = catId;
  document.getElementById('card-status-id').value   = statusId;
  document.getElementById('card-form-title').value  = '';
  document.getElementById('card-form-desc').value   = '';
  document.getElementById('card-form-priority').value = 'medium';
  document.getElementById('card-delete-btn').classList.add('hidden');
  setCardFormReadOnly(false);

  populateCardSelects(catId, statusId);
  openModal('modal-card');
  setTimeout(() => document.getElementById('card-form-title').focus(), 50);
}

function openCard(cardId) {
  const card = boardData.cards.find(c => c.id === cardId);
  if (!card) return;
  const editable = can('editor');
  document.getElementById('modal-card-title').textContent = editable ? 'Edit Card' : 'Card';
  document.getElementById('card-edit-id').value    = card.id;
  document.getElementById('card-form-title').value = card.title;
  document.getElementById('card-form-desc').value  = card.description || '';
  document.getElementById('card-form-priority').value = card.priority;
  document.getElementById('card-delete-btn').classList.toggle('hidden', !editable);
  setCardFormReadOnly(!editable);

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
  const id    = parseInt(document.getElementById('card-edit-id').value) || null;
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
      const res = await API.updateCard(pid, id, data);
      const card = boardData.cards.find(c => c.id === id);
      if (card) {
        Object.assign(card, data);
        if (res.position !== undefined) card.position = res.position;
      }
      toast('Card updated ✓');
    } else {
      const res = await API.createCard(pid, data);
      boardData.cards.push({ id: res.id, ...data, position: res.position });
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
  const id  = parseInt(document.getElementById('card-edit-id').value);
  if (!id || !confirm('Delete this card?')) return;
  try {
    await API.deleteCard(pid, id);
    boardData.cards = boardData.cards.filter(c => c.id !== id);
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
    boardData.categories.push({ id: res.id, name, color, hidden: 0, position: res.position });
    closeModal('modal-category');
    renderBoard(); renderToggles();
    toast('Category created ✓');
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
    boardData.statuses.push({ id: res.id, name, color, hidden: 0, position: res.position });
    closeModal('modal-status');
    renderBoard(); renderToggles();
    toast('Status created ✓');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Board settings: rename / recolor / reorder / delete lanes ── */
const LANE_KINDS = {
  categories: {
    containerId: 'manage-categories', label: 'category', plural: 'categories', field: 'category_id',
    hiddenSet: () => hiddenCategories,
    update: API.updateCategory, remove: API.deleteCategory, reorder: API.reorderCategories
  },
  statuses: {
    containerId: 'manage-statuses', label: 'status', plural: 'statuses', field: 'status_id',
    hiddenSet: () => hiddenStatuses,
    update: API.updateStatus, remove: API.deleteStatus, reorder: API.reorderStatuses
  }
};

function openBoardSettings() {
  if (!can('editor')) return;
  renderLaneManager('categories');
  renderLaneManager('statuses');
  openModal('modal-board');
}

/** <input type="color"> only accepts #rrggbb. */
function toHex6(color) {
  const c = safeColor(color);
  return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c;
}

function refreshBoardViews(kind) {
  if (kind) renderLaneManager(kind);
  renderBoard();
  renderToggles();
}

function renderLaneManager(kind) {
  const cfg   = LANE_KINDS[kind];
  const list  = document.getElementById(cfg.containerId);
  const items = boardData[kind];
  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = `<p class="text-sm text-muted">No ${cfg.plural} yet.</p>`;
    return;
  }

  items.forEach((item, i) => {
    const count = boardData.cards.filter(c => c[cfg.field] === item.id).length;
    const row = document.createElement('div');
    row.className = 'lane-row';
    row.innerHTML = `
      <input type="color" class="lane-color" value="${toHex6(item.color)}" title="Color" aria-label="Color of ${esc(item.name)}">
      <input type="text" class="input lane-name" value="${esc(item.name)}" maxlength="80" aria-label="Name of ${esc(cfg.label)}">
      <span class="lane-count" title="${count} card${count !== 1 ? 's' : ''}">${count}</span>
      <button type="button" class="k-card-btn" data-act="up"   title="Move earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="k-card-btn" data-act="down" title="Move later"   ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="k-card-btn lane-delete" data-act="delete" title="Delete ${esc(cfg.label)}">🗑</button>
    `;

    const nameInput = row.querySelector('.lane-name');
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') nameInput.blur();
      if (e.key === 'Escape') nameInput.value = item.name; // cancel, then the modal closes
    });
    nameInput.addEventListener('change', () => renameLane(kind, item, nameInput));

    const colorInput = row.querySelector('.lane-color');
    colorInput.addEventListener('change', () => recolorLane(kind, item, colorInput));

    row.querySelector('[data-act="up"]').onclick     = () => moveLane(kind, item.id, -1);
    row.querySelector('[data-act="down"]').onclick   = () => moveLane(kind, item.id, +1);
    row.querySelector('[data-act="delete"]').onclick = () => deleteLane(kind, item);
    list.appendChild(row);
  });
}

async function renameLane(kind, item, input) {
  const name = input.value.trim();
  if (!name) {
    input.value = item.name;
    toast('Name cannot be empty.', 'error');
    return;
  }
  if (name === item.name) { input.value = name; return; }
  try {
    await LANE_KINDS[kind].update(window._currentProject.id, item.id, { name });
    item.name = name;
    input.value = name;
    refreshBoardViews(); // the manager row already shows the new name
  } catch (e) {
    input.value = item.name;
    toast(e.message, 'error');
  }
}

async function recolorLane(kind, item, input) {
  const color = input.value;
  try {
    await LANE_KINDS[kind].update(window._currentProject.id, item.id, { color });
    item.color = color;
    refreshBoardViews();
  } catch (e) {
    input.value = toHex6(item.color);
    toast(e.message, 'error');
  }
}

// Reorders are sent one after the other so fast clicks can't arrive out of order.
let laneSaves = Promise.resolve();
function enqueueLaneSave(task) {
  const run = laneSaves.then(task);
  laneSaves = run.catch(() => {});
  return run;
}

async function moveLane(kind, id, delta) {
  const cfg   = LANE_KINDS[kind];
  const items = boardData[kind];
  const from  = items.findIndex(x => x.id === id);
  const to    = from + delta;
  if (from === -1 || to < 0 || to >= items.length) return;

  [items[from], items[to]] = [items[to], items[from]];
  items.forEach((x, i) => { x.position = i; });
  refreshBoardViews(kind);

  // Keep keyboard focus on the row that moved.
  const row = document.getElementById(cfg.containerId).children[to];
  const btn = row?.querySelector(`[data-act="${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`)
           || row?.querySelector('[data-act]:not(:disabled)');
  btn?.focus();

  const pid = window._currentProject.id;
  const ids = items.map(x => x.id);
  try {
    await enqueueLaneSave(() => cfg.reorder(pid, ids));
  } catch (e) {
    toast(e.message, 'error');
    await loadBoard(pid);
    renderLaneManager(kind);
  }
}

async function deleteLane(kind, item) {
  const cfg   = LANE_KINDS[kind];
  const count = boardData.cards.filter(c => c[cfg.field] === item.id).length;
  const what  = `${cfg.label} "${item.name}"`;
  const msg   = count
    ? `Delete ${what} and the ${count} card${count !== 1 ? 's' : ''} in it? This cannot be undone.`
    : `Delete ${what}?`;
  if (!confirm(msg)) return;

  try {
    await cfg.remove(window._currentProject.id, item.id);
    boardData[kind] = boardData[kind].filter(x => x.id !== item.id);
    boardData.cards = boardData.cards.filter(c => c[cfg.field] !== item.id);
    cfg.hiddenSet().delete(item.id);
    refreshBoardViews(kind);
    toast(`${cfg.label[0].toUpperCase()}${cfg.label.slice(1)} deleted`);
  } catch (e) {
    toast(e.message, 'error');
  }
}
