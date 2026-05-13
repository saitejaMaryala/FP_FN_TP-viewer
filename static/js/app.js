// ── Color palette for experiments ──
const EXP_COLORS = [
  '#388bfd', '#3fb950', '#d29922', '#bc8cff',
  '#39d3f3', '#f85149', '#ff9f1c', '#2ec4b6'
];

const CAT_META = {
  false_positives:  { icon: '⚠️', color: '#f85149', label: 'False Positives' },
  false_negatives:   { icon: '❌', color: '#d29922', label: 'False Negatives' },
};

// ── State ──
let state = {
  experiments: [],        // all available
  selected: new Set(),    // selected experiment names
  category: 'false_positives',
  page: 1,
  perPage: 10,
  totalPages: 1,
  total: 0,
  searchVideo: '',
  searchInstance: '',
  tripleRiderOnly: false,
  loading: false,
  expColorMap: {},
  currentResults: [],       // full results from API (instance groups)
  currentExperiments: [],
  // Modal position: { gIdx (group index in filtered list), fIdx (frame index), eIdx (col: -1=original, 0..N-1=exp) }
  modalPos: null,
};

// ── DOM refs ──
const expListEl     = document.getElementById('exp-list');
const catListEl     = document.getElementById('cat-list');
const resultsEl     = document.getElementById('results');
const statsBarEl    = document.getElementById('stats-bar');
const paginationEl  = document.getElementById('pagination');
const paginationTopEl = document.getElementById('pagination-top');
const legendRowEl   = document.getElementById('legend-row');
const totalCountEl  = document.getElementById('total-count');
const pageInfoEl    = document.getElementById('page-info');
const searchVideoEl = document.getElementById('search-video');
const searchInstEl  = document.getElementById('search-instance');
const perPageEl     = document.getElementById('per-page');
const applyBtn      = document.getElementById('apply-btn');
const selectAllBtn  = document.getElementById('select-all');
const clearAllBtn   = document.getElementById('clear-all');
const modalOverlay  = document.getElementById('modal-overlay');
const modalImg      = document.getElementById('modal-img');
const modalTitle    = document.getElementById('modal-title');
const modalClose    = document.getElementById('modal-close');
const trToggle      = document.getElementById('triple-rider-toggle');
const trToggleLabel = document.getElementById('triple-rider-toggle-label');

// ── Init ──
async function init() {
  await loadExperiments();
  renderCategories();

  // Wire up the triple rider toggle
  if (trToggle) {
    trToggle.addEventListener('change', () => {
      state.tripleRiderOnly = trToggle.checked;
      if (trToggleLabel) trToggleLabel.classList.toggle('active', trToggle.checked);
      // Re-render from cached results (no API call needed)
      renderResults(state.currentResults, state.currentExperiments);
    });
  }
}

async function loadExperiments() {
  const res = await fetch('/api/experiments');
  const data = await res.json();
  state.experiments = data.experiments || [];
  // default: select all
  state.experiments.forEach((e, i) => {
    state.selected.add(e);
    state.expColorMap[e] = EXP_COLORS[i % EXP_COLORS.length];
  });
  renderExperiments();
}

function renderExperiments() {
  expListEl.innerHTML = '';
  state.experiments.forEach(exp => {
    const color = state.expColorMap[exp];
    const isSelected = state.selected.has(exp);
    const item = document.createElement('label');
    item.className = 'exp-item' + (isSelected ? ' selected' : '');
    item.title = exp;
    item.innerHTML = `
      <span class="exp-color-dot" style="background:${color}"></span>
      <span class="exp-check"></span>
      <span class="exp-label">${formatExpName(exp)}</span>
    `;
    item.addEventListener('click', () => toggleExp(exp, item));
    expListEl.appendChild(item);
  });
  renderLegend();
}

function toggleExp(exp, item) {
  if (state.selected.has(exp)) {
    state.selected.delete(exp);
    item.classList.remove('selected');
  } else {
    state.selected.add(exp);
    item.classList.add('selected');
  }
  renderLegend();
}

