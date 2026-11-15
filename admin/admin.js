'use strict';
/* ============================================================================
   UniMart Admin - front end
   Vanilla JS, no framework. Talks to the Python API in server.py.
   Views: dashboard, inventory, stock history, orders.
   ========================================================================== */

/* ---------- helpers ------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const nf = new Intl.NumberFormat('en-US');
const num = (n) => nf.format(Number(n) || 0);
/* The database stores Thai baht, so the console reports baht. Whole baht only. */
const money = (n) => '฿' + nf.format(Math.round(Number(n) || 0));
const money0 = money;
const compact = (n) => {
  const v = Math.round(Number(n) || 0);
  return Math.abs(v) >= 1000 ? '฿' + (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + 'k' : money(v);
};

function parseDate(s) { return new Date(String(s).replace(' ', 'T')); }
function ago(s) {
  const diff = (Date.now() - parseDate(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + ' d ago';
  return parseDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function stamp(s) {
  const d = parseDate(s);
  if (isNaN(d)) return s || '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const img = (p) => '/' + (p || 'assets/products/strawberries.webp');

/* ---------- icons -------------------------------------------------------- */
const svg = (d, w = 20) => '<svg viewBox="0 0 24 24" fill="none" width="' + w + '" height="' + w + '" aria-hidden="true">' + d + '</svg>';
const ICON = {
  box: svg('<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'),
  cash: svg('<rect x="3" y="6" width="18" height="12" rx="2.2" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 9.5h.01M17.5 14.5h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  alert: svg('<path d="M12 4.5 21 19.5H3L12 4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  cart: svg('<path d="M3.5 4.5h2l2.2 10.5h9.4l2.1-7.5H6.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19" r="1.4" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="19" r="1.4" stroke="currentColor" stroke-width="1.7"/>'),
  trend: svg('<path d="M4 16.5 9 11l3.5 3.5L20 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 6.5H20V11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  units: svg('<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m14.5 6.5 3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  sliders: svg('<path d="M4 8h9M17 8h3M4 16h3M11 16h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="8" r="2.1" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="16" r="2.1" stroke="currentColor" stroke-width="1.7"/>'),
  archive: svg('<rect x="3.5" y="4.5" width="17" height="4" rx="1.2" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 8.5v9.2a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8V8.5M10 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  restore: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  warn: svg('<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 8v4.5M12 16h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  empty: svg('<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 7.5 12 12l8-4.5M12 12v9" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>', 38),
  down: svg('<path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  x: svg('<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  plus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
};

/* ---------- state -------------------------------------------------------- */
const state = {
  user: null, csrf: null, meta: null, view: 'dashboard',
  inv: { page: 1, per: 10, search: '', shelf: '', status: '', sort: 'name', dir: 'asc' },
  pay: { status: 'submitted' },
  mv: { page: 1, per: 15, search: '', reason: '' },
  ord: { page: 1, per: 10, search: '', status: '' },
};

/* Every order is paid (walk-in at the counter, delivery prepaid), so there is
   no pending/unpaid state to manage. */
const ORDER_STATUSES = ['paid', 'packing', 'shipped', 'delivered', 'cancelled'];

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    throw new ApiError('Cannot reach the server. Is python3 server.py running?', 0);
  }
  if (res.status === 401) { onUnauthorized(); throw new ApiError('Session expired', 401); }
  if (!res.ok) {
    let msg = res.statusText || 'Request failed';
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* html error */ }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.indexOf('json') !== -1 ? res.json() : res.text();
}

/* ---------- toasts ------------------------------------------------------- */
function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'err' ? ICON.warn : ICON.check) + '<span>' + esc(message) + '</span>';
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/* ---------- modal -------------------------------------------------------- */
let activeModal = null;

function focusables(root) {
  return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', root)
    .filter((el) => el.offsetParent !== null);
}
function trapTab(e, dialog) {
  const f = focusables(dialog);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openModal(html, opts = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="'
    + esc(opts.label || 'Dialog') + '">' + html + '</div>';
  document.body.appendChild(overlay);
  const dialog = overlay.firstElementChild;
  const prev = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    if (e.key === 'Tab') trapTab(e, dialog);
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (activeModal && activeModal.overlay === overlay) activeModal = null;
    if (prev && prev.focus) try { prev.focus(); } catch (e) { /* detached */ }
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  activeModal = { overlay, dialog, close };
  requestAnimationFrame(() => {
    const f = dialog.querySelector('[autofocus]') || focusables(dialog)[0];
    if (f) f.focus();
  });
  return activeModal;
}
function closeModal() { if (activeModal) activeModal.close(); }

function confirmDialog(title, body, confirmLabel = 'Delete', danger = true) {
  return new Promise((resolve) => {
    const m = openModal(
      '<div class="modal-head"><div><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
      '<div class="modal-foot"><button class="btn" data-no type="button">Cancel</button>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-yes type="button" autofocus>' + esc(confirmLabel) + '</button></div>',
      { label: title });
    const done = (v) => { m.close(); resolve(v); };
    m.dialog.querySelector('[data-no]').addEventListener('click', () => done(false));
    m.dialog.querySelector('[data-x]').addEventListener('click', () => done(false));
    m.dialog.querySelector('[data-yes]').addEventListener('click', () => done(true));
  });
}

/* ---------- shared fragments -------------------------------------------- */
const spinnerHtml = (label = 'Loading…') => '<div class="loading"><span class="spinner"></span>' + esc(label) + '</div>';

const errorHtml = (msg) => '<div class="empty">' + ICON.warn.replace('width="20" height="20"', 'width="38" height="38"') +
  '<b>Something went wrong</b><span>' + esc(msg) + '</span>' +
  '<button class="btn btn-sm" data-retry type="button">Try again</button></div>';

const emptyHtml = (title, body) => '<div class="empty">' + ICON.empty + '<b>' + esc(title) + '</b><span>' + esc(body) + '</span></div>';

function statusPill(status) {
  const label = { ok: 'In stock', low: 'Low stock', out: 'Out of stock' }[status] || status;
  return '<span class="pill pill-' + status + '">' + esc(label) + '</span>';
}
function orderPill(status) {
  return '<span class="pill pill-' + status + '">' + esc(status) + '</span>';
}
/* Payment verification state, separate from fulfilment. */
const PAY_STATUS = { awaiting: 'Awaiting slip', submitted: 'Slip submitted', confirmed: 'Confirmed', rejected: 'Rejected' };
const PAY_METHOD = { qr: 'QR code', bank: 'Bank transfer', promptpay: 'PromptPay' };
function payPill(status) {
  return '<span class="pill pill-' + status + '">' + esc(PAY_STATUS[status] || status) + '</span>';
}
function reasonTag(reason) {
  const cls = ['opening', 'restock', 'return'].indexOf(reason) !== -1 ? 'pill-ok'
    : ['damage'].indexOf(reason) !== -1 ? 'pill-out' : 'pill-plain';
  return '<span class="pill ' + cls + '">' + esc(reason) + '</span>';
}
function deltaCell(d) {
  return '<span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '−') + Math.abs(d) + '</span>';
}
function stockBar(p) {
  const target = Math.max(1, p.min_stock * 2);
  const pct = Math.max(3, Math.min(100, (p.stock / target) * 100));
  return '<span class="stock-cell ' + p.status + '"><span class="bar-track"><i style="width:' + pct + '%"></i></span>' +
    '<span>' + num(p.stock) + '</span></span>';
}
function paginationHtml(prefix, data, extra = '') {
  const { page, pages, total, per } = data;
  const from = total === 0 ? 0 : (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  const wins = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const nums = Array.from(wins).sort((a, b) => a - b);
  let html = '';
  let prev = 0;
  nums.forEach((n) => {
    if (prev && n - prev > 1) html += '<span class="faint" style="padding:0 2px">…</span>';
    html += '<button class="page-btn" data-' + prefix + '-page="' + n + '"' + (n === page ? ' aria-current="page"' : '') + '>' + n + '</button>';
    prev = n;
  });
  return '<div class="pagination"><span class="range">Showing <b>' + num(from) + '–' + num(to) + '</b> of <b>' + num(total) + '</b></span>' +
    extra +
    '<div class="pages">' +
    '<button class="page-btn" data-' + prefix + '-page="' + (page - 1) + '" aria-label="Previous page"' + (page <= 1 ? ' disabled' : '') + '>‹</button>' +
    html +
    '<button class="page-btn" data-' + prefix + '-page="' + (page + 1) + '" aria-label="Next page"' + (page >= pages ? ' disabled' : '') + '>›</button>' +
    '</div></div>';
}

/* ---------- chart -------------------------------------------------------- */
function chartSvg(series) {
  const W = 780, H = 252, L = 48, R = 12, T = 14, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const maxRev = Math.max(1, ...series.map((s) => s.revenue));
  const maxOrd = Math.max(1, ...series.map((s) => s.orders));
  const step = iw / series.length;
  const bw = Math.min(30, step * 0.5);
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = T + ih - (ih * i) / 4;
    grid += '<line x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '" stroke="#e9ede9" stroke-width="1"/>';
    grid += '<text x="' + (L - 9) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10.5" fill="#8a958d">' +
      compact((maxRev * i) / 4) + '</text>';
  }
  let bars = '', hits = '', pts = [];
  const last = series.length - 1;
  series.forEach((s, i) => {
    const cx = L + step * i + step / 2;
    const bh = (s.revenue / maxRev) * ih;
    const by = T + ih - bh;
    bars += '<rect class="bar" x="' + (cx - bw / 2) + '" y="' + by + '" width="' + bw + '" height="' + Math.max(3, bh) +
      '" rx="5" fill="' + (i === last ? '#1f8a3b' : '#8cc79e') + '"></rect>';
    bars += '<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10.5" fill="#8a958d">' +
      s.date.slice(5).replace('-', '/') + '</text>';
    // transparent column that catches the click (works for empty days too)
    hits += '<rect class="hit" x="' + (L + step * i) + '" y="' + T + '" width="' + step + '" height="' + (ih + 18) +
      '" rx="6" data-day="' + s.date + '" tabindex="0" role="button" aria-label="' +
      esc(s.date + ': ' + money(s.revenue) + ', ' + s.orders + ' order' + (s.orders === 1 ? '' : 's') + '. Show the day') + '">' +
      '<title>' + s.date + ' — ' + money(s.revenue) + ', ' + s.orders + ' order' + (s.orders === 1 ? '' : 's') + '</title></rect>';
    pts.push([cx, T + ih - (s.orders / maxOrd) * ih * 0.88]);
  });
  const line = '<polyline fill="none" stroke="#141a16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".5" points="' +
    pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>' +
    pts.map((p, i) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === last ? 3.4 : 2.2) +
      '" fill="#141a16" opacity="' + (i === last ? '.75' : '.4') + '"/>').join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="Revenue in green bars and order count as a line, last 14 days. Each column opens the orders for that day.">' +
    grid + bars + line + hits + '</svg>';
}

/* ---------- dashboard ---------------------------------------------------- */
function dashboardHtml(s) {
  const k = s.kpis;
  const kpis = [
    { label: 'Products', value: num(k.products), foot: num(k.units) + ' units on shelves', icon: ICON.box, cls: 'good' },
    { label: 'Inventory value', value: compact(k.value), foot: 'at cost of current stock', icon: ICON.cash },
    { label: 'Low stock', value: num(k.low), foot: 'at or below reorder point', icon: ICON.alert, cls: k.low ? 'warn' : 'good' },
    { label: 'Out of stock', value: num(k.out), foot: k.out ? 'needs restocking now' : 'nothing is empty', icon: ICON.units, cls: k.out ? 'crit' : 'good' },
    { label: 'Orders · 30 days', value: num(k.orders_30d), foot: num(k.orders_today) + ' placed today', icon: ICON.cart },
    { label: 'Revenue · 30 days', value: compact(k.revenue_30d), foot: 'avg ' + money(k.avg_order) + ' per order', icon: ICON.trend, cls: 'good' },
  ];
  const kpiHtml = kpis.map((c) =>
    '<article class="kpi ' + (c.cls || '') + '">' +
    '<span class="kpi-icon">' + c.icon + '</span>' +
    '<span class="kpi-label">' + c.label + '</span>' +
    '<span class="kpi-value">' + c.value + '</span>' +
    '<span class="kpi-foot">' + c.foot + '</span></article>').join('');

  const maxQty = Math.max(1, ...s.top.map((t) => t.qty));
  const topHtml = s.top.length ? s.top.map((t) =>
    '<div class="top-row"><img class="thumb" src="' + img(t.image) + '" alt="" loading="lazy">' +
    '<div class="top-meta"><span class="top-name">' + esc(t.name) + '</span>' +
    '<span class="top-track"><i style="width:' + Math.max(6, (t.qty / maxQty) * 100) + '%"></i></span></div>' +
    '<span class="top-qty">' + num(t.qty) + '<small>' + money(t.revenue) + '</small></span></div>').join('')
    : emptyHtml('No sales yet', 'Orders placed in the storefront will rank here.');

  const lowHtml = s.low_items.length ? s.low_items.map((p) =>
    '<div class="low-row"><span class="low-name"><img class="thumb" src="' + img(p.image) + '" alt="" loading="lazy">' +
    '<div><b>' + esc(p.name) + '</b><span>' + esc(p.sku) + ' · ' + esc(p.shelf_name) + '</span></div></span>' +
    '<span class="low-qty"><b>' + num(p.stock) + '</b> / ' + num(p.min_stock) + '</span>' +
    '<button class="btn btn-sm" data-restock="' + esc(p.id) + '" type="button">Restock</button></div>').join('')
    : emptyHtml('All shelves healthy', 'Every product is above its reorder point.');

  const feedHtml = s.recent.length ? s.recent.map((m) =>
    '<div class="feed-item"><span class="feed-dot ' + (m.delta >= 0 ? 'up' : 'down') + '">' +
    (m.delta >= 0 ? '+' : '−') + '</span>' +
    '<div class="feed-body"><b>' + esc(m.product_name) + '</b>' +
    '<span>' + esc(m.reason) + ' · ' + num(m.stock_after) + ' left · ' + esc(m.actor) + '</span></div>' +
    '<span class="feed-time">' + ago(m.created_at) + '</span></div>').join('')
    : emptyHtml('No activity yet', 'Stock changes will appear here.');

  return '<div class="stack">' +
    '<section class="kpis" aria-label="Key figures">' + kpiHtml + '</section>' +
    '<div class="grid-2">' +
      '<section class="card"><div class="card-head"><div><h2>Orders &amp; revenue</h2>' +
        '<span class="sub">Last 14 days · bars are revenue, line is order count · click a column for that day</span></div></div>' +
        '<div class="chart-wrap">' + chartSvg(s.series) + '</div>' +
        '<div class="chart-legend"><span><i style="background:#1f8a3b"></i>Revenue</span>' +
        '<span><i style="background:#141a16;opacity:.5"></i>Orders</span></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Top products</h2>' +
        '<span class="sub">Units sold, last 30 days</span></div>' +
        '<div class="card-actions"><a class="btn btn-sm" href="#/inventory">Inventory</a></div></div>' +
        '<div class="top-list">' + topHtml + '</div></section>' +
    '</div>' +
    '<div class="grid-2-even">' +
      '<section class="card"><div class="card-head"><div><h2>Needs attention</h2>' +
        '<span class="sub">At or below reorder point</span></div>' +
        '<div class="card-actions"><span class="pill pill-low">' + num(k.low) + ' low</span>' +
        (k.out ? '<span class="pill pill-out">' + num(k.out) + ' out</span>' : '') + '</div></div>' +
        '<div class="card-body flush" style="padding:0 8px 10px">' + lowHtml + '</div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Recent activity</h2>' +
        '<span class="sub">Every stock movement is logged</span></div>' +
        '<div class="card-actions"><a class="btn btn-sm" href="#/movements">Full history</a></div></div>' +
        '<div class="card-body flush" style="padding:0 8px 10px">' + feedHtml + '</div></section>' +
    '</div></div>';
}

async function renderDashboard() {
  const v = $('#view');
  v.innerHTML = spinnerHtml('Crunching the numbers…');
  try {
    const stats = await api('/api/stats');
    if (state.view !== 'dashboard') return;
    v.innerHTML = dashboardHtml(stats);
    const badge = $('#navLow');
    badge.textContent = stats.kpis.low ? String(stats.kpis.low) : '';
    badge.title = stats.kpis.low + ' products at or below reorder point';
    v.querySelectorAll('[data-day]').forEach((el) => {
      el.addEventListener('click', () => openDayModal(el.dataset.day));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayModal(el.dataset.day); }
      });
    });
    v.querySelectorAll('[data-restock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = stats.low_items.find((x) => x.id === btn.dataset.restock);
        if (p) openStockModal(p);
      });
    });
  } catch (e) {
    if (state.view === 'dashboard') v.innerHTML = errorHtml(e.message);
  }
}

