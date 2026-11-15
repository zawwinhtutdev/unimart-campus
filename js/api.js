/* ============================================================================
   UniMart — storefront to admin bridge
   Progressive enhancement, loaded after app.js. When the page is served by
   server.py this connects the shop to the live SQLite catalogue:

     - products whose stock reached zero are marked "Sold out" and cannot be
       added to the cart;
     - "Place order" posts a real order, which decrements stock and appears in
       the admin console immediately.

   Served as a plain static file (python3 -m http.server) or opened over
   file://, every request fails quietly and the replica behaves exactly as it
   did before. Nothing here is required for the storefront to work.
   ========================================================================== */
(function () {
  'use strict';
  if (location.protocol === 'file:') return;

  var stock = new Map();
  var connected = false;
  var baseRender = window.renderCtl;

  /* sold-out styling lives here rather than in css/app.css so the replica's
     stylesheet stays byte-identical to the captured original */
  var style = document.createElement('style');
  style.textContent =
    '.item.sold-out .pic img{opacity:.4;filter:grayscale(1) contrast(.9)}' +
    '.item.sold-out .pic::after{content:"";position:absolute;inset:0;background:rgba(236,238,236,.28);pointer-events:none}' +
    /* centred on the product itself, so it never pushes into the gap between items */
    '.item.sold-out .soldout-tag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;' +
    'display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border-radius:999px;' +
    'background:#fff;border:1px solid #e2c4bf;color:#bf3727;font-weight:700;font-size:13px;letter-spacing:.01em;' +
    'box-shadow:0 3px 10px rgba(20,40,25,.16);white-space:nowrap;pointer-events:none}' +
    '.order-ref{margin:10px 0 0;font-size:13px;color:#5d6a61}' +
    '.order-ref b{color:#166b2d;font-variant-numeric:tabular-nums}';
  document.head.appendChild(style);

  function markSoldOut(id) {
    var items = document.querySelectorAll('.item[data-id="' + id + '"]');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.add('sold-out');
      var pic = el.querySelector('.pic');
      if (pic && !pic.querySelector('.soldout-tag')) {
        var tag = document.createElement('span');
        tag.className = 'soldout-tag';
        tag.textContent = 'Sold out';
        pic.appendChild(tag);
      }
      // clear the add/stepper slot: a sold-out product has no control there
      var ctl = el.querySelector('.ctl');
      if (ctl) ctl.innerHTML = '';
    }
  }

  /* keep the marker applied whenever the cart control re-renders */
  if (typeof baseRender === 'function') {
    window.renderCtl = function (id) {
      baseRender(id);
      if (stock.has(id) && stock.get(id) <= 0) markSoldOut(id);
    };
  }

  /* block adding a sold-out product (delegated listener in app.js runs later) */
  document.addEventListener('click', function (e) {
    if (!connected || !e.target.closest) return;
    var btn = e.target.closest('.item .ctl button[data-act="add"]');
    if (btn) {
      var item = btn.closest('.item');
      if (item && stock.has(item.dataset.id) && stock.get(item.dataset.id) <= 0) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  /* Ordering now lives on the full checkout page (checkout.html); this script
     only keeps shelf availability and prices in sync with the database. */

  /* connect on load; a 404 means static hosting, so stay inert */
  fetch('/api/public/catalog', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('no api'); return r.json(); })
    .then(function (data) {
      connected = true;
      var repriced = false;
      (data.items || []).forEach(function (p) {
        stock.set(p.id, p.stock);
        // the database is the source of truth for prices too, so an edit in the
        // admin console shows up on the shop on the next load
        if (PRODUCTS[p.id] && typeof p.price === 'number' && PRODUCTS[p.id].price !== p.price) {
          PRODUCTS[p.id].price = p.price;
          repriced = true;
        }
        if (p.sold_out) markSoldOut(p.id);
      });
      if (repriced && typeof refreshCurrency === 'function') refreshCurrency();
    })
    .catch(function () {
      /* Static hosting has no API. Load the build-time snapshot so the shop can
         still mark sold-out products instead of pretending everything is in stock. */
      var s = document.createElement('script');
      s.src = 'js/stock-snapshot.js';
      s.onload = function () { applySnapshot(); };
      document.head.appendChild(s);
    });

  function applySnapshot() {
    var snap = window.UNIMART_SNAPSHOT;
    if (!snap || !snap.items) return;
    var repriced = false;
    snap.items.forEach(function (p) {
      stock.set(p.id, p.stock);
      if (PRODUCTS[p.id] && typeof p.price === 'number' && PRODUCTS[p.id].price !== p.price) {
        PRODUCTS[p.id].price = p.price;
        repriced = true;
      }
      if (p.sold_out) markSoldOut(p.id);
    });
    if (repriced && typeof refreshCurrency === 'function') refreshCurrency();
  }
})();