function renderCategories() {
  catListEl.innerHTML = '';
  Object.entries(CAT_META).forEach(([key, meta]) => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (state.category === key ? ' active' : '');
    btn.innerHTML = `
      <span class="cat-dot" style="background:${meta.color}"></span>
      ${meta.label}
      <span class="cat-badge">${meta.icon}</span>
    `;
    btn.addEventListener('click', () => {
      state.category = key;
      state.page = 1;
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadImages();
    });
    catListEl.appendChild(btn);
  });
}

function renderLegend() {
  if (!legendRowEl) return;
  legendRowEl.innerHTML = '';
  state.selected.forEach(exp => {
    const color = state.expColorMap[exp];
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${formatExpName(exp)}`;
    legendRowEl.appendChild(item);
  });
  const missing = document.createElement('div');
  missing.className = 'legend-item missing-legend';
  missing.innerHTML = `<span>⊘</span> Not present in experiment`;
  legendRowEl.appendChild(missing);
}

// ── Load images from API ──
async function loadImages() {
  if (state.selected.size === 0) {
    showEmpty('No experiments selected', 'Select at least one experiment from the sidebar.');
    return;
  }
  showLoading();
  state.loading = true;

  const params = new URLSearchParams({
    experiments: [...state.selected].join(','),
    category: state.category,
    page: state.page,
    per_page: state.perPage,
    search_video: state.searchVideo,
    search_instance: state.searchInstance,
  });

  try {
    const res = await fetch(`/api/images?${params}`);
    const data = await res.json();
    if (data.error) { showError(data.error); return; }

    state.total = data.total;
    state.totalPages = data.total_pages;
    state.page = data.page;
    state.currentResults = data.results;
    state.currentExperiments = data.experiments;

    renderResults(data.results, data.experiments);
    renderPagination();
    updateStats(data);
  } catch (e) {
    showError('Failed to fetch data: ' + e.message);
  } finally {
    state.loading = false;
  }
}

// ── Get the filtered list of results based on toggle ──
function getFilteredResults(baseResults = state.currentResults) {
  if (state.tripleRiderOnly) {
    return baseResults
      .filter(inst => inst.is_triple_rider)
      .map(inst => ({
        ...inst,
        frames: inst.frames.filter(f => f.is_3r)
      }));
  }
  return baseResults;
}

function renderResults(results, experiments) {
  const filtered = getFilteredResults(results);

  if (!filtered || filtered.length === 0) {
    const msg = state.tripleRiderOnly
      ? 'No triple rider instances found on this page. Try navigating to other pages or disabling the filter.'
      : 'Try selecting different experiments, category, or clearing search filters.';
    showEmpty('No instances found', msg);
    return;
  }

  resultsEl.innerHTML = '';
  filtered.forEach((inst, gIdx) => {
    resultsEl.appendChild(buildInstanceGroup(inst, experiments, gIdx));
  });

  // Lazy load images
  setupLazyLoad();
}

// ── Build one instance group card (video_id + instance_id) ──
function buildInstanceGroup(inst, experiments, gIdx) {
  const group = document.createElement('div');
  group.className = 'instance-group' + (inst.is_triple_rider ? ' triple-rider' : '');
  group.id = `group-${inst.group_key}`;

  // ── Group header ──
  const trBadge = inst.is_triple_rider
    ? `<span class="triple-rider-badge">🚨 Triple Rider</span>`
    : '';

  const frameCount = inst.frames.length;
  group.innerHTML = `
    <div class="group-header">
      <div class="group-header-info">
        <span class="group-video-label">Video</span>
        <span class="group-video-name" title="${inst.video_id}">${inst.video_id}</span>
        <div class="group-instance-row">
          <span class="group-instance-label">Instance ID:</span>
          <span class="group-instance-id">${inst.instance_id}</span>
          <span class="group-frame-count">${frameCount} frame${frameCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${trBadge}
    </div>
  `;

  // ── Frame rows ──
  inst.frames.forEach((frame, fIdx) => {
    group.appendChild(buildFrameRow(frame, experiments, gIdx, fIdx, inst));
  });

  return group;
}

// ── Build one frame row within a group ──
function buildFrameRow(frame, experiments, gIdx, fIdx, inst) {
  const row = document.createElement('div');
  row.className = 'frame-row';

  const frameBadge = frame.is_3r
    ? `<span class="frame-3r-badge">🚨 3R</span>`
    : '';

  row.innerHTML = `
    <div class="frame-row-header">
      <span class="frame-number-label">Frame: ${frame.frame_num}</span>
      ${frameBadge}
    </div>
    <div class="images-grid" id="grid-${inst.group_key}-${frame.frame_num}"></div>
  `;

  const grid = row.querySelector(`#grid-${inst.group_key}-${frame.frame_num}`);

  // ── Column 0: Original Frame ──
  const origCol = document.createElement('div');
  origCol.className = 'exp-image-col orig-image-col';
  if (frame.original_image_url) {
    origCol.innerHTML = `
      <div class="exp-name-label orig-label">🖼 Original Frame</div>
      <div class="image-thumb-wrap" data-url="${frame.original_image_url}" data-title="Original — ${frame.instance_key}">
        <img class="lazy" data-src="${frame.original_image_url}" alt="Original ${frame.instance_key}" />
      </div>
    `;
    origCol.querySelector('.image-thumb-wrap').addEventListener('click', () => {
      openModal(frame.original_image_url, `Original · ${inst.video_id} · Frame ${frame.frame_num}`, gIdx, fIdx, 0);
    });
  } else {
    origCol.innerHTML = `
      <div class="exp-name-label orig-label" style="opacity:0.5">🖼 Original Frame</div>
      <div class="image-thumb-wrap missing">
        <span class="missing-icon">⊘</span>
        <span class="missing-text">No original</span>
      </div>
    `;
  }
  grid.appendChild(origCol);

  // ── Column 1: Mask Frame ──
  const maskCol = document.createElement('div');
  maskCol.className = 'exp-image-col mask-image-col';
  if (frame.mask_image_url) {
    maskCol.innerHTML = `
      <div class="exp-name-label mask-label">🎭 Mask Frame</div>
      <div class="image-thumb-wrap" data-url="${frame.mask_image_url}" data-title="Mask — ${frame.instance_key}">
        <img class="lazy" data-src="${frame.mask_image_url}" alt="Mask ${frame.instance_key}" />
      </div>
    `;
    maskCol.querySelector('.image-thumb-wrap').addEventListener('click', () => {
      openModal(frame.mask_image_url, `Mask · ${inst.video_id} · Frame ${frame.frame_num}`, gIdx, fIdx, 1);
    });
  } else {
    maskCol.innerHTML = `
      <div class="exp-name-label mask-label" style="opacity:0.5">🎭 Mask Frame</div>
      <div class="image-thumb-wrap missing">
        <span class="missing-icon">⊘</span>
        <span class="missing-text">No mask</span>
      </div>
    `;
  }
  grid.appendChild(maskCol);

  // ── Columns 2…N+1: Experiment images ──
  experiments.forEach((exp, eIdx) => {
    const col = document.createElement('div');
    col.className = 'exp-image-col';
    const color = state.expColorMap[exp];
    const imgData = frame.images[exp];

    if (imgData) {
      const is3r = imgData.is_3r;
      const highlightClass = is3r ? ' triple-rider-highlight' : '';
      const badge3r = is3r ? `<span class="thumb-3r-badge">3R</span>` : '';
      col.innerHTML = `
        <div class="exp-name-label" style="background:${color}22;color:${color}">${formatExpName(exp)}</div>
        <div class="image-thumb-wrap${highlightClass}" data-url="${imgData.url}" data-title="${exp} — ${frame.instance_key}">
          ${badge3r}
          <img class="lazy" data-src="${imgData.url}" alt="${frame.instance_key}" />
        </div>
      `;
      // eIdx+2 because column 0 is original, 1 is mask
      col.querySelector('.image-thumb-wrap').addEventListener('click', () => {
        openModal(imgData.url, `${formatExpName(exp)} · ${inst.video_id} · Frame ${frame.frame_num}`, gIdx, fIdx, eIdx + 2);
      });
    } else {
      col.innerHTML = `
        <div class="exp-name-label" style="background:#f8514920;color:#f85149;opacity:0.6">${formatExpName(exp)}</div>
        <div class="image-thumb-wrap missing">
          <span class="missing-icon">⊘</span>
          <span class="missing-text">Not present</span>
        </div>
      `;
    }
    grid.appendChild(col);
  });

  return row;
}

// ── Lazy loading ──
let observer = null;
function setupLazyLoad() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.onload = () => img.classList.add('loaded');
        img.onerror = () => { img.src = ''; img.classList.add('loaded'); };
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });

  document.querySelectorAll('img.lazy').forEach(img => observer.observe(img));
}