/* ---------- day detail (chart drill-down) -------------------------------- */
async function openDayModal(date) {
  let data;
  try { data = await api('/api/orders?date=' + encodeURIComponent(date) + '&per=50'); }
  catch (e) { toast(e.message, 'err'); return; }

  const day = new Date(date + 'T00:00:00');
  const heading = isNaN(day) ? date : day.toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const live = data.items.filter((o) => o.status !== 'cancelled');
  const revenue = live.reduce((a, o) => a + o.total, 0);
  const units = live.reduce((a, o) => a + (o.units || 0), 0);

  const rows = data.items.length ? data.items.map((o) =>
    '<div class="day-row" data-day-order="' + o.id + '" tabindex="0" role="button" aria-label="Open order ' + esc(o.ref) + '">' +
      '<span class="tag mono">' + esc(o.ref) + '</span>' +
      '<div style="min-width:0"><b style="font-size:13.2px;font-weight:600">' + esc(o.customer) + '</b>' +
        '<span class="faint" style="font-size:11.6px"> · ' + num(o.items_count) + ' line' + (o.items_count === 1 ? '' : 's') + '</span></div>' +
      orderPill(o.status) +
      '<b class="mono" style="text-align:right">' + money(o.total) + '</b>' +
    '</div>').join('')
    : emptyHtml('No orders that day', 'The shop was quiet — nothing was placed.');

  const m = openModal(
    '<div class="modal-head"><div><h2>' + esc(heading) + '</h2>' +
      '<p>' + num(data.total) + ' order' + (data.total === 1 ? '' : 's') + ' · ' + money(revenue) +
      ' revenue · ' + num(units) + ' units' +
      (data.total > data.items.length ? ' · showing the first ' + data.items.length : '') + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="modal-body"><div class="order-items">' + rows + '</div>' +
      (data.items.length ? '<p class="faint" style="font-size:12.5px;margin:6px 0 0">Pick an order to open it.</p>' : '') +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-x type="button">Close</button>' +
      '<button class="btn btn-primary" id="dayOrdersLink" type="button">Open all orders</button></div>',
    { label: 'Orders on ' + date, wide: true });

  m.dialog.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => m.close()));
  m.dialog.querySelector('#dayOrdersLink').addEventListener('click', () => {
    m.close();
    location.hash = '#/orders';
  });
  m.dialog.querySelectorAll('[data-day-order]').forEach((row) => {
    const openIt = () => { const id = Number(row.dataset.dayOrder); m.close(); openOrderModal(id); };
    row.addEventListener('click', openIt);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openIt(); });
  });
}

