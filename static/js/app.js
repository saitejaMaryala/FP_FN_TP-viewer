const CAT_META = {
  fn_classified: { icon: '❌', color: '#d29922', label: 'FN Classified' },
  fn_unmatched: { icon: '❓', color: '#8b949e', label: 'FN Unmatched' },
  fp_classified: { icon: '⚠️', color: '#f85149', label: 'FP Classified' },
  fp_unmatched: { icon: '👻', color: '#ff7b72', label: 'FP Unmatched' },
  tp_annots: { icon: '✅', color: '#2ea043', label: 'TP Annotations' },
};

// ── State ──
let state = {
  category: 'fp_classified',
  page: 1,
  perPage: 10,
  totalPages: 1,
  total: 0,
  search: '',
  loading: false,
  show3rOnly: false,
  currentResults: [],   // flat list of image objects from API
  // Modal position: { rowIdx, colIdx }  (0=original, 1=mask, 2=prediction)
  modalPos: null,
};

// ── DOM refs ──
const catListEl       = document.getElementById('cat-list');
const resultsEl       = document.getElementById('results');
const paginationEl    = document.getElementById('pagination');
const paginationTopEl = document.getElementById('pagination-top');
const totalCountEl    = document.getElementById('total-count');
const pageInfoEl      = document.getElementById('page-info');
const searchEl        = document.getElementById('search-filename');
const perPageEl       = document.getElementById('per-page');
const applyBtn        = document.getElementById('apply-btn');
const modalOverlay    = document.getElementById('modal-overlay');
const modalImg        = document.getElementById('modal-img');
const modalTitle      = document.getElementById('modal-title');
const modalClose      = document.getElementById('modal-close');
const tripleRiderToggle = document.getElementById('triple-rider-toggle');
const tripleRiderToggleLabel = document.getElementById('triple-rider-toggle-label');

// ── Init ──
async function init() {
  try {
    const res = await fetch('/api/categories');
    const data = await res.json();
    if (data.categories && data.categories.length > 0) {
      data.categories.forEach(cat => {
        if (!CAT_META[cat]) {
          CAT_META[cat] = {
            icon: '📁',
            color: '#8b949e',
            label: cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          };
        }
      });
      if (!data.categories.includes(state.category)) {
        state.category = data.categories[0];
      }
      renderCategories(data.categories);
    } else {
      renderCategories(Object.keys(CAT_META));
    }
  } catch (e) {
    console.error('Failed to load categories', e);
    renderCategories(Object.keys(CAT_META));
  }
  loadImages();
}