// ── Pagination ──
function renderPagination() {
  paginationEl.innerHTML = '';
  if (paginationTopEl) paginationTopEl.innerHTML = '';
  const total = state.totalPages;
  const cur = state.page;
  if (total <= 1) return;

  const addBtn = (label, page, disabled = false, active = false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => { if (!disabled) goToPage(page); });
    paginationEl.appendChild(btn);

    if (paginationTopEl) {
      const btnTop = btn.cloneNode(true);
      btnTop.addEventListener('click', () => { if (!disabled) goToPage(page); });
      paginationTopEl.appendChild(btnTop);
    }
  };
  const addEllipsis = () => {
    const s = document.createElement('span');
    s.className = 'page-ellipsis';
    s.textContent = '…';
    paginationEl.appendChild(s);

    if (paginationTopEl) {
      const sTop = s.cloneNode(true);
      paginationTopEl.appendChild(sTop);
    }
  };

  addBtn('←', cur - 1, cur === 1);

  const pages = new Set([1, total, cur, cur-1, cur+1, cur-2, cur+2].filter(p => p >= 1 && p <= total));
  let sorted = [...pages].sort((a,b) => a-b);
  let prev = null;
  sorted.forEach(p => {
    if (prev !== null && p - prev > 1) addEllipsis();
    addBtn(p, p, false, p === cur);
    prev = p;
  });

  addBtn('→', cur + 1, cur === total);
}