/* ---------- inventory ---------------------------------------------------- */
function inventoryTableHtml(data) {
  if (!data.items.length) {
    return emptyHtml('Nothing matches', 'Try a different search, aisle or status filter.');
  }
  const rows = data.items.map((p) => {
    const archived = !p.active;
    return '<tr data-id="' + esc(p.id) + '">' +
      '<td><div class="cell-product"><img class="thumb" src="' + img(p.image) + '" alt="" loading="lazy">' +
        '<div class="nm"><b>' + esc(p.name) + '</b><span>' + esc(p.sku) + '</span></div></div></td>' +
      '<td class="hide-sm"><span class="tag">' + esc(p.shelf_name) + '</span></td>' +
      '<td class="num hide-sm"><span title="' + esc(p.price_source || 'No price source recorded') + '">' + money(p.price) + '</span></td>' +
      '<td>' + stockBar(p) + '</td>' +
      '<td class="num hide-sm">' + num(p.min_stock) + '</td>' +
      '<td>' + (archived ? '<span class="pill pill-plain">Archived</span>' : statusPill(p.status)) + '</td>' +
      '<td class="num hide-sm">' + money(p.value) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="icon-btn" data-adjust="' + esc(p.id) + '" title="Adjust stock" aria-label="Adjust stock for ' + esc(p.name) + '" type="button">' + ICON.sliders + '</button>' +
        '<button class="icon-btn" data-edit="' + esc(p.id) + '" title="Edit product" aria-label="Edit ' + esc(p.name) + '" type="button">' + ICON.edit + '</button>' +
        (state.user && state.user.role === 'admin'
          ? (archived
            ? '<button class="icon-btn" data-restore="' + esc(p.id) + '" title="Restore product" aria-label="Restore ' + esc(p.name) + '" type="button">' + ICON.restore + '</button>'
            : '<button class="icon-btn danger" data-archive="' + esc(p.id) + '" title="Archive product" aria-label="Archive ' + esc(p.name) + '" type="button">' + ICON.archive + '</button>')
          : '') +
        '</div></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table class="table"><thead><tr>' +
    '<th data-sort="name">Product</th>' +
    '<th class="hide-sm">Aisle</th>' +
    '<th class="num hide-sm" data-sort="price">Price</th>' +
    '<th data-sort="stock">Stock</th>' +
    '<th class="num hide-sm">Reorder at</th>' +
    '<th>Status</th>' +
    '<th class="num hide-sm" data-sort="value">Value</th>' +
    '<th class="num">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function inventoryHtml(data, shelves) {
  const s = state.inv;
  const shelfOpts = '<option value="">All aisles</option>' + shelves.map((x) =>
    '<option value="' + esc(x.id) + '"' + (s.shelf === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  const statusOpts = [['', 'All statuses'], ['ok', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock'], ['inactive', 'Archived']]
    .map(([v, l]) => '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' + l + '</option>').join('');
  const arrow = s.dir === 'asc' ? ' ↑' : ' ↓';
  return '<section class="card">' +
    '<div class="toolbar">' +
      '<label class="search">' + ICON.search +
        '<input class="input" id="invSearch" type="search" placeholder="Search name, SKU or id…" value="' + esc(s.search) + '" aria-label="Search products">' +
      '</label>' +
      '<select class="select" id="invShelf" aria-label="Filter by aisle">' + shelfOpts + '</select>' +
      '<select class="select" id="invStatus" aria-label="Filter by status">' + statusOpts + '</select>' +
      '<select class="select" id="invSort" aria-label="Sort products">' +
        ['name:Name', 'stock:Stock', 'price:Price', 'value:Value', 'updated:Recently updated'].map((o) => {
          const [v, l] = o.split(':');
          const mark = s.sort === v ? (s.dir === 'asc' ? ' ↑' : ' ↓') : '';
          return '<option value="' + v + '"' + (s.sort === v ? ' selected' : '') + '>' + l + mark + '</option>';
        }).join('') +
      '</select>' +
      '<span class="spacer"></span>' +
      '<span class="count">' + num(data.total) + ' product' + (data.total === 1 ? '' : 's') + '</span>' +
      '<a class="btn btn-sm" href="/api/export/products.csv" download>Export CSV</a>' +
    '</div>' +
    inventoryTableHtml(data) +
    paginationHtml('inv', data,
      '<select class="select" id="invPer" aria-label="Rows per page" style="height:32px;max-width:110px;font-size:13px">' +
      [10, 25, 50].map((n) => '<option value="' + n + '"' + (s.per === n ? ' selected' : '') + '>' + n + ' / page</option>').join('') +
      '</select>') +
    '</section>';
}

async function loadInventory() {
  const v = $('#view');
  v.innerHTML = spinnerHtml('Loading inventory…');
  const s = state.inv;
  const qs = new URLSearchParams({ page: s.page, per: s.per, sort: s.sort, dir: s.dir });
  if (s.search) qs.set('search', s.search);
  if (s.shelf) qs.set('shelf', s.shelf);
  if (s.status) qs.set('status', s.status);
  try {
    const [data, meta] = await Promise.all([api('/api/products?' + qs.toString()), state.meta ? Promise.resolve(state.meta) : api('/api/meta')]);
    state.meta = meta;
    if (state.view !== 'inventory') return;
    v.innerHTML = inventoryHtml(data, meta.shelves);
    bindInventory(data);
  } catch (e) {
    if (state.view === 'inventory') v.innerHTML = errorHtml(e.message);
  }
}

function bindInventory(data) {
  const v = $('#view');
  const rerender = () => loadInventory();

  const search = $('#invSearch');
  search.addEventListener('input', debounce(() => {
    state.inv.search = search.value.trim(); state.inv.page = 1; rerender();
  }, 320));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.inv.search = search.value.trim(); state.inv.page = 1; rerender(); }
  });

  $('#invShelf').addEventListener('change', (e) => { state.inv.shelf = e.target.value; state.inv.page = 1; rerender(); });
  $('#invStatus').addEventListener('change', (e) => { state.inv.status = e.target.value; state.inv.page = 1; rerender(); });
  $('#invSort').addEventListener('change', (e) => { state.inv.sort = e.target.value.split(':')[0]; state.inv.page = 1; rerender(); });
  const per = $('#invPer');
  if (per) per.addEventListener('change', (e) => { state.inv.per = Number(e.target.value); state.inv.page = 1; rerender(); });

  $$('[data-inv-page]', v).forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    state.inv.page = Number(b.dataset.invPage);
    rerender();
  }));

  $$('th[data-sort]', v).forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.inv.sort === key) state.inv.dir = state.inv.dir === 'asc' ? 'desc' : 'asc';
    else { state.inv.sort = key; state.inv.dir = key === 'stock' ? 'asc' : 'desc'; }
    rerender();
  }));

  const byId = (id) => data.items.find((p) => p.id === id);

  $$('[data-adjust]', v).forEach((b) => b.addEventListener('click', () => {
    const p = byId(b.dataset.adjust);
    if (p) openStockModal(p);
  }));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => {
    const p = byId(b.dataset.edit);
    if (p) openProductModal(p);
  }));
  $$('[data-archive]', v).forEach((b) => b.addEventListener('click', async () => {
    const p = byId(b.dataset.archive);
    if (!p) return;
    const ok = await confirmDialog('Archive ' + p.name + '?',
      'It disappears from the storefront and the active inventory list, but its order history and stock ledger are kept. You can restore it later.',
      'Archive', false);
    if (!ok) return;
    try {
      await api('/api/products/' + encodeURIComponent(p.id) + '?archive=1', { method: 'PATCH', body: { active: false } });
      toast('Archived ' + p.name);
      loadInventory();
    } catch (e) { toast(e.message, 'err'); }
  }));
  $$('[data-restore]', v).forEach((b) => b.addEventListener('click', async () => {
    const p = byId(b.dataset.restore);
    if (!p) return;
    try {
      await api('/api/products/' + encodeURIComponent(p.id), { method: 'PATCH', body: { active: true } });
      toast('Restored ' + p.name);
      loadInventory();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

/* ---------- product modal ------------------------------------------------ */
function openProductModal(product) {
  const isEdit = !!product;
  const p = product || { name: '', sku: '', shelf: 'produce', price: '', price_source: '', stock: 0, min_stock: 20 };
  const shelves = (state.meta ? state.meta.shelves : [{ id: 'produce', name: 'Fresh Produce' }]);
  const body =
    '<div class="modal-head"><div><h2>' + (isEdit ? 'Edit product' : 'New product') + '</h2>' +
      '<p>' + (isEdit ? 'Changes to price and stock are logged in the ledger.' : 'Adds a product to the catalogue and the storefront.') + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
    '<form class="modal-body" id="productForm">' +
      '<div class="form-grid">' +
        '<label class="field span-2"><span>Product name</span>' +
          '<input name="name" required maxlength="120" value="' + esc(p.name) + '" autofocus placeholder="e.g. Oatly Barista Oat Milk, 1 L"></label>' +
        '<label class="field"><span>SKU</span><input name="sku" required maxlength="24" value="' + esc(p.sku) + '" placeholder="DRY-020" spellcheck="false"></label>' +
        '<label class="field"><span>Aisle</span><select name="shelf">' +
          shelves.map((s) => '<option value="' + esc(s.id) + '"' + (p.shelf === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
        '</select></label>' +
        '<label class="field"><span>Price (฿ baht)</span><input name="price" type="number" step="1" min="0" required value="' + esc(p.price) + '"></label>' +
        '<label class="field"><span>Stock on hand</span><input name="stock" type="number" min="0" step="1" value="' + esc(p.stock) + '"' + (isEdit ? '' : '') + '></label>' +
        '<label class="field"><span>Reorder point</span><input name="min_stock" type="number" min="0" step="1" value="' + esc(p.min_stock) + '"></label>' +
        '<label class="field span-2"><span>Price basis (where this baht price comes from)</span>' +
          '<input name="price_source" maxlength="120" value="' + esc(p.price_source || '') + '" placeholder="e.g. Makro/Lotus\'s anchor (Nov 2026)"></label>' +
        '<label class="field span-2"><span>Image path</span><input name="image" value="' + esc(p.image || '') + '" placeholder="assets/products/oat-milk.webp" spellcheck="false"></label>' +
      '</div>' +
      '<p class="login-error" id="productError" role="alert" hidden></p>' +
    '</form>' +
    '<div class="modal-foot"><button class="btn" data-x type="button">Cancel</button>' +
      '<button class="btn btn-primary" id="productSave" type="button">' + (isEdit ? 'Save changes' : 'Create product') + '</button></div>';

  const m = openModal(body, { label: isEdit ? 'Edit product' : 'New product' });
  const form = $('#productForm', m.dialog);
  const errBox = $('#productError', m.dialog);
  const showErr = (msg) => { errBox.hidden = false; errBox.textContent = msg; };
  m.dialog.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => m.close()));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  async function save() {
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get('name') || '').trim(),
      sku: String(fd.get('sku') || '').trim().toUpperCase(),
      shelf: String(fd.get('shelf') || ''),
      price: Math.round(Number(fd.get('price'))),
      price_source: String(fd.get('price_source') || '').trim() || null,
      stock: Number(fd.get('stock')),
      min_stock: Number(fd.get('min_stock')),
      image: String(fd.get('image') || '').trim() || null,
    };
    const btn = $('#productSave', m.dialog);
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isEdit) await api('/api/products/' + encodeURIComponent(p.id), { method: 'PATCH', body: payload });
      else await api('/api/products', { method: 'POST', body: payload });
      m.close();
      toast(isEdit ? 'Saved ' + payload.name : 'Created ' + payload.name);
      if (state.view === 'inventory') loadInventory(); else if (state.view === 'dashboard') renderDashboard();
    } catch (e) {
      showErr(e.message);
      btn.disabled = false; btn.textContent = isEdit ? 'Save changes' : 'Create product';
    }
  }
}

