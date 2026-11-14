'use strict';
/* ============================================================================
   UniMart — checkout page
   Full-page checkout: delivery address, payment method (QR / bank transfer /
   PromptPay), then confirmation. Reads the cart from localStorage (the same key
   the shop writes), posts to /api/public/orders, and clears the cart on success.
   ========================================================================== */
(function () {
  var RATE = 35.5;              // baht per US dollar (display only)
  var FREE_AT = 500;            // free delivery from this subtotal
  var FEE = 39;                 // delivery fee below it

  /* Demo payment details. Replace these with the real shop's details. */
  var SHOP = {
    promptpayId: '0812345678',
    promptpayName: 'UniMart Mini Store',
    bank: 'Kasikorn Bank (KBank)',
    bankName: 'UniMart Mini Store',
    bankAccount: '123-4-56789-0'
  };

  var state = { currency: 'THB', items: [], subtotal: 0, fee: 0, total: 0, method: 'qr', result: null };

  /* ---------- storage helpers ------------------------------------------- */
  function ls(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  function lsJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(base) {
    if (state.currency === 'USD') return '$' + (base / RATE).toFixed(2);
    return '฿' + Math.round(base);
  }

  /* ---------- QR (real, scannable PromptPay payload) -------------------- */
  function crc16(text) {
    var crc = 0xFFFF;
    for (var i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }
  function tlv(tag, value) {
    return tag + ('00' + String(value).length).slice(-2) + value;
  }
  function promptPayPayload(amountThb) {
    var id = SHOP.promptpayId.replace(/\D/g, '');
    var target = '0066' + id.slice(1);              // 0066 + local number without the 0
    var merchant = tlv('00', 'A000000677010111') + tlv('01', target);
    var payload = tlv('00', '01') + tlv('01', '12') + tlv('29', merchant) +
                  tlv('53', '764') + tlv('54', Number(amountThb).toFixed(2)) +
                  tlv('58', 'TH') + '6304';
    return payload + crc16(payload);
  }
  function qrSvg(amountThb) {
    if (typeof qrcode !== 'function') return '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(promptPayPayload(amountThb));
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 1 });
    } catch (e) {
      return '';
    }
  }

  /* ---------- cart ------------------------------------------------------ */
  function loadCart() {
    var cart = lsJson('fc-cart', {});
    state.items = Object.keys(cart).filter(function (id) {
      return cart[id] > 0 && typeof PRODUCTS !== 'undefined' && PRODUCTS[id];
    }).map(function (id) {
      var p = PRODUCTS[id];
      return { id: id, name: p.name, price: p.price, qty: cart[id], image: 'assets/products/' + id + '.webp' };
    });
    var sub = 0;
    state.items.forEach(function (it) { sub += it.price * it.qty; });
    state.subtotal = sub;
    state.fee = sub > 0 && sub < FREE_AT ? FEE : 0;
    state.total = sub + state.fee;
  }

  /* ---------- form value preservation ----------------------------------- */
  var FIELDS = ['name', 'phone', 'line1', 'line2', 'city', 'postcode'];
  function readForm() {
    var f = document.getElementById('ckForm');
    if (!f) return null;
    var out = {};
    FIELDS.forEach(function (k) { out[k] = f.elements[k] ? f.elements[k].value : ''; });
    return out;
  }
  function savedAddress() {
    var a = lsJson('fc-address', {});
    var out = {};
    FIELDS.forEach(function (k) { out[k] = a[k] || ''; });
    return out;
  }

  /* ---------- views ----------------------------------------------------- */
  function paymentBody(method) {
    var amount = fmt(state.total);
    var thb = '฿' + Math.round(state.total);
    if (method === 'qr') {
      return '<div class="ck-qr"><div class="ck-qr-box">' + qrSvg(state.total) + '</div>' +
        '<div class="ck-qr-text"><b>' + esc(thb) + '</b>' +
        '<small>Scan with any Thai banking app to pay this order.</small>' +
        '<p class="ck-demo">Demo QR generated from a sample PromptPay ID — do not send money.</p></div></div>';
    }
    if (method === 'bank') {
      return '<dl class="ck-dl">' +
        '<dt>Bank</dt><dd>' + esc(SHOP.bank) + '</dd>' +
        '<dt>Account name</dt><dd>' + esc(SHOP.bankName) + '</dd>' +
        '<dt>Account number</dt><dd class="ck-mono">' + esc(SHOP.bankAccount) + '</dd>' +
        '<dt>Amount</dt><dd class="ck-mono">' + esc(thb) + '</dd>' +
        '<dt>Reference</dt><dd>Your phone number</dd></dl>' +
        '<p class="ck-demo">Demo account details — no real transfer is expected.</p>';
    }
    return '<dl class="ck-dl">' +
      '<dt>PromptPay ID</dt><dd class="ck-mono">' + esc(SHOP.promptpayId) + ' <button class="ck-copy" type="button" data-copy="' + esc(SHOP.promptpayId) + '">Copy</button></dd>' +
      '<dt>Name</dt><dd>' + esc(SHOP.promptpayName) + '</dd>' +
      '<dt>Amount</dt><dd class="ck-mono">' + esc(thb) + '</dd></dl>' +
      '<p class="ck-demo">Demo PromptPay ID — no real transfer is expected.</p>';
  }

  function paymentOptions() {
    var opts = [
      { id: 'qr', title: 'QR code', sub: 'Scan the shop QR with your banking app' },
      { id: 'bank', title: 'Bank transfer', sub: 'Transfer to the shop account' },
      { id: 'promptpay', title: 'PromptPay', sub: 'Pay by PromptPay ID or phone number' }
    ];
    return opts.map(function (o) {
      var on = state.method === o.id;
      return '<div class="ck-pay-item' + (on ? ' on' : '') + '" data-method="' + o.id + '">' +
        '<label class="ck-pay-head"><input type="radio" name="payment" value="' + o.id + '"' + (on ? ' checked' : '') + '>' +
        '<span><b>' + o.title + '</b><small>' + o.sub + '</small></span></label>' +
        '<div class="ck-pay-body">' + (on ? paymentBody(o.id) : '') + '</div></div>';
    }).join('');
  }

  function summaryHtml() {
    var rows = state.items.map(function (it) {
      return '<div class="ck-item"><img src="' + it.image + '" alt="" loading="lazy">' +
        '<div class="nm"><b>' + esc(it.name) + '</b><span>' + fmt(it.price) + ' × ' + it.qty + '</span></div>' +
        '<span class="amt">' + fmt(it.price * it.qty) + '</span></div>';
    }).join('');
    var pct = Math.max(0, Math.min(100, state.subtotal / FREE_AT * 100));
    var msg = state.subtotal >= FREE_AT
      ? "You've unlocked free delivery."
      : 'Add ' + fmt(FREE_AT - state.subtotal) + ' more for free delivery.';
    return '<div class="ck-card ck-card-body ck-summary"><h2>Order summary</h2>' +
      '<div class="ck-items">' + rows + '</div>' +
      '<div class="ck-meter"><i style="width:' + pct + '%"></i></div>' +
      '<p class="ck-meter-msg">' + esc(msg) + '</p>' +
      '<div class="ck-totals">' +
      '<div><span>Subtotal</span><span class="ck-mono">' + fmt(state.subtotal) + '</span></div>' +
      '<div><span>Delivery</span><span class="' + (state.fee ? 'ck-mono' : 'free') + '">' + (state.fee ? fmt(state.fee) : 'Free') + '</span></div>' +
      '<div class="grand"><span>Total</span><span class="ck-mono">' + fmt(state.total) + '</span></div></div>' +
      '<p class="ck-error" id="ckError" hidden></p>' +
      '<button class="ck-primary" id="ckPlace" type="button">Place order · ' + fmt(state.total) + '</button>' +
      '<p class="ck-note">Payment is completed with the details you pick above. This is a demo shop — no money is taken.</p></div>';
  }

  function checkoutView() {
    var a = savedAddress();
    function field(name, label, opts) {
      opts = opts || {};
      return '<label class="ck-field' + (opts.wide ? ' wide' : '') + '"><span>' + label + '</span>' +
        '<input name="' + name + '" value="' + esc(a[name] || '') + '"' +
        (opts.wide ? '' : ' ') + (opts.attrs || '') + '></label>';
    }
    return '<div class="ck-grid">' +
      '<div class="ck-col">' +
        '<h1 class="ck-h1">Checkout</h1>' +
        '<form id="ckForm" novalidate>' +
          '<div class="ck-card"><div class="ck-card-head"><h2>Delivery address</h2>' +
            '<p class="ck-sub">Where should the order go?</p></div>' +
            '<div class="ck-card-body"><div class="ck-fields">' +
              '<label class="ck-field wide"><span>Full name</span><input name="name" required minlength="2" autocomplete="name" placeholder="Your name"></label>' +
              '<label class="ck-field"><span>Phone</span><input name="phone" required pattern="[0-9+ ]{9,15}" inputmode="tel" autocomplete="tel" placeholder="081 234 5678"></label>' +
              '<label class="ck-field"><span>Postcode</span><input name="postcode" required pattern="[0-9]{5}" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="57000"></label>' +
              '<label class="ck-field wide"><span>Address</span><input name="line1" required minlength="5" autocomplete="address-line1" placeholder="House no., street, tambon"></label>' +
              '<label class="ck-field wide"><span>District / apartment (optional)</span><input name="line2" autocomplete="address-line2" placeholder="Apartment, building, floor"></label>' +
              '<label class="ck-field wide"><span>City / province</span><input name="city" required minlength="2" autocomplete="address-level1" placeholder="Mueang Chiang Rai"></label>' +
            '</div></div></div>' +
          '<div class="ck-card"><div class="ck-card-head"><h2>Payment method</h2>' +
            '<p class="ck-sub">Pay now with any of these.</p></div>' +
            '<div class="ck-card-body"><div class="ck-pay" id="ckPay">' + paymentOptions() + '</div></div></div>' +
        '</form>' +
      '</div>' +
      '<aside class="ck-side">' + summaryHtml() + '</aside>' +
    '</div>';
  }

  function emptyView() {
    return '<div class="ck-empty"><b>Your cart is empty</b>' +
      '<p class="ck-sub">Add a few products and come back to check out.</p>' +
      '<p><a href="/">← Back to the shop</a></p></div>';
  }

  function successView(res, address) {
    var method = res.payment || state.method;
    var labels = { qr: 'QR code', bank: 'Bank transfer', promptpay: 'PromptPay' };
    var addressBlock = '<dl class="ck-dl" style="margin-top:14px">' +
      '<dt>Deliver to</dt><dd>' + esc(address.name || res.ship_name) + '</dd>' +
      '<dt>Phone</dt><dd class="ck-mono">' + esc(address.phone || res.ship_phone) + '</dd>' +
      '<dt>Address</dt><dd style="font-weight:500">' + esc(res.ship_address || '') + '</dd></dl>';
    return '<div class="ck-done"><div class="tick">✓</div>' +
      '<h1>Order placed</h1>' +
      '<p class="ref">Order <b>' + esc(res.ref) + '</b> · ' + fmt(res.total) + ' · paid by ' + esc(labels[method] || method) + '</p>' +
      '<div class="ck-card ck-done-card"><div class="ck-card-body">' +
        '<h2 style="margin-bottom:4px">' + esc(labels[method] || 'Payment') + '</h2>' +
        '<p class="ck-sub" style="margin:0 0 10px">Use these details if you have not paid yet.</p>' +
        paymentBody(method) + addressBlock +
      '</div></div>' +
      (res.access_token ? '<div class="ck-card ck-done-card"><div class="ck-card-body">' +
        '<h2 style="margin-bottom:4px">Upload your payment slip</h2>' +
        '<p class="ck-sub" style="margin:0 0 12px">Send a screenshot of your transfer so the shop can confirm the payment.</p>' +
        '<div id="ckSlipBox" data-order="' + esc(String(res.id || '')) + '" data-token="' + esc(res.access_token) + '">' +
          (res.payment_status === 'submitted'
            ? '<p class="ck-slip-ok">Slip received — the shop will confirm your payment shortly.</p>'
            : '<input id="ckSlipFile" class="ck-slip-input" type="file" accept="image/png,image/jpeg,image/webp">' +
              '<div id="ckSlipPreview" class="ck-slip-preview" hidden></div>' +
              '<button class="ck-primary" id="ckSlipSend" type="button" disabled style="max-width:260px">Send slip</button>') +
          '<p class="ck-slip-msg" id="ckSlipMsg"></p>' +
        '</div></div></div>' : '') +
      '<div class="ck-done-actions">' +
        '<a class="ck-btn primary" href="/">Keep shopping</a>' +
        '<a class="ck-btn" href="/#account">View your orders</a>' +
      '</div>' +
      '<p class="ck-note">This is a demo shop — no money was taken and nothing will ship.</p></div>';
  }

  /* ---------- rendering -------------------------------------------------- */
  function syncCurrencyButton() {
    var btn = document.getElementById('ckCurrency');
    if (!btn) return;
    btn.querySelector('.ck-sym').textContent = state.currency === 'USD' ? '$' : '฿';
    btn.querySelector('.ck-code').textContent = state.currency;
    btn.title = 'Prices in ' + state.currency;
  }

  function bind() {
    var pay = document.getElementById('ckPay');
    if (pay) {
      pay.addEventListener('change', function (e) {
        if (e.target.name !== 'payment') return;
        state.method = e.target.value;
        Array.prototype.forEach.call(pay.querySelectorAll('.ck-pay-item'), function (el) {
          var on = el.getAttribute('data-method') === state.method;
          el.classList.toggle('on', on);
          var body = el.querySelector('.ck-pay-body');
          body.innerHTML = on ? paymentBody(state.method) : '';
        });
      });
      pay.addEventListener('click', function (e) {
        var copy = e.target.closest('[data-copy]');
        if (!copy) return;
        var text = copy.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { copy.textContent = 'Copied'; });
      });
    }
    bindSlip();
    var place = document.getElementById('ckPlace');
    if (place) place.addEventListener('click', placeOrder);
    var form = document.getElementById('ckForm');
    if (form) {
      form.addEventListener('submit', function (e) { e.preventDefault(); placeOrder(); });
      form.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); placeOrder(); }
      });
      // restore anything the user had typed before a currency re-render
      if (state.typed) FIELDS.forEach(function (k) { if (form.elements[k] && state.typed[k] != null) form.elements[k].value = state.typed[k]; });
    }
  }

  function render() {
    var main = document.getElementById('ckMain');
    state.typed = readForm() || state.typed || null;
    if (state.result) main.innerHTML = successView(state.result.res, state.result.address);
    else main.innerHTML = checkoutView();
    bind();
    syncCurrencyButton();
    if (state.result) return;
    var typed = state.typed;
    var form = document.getElementById('ckForm');
    if (form && typed) FIELDS.forEach(function (k) { if (form.elements[k] && typed[k] != null) form.elements[k].value = typed[k]; });
  }

  /* ---------- payment slip upload --------------------------------------- */
  function bindSlip() {
    var file = document.getElementById('ckSlipFile');
    if (!file) return;
    var box = document.getElementById('ckSlipBox');
    var send = document.getElementById('ckSlipSend');
    var preview = document.getElementById('ckSlipPreview');
    var msg = document.getElementById('ckSlipMsg');
    var dataUrl = null;

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      msg.className = 'ck-slip-msg';
      if (!f) { send.disabled = true; preview.hidden = true; return; }
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
        msg.className = 'ck-slip-msg err';
        msg.textContent = 'Choose a PNG, JPEG or WebP image.';
        return;
      }
      if (f.size > 5 * 1024 * 1024) {
        msg.className = 'ck-slip-msg err';
        msg.textContent = 'That image is larger than 5 MB.';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        dataUrl = reader.result;
        preview.hidden = false;
        preview.innerHTML = '<img alt="Payment slip preview" src="' + dataUrl + '">';
        send.disabled = false;
        msg.textContent = '';
      };
      reader.readAsDataURL(f);
    });

    send.addEventListener('click', function () {
      if (!dataUrl) return;
      send.disabled = true;
      send.textContent = 'Sending…';
      fetch('/api/public/orders/' + encodeURIComponent(box.getAttribute('data-order')) + '/proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: box.getAttribute('data-token'), image: dataUrl })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { throw new Error(j.error || 'Could not send the slip'); }
            return j;
          });
        })
        .then(function () {
          box.innerHTML = '<p class="ck-slip-ok">Slip received — the shop will confirm your payment shortly.</p>';
        })
        .catch(function (e) {
          send.disabled = false;
          send.textContent = 'Send slip';
          msg.className = 'ck-slip-msg err';
          msg.textContent = e.message;
        });
    });
  }

  /* ---------- placing the order ----------------------------------------- */
  function placeOrder() {
    var form = document.getElementById('ckForm');
    if (!form) return;
    if (!form.reportValidity()) return;
    var err = document.getElementById('ckError');
    if (err) err.hidden = true;
    var fd = new FormData(form);
    var address = {};
    FIELDS.forEach(function (k) { address[k] = (fd.get(k) || '').toString().trim(); });
    var items = {};
    state.items.forEach(function (it) { items[it.id] = it.qty; });
    var btn = document.getElementById('ckPlace');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }
    fetch('/api/public/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ items: items, address: address, payment: state.method })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'Could not place the order'); e.status = r.status; throw e; }
          return j;
        });
      })
      .then(function (res) {
        lsSet('fc-address', JSON.stringify(address));
        try { localStorage.removeItem('fc-cart'); } catch (e) { /* ignore */ }
        state.result = { res: res, address: address };
        render();
        window.scrollTo(0, 0);
      })
      .catch(function (e) {
        // A static host answers /api/* with 404 (no route), or the request fails
        // outright; both mean "preview", not a real validation error.
        var offline = e && (e.name === 'TypeError' ||
          /failed to fetch|networkerror/i.test(e.message || '') ||
          e.status === 404 || e.status === 405 || e.status === 501);
        if (err) {
          err.hidden = false;
          err.textContent = offline
            ? 'This is a static preview, so orders cannot be placed. Run the app locally (python3 server.py) for the full checkout.'
            : e.message;
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Place order · ' + fmt(state.total); }
      });
  }

  /* ---------- boot ------------------------------------------------------- */
  function boot() {
    state.currency = ls('fc-currency', 'THB') === 'USD' ? 'USD' : 'THB';
    loadCart();
    if (!state.items.length) {
      document.getElementById('ckMain').innerHTML = emptyView();
      syncCurrencyButton();
      return;
    }
    render();
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.customer) return;
        var form = document.getElementById('ckForm');
        if (form && form.elements.name && !form.elements.name.value) form.elements.name.value = d.customer.name;
      })
      .catch(function () { /* guest checkout */ });

    var toggle = document.getElementById('ckCurrency');
    if (toggle) toggle.addEventListener('click', function () {
      state.currency = state.currency === 'USD' ? 'THB' : 'USD';
      lsSet('fc-currency', state.currency);
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
