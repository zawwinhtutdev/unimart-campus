'use strict';
/* ============================================================================
   UniMart — shopper accounts
   Sign up, sign in, and see your own order history. Talks to the customer auth
   endpoints in server.py (/api/auth/*). Loaded after app.js so it can reuse the
   storefront's money() formatter. Inert when the page is opened from file://.
   ========================================================================== */
(function () {
  if (location.protocol === 'file:') return;

  var state = { customer: null, csrf: null, orders: null, offline: false, error: '', busy: false };
  var overlay = null, lastFocus = null;

  /* ---------- styles ---------------------------------------------------- */
  var style = document.createElement('style');
  style.textContent =
    '.acct-overlay{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:18px;' +
    'background:rgba(17,26,20,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}' +
    '.acct-modal{width:min(520px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;background:#fff;' +
    'border-radius:20px;box-shadow:0 24px 60px rgba(20,40,25,.28);overflow:hidden;font-family:var(--body)}' +
    '.acct-head{display:flex;align-items:center;padding:18px 20px 10px}' +
    '.acct-head h2{margin:0;font-family:var(--display);font-size:20px;font-weight:800;letter-spacing:-.02em}' +
    '.acct-close{margin-left:auto;width:34px;height:34px;border:0;border-radius:9px;background:#f2f5f2;color:#5d6a61;' +
    'font-size:20px;line-height:1;cursor:pointer}' +
    '.acct-body{padding:0 20px 20px;overflow-y:auto}' +
    '.acct-tabs{display:flex;gap:5px;background:#f2f5f2;border-radius:10px;padding:4px;margin-bottom:14px}' +
    '.acct-tab{flex:1;height:34px;border:0;border-radius:8px;background:transparent;font:inherit;font-weight:700;' +
    'font-size:13.5px;color:#5d6a61;cursor:pointer}' +
    '.acct-tab[aria-selected="true"]{background:#fff;color:#141a16;box-shadow:0 1px 2px rgba(20,40,25,.14)}' +
    '.acct-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}' +
    '.acct-field span{font-size:12.5px;font-weight:600;color:#5d6a61}' +
    '.acct-field input{height:42px;border:1px solid #d2d8d3;border-radius:10px;padding:0 12px;font:inherit;background:#fff}' +
    '.acct-field input:focus{outline:none;border-color:#1f8a3b;box-shadow:0 0 0 3px rgba(31,138,59,.15)}' +
    '.acct-primary{width:100%;height:44px;border:0;border-radius:10px;background:#1f8a3b;color:#fff;' +
    'font:inherit;font-weight:700;font-size:15px;cursor:pointer;margin-top:2px}' +
    '.acct-primary:hover{background:#166b2d}' +
    '.acct-primary:disabled{opacity:.6;cursor:default}' +
    '.acct-error{margin:0 0 12px;padding:9px 11px;border-radius:9px;background:#fdeeeb;border:1px solid #f5d3cc;' +
    'color:#bf3727;font-size:13px}' +
    '.acct-note{margin:12px 0 0;font-size:12.5px;color:#8a958d;line-height:1.45}' +
    '.acct-who{display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid #e3e7e3;margin-bottom:14px}' +
    '.acct-avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#e9f5ed;' +
    'border:1px solid #cfe6d7;color:#166b2d;font-weight:800;font-size:16px;flex:none}' +
    '.acct-who b{display:block;font-size:15px}' +
    '.acct-who small{color:#5d6a61;font-size:12.5px}' +
    '.acct-signout{margin-left:auto;height:32px;padding:0 11px;border-radius:8px;border:1px solid #d2d8d3;' +
    'background:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
    '.acct-h3{margin:0 0 9px;font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:#8a958d}' +
    '.acct-orders{display:flex;flex-direction:column;gap:10px}' +
    '.acct-order{border:1px solid #e3e7e3;border-radius:12px;padding:11px 12px;background:#fff}' +
    '.acct-order-top{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.acct-ref{font-weight:700;font-size:13.5px;font-variant-numeric:tabular-nums}' +
    '.acct-status{font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:capitalize;' +
    'background:#f2f5f2;color:#5d6a61;border:1px solid #e3e7e3}' +
    '.acct-status.acct-paid{background:#e6f4f1;color:#0f6b5c;border-color:#c9e7e1}' +
    '.acct-status.acct-packing{background:#eef0fb;color:#4348a8;border-color:#dadff5}' +
    '.acct-status.acct-shipped{background:#e8f1fb;color:#1c5fa8;border-color:#cfe1f6}' +
    '.acct-status.acct-delivered{background:#e9f5ed;color:#166b2d;border-color:#cfe6d7}' +
    '.acct-status.acct-cancelled{background:#fdeeeb;color:#bf3727;border-color:#f5d3cc}' +
    '.acct-meta{font-size:12.3px;color:#5d6a61;margin-top:5px}' +
    '.acct-lines{font-size:12.8px;color:#3c453e;margin-top:5px;line-height:1.45}' +
    '.acct-total{display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;' +
    'padding-top:8px;border-top:1px dashed #e3e7e3;font-size:13px}' +
    '.acct-total b{font-size:14.5px}' +
    '@media (max-width:600px){.acct-overlay{padding:0;align-items:end}.acct-modal{width:100%;max-height:90vh;' +
    'border-radius:20px 20px 0 0}}' +
    '.acct-initials{position:absolute;bottom:-2px;right:-2px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;' +
    'background:#1f8a3b;color:#fff;font-size:10.5px;font-weight:800;display:grid;place-items:center;border:2px solid #fff}' +
    '.acct-only-mobile{display:none}';
  document.head.appendChild(style);

  /* ---------- helpers --------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    try { return money(n); } catch (e) { return '฿' + Math.round(n); }
  }
  function when(s) {
    var d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return s || '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.method && opts.method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || 'Something went wrong');
          e.status = r.status;
          throw e;
        }
        return j;
      });
    });
  }

  /* ---------- icon state ------------------------------------------------ */
  function paintIcon() {
    var btn = document.getElementById('acctBtn');
    if (!btn) return;
    var badge = btn.querySelector('.acct-initials');
    if (state.customer) {
      btn.classList.add('acct-on');
      btn.setAttribute('aria-label', 'Your account — signed in as ' + state.customer.name);
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'acct-initials';
        btn.appendChild(badge);
      }
      badge.textContent = state.customer.name.trim().charAt(0).toUpperCase();
    } else {
      btn.classList.remove('acct-on');
      btn.setAttribute('aria-label', 'Your account — sign in');
      if (badge) badge.remove();
    }
  }

  /* ---------- views ----------------------------------------------------- */
  function signedOutView() {
    return '<div class="acct-tabs" role="tablist">' +
        '<button class="acct-tab" role="tab" data-mode="signin" aria-selected="true">Sign in</button>' +
        '<button class="acct-tab" role="tab" data-mode="signup" aria-selected="false">Create account</button>' +
      '</div>' +
      '<form id="acctForm" novalidate>' +
        '<label class="acct-field" id="acctNameField" hidden><span>Name</span>' +
          '<input name="name" autocomplete="name" placeholder="Your name"></label>' +
        '<label class="acct-field"><span>Email</span>' +
          '<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>' +
        '<label class="acct-field"><span>Password</span>' +
          '<input name="password" type="password" autocomplete="current-password" required minlength="8" ' +
          'placeholder="At least 8 characters"></label>' +
        '<p class="acct-error" id="acctError" hidden></p>' +
        '<button class="acct-primary" type="submit">Sign in</button>' +
      '</form>' +
      '<p class="acct-note">New here? Create an account to check out faster and keep your order history. ' +
      'Accounts are stored in this project&#39;s own database.</p>';
  }

  function signedInView() {
    var c = state.customer;
    var orders = state.orders;
    var list;
    if (orders === null) {
      list = '<p class="acct-note">Loading your orders…</p>';
    } else if (!orders.length) {
      list = '<p class="acct-note">No orders yet. Add something to your cart and check out — it will appear here.</p>';
    } else {
      list = '<div class="acct-orders">' + orders.map(function (o) {
        var lines = (o.items || []).map(function (it) { return it.qty + '× ' + it.name; }).join(' · ');
        return '<article class="acct-order">' +
          '<div class="acct-order-top"><span class="acct-ref">' + esc(o.ref) + '</span>' +
            '<span class="acct-status acct-' + esc(o.status) + '">' + esc(o.status) + '</span></div>' +
          '<div class="acct-meta">' + esc(when(o.created_at)) + ' · ' +
            (o.fulfilment === 'walk-in' ? 'Walk-in' : 'Delivery') + '</div>' +
          (lines ? '<div class="acct-lines">' + esc(lines) + '</div>' : '') +
          '<div class="acct-total"><span>Total</span><b>' + fmt(o.total) + '</b></div>' +
        '</article>';
      }).join('') + '</div>';
    }
    return '<div class="acct-who"><span class="acct-avatar">' +
        esc(c.name.trim().charAt(0).toUpperCase()) + '</span><div><b>' + esc(c.name) + '</b>' +
        '<small>' + esc(c.email) + '</small></div>' +
        '<button class="acct-signout" type="button" data-signout>Sign out</button></div>' +
      '<h3 class="acct-h3">Your orders</h3>' + list;
  }

  function render() {
    var body = document.getElementById('acctBody');
    if (!body) return;
    if (state.offline) {
      body.innerHTML = '<p class="acct-note">Sign-in needs the app server. Start it with ' +
        '<b>python3 server.py</b> and reload this page.</p>';
      return;
    }
    body.innerHTML = state.customer ? signedInView() : signedOutView();
    var err = document.getElementById('acctError');
    if (err && state.error) { err.hidden = false; err.textContent = state.error; }

    if (!state.customer) {
      var form = document.getElementById('acctForm');
      var mode = 'signin';
      var nameField = document.getElementById('acctNameField');
      var submit = form.querySelector('.acct-primary');
      var pass = form.password;
      Array.prototype.forEach.call(document.querySelectorAll('.acct-tab'), function (tab) {
        tab.addEventListener('click', function () {
          mode = tab.getAttribute('data-mode');
          Array.prototype.forEach.call(document.querySelectorAll('.acct-tab'), function (t) {
            t.setAttribute('aria-selected', String(t === tab));
          });
          nameField.hidden = mode !== 'signup';
          submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
          pass.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
          state.error = '';
          if (err) err.hidden = true;
        });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (state.busy) return;
        var payload = { email: form.email.value.trim(), password: form.password.value };
        if (mode === 'signup') payload.name = form.name.value.trim();
        state.busy = true;
        submit.disabled = true;
        submit.textContent = 'Please wait…';
        api('/api/auth/' + (mode === 'signup' ? 'signup' : 'login'), { method: 'POST', body: payload })
          .then(function (d) {
            state.customer = d.customer; state.csrf = d.csrf; state.orders = null; state.error = '';
            state.busy = false;
            paintIcon();
            loadOrders();
          })
          .catch(function (e2) {
            state.busy = false;
            state.error = e2.message;
            submit.disabled = false;
            submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
            if (err) { err.hidden = false; err.textContent = e2.message; }
          });
      });
    } else {
      var out = body.querySelector('[data-signout]');
      if (out) out.addEventListener('click', signOut);
    }
  }

  function loadOrders() {
    if (!state.customer) return;
    state.orders = null;
    render();
    api('/api/auth/orders').then(function (d) {
      state.orders = d.items || [];
      render();
    }).catch(function (e) {
      if (e.status === 401) { state.customer = null; state.csrf = null; paintIcon(); }
      state.orders = [];
      render();
    });
  }

  function signOut() {
    api('/api/auth/logout', { method: 'POST' }).then(function () {
      state.customer = null; state.csrf = null; state.orders = null;
      paintIcon();
      render();
    }).catch(function (e) {
      state.error = e.message;
      render();
    });
  }

  /* ---------- open / close ---------------------------------------------- */
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'acct-overlay';
    overlay.innerHTML = '<div class="acct-modal" role="dialog" aria-modal="true" aria-label="Your account">' +
      '<div class="acct-head"><h2>Your account</h2>' +
      '<button class="acct-close" type="button" data-acct-close aria-label="Close">×</button></div>' +
      '<div class="acct-body" id="acctBody"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('[data-acct-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    render();
    if (state.customer) loadOrders();
    var focusable = overlay.querySelector('input, button');
    if (focusable) focusable.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- wiring ---------------------------------------------------- */
  function wire() {
    var btn = document.getElementById('acctBtn');
    if (btn) btn.addEventListener('click', open);
    Array.prototype.forEach.call(document.querySelectorAll('[data-go="account"]'), function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        open();
      });
    });
    if (location.hash === '#account') open();
  }

  api('/api/auth/me').then(function (d) {
    state.customer = d.customer;
    state.csrf = d.csrf;
    paintIcon();
  }).catch(function (e) {
    if (e.status === 401) { paintIcon(); return; }
    state.offline = true;            // API not reachable: static hosting
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