/* ---------- stock adjust modal ------------------------------------------ */
function openStockModal(product) {
  const suggest = Math.max(1, product.min_stock * 2 - product.stock);
  const reasons = ['restock', 'adjustment', 'damage', 'return'];
  const body =
    '<div class="modal-head"><div><h2>Adjust stock</h2><p>' + esc(product.name) + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="modal-body">' +
      '<div class="adjust-preview"><div class="now"><b id="stockNow">' + num(product.stock) + '</b><span>On hand</span></div>' +
        '<span class="arrow">' + ICON.trend + '</span>' +
        '<div class="next pos" id="stockNextWrap"><b id="stockNext">' + num(product.stock) + '</b><span>After</span></div>' +
        '<div style="margin-left:auto;text-align:right"><span class="faint" style="font-size:12px">Reorder at ' +
          num(product.min_stock) + '</span><br><span class="faint" style="font-size:12px">Suggested +' + suggest + '</span></div></div>' +
      '<label class="field"><span>Change (+ to add, − to remove)</span>' +
        '<input id="adjustDelta" type="number" step="1" value="' + suggest + '" autofocus></label>' +
      '<div class="quick-chips">' +
        '<button class="chip" data-set="' + suggest + '" type="button">+' + suggest + ' (reach 2× reorder)</button>' +
        '<button class="chip" data-set="10" type="button">+10</button>' +
        '<button class="chip" data-set="25" type="button">+25</button>' +
        '<button class="chip" data-set="-1" type="button">−1</button>' +
        '<button class="chip" data-set="-5" type="button">−5</button>' +
      '</div>' +
      '<div class="form-grid" style="margin-top:14px">' +
        '<label class="field"><span>Reason</span><select id="adjustReason">' +
          reasons.map((r) => '<option value="' + r + '"' + (r === 'restock' ? ' selected' : '') + '>' + r + '</option>').join('') +
        '</select></label>' +
        '<label class="field span-2"><span>Note (optional)</span><input id="adjustNote" maxlength="200" placeholder="e.g. delivery from supplier, PO 4471"></label>' +
      '</div>' +
      '<p class="login-error" id="adjustError" role="alert" hidden></p>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-x type="button">Cancel</button>' +
      '<button class="btn btn-primary" id="adjustSave" type="button">Apply adjustment</button></div>';

  const m = openModal(body, { label: 'Adjust stock' });
  const delta = $('#adjustDelta', m.dialog);
  const nextEl = $('#stockNext', m.dialog);
  const wrap = $('#stockNextWrap', m.dialog);
  const err = $('#adjustError', m.dialog);

  const refresh = () => {
    const d = Number(delta.value) || 0;
    const next = product.stock + d;
    nextEl.textContent = num(next);
    wrap.className = 'next ' + (next < product.stock ? 'neg' : 'pos');
    err.hidden = true;
    if (next < 0) { err.hidden = false; err.textContent = 'Only ' + product.stock + ' on hand — cannot remove that many.'; }
  };
  delta.addEventListener('input', refresh);
  refresh();

  m.dialog.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    delta.value = b.dataset.set; refresh(); delta.focus();
  }));
  m.dialog.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => m.close()));

  $('#adjustSave', m.dialog).addEventListener('click', async () => {
    const d = Number(delta.value) || 0;
    if (!d) { err.hidden = false; err.textContent = 'Enter a non-zero change.'; return; }
    const btn = $('#adjustSave', m.dialog);
    btn.disabled = true; btn.textContent = 'Applying…';
    try {
      await api('/api/products/' + encodeURIComponent(product.id) + '/stock', {
        method: 'POST',
        body: { delta: d, reason: $('#adjustReason', m.dialog).value, note: $('#adjustNote', m.dialog).value.trim() },
      });
      m.close();
      toast((d > 0 ? 'Added ' : 'Removed ') + Math.abs(d) + ' × ' + product.name);
      if (state.view === 'inventory') loadInventory();
      else if (state.view === 'dashboard') renderDashboard();
      else if (state.view === 'movements') loadMovements();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Apply adjustment';
    }
  });
}