function goToPage(page) {
  state.page = page;
  loadImages();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Stats ──
function updateStats(data) {
  if (totalCountEl) totalCountEl.textContent = data.total.toLocaleString();
  if (pageInfoEl) pageInfoEl.textContent = `Page ${data.page} / ${data.total_pages}`;
  const catMeta = CAT_META[data.category] || {};
  document.title = `${catMeta.label || data.category} · TR Visualizer`;
}

// ── State helpers ──
function showLoading() {
  resultsEl.innerHTML = `<div class="state-box"><div class="spinner"></div><p>Loading instances…</p></div>`;
  paginationEl.innerHTML = '';
  if (paginationTopEl) paginationTopEl.innerHTML = '';
}

function showEmpty(title, msg) {
  resultsEl.innerHTML = `<div class="state-box">
    <div class="state-icon">🔎</div>
    <h3>${title}</h3>
    <p>${msg}</p>
  </div>`;
  paginationEl.innerHTML = '';
  if (paginationTopEl) paginationTopEl.innerHTML = '';
  if (totalCountEl) totalCountEl.textContent = '0';
}

function showError(msg) {
  resultsEl.innerHTML = `<div class="state-box">
    <div class="state-icon">⚠️</div>
    <h3>Error</h3>
    <p>${msg}</p>
  </div>`;
}

// ── Image prefetch cache ──
const imgCache = new Map(); // url -> HTMLImageElement

function prefetchUrl(url) {
  if (!url || imgCache.has(url)) return;
  const img = new Image();
  img.src = url;
  imgCache.set(url, img);
}

// ── Modal navigation helpers ──
// modalPos: { gIdx, fIdx, eColIdx }   (eColIdx: 0=original, 1..N=experiments)
// Up/Down: navigate between frames within the same instance group (or across groups)
// Left/Right: navigate between experiment columns

function getFilteredResultsForModal() {
  return getFilteredResults();
}

function urlForPos(filtered, gIdx, fIdx, eColIdx) {
  if (gIdx < 0 || gIdx >= filtered.length) return null;
  const inst = filtered[gIdx];
  if (fIdx < 0 || fIdx >= inst.frames.length) return null;
  const frame = inst.frames[fIdx];
  const totalCols = state.currentExperiments.length + 2; // 0=orig, 1=mask, 2..N+1=exp
  if (eColIdx < 0 || eColIdx >= totalCols) return null;

  if (eColIdx === 0) {
    return frame.original_image_url || null;
  } else if (eColIdx === 1) {
    return frame.mask_image_url || null;
  } else {
    const exp = state.currentExperiments[eColIdx - 2];
    const imgData = frame.images[exp];
    return imgData ? imgData.url : null;
  }
}

function titleForPos(filtered, gIdx, fIdx, eColIdx) {
  const inst = filtered[gIdx];
  const frame = inst.frames[fIdx];
  if (eColIdx === 0) {
    return `Original · ${inst.video_id} · Frame ${frame.frame_num}`;
  } else if (eColIdx === 1) {
    return `Mask · ${inst.video_id} · Frame ${frame.frame_num}`;
  } else {
    const exp = state.currentExperiments[eColIdx - 2];
    return `${formatExpName(exp)} · ${inst.video_id} · Frame ${frame.frame_num}`;
  }
}

function prefetchNeighbors(gIdx, fIdx, eColIdx) {
  const filtered = getFilteredResultsForModal();
  const totalCols = state.currentExperiments.length + 2;
  const candidates = [];

  // Up: previous frame
  if (fIdx > 0) candidates.push([gIdx, fIdx - 1, eColIdx]);
  else if (gIdx > 0) {
    const prevInst = filtered[gIdx - 1];
    candidates.push([gIdx - 1, prevInst.frames.length - 1, eColIdx]);
  }
  // Down: next frame
  const inst = filtered[gIdx];
  if (fIdx < inst.frames.length - 1) candidates.push([gIdx, fIdx + 1, eColIdx]);
  else if (gIdx < filtered.length - 1) candidates.push([gIdx + 1, 0, eColIdx]);
  // Left: previous column
  if (eColIdx > 0) candidates.push([gIdx, fIdx, eColIdx - 1]);
  // Right: next column
  if (eColIdx < totalCols - 1) candidates.push([gIdx, fIdx, eColIdx + 1]);

  candidates.forEach(([g, f, e]) => {
    const url = urlForPos(filtered, g, f, e);
    if (url) prefetchUrl(url);
  });
}

// ── Modal ──
function openModal(url, title, gIdx = null, fIdx = null, eColIdx = null) {
  if (imgCache.has(url)) {
    modalImg.src = imgCache.get(url).src;
  } else {
    modalImg.src = url;
    prefetchUrl(url);
  }
  modalTitle.textContent = title;
  modalOverlay.classList.add('open');
  state.modalPos = (gIdx !== null && fIdx !== null && eColIdx !== null)
    ? { gIdx, fIdx, eColIdx }
    : null;

  if (state.modalPos !== null) {
    prefetchNeighbors(gIdx, fIdx, eColIdx);
    updateModalNavButtons(gIdx, fIdx, eColIdx);
  } else {
    updateModalNavButtons(null, null, null);
  }
}

function closeModal() {
  modalOverlay.classList.remove('open');
  modalImg.src = '';
  state.modalPos = null;
  updateModalNavButtons(null, null, null);
}
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function findNextImage(direction, gIdx, fIdx, eColIdx) {
  const filtered = getFilteredResultsForModal();
  const totalCols = state.currentExperiments.length + 2;
  let newGIdx = gIdx, newFIdx = fIdx, newEColIdx = eColIdx;

  if (direction === 'ArrowLeft') {
    newEColIdx--;
    if (newEColIdx < 0) return null;
  } else if (direction === 'ArrowRight') {
    newEColIdx++;
    if (newEColIdx >= totalCols) return null;
  } else if (direction === 'ArrowUp') {
    // Previous frame, or last frame of previous instance
    newFIdx--;
    if (newFIdx < 0) {
      newGIdx--;
      if (newGIdx < 0) return null;
      newFIdx = filtered[newGIdx].frames.length - 1;
    }
  } else if (direction === 'ArrowDown') {
    // Next frame, or first frame of next instance
    const curInst = filtered[newGIdx];
    newFIdx++;
    if (newFIdx >= curInst.frames.length) {
      newGIdx++;
      if (newGIdx >= filtered.length) return null;
      newFIdx = 0;
    }
  }

  // Find actual URL (skip missing)
  let tries = 0;
  while (tries < 200) {
    const url = urlForPos(filtered, newGIdx, newFIdx, newEColIdx);
    if (url) {
      return {
        url,
        title: titleForPos(filtered, newGIdx, newFIdx, newEColIdx),
        gIdx: newGIdx, fIdx: newFIdx, eColIdx: newEColIdx
      };
    }
    // If missing, keep advancing in same direction
    if (direction === 'ArrowLeft') { newEColIdx--; if (newEColIdx < 0) return null; }
    else if (direction === 'ArrowRight') { newEColIdx++; if (newEColIdx >= totalCols) return null; }
    else if (direction === 'ArrowUp') {
      newFIdx--;
      if (newFIdx < 0) { newGIdx--; if (newGIdx < 0) return null; newFIdx = filtered[newGIdx].frames.length - 1; }
    }
    else if (direction === 'ArrowDown') {
      newFIdx++;
      if (newFIdx >= (filtered[newGIdx]?.frames.length ?? 0)) { newGIdx++; if (newGIdx >= filtered.length) return null; newFIdx = 0; }
    }
    tries++;
  }
  return null;
}

function navigateModal(direction) {
  if (!modalOverlay.classList.contains('open') || state.modalPos === null) return;
  const { gIdx, fIdx, eColIdx } = state.modalPos;
  const next = findNextImage(direction, gIdx, fIdx, eColIdx);
  if (next) {
    openModal(next.url, next.title, next.gIdx, next.fIdx, next.eColIdx);
  }
}

function updateModalNavButtons(gIdx, fIdx, eColIdx) {
  const upBtn    = document.getElementById('modal-nav-up');
  const downBtn  = document.getElementById('modal-nav-down');
  const leftBtn  = document.getElementById('modal-nav-left');
  const rightBtn = document.getElementById('modal-nav-right');
  if (!upBtn) return;

  if (gIdx === null || fIdx === null || eColIdx === null) {
    upBtn.disabled = true; downBtn.disabled = true;
    leftBtn.disabled = true; rightBtn.disabled = true;
    return;
  }

  upBtn.disabled    = !findNextImage('ArrowUp',    gIdx, fIdx, eColIdx);
  downBtn.disabled  = !findNextImage('ArrowDown',  gIdx, fIdx, eColIdx);
  leftBtn.disabled  = !findNextImage('ArrowLeft',  gIdx, fIdx, eColIdx);
  rightBtn.disabled = !findNextImage('ArrowRight', gIdx, fIdx, eColIdx);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  if (modalOverlay.classList.contains('open') && state.modalPos !== null) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      navigateModal(e.key);
    }
  }
});

// Modal on-screen navigation buttons
const dirs = {
  'modal-nav-up':    'ArrowUp',
  'modal-nav-down':  'ArrowDown',
  'modal-nav-left':  'ArrowLeft',
  'modal-nav-right': 'ArrowRight'
};
Object.entries(dirs).forEach(([id, dir]) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', e => { e.stopPropagation(); navigateModal(dir); });
});

// ── Event listeners ──
applyBtn.addEventListener('click', () => {
  state.page = 1;
  state.searchVideo = searchVideoEl.value.trim();
  state.searchInstance = searchInstEl.value.trim();
  state.perPage = parseInt(perPageEl.value) || 10;
  loadImages();
});

selectAllBtn.addEventListener('click', () => {
  state.experiments.forEach(e => state.selected.add(e));
  renderExperiments();
});

clearAllBtn.addEventListener('click', () => {
  state.selected.clear();
  renderExperiments();
});

// Enter key triggers apply
[searchVideoEl, searchInstEl].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') applyBtn.click(); });
});

// ── Helpers ──
function formatExpName(exp) {
  return exp
    .replace(/^results_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Bootstrap ──
init().then(() => loadImages());