function renderCategories(categories) {
  catListEl.innerHTML = '';
  categories.forEach(key => {
    const meta = CAT_META[key];
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

// ── Load images from API ──
async function loadImages() {
  showLoading();
  state.loading = true;

  const params = new URLSearchParams({
    category: state.category,
    page: state.page,
    per_page: state.perPage,
    search: state.search,
    show_3r_only: state.show3rOnly,
  });

  try {
    const res = await fetch(`/api/images?${params}`);
    const data = await res.json();
    if (data.error) { showError(data.error); return; }

    state.total = data.total;
    state.totalPages = data.total_pages;
    state.page = data.page;
    state.currentResults = data.results;

    renderResults(data.results);
    renderPagination();
    updateStats(data);
  } catch (e) {
    showError('Failed to fetch data: ' + e.message);
  } finally {
    state.loading = false;
  }
}

// ── Triple Rider Toggle ──
if (tripleRiderToggle) {
  tripleRiderToggle.addEventListener('change', () => {
    state.show3rOnly = tripleRiderToggle.checked;
    if (tripleRiderToggleLabel) {
      tripleRiderToggleLabel.classList.toggle('active', state.show3rOnly);
    }
    state.page = 1;
    loadImages();
  });
}

// ── Render flat image rows ──
function renderResults(results) {
  if (!results || results.length === 0) {
    showEmpty('No images found', 'Try a different category or clear the search filter.');
    return;
  }

  resultsEl.innerHTML = '';
  results.forEach((imgData, rowIdx) => {
    resultsEl.appendChild(buildImageRow(imgData, rowIdx));
  });

  setupLazyLoad();
}

// ── Build one image row (3 columns: original, mask, prediction) ──
function buildImageRow(imgData, rowIdx) {
  const is3r = imgData.filename.endsWith('_3r.jpg');
  const row = document.createElement('div');
  row.className = 'instance-group' + (is3r ? ' triple-rider' : '');
  row.id = `row-${rowIdx}`;
  row.dataset.is3r = is3r ? 'true' : 'false';

  const badge3r = is3r ? `<span class="triple-rider-badge" style="margin-left: auto;">🏍️ Triple Rider</span>` : '';

  row.innerHTML = `
    <div class="group-header">
      <div class="group-header-info">
        <span class="group-video-label">Image</span>
        <span class="group-video-name" title="${imgData.filename}">${imgData.filename}</span>
      </div>
      ${badge3r}
    </div>
  `;

  const frameRow = document.createElement('div');
  frameRow.className = 'frame-row';

  const grid = document.createElement('div');
  grid.className = 'images-grid';

  // Column 0: Original
  grid.appendChild(buildImageCol(
    imgData.original_url,
    '🖼 Original',
    'orig-image-col',
    'orig-label',
    `Original · ${imgData.filename}`,
    rowIdx, 0
  ));

  // Column 1: GT Mask
  grid.appendChild(buildImageCol(
    imgData.mask_url,
    '🎭 GT Mask',
    'mask-image-col',
    'mask-label',
    `GT Mask · ${imgData.filename}`,
    rowIdx, 1
  ));

  // Column 2: Prediction Overlay
  grid.appendChild(buildImageCol(
    imgData.prediction_url,
    '🎯 Prediction',
    'pred-image-col',
    'pred-label',
    `Prediction · ${imgData.filename}`,
    rowIdx, 2
  ));

  frameRow.appendChild(grid);
  row.appendChild(frameRow);
  return row;
}

function buildImageCol(url, label, colClass, labelClass, title, rowIdx, colIdx) {
  const col = document.createElement('div');
  col.className = `exp-image-col ${colClass}`;

  if (url) {
    col.innerHTML = `
      <div class="exp-name-label ${labelClass}">${label}</div>
      <div class="image-thumb-wrap">
        <img class="lazy" data-src="${url}" alt="${title}" />
      </div>
    `;
    col.querySelector('.image-thumb-wrap').addEventListener('click', () => {
      openModal(url, title, rowIdx, colIdx);
    });
  } else {
    col.innerHTML = `
      <div class="exp-name-label ${labelClass}" style="opacity:0.5">${label}</div>
      <div class="image-thumb-wrap missing">
        <span class="missing-icon">⊘</span>
        <span class="missing-text">Not found</span>
      </div>
    `;
  }
  return col;
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
    if (paginationTopEl) paginationTopEl.appendChild(s.cloneNode(true));
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
  document.title = `${catMeta.label || data.category} · FP/FN Viewer`;
}

// ── State helpers ──
function showLoading() {
  resultsEl.innerHTML = `<div class="state-box"><div class="spinner"></div><p>Loading images…</p></div>`;
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
const imgCache = new Map();
function prefetchUrl(url) {
  if (!url || imgCache.has(url)) return;
  const img = new Image();
  img.src = url;
  imgCache.set(url, img);
}

// ── Modal ──
// colIdx: 0=original, 1=mask, 2=prediction
function urlForPos(rowIdx, colIdx) {
  if (rowIdx < 0 || rowIdx >= state.currentResults.length) return null;
  const d = state.currentResults[rowIdx];
  
  if (colIdx === 0) return d.original_url || null;
  if (colIdx === 1) return d.mask_url || null;
  if (colIdx === 2) return d.prediction_url || null;
  return null;
}

function titleForPos(rowIdx, colIdx) {
  const d = state.currentResults[rowIdx];
  const labels = ['Original', 'GT Mask', 'Prediction'];
  return `${labels[colIdx] || ''} · ${d.filename}`;
}

function prefetchNeighbors(rowIdx, colIdx) {
  [
    [rowIdx - 1, colIdx],
    [rowIdx + 1, colIdx],
    [rowIdx, colIdx - 1],
    [rowIdx, colIdx + 1],
  ].forEach(([r, c]) => {
    const url = urlForPos(r, c);
    if (url) prefetchUrl(url);
  });
}

function openModal(url, title, rowIdx = null, colIdx = null) {
  modalImg.src = url;
  modalTitle.textContent = title;
  modalOverlay.classList.add('open');
  state.modalPos = (rowIdx !== null && colIdx !== null) ? { rowIdx, colIdx } : null;
  if (state.modalPos) {
    prefetchNeighbors(rowIdx, colIdx);
    updateModalNavButtons(rowIdx, colIdx);
  } else {
    updateModalNavButtons(null, null);
  }
}

function closeModal() {
  modalOverlay.classList.remove('open');
  modalImg.src = '';
  state.modalPos = null;
  updateModalNavButtons(null, null);
}
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function findNextImage(direction, rowIdx, colIdx) {
  const totalRows = state.currentResults.length;
  let r = rowIdx, c = colIdx;

  const getBoundaryAction = (dir) => {
    if (dir === 'ArrowUp' && state.page > 1) return { action: 'PREV_PAGE', targetCol: c };
    if (dir === 'ArrowDown' && state.page < state.totalPages) return { action: 'NEXT_PAGE', targetCol: c };
    return null;
  };

  if (direction === 'ArrowLeft')  { c--; if (c < 0) return null; }
  else if (direction === 'ArrowRight') { c++; if (c > 2) return null; }
  else if (direction === 'ArrowUp')    { r--; if (r < 0) return getBoundaryAction('ArrowUp'); }
  else if (direction === 'ArrowDown')  { r++; if (r >= totalRows) return getBoundaryAction('ArrowDown'); }

  // Skip missing images
  let tries = 0;
  while (tries < 200) {
    const url = urlForPos(r, c);
    if (url) return { url, title: titleForPos(r, c), rowIdx: r, colIdx: c };
    if (direction === 'ArrowLeft')  { c--; if (c < 0) return null; }
    else if (direction === 'ArrowRight') { c++; if (c > 2) return null; }
    else if (direction === 'ArrowUp')    { r--; if (r < 0) return getBoundaryAction('ArrowUp'); }
    else if (direction === 'ArrowDown')  { r++; if (r >= totalRows) return getBoundaryAction('ArrowDown'); }
    tries++;
  }
  return null;
}

async function navigateModal(direction) {
  if (!modalOverlay.classList.contains('open') || !state.modalPos || state.loading) return;
  const { rowIdx, colIdx } = state.modalPos;
  const next = findNextImage(direction, rowIdx, colIdx);
  if (next) {
    if (next.action === 'PREV_PAGE') {
      modalImg.style.opacity = '0.5';
      state.page -= 1;
      await loadImages();
      modalImg.style.opacity = '1';
      const lastRow = state.currentResults.length - 1;
      const finalNext = findNextImage('ArrowUp', lastRow + 1, next.targetCol);
      if (finalNext && !finalNext.action) openModal(finalNext.url, finalNext.title, finalNext.rowIdx, finalNext.colIdx);
      else closeModal();
    } else if (next.action === 'NEXT_PAGE') {
      modalImg.style.opacity = '0.5';
      state.page += 1;
      await loadImages();
      modalImg.style.opacity = '1';
      const finalNext = findNextImage('ArrowDown', -1, next.targetCol);
      if (finalNext && !finalNext.action) openModal(finalNext.url, finalNext.title, finalNext.rowIdx, finalNext.colIdx);
      else closeModal();
    } else {
      openModal(next.url, next.title, next.rowIdx, next.colIdx);
    }
  }
}

function updateModalNavButtons(rowIdx, colIdx) {
  const up    = document.getElementById('modal-nav-up');
  const down  = document.getElementById('modal-nav-down');
  const left  = document.getElementById('modal-nav-left');
  const right = document.getElementById('modal-nav-right');
  if (!up) return;
  if (rowIdx === null) {
    [up, down, left, right].forEach(b => b.disabled = true);
    return;
  }
  up.disabled    = !findNextImage('ArrowUp',    rowIdx, colIdx);
  down.disabled  = !findNextImage('ArrowDown',  rowIdx, colIdx);
  left.disabled  = !findNextImage('ArrowLeft',  rowIdx, colIdx);
  right.disabled = !findNextImage('ArrowRight', rowIdx, colIdx);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (modalOverlay.classList.contains('open') && state.modalPos) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      navigateModal(e.key);
    }
  }
});

['modal-nav-up','modal-nav-down','modal-nav-left','modal-nav-right'].forEach(id => {
  const dirMap = {
    'modal-nav-up': 'ArrowUp', 'modal-nav-down': 'ArrowDown',
    'modal-nav-left': 'ArrowLeft', 'modal-nav-right': 'ArrowRight'
  };
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', e => { e.stopPropagation(); navigateModal(dirMap[id]); });
});

// ── Event listeners ──
applyBtn.addEventListener('click', () => {
  state.page = 1;
  state.search = searchEl.value.trim();
  state.perPage = parseInt(perPageEl.value) || 10;
  loadImages();
});
searchEl.addEventListener('keydown', e => { if (e.key === 'Enter') applyBtn.click(); });

// ── Helpers ──
function formatExpName(exp) {
  return exp.replace(/^results_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Bootstrap ──
init();