/* ---------- movements ---------------------------------------------------- */
function movementsHtml(data, reasons) {
  const s = state.mv;
  const rows = data.items.map((m) =>
    '<tr><td class="mono" style="white-space:nowrap">' + stamp(m.created_at) + '</td>' +
    '<td><div class="cell-product"><img class="thumb" src="' + img(m.image) + '" alt="" loading="lazy">' +
      '<div class="nm"><b>' + esc(m.product_name) + '</b><span>' + esc(m.product_id) + '</span></div></div></td>' +
    '<td class="num">' + deltaCell(m.delta) + '</td>' +
    '<td>' + reasonTag(m.reason) + '</td>' +
    '<td class="hide-sm">' + (m.note ? esc(m.note) : '<span class="faint">—</span>') + '</td>' +
    '<td class="hide-sm"><span class="tag">' + esc(m.actor) + '</span></td>' +
    '<td class="num">' + num(m.stock_after) + '</td></tr>').join('');

  return '<section class="card"><div class="toolbar">' +
      '<label class="search">' + ICON.search +
        '<input class="input" id="mvSearch" type="search" placeholder="Search product, note or user…" value="' + esc(s.search) + '"></label>' +
      '<select class="select" id="mvReason"><option value="">All reasons</option>' +
        reasons.map((r) => '<option value="' + r + '"' + (s.reason === r ? ' selected' : '') + '>' + r + '</option>').join('') +
      '</select><span class="spacer"></span>' +
      '<span class="count">' + num(data.total) + ' movements</span></div>' +
    (data.items.length
      ? '<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Product</th>' +
        '<th class="num">Change</th><th>Reason</th><th class="hide-sm">Note</th>' +
        '<th class="hide-sm">By</th><th class="num">After</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : emptyHtml('No movements', 'Stock changes, sales and returns will show up here.')) +
    paginationHtml('mv', data) + '</section>';
}

async function loadMovements() {
  const v = $('#view');
  v.innerHTML = spinnerHtml('Loading stock history…');
  const s = state.mv;
  const qs = new URLSearchParams({ page: s.page, per: s.per });
  if (s.search) qs.set('q', s.search);
  if (s.reason) qs.set('reason', s.reason);
  try {
    const [data, meta] = await Promise.all([api('/api/movements?' + qs.toString()), state.meta ? Promise.resolve(state.meta) : api('/api/meta')]);
    state.meta = meta;
    if (state.view !== 'movements') return;
    v.innerHTML = movementsHtml(data, meta.reasons);
    const search = $('#mvSearch');
    search.addEventListener('input', debounce(() => { state.mv.search = search.value.trim(); state.mv.page = 1; loadMovements(); }, 320));
    $('#mvReason').addEventListener('change', (e) => { state.mv.reason = e.target.value; state.mv.page = 1; loadMovements(); });
    $$('[data-mv-page]', v).forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      state.mv.page = Number(b.dataset.mvPage); loadMovements();
    }));
  } catch (e) {
    if (state.view === 'movements') v.innerHTML = errorHtml(e.message);
  }
}

/* ---------- orders -------------------------------------------------------- */
function ordersHtml(data) {
  const s = state.ord;
  const rows = data.items.map((o) =>
    '<tr data-order="' + o.id + '" tabindex="0" style="cursor:pointer">' +
    '<td><b class="mono">' + esc(o.ref) + '</b></td>' +
    '<td>' + esc(o.customer) + '</td>' +
    '<td class="hide-sm"><span class="tag">' + (o.fulfilment === 'walk-in' ? 'Walk-in' : 'Delivery') + '</span></td>' +
    '<td class="num hide-sm">' + num(o.items_count) + ' line' + (o.items_count === 1 ? '' : 's') + ' · ' + num(o.units) + ' unit' + (o.units === 1 ? '' : 's') + '</td>' +
    '<td class="num"><b>' + money(o.total) + '</b></td>' +
    '<td onclick="event.stopPropagation()">' +
      '<select class="select" data-status="' + o.id + '" style="height:32px;font-size:12.6px;padding-left:9px" aria-label="Status for ' + esc(o.ref) + '">' +
        ORDER_STATUSES.map((st) =>
          '<option value="' + st + '"' + (o.status === st ? ' selected' : '') + '>' + st + '</option>').join('') +
      '</select></td>' +
    '<td class="mono hide-sm" style="white-space:nowrap">' + stamp(o.created_at) + '</td></tr>').join('');

  return '<section class="card"><div class="toolbar">' +
      '<label class="search">' + ICON.search +
        '<input class="input" id="ordSearch" type="search" placeholder="Search reference or customer…" value="' + esc(s.search) + '"></label>' +
      '<select class="select" id="ordStatus" aria-label="Filter by status"><option value="">All statuses</option>' +
        ORDER_STATUSES.map((st) =>
          '<option value="' + st + '"' + (s.status === st ? ' selected' : '') + '>' + st + '</option>').join('') +
      '</select><span class="spacer"></span>' +
      '<span class="count">' + num(data.total) + ' orders</span></div>' +
    (data.items.length
      ? '<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Customer</th>' +
        '<th class="hide-sm">Type</th><th class="num hide-sm">Items</th><th class="num">Total</th><th>Status</th><th class="hide-sm">Placed</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>'
      : emptyHtml('No orders yet', 'Place an order in the storefront and it will appear here instantly.')) +
    paginationHtml('ord', data) + '</section>';
}

async function loadOrders() {
  const v = $('#view');
  v.innerHTML = spinnerHtml('Loading orders…');
  const s = state.ord;
  const qs = new URLSearchParams({ page: s.page, per: s.per });
  if (s.search) qs.set('q', s.search);
  if (s.status) qs.set('status', s.status);
  try {
    const data = await api('/api/orders?' + qs.toString());
    if (state.view !== 'orders') return;
    v.innerHTML = ordersHtml(data);
    const search = $('#ordSearch');
    search.addEventListener('input', debounce(() => { state.ord.search = search.value.trim(); state.ord.page = 1; loadOrders(); }, 320));
    $('#ordStatus').addEventListener('change', (e) => { state.ord.status = e.target.value; state.ord.page = 1; loadOrders(); });
    $$('[data-ord-page]', v).forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      state.ord.page = Number(b.dataset.ordPage); loadOrders();
    }));
    $$('tr[data-order]', v).forEach((tr) => {
      tr.addEventListener('click', () => openOrderModal(Number(tr.dataset.order)));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openOrderModal(Number(tr.dataset.order)); });
    });
    $$('select[data-status]', v).forEach((sel) => sel.addEventListener('change', async () => {
      const id = sel.dataset.status;
      sel.disabled = true;
      try {
        await api('/api/orders/' + id, { method: 'PATCH', body: { status: sel.value } });
        toast('Order marked ' + sel.value);
        loadOrders();
      } catch (e) {
        toast(e.message, 'err');
        sel.disabled = false;
        loadOrders();
      }
    }));
  } catch (e) {
    if (state.view === 'orders') v.innerHTML = errorHtml(e.message);
  }
}

async function openOrderModal(id) {
  let detail;
  try { detail = await api('/api/orders/' + id); }
  catch (e) { toast(e.message, 'err'); return; }
  const o = detail.order, items = detail.items;
  const rows = items.map((it) =>
    '<div class="order-item"><img class="thumb" src="' + img(it.image) + '" alt="">' +
    '<b>' + esc(it.name) + '</b>' +
    '<span class="qty">' + num(it.qty) + ' × ' + money(it.unit_price) + '</span>' +
    '<b class="mono">' + money(it.qty * it.unit_price) + '</b></div>').join('');

  const m = openModal(
    '<div class="modal-head"><div><h2>' + esc(o.ref) + '</h2><p>' + esc(o.customer) + ' · ' + stamp(o.created_at) + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="modal-body">' +
      '<div class="order-items">' + rows + '</div>' +
      '<div class="order-totals"><div><span>Subtotal</span><span class="mono">' + money(o.subtotal) + '</span></div>' +
        '<div><span>Delivery</span><span class="mono">' + (o.fee ? money(o.fee) : 'Free') + '</span></div>' +
        '<div class="grand"><span>Total</span><span class="mono">' + money(o.total) + '</span></div></div>' +
      (o.ship_address ? '<div class="day-row" style="cursor:default;display:block;background:#f8faf8;border-color:#e3e7e3;margin:12px 0 0">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#8a958d;margin-bottom:4px">Deliver to</div>' +
        '<b style="font-size:13.4px">' + esc(o.ship_name || o.customer) + '</b>' +
        '<div class="faint" style="font-size:12.6px">' + esc(o.ship_phone || '') + '</div>' +
        '<div style="font-size:12.8px;line-height:1.45">' + esc(o.ship_address) + '</div>' +
        '<div class="faint" style="font-size:12.4px;margin-top:6px">Paid by ' +
        esc(o.payment === 'qr' ? 'QR code' : o.payment === 'bank' ? 'bank transfer' : o.payment === 'promptpay' ? 'PromptPay' : '—') +
        '</div></div>' : '') +
      '<div class="form-grid" style="margin-top:16px">' +
        '<label class="field"><span>Order status</span><select id="orderStatus">' +
          ORDER_STATUSES.map((st) =>
            '<option value="' + st + '"' + (o.status === st ? ' selected' : '') + '>' + st + '</option>').join('') +
        '</select></label>' +
        '<div class="field"><span>Payment &amp; fulfilment</span><div class="tag" style="align-self:flex-start;height:40px;display:flex;align-items:center">' +
          (o.fulfilment === 'walk-in' ? 'Paid · walk-in' : 'Prepaid · delivery') + ' · ' +
          (PAY_STATUS[o.payment_status] || '') + '</div></div>' +
      '</div>' +
      (o.status === 'cancelled' ? '' : '<p class="faint" style="font-size:12.5px;margin:10px 0 0">Cancelling returns every unit to stock and writes a return entry to the ledger.</p>') +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-x type="button">Close</button>' +
      '<button class="btn btn-primary" id="orderSave" type="button">Update status</button></div>',
    { label: 'Order ' + o.ref, wide: true });

  m.dialog.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => m.close()));
  $('#orderSave', m.dialog).addEventListener('click', async () => {
    const status = $('#orderStatus', m.dialog).value;
    if (status === o.status) { m.close(); return; }
    const btn = $('#orderSave', m.dialog);
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api('/api/orders/' + o.id, { method: 'PATCH', body: { status } });
      m.close();
      toast('Order ' + o.ref + ' marked ' + status);
      if (state.view === 'orders') loadOrders();
      else if (state.view === 'dashboard') renderDashboard();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false; btn.textContent = 'Update status';
    }
  });
}

/* ---------- payments (slip review) --------------------------------------- */
async function refreshPayBadge() {
  try {
    const d = await api('/api/payments?status=submitted');
    const el = $('#navPay');
    if (el) {
      const n = (d.counts && d.counts.submitted) || 0;
      el.textContent = n ? String(n) : '';
      el.title = n ? n + ' slip(s) awaiting review' : '';
    }
  } catch (e) { /* signed out or offline */ }
}

function paymentsHtml(data) {
  const counts = data.counts || {};
  const total = Object.keys(PAY_STATUS).reduce(function (a, k) { return a + (counts[k] || 0); }, 0);
  const tabs = [['submitted', 'Awaiting review'], ['rejected', 'Rejected'], ['confirmed', 'Confirmed'], ['awaiting', 'No slip yet'], ['all', 'All']];
  const bar = '<div class="toolbar">' + tabs.map(function (t) {
    const on = data.status === t[0];
    const n = t[0] === 'all' ? total : (counts[t[0]] || 0);
    return '<button class="chip" type="button" data-pay-tab="' + t[0] + '"' +
      (on ? ' aria-pressed="true" style="background:var(--brand-soft);border-color:var(--brand-line);color:var(--brand-dark)"' : '') +
      '>' + t[1] + ' · ' + num(n) + '</button>';
  }).join('') + '<span class="spacer"></span><span class="count">' + data.items.length + ' shown</span></div>';

  if (!data.items.length) {
    return '<section class="card">' + bar +
      emptyHtml('Nothing to review', 'When a shopper uploads a transfer slip it lands here for confirmation.') + '</section>';
  }
  const rows = data.items.map(function (o) {
    return '<tr data-pay="' + o.id + '" tabindex="0" style="cursor:pointer">' +
      '<td><b class="mono">' + esc(o.ref) + '</b></td>' +
      '<td>' + esc(o.customer) + '</td>' +
      '<td class="hide-sm"><span class="tag">' + esc(PAY_METHOD[o.payment] || '—') + '</span></td>' +
      '<td class="num"><b>' + money(o.total) + '</b></td>' +
      '<td class="hide-sm mono">' + (o.payment_uploaded_at ? stamp(o.payment_uploaded_at) : '—') + '</td>' +
      '<td>' + payPill(o.payment_status) + '</td>' +
      '<td class="num">' + (o.payment_proof ? '<span class="tag">Slip</span>' : '<span class="faint">—</span>') + '</td></tr>';
  }).join('');
  return '<section class="card">' + bar +
    '<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Customer</th>' +
    '<th class="hide-sm">Method</th><th class="num">Total</th><th class="hide-sm">Slip received</th>' +
    '<th>Payment</th><th class="num">Slip</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
}

async function loadPayments() {
  const v = $('#view');
  v.innerHTML = spinnerHtml('Loading payment slips…');
  try {
    const data = await api('/api/payments?status=' + encodeURIComponent(state.pay.status));
    if (state.view !== 'payments') return;
    v.innerHTML = paymentsHtml(data);
    $$('[data-pay-tab]', v).forEach(function (b) {
      b.addEventListener('click', function () { state.pay.status = b.dataset.payTab; loadPayments(); });
    });
    $$('tr[data-pay]', v).forEach(function (tr) {
      tr.addEventListener('click', function () { openPaymentModal(Number(tr.dataset.pay)); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openPaymentModal(Number(tr.dataset.pay)); });
    });
    refreshPayBadge();
  } catch (e) {
    if (state.view === 'payments') v.innerHTML = errorHtml(e.message);
  }
}

async function openPaymentModal(id) {
  let detail;
  try { detail = await api('/api/orders/' + id); }
  catch (e) { toast(e.message, 'err'); return; }
  const o = detail.order, items = detail.items;

  let slip = '<div class="slip-empty">No slip has been uploaded for this order yet.</div>';
  let objectUrl = null;
  if (o.payment_proof) {
    try {
      const res = await fetch('/api/payments/' + id + '/proof', { credentials: 'same-origin' });
      if (res.ok) {
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        slip = '<img class="slip-preview" alt="Payment slip" src="' + objectUrl + '">';
      }
    } catch (e) { /* fall back to the empty state */ }
  }

  const lines = items.map(function (it) {
    return '<div class="order-item"><img class="thumb" src="' + img(it.image) + '" alt="">' +
      '<b>' + esc(it.name) + '</b><span class="qty">' + num(it.qty) + ' × ' + money(it.unit_price) + '</span>' +
      '<b class="mono">' + money(it.qty * it.unit_price) + '</b></div>';
  }).join('');

  const m = openModal(
    '<div class="modal-head"><div><h2>' + esc(o.ref) + '</h2>' +
      '<p>' + esc(o.customer) + ' · ' + money(o.total) + ' · ' + esc(PAY_METHOD[o.payment] || '—') + '</p></div>' +
      '<button class="icon-btn" data-x type="button" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="modal-body">' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">' + payPill(o.payment_status) +
        (o.payment_uploaded_at ? '<span class="faint" style="font-size:12.4px">Slip received ' + stamp(o.payment_uploaded_at) + '</span>' : '') +
        (o.payment_checked_by ? '<span class="faint" style="font-size:12.4px">· checked by ' + esc(o.payment_checked_by) + '</span>' : '') + '</div>' +
      slip +
      (o.payment_note ? '<p class="faint" style="font-size:12.6px;margin:10px 0 0">Note: ' + esc(o.payment_note) + '</p>' : '') +
      (o.ship_address ? '<div style="margin-top:14px"><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.07em">Deliver to</div>' +
        '<b style="font-size:13.4px">' + esc(o.ship_name || o.customer) + '</b>' +
        '<div class="faint" style="font-size:12.6px">' + esc(o.ship_phone || '') + '</div>' +
        '<div style="font-size:12.8px">' + esc(o.ship_address) + '</div></div>' : '') +
      '<div class="order-items" style="margin-top:14px">' + lines + '</div>' +
      '<label class="field" style="margin-top:8px"><span>Note to the shopper (required when rejecting)</span>' +
        '<input id="payNote" maxlength="200" placeholder="e.g. amount does not match the order"></label>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-x type="button">Close</button>' +
      '<button class="btn btn-danger" id="payReject" type="button">Reject slip</button>' +
      '<button class="btn btn-primary" id="payConfirm" type="button">Confirm payment</button></div>',
    { label: 'Payment for ' + o.ref, wide: true });

  const closeIt = function () { m.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  m.dialog.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeIt); });
  const confirmBtn = m.dialog.querySelector('#payConfirm');
  const rejectBtn = m.dialog.querySelector('#payReject');
  if (!o.payment_proof) { confirmBtn.disabled = true; rejectBtn.disabled = true; }

  async function review(action) {
    const note = $('#payNote', m.dialog).value.trim();
    if (action === 'reject' && !note) {
      toast('Add a short reason before rejecting the slip', 'err');
      $('#payNote', m.dialog).focus();
      return;
    }
    try {
      await api('/api/payments/' + id + '/confirm', { method: 'POST', body: { action: action, note: note } });
      closeIt();
      toast(action === 'confirm' ? 'Payment confirmed for ' + o.ref : 'Slip rejected for ' + o.ref);
      if (state.view === 'payments') loadPayments();
      else if (state.view === 'orders') loadOrders();
      refreshPayBadge();
    } catch (e) {
      toast(e.message, 'err');
      confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm payment';
      rejectBtn.disabled = false; rejectBtn.textContent = 'Reject slip';
    }
  }
  confirmBtn.addEventListener('click', function () {
    if (o.payment_status === 'confirmed') { closeIt(); return; }
    confirmBtn.disabled = true; confirmBtn.textContent = 'Confirming…';
    review('confirm');
  });
  rejectBtn.addEventListener('click', function () {
    rejectBtn.disabled = true; rejectBtn.textContent = 'Rejecting…';
    review('reject');
  });
}

/* ---------- chrome / routing --------------------------------------------- */
const PAGES = {
  dashboard: { title: 'Dashboard', sub: 'Inventory health at a glance', render: renderDashboard },
  inventory: { title: 'Inventory', sub: 'Products, stock levels and pricing', render: loadInventory },
  movements: { title: 'Stock history', sub: 'Every change, with who and why', render: loadMovements },
  orders: { title: 'Orders', sub: 'Orders placed through the storefront', render: loadOrders },
  payments: { title: 'Payments', sub: 'Check transfer slips before delivery', render: loadPayments },
};

function setChrome(view) {
  const p = PAGES[view];
  $('#pageTitle').textContent = p.title;
  $('#pageSub').textContent = p.sub;
  $$('.nav-item[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
}

function route() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  const view = PAGES[hash] ? hash : 'dashboard';
  state.view = view;
  setChrome(view);
  window.scrollTo(0, 0);
  PAGES[view].render();
  $('#view').focus({ preventScroll: true });
}

/* ---------- auth --------------------------------------------------------- */
function showLogin() {
  closeModal();
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#loginError').hidden = true;
  setTimeout(() => $('#loginUser').focus(), 40);
}
function onUnauthorized() {
  const wasSignedIn = !!state.user;      // a 401 while signed out is the normal boot probe
  state.user = null; state.csrf = null;
  if (!$('#login').hidden) return;
  showLogin();
  if (wasSignedIn) toast('Your session expired — please sign in again.', 'err');
}

async function startApp() {
  if (!state.meta) state.meta = await api('/api/meta');
  $('#login').hidden = true;
  $('#shell').hidden = false;
  $('#userName').textContent = state.user.username;
  $('#userRole').textContent = state.user.role;
  $('#avatar').textContent = state.user.username.slice(0, 1).toUpperCase();
  if (!location.hash) location.hash = '#/dashboard';
  route();
  refreshPayBadge();
}

async function boot() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'), err = $('#loginError');
    err.hidden = true;
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await api('/api/login', {
        method: 'POST',
        body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value },
      });
      state.user = res.user; state.csrf = res.csrf;
      await startApp();
      toast('Signed in as ' + res.user.username);
    } catch (e2) {
      err.hidden = false; err.textContent = e2.message;
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  try {
    const me = await api('/api/me');
    state.user = me.user; state.csrf = me.csrf;
    await startApp();
  } catch (e) {
    showLogin();
  }

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    state.user = null; state.csrf = null;
    showLogin();
    toast('Signed out');
  });

  $('#refreshBtn').addEventListener('click', () => {
    if ($('#shell').hidden) return;
    route();
    toast('Refreshed');
  });
  $('#newProductBtn').addEventListener('click', () => openProductModal(null));

  $('#sideOpen').addEventListener('click', () => {
    $('#side').classList.add('open');
    $('#sideScrim').hidden = false;
  });
  const closeSide = () => {
    $('#side').classList.remove('open');
    $('#sideScrim').hidden = true;
  };
  $('#sideClose').addEventListener('click', closeSide);
  $('#sideScrim').addEventListener('click', closeSide);
  $$('.nav-item').forEach((a) => a.addEventListener('click', () => { if (window.innerWidth <= 900) closeSide(); }));

  window.addEventListener('hashchange', route);

  document.addEventListener('keydown', (e) => {
    if ($('#shell').hidden) return;
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      const box = $('#view').querySelector('input[type="search"]');
      if (box) { e.preventDefault(); box.focus(); }
    }
    if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openProductModal(null); }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) route();
  });
}

boot();
