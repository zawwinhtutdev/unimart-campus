/* ============================================================================
   UniMart replica — application shell
   One route ("/"), no router, no framework, no network calls. State lives in
   two keys of localStorage: fc-cart and fc-favs.
   ========================================================================== */
'use strict';

/* --- helpers ------------------------------------------------------------- */
const $ = s => document.querySelector(s);
/* --- currency -------------------------------------------------------------
   The catalogue is priced in USD (the base currency stored in the database).
   THB is a display currency at a fixed demo rate, so switching never rewrites
   data - it only changes how amounts are formatted. */
/* Catalogue prices are Thai baht, the base currency for the whole app.
   Dollars are derived for display only, at a fixed demo rate. */
const RATE = 35.5;                       // baht per US dollar
const FX = {
  /* rate multiplies a base (baht) price to give the displayed amount;
     decimals: 0 shows whole baht, 2 keeps dollars and cents */
  THB: { rate: 1, symbol: "฿", code: "THB", decimals: 0 },
  USD: { rate: 1 / RATE, symbol: "$", code: "USD", decimals: 2 },
};
const FX_DEFAULT = "THB";
let currency = FX_DEFAULT;
try { const saved = localStorage.getItem("fc-currency"); if (saved && FX[saved]) currency = saved; } catch {}
/* An amount enters the display currency exactly once, rounded to that currency's
   precision (whole baht, or cents). Cart maths runs on those converted values, so
   the prices on the shelf, the lines in the cart and the total all agree. */
const toDisplay = n => {
  const c = FX[currency], v = n * c.rate;
  return c.decimals ? Number(v.toFixed(c.decimals)) : Math.floor(v + 1e-9);
};
const amount = v => (FX[currency].decimals ? v.toFixed(FX[currency].decimals) : String(Math.round(v)));
const moneyD = v => FX[currency].symbol + amount(v);
const money = n => moneyD(toDisplay(n));
const priceTag = n => {
  const c = FX[currency];
  const shown = amount(toDisplay(n));
  if (!c.decimals) return `<span class="tag" aria-label="${money(n)}"><sup>${c.symbol}</sup>${shown}</span>`;
  const [whole, cents] = shown.split(".");
  return `<span class="tag" aria-label="${money(n)}"><sup>${c.symbol}</sup>${whole}<sup>${cents}</sup></span>`;
};

/* The currency control's styles are injected rather than added to css/app.css,
   so the captured storefront stylesheet stays byte-identical. */
document.head.insertAdjacentHTML("beforeend", `<style>
.currency-btn { display: flex; align-items: center; gap: 7px; height: 46px; padding: 0 12px; border: 1.5px solid #cfd5d0; border-radius: 999px; background: #fff; color: var(--ink); font-weight: 800; font-size: 13.5px; letter-spacing: .02em; flex-shrink: 0; transition: background .2s, border-color .2s, color .2s; }
.currency-btn:hover { border-color: var(--brand); color: var(--brand-dark); }
.currency-btn .cur-sym { font-size: 17px; color: var(--brand-dark); }
.currency-btn .swap { width: 15px; height: 15px; color: var(--muted); opacity: .65; }
@media (max-width: 640px) { .currency-btn { height: 38px; padding: 0 9px; gap: 5px; } .currency-btn .cur-sym { font-size: 15px; } .currency-btn .cur-code, .currency-btn .swap { display: none; } .top-inner { gap: 10px; } }
/* ultra-narrow phones: the header has no slack, so the favourites drawer button
   steps aside (items keep their own heart buttons, and the pattern matches the
   original's decision to drop the bell at 380px) */
@media (max-width: 344px) { #favBtn { display: none; } .top-inner { gap: 8px; } }
</style>`);

/* The floating basket peeking up from the bottom of the shop. Set SHOW_BASKET to
   true to bring it back: the header total pill is the cart entry point either way,
   and the fly-into-basket motion is skipped while the basket is hidden. */
const SHOW_BASKET = false;
if (!SHOW_BASKET) {
  document.head.insertAdjacentHTML("beforeend", `<style>
    .dock { display: none !important; }
    .ground { display: none !important; }
    main { padding-bottom: 56px !important; }
    @media (max-width: 600px) { main { padding-bottom: 36px !important; } }
  </style>`);
}

function paintCurrency() {
  const btn = $("#currencyBtn"); if (!btn) return;
  btn.querySelector(".cur-code").textContent = FX[currency].code;
  btn.querySelector(".cur-sym").textContent = FX[currency].symbol;
  const other = currency === "THB" ? "USD" : "THB";
  btn.setAttribute("aria-label", `Prices in ${FX[currency].code}. Switch to ${other}`);
  btn.title = `Prices shown in ${FX[currency].code} — click for ${other}`;
}
function refreshCurrency() {
  document.querySelectorAll(".item[data-id]").forEach(el => {
    const p = PRODUCTS[el.dataset.id], zone = el.querySelector(".tag-zone");
    if (p && zone) zone.innerHTML = priceTag(p.price);
  });
  document.querySelectorAll("[data-money]").forEach(el => { el.textContent = money(Number(el.dataset.money)); });
  renderTotals();
  renderCart();
  paintCurrency();
}
function toggleCurrency() {
  currency = currency === "THB" ? "USD" : "THB";
  try { localStorage.setItem("fc-currency", currency); } catch {}
  refreshCurrency();
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* --- state --------------------------------------------------------------- */
let cart = store.get("fc-cart", {});
let favs = new Set(store.get("fc-favs", []));
let favOnly = false;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let arriveTimer = null, outTimer = null;

/* --- shelf slot sizing ---------------------------------------------------
   Sizes the products so every shelf ends on a half-visible product, which
   hints that it scrolls. Recomputed on every resize. */
function fitSlots() {
  const narrow = innerWidth <= 600;
  const base = narrow ? 132 : 200, gap = narrow ? 20 : 30, ratio = narrow ? .85 : .8;
  const pad = narrow ? 18 : 36;
  const avail = document.documentElement.clientWidth - pad;
  const n = Math.max(1, Math.round((avail - .5 * base) / (base + gap)));
  const slot = Math.max(base * .75, Math.min(base * 1.3, (avail - n * gap) / (n + .5)));
  const r = document.documentElement.style;
  r.setProperty("--slot", slot.toFixed(1) + "px");
  r.setProperty("--img-h", Math.round(slot * ratio) + "px");
}
fitSlots();
addEventListener("resize", fitSlots);

/* --- smooth eased scrolling (defined in the artifact, never wired up) ---- */
function glide(el, dx) {
  if (reduce) { el.scrollLeft += dx; return; }
  if (el._glide) cancelAnimationFrame(el._glide.raf);
  const from = el.scrollLeft, max = el.scrollWidth - el.clientWidth;
  const to = Math.max(0, Math.min(max, (el._glide ? el._glide.to : from) + dx));
  const start = performance.now(), dur = 620;
  const ease = t => 1 - Math.pow(1 - t, 4);
  el.style.scrollSnapType = "none";
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    el.scrollLeft = from + (to - from) * ease(t);
    if (t < 1) el._glide = { raf: requestAnimationFrame(step), to };
    else { el._glide = null; el.style.scrollSnapType = ""; }
  };
  el._glide = { raf: requestAnimationFrame(step), to };
}

/* --- shelf edge effect ---------------------------------------------------
   Driven by scroll direction. A product counts as fully on the shelf once half
   of it is visible (so the half product at the edge stays crisp). Past that,
   the one heading out shrinks down onto the shelf, and the one coming in
   slides along the shelf into place. */
function edgeFx(track) {
  if (reduce) return;
  // layout positions (not on-screen rects), so the effect's own transforms never feed back into it
  const r = { left: track.scrollLeft, right: track.scrollLeft + track.clientWidth }, dir = track._dir || 1;
  for (const it of track.children) {
    if (it.hidden) continue;
    const b = { left: it.offsetLeft, right: it.offsetLeft + it.offsetWidth, width: it.offsetWidth || 1 };
    if (b.right < r.left - b.width || b.left > r.right + b.width) { if (it._fx) clearFx(it); continue; }
    const vis = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)) / b.width;
    let p = Math.min(1, vis / .5);
    if (p >= 1) { if (it._fx) clearFx(it); continue; }
    p = 1 - Math.pow(1 - p, 2);
    const side = b.left < r.left ? -1 : 1;
    const entering = side === dir;
    const pic = it.querySelector(".pic");
    it._fx = true;
    it.style.opacity = (.15 + .85 * p).toFixed(3);
    if (entering) {
      it.style.transform = `translateX(${(side * (1 - p) * 70).toFixed(1)}px)`;
      pic.style.transform = "";
    } else {
      it.style.transform = "";
      pic.style.transform = `scale(${(.55 + .45 * p).toFixed(3)})`;
    }
  }
}
function clearFx(it) { it._fx = false; it.style.opacity = ""; it.style.transform = ""; it.querySelector(".pic").style.transform = ""; }

/* --- build the bays ------------------------------------------------------ */
const shelvesEl = $("#shelves");
SHELVES.forEach(s => {
  const sec = document.createElement("section");
  sec.className = "shelf"; sec.id = "shelf-" + s.id; sec.setAttribute("aria-label", s.name);
  sec.innerHTML = `<div class="shelf-label">${s.name} <span>${s.items.length} items</span></div>
    <div class="track"></div>
    <div class="ledge" aria-hidden="true"><div class="deck"></div><div class="lip"></div><div class="led"></div><div class="glow"></div></div>
`;
  const track = sec.querySelector(".track");
  s.items.forEach(([id, name, price]) => {
    const el = document.createElement("article");
    el.className = "item"; el.dataset.id = id; el.dataset.search = (name + " " + s.name).toLowerCase();
    el.innerHTML = `<div class="pic"><span class="base"></span><img src="assets/products/${id}.webp" alt="${name}" loading="lazy" decoding="async">
        <button class="fav" type="button" aria-label="Save ${name}" aria-pressed="false">${icons.heart}</button>
        <div class="ctl"></div></div>
      <div class="tag-zone">${priceTag(price)}</div>`;
    if (SEAT[id]) { el.dataset.round = ""; el.style.setProperty("--seat", `calc(var(--deck) * ${(0.34 * SEAT[id]).toFixed(2)})`); }
    const img = el.querySelector("img");
    const base = el.querySelector(".base");
    const fit = () => {  // size the contact shadow to the product's real footprint
      const pic = el.querySelector(".pic");
      const w = Math.min(pic.clientWidth, img.naturalWidth * (pic.clientHeight / img.naturalHeight));
      base.style.setProperty("--w", Math.round(w * 0.92) + "px");
    };
    // Wait one frame before measuring: the shelf was created in this same task, so a
    // picture that is already decoded would otherwise be measured with no layout box
    // yet (clientWidth 0) and get a zero-width shadow.
    if (img.complete && img.naturalWidth) requestAnimationFrame(fit);
    else img.addEventListener("load", () => requestAnimationFrame(fit), { once: true });
    track.appendChild(el);
  });
  shelvesEl.appendChild(sec);
  track._dir = 1; track._last = 0;
  const update = () => {
    const dx = track.scrollLeft - track._last;
    if (Math.abs(dx) > .5) track._dir = Math.sign(dx);
    track._last = track.scrollLeft;
    if (!track._raf) track._raf = requestAnimationFrame(() => { track._raf = 0; edgeFx(track); });
  };
  track.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(() => edgeFx(track)).observe(track);
});

/* --- item controls ------------------------------------------------------- */
function renderCtl(id) {
  document.querySelectorAll(`.item[data-id="${id}"] .ctl`).forEach(ctl => {
    const q = cart[id] || 0;
    const name = PRODUCTS[id].name;
    ctl.innerHTML = q
      ? `<div class="stepper"><button type="button" data-act="dec" aria-label="Remove one ${name}">−</button><output aria-live="polite">${q}</output><button type="button" data-act="inc" aria-label="Add one more ${name}">+</button></div>`
      : `<button class="add" type="button" data-act="add" aria-label="Add ${name} to cart">${icons.plus}</button>`;
  });
  if (shieldCount) refreshShield();
}

/* Button shielding exists in the shipped artifact but is inert: `shieldOn()` is
   a no-op and `shieldCount` is never incremented, so the layer is never built.
   Kept for parity; the flying product is layered by `.ctl` z-index instead. */
let shieldCount = 0, shieldLayer = null, shielded = [];
function buildShield() {
  shieldLayer = document.createElement("div"); shieldLayer.className = "shield";
  document.querySelectorAll(".item:not([hidden]) .ctl > *").forEach(btn => {
    const r = btn.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
    const track = btn.closest(".track").getBoundingClientRect();
    if (r.right < track.left || r.left > track.right) return;
    // a button the cart is standing in front of stays where it is, behind the cart
    const cbox = $("#cartBtn").getBoundingClientRect();
    if (r.right > cbox.left && r.left < cbox.right && r.bottom > cbox.top && r.top < cbox.bottom) return;
    const c = btn.cloneNode(true);
    Object.assign(c.style, { position: "fixed", left: r.left + "px", top: r.top + "px", right: "auto", bottom: "auto",
      width: r.width + "px", height: r.height + "px", margin: "0", opacity: getComputedStyle(btn.closest(".item")).opacity });
    shieldLayer.appendChild(c);
    btn.style.opacity = "0"; shielded.push(btn);
  });
  document.body.appendChild(shieldLayer);
}
function dropShield() {
  if (shieldLayer) shieldLayer.remove();
  shielded.forEach(b => { b.style.opacity = ""; });
  shieldLayer = null; shielded = [];
}
function refreshShield() { dropShield(); buildShield(); }
function shieldOn() {}
function shieldOff() {}
addEventListener("scroll", () => { if (shieldCount) refreshShield(); }, { passive: true, capture: true });

function renderFav(id) {
  document.querySelector(`.item[data-id="${id}"] .fav`).setAttribute("aria-pressed", favs.has(id));
}
Object.keys(PRODUCTS).forEach(id => { renderCtl(id); renderFav(id); });

shelvesEl.addEventListener("click", e => {
  const btn = e.target.closest("button"); if (!btn) return;
  const item = btn.closest(".item"); if (!item) return;
  const id = item.dataset.id;
  if (btn.classList.contains("fav")) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set("fc-favs", [...favs]); renderFav(id); renderFavCount();
    if (favOnly) applyFilter();
    return;
  }
  const act = btn.dataset.act;
  if (act === "add") { setQty(id, 1, { fly: item.querySelector(".pic img") }); }
  if (act === "inc") { setQty(id, (cart[id] || 0) + 1, { fly: item.querySelector(".pic img") }); }
  if (act === "dec") setQty(id, (cart[id] || 0) - 1, { back: true });
});

function setQty(id, q, opts = {}) {
  const prev = cart[id] || 0;
  const isNew = !prev && q > 0;
  if (q <= 0) delete cart[id]; else cart[id] = q;
  store.set("fc-cart", cart);
  renderCtl(id);
  if (!SHOW_BASKET) { renderCart(); return; }
  if (opts.fly && !reduce && opts.fly.animate) {
    // reserve the product's spot in the cart (invisible), carry the product to just above it, then let it drop in
    let target = null;
    if (isNew) target = syncLoad(id);
    else {
      // another of the same item: the one already in the cart stays and settles underneath; the new one lands on top
      const old = $(`#load img[data-id="${id}"]`);
      if (old) {
        target = makeLoadImg(id);
        target.dataset.id = id; target.className = old.className; target.style.left = old.style.left;
        target.style.setProperty("--r", old.style.getPropertyValue("--r"));
        target.style.opacity = "0";
        target.dataset.z = (stackTop += 4); target.style.zIndex = target.dataset.z;
        old.after(target);
        old.removeAttribute("data-id"); old.dataset.under = id;
      }
    }
    // buttons stay put and on top: the product travels underneath them
    fly(opts.fly, target, () => { renderCart(); shieldOff(); }, () => restock(opts.fly));
  } else if (opts.back && q < prev && !reduce && document.body.animate) {
    // taking one out: it travels from the cart (or the cart panel) back to its own spot on the shelf
    const top = document.querySelector(`#load img[data-id="${id}"]`);
    const src = opts.srcEl || top;
    let s = src && src.getBoundingClientRect();
    const c = $("#cartBtn").getBoundingClientRect();
    if (!s || s.width < 2) s = { left: c.left + c.width / 2 - 26, top: c.top + c.height * .2, width: 52, height: 52 };
    s = { left: s.left, top: s.top, width: s.width, height: s.height };
    // the top one leaves the cart; the one underneath (if any) rises back to the top
    const under = [...document.querySelectorAll(`#load img[data-under="${id}"]`)].pop();
    if (top && under) { top.remove(); under.removeAttribute("data-under"); under.dataset.id = id; }
    renderCart();
    flyBack(id, s, !!opts.srcEl);
  } else { renderCart(); }
}

/* --- the pile inside the basket ------------------------------------------ */
// Keeps the cart's images in place between updates, so nothing flickers or reloads.
// Each item shows its newest one on top and up to two more settled a little smaller underneath.
// Every item keeps its own spot in the basket for as long as it is shown, so nothing ever reshuffles.
const spotOf = {};
let stackTop = 0;            // newest item is always layered on top, so a drop never slips behind anything
function syncLoad(holdId) {
  if (!SHOW_BASKET) return;
  const ids = Object.keys(cart).filter(id => PRODUCTS[id]).slice(-SPOTS.length);
  const load = $("#load");
  [...load.children].forEach(el => {
    const owner = el.dataset.id || el.dataset.under;
    if (owner && !ids.includes(owner)) fadeOut(el);
  });
  for (const id in spotOf) if (!ids.includes(id)) delete spotOf[id];
  const used = new Set(Object.values(spotOf));
  ids.forEach(id => {
    if (spotOf[id] !== undefined) return;
    let i = 0; while (used.has(i)) i++;
    spotOf[id] = i; used.add(i);
  });
  let held = null;
  ids.forEach(id => {
    const s = SPOTS[spotOf[id]];
    let el = load.querySelector(`img[data-id="${id}"]`);
    if (!el) {
      el = makeLoadImg(id); el.dataset.id = id;
      if (id === holdId) { el.style.opacity = "0"; held = el; }
      load.appendChild(el);
    }
    if (!el.dataset.z) el.dataset.z = (stackTop += 4);
    el.style.zIndex = el.dataset.z;
    el.className = "r" + s.r; el.style.left = s.x + "%"; el.style.setProperty("--r", s.rot + "deg"); el.style.setProperty("--s", "1");
    const want = Math.min(Math.max((cart[id] || 0) - 1, 0), 2);
    const under = [...load.querySelectorAll(`img[data-under="${id}"]`)];
    while (under.length > want) fadeOut(under.shift());
    while (under.length < want) { const c = makeLoadImg(id); c.dataset.under = id; el.before(c); under.unshift(c); }
    under.forEach((c, k) => {
      const side = (under.length - k) % 2 ? -1 : 1;
      c.className = "r" + s.r;
      c.style.left = (s.x + side * 4) + "%";
      c.style.setProperty("--r", (s.rot + side * 7) + "deg");
      c.style.setProperty("--s", ".86");
      c.style.zIndex = el.dataset.z - (under.length - k);
    });
  });
  return held;
}

/* --- totals & cart panel ------------------------------------------------- */
function totals() {
  let count = 0, sub = 0;
  for (const [id, q] of Object.entries(cart)) { if (!PRODUCTS[id]) continue; count += q; sub += PRODUCTS[id].price * q; }
  return { count, sub };
}
/* the same totals, computed in the currency the shopper is reading, so that
   whole-baht prices still add up to the whole-baht total */
function totalsD() {
  let count = 0, sub = 0;
  for (const [id, q] of Object.entries(cart)) { if (!PRODUCTS[id]) continue; count += q; sub += toDisplay(PRODUCTS[id].price) * q; }
  return { count, sub };
}
let lastSub = null;
function renderTotals() {
  const { count, sub } = totalsD();
  const pill = $("#totalPill");
  pill.classList.toggle("has", count > 0);
  $("#pillTotal").textContent = moneyD(sub);
  $("#pillCount").textContent = count;
  pill.setAttribute("aria-label", count ? `Open cart, ${count} items, ${moneyD(sub)}` : "Open cart, empty");
  $("#cartBtn").setAttribute("aria-label", pill.getAttribute("aria-label"));
  if (lastSub !== null && lastSub !== sub) { pill.classList.remove("pulse"); void pill.offsetWidth; pill.classList.add("pulse"); }
  lastSub = sub;
}
function renderCart() {
  renderTotals();
  if (SHOW_BASKET) syncLoad();
  const { count, sub } = totalsD();
  const FREE_D = toDisplay(FREE_AT), FEE_D = toDisplay(FEE);
  $("#drawerCount").textContent = count ? `${count} item${count > 1 ? "s" : ""}` : "";
  const ids = Object.keys(cart).filter(id => PRODUCTS[id]);
  $("#lines").innerHTML = ids.length ? ids.map(id => {
    const p = PRODUCTS[id], q = cart[id], unit = toDisplay(p.price);
    return `<div class="line" data-id="${id}"><img src="assets/products/${id}.webp" alt=""><div class="nm">${p.name}<div class="unit">${moneyD(unit)} each</div></div>
      <div class="right"><span class="sum">${moneyD(unit * q)}</span><div class="mini"><button type="button" data-act="dec" aria-label="Remove one ${p.name}">−</button><output>${q}</output><button type="button" data-act="inc" aria-label="Add one ${p.name}">+</button></div></div></div>`;
  }).join("") : `<div class="drawer-empty"><strong>Your cart is empty</strong>Tap + on any product to add it.</div>`;
  const fee = count && sub < FREE_D ? FEE_D : 0;
  $("#sub").textContent = moneyD(sub);
  $("#fee").textContent = count ? (fee ? moneyD(fee) : "Free") : moneyD(0);
  $("#total").textContent = moneyD(sub + fee);
  $("#meter").style.width = Math.min(100, sub / FREE_D * 100) + "%";
  $("#freeMsg").textContent = sub >= FREE_D ? "You've unlocked free delivery." : `Add ${moneyD(FREE_D - sub)} more for free delivery.`;
  $("#checkout").disabled = !count;
  $("#totals").hidden = false;
}
$("#lines").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const line = btn.closest(".line"), id = line.dataset.id;
  if (btn.dataset.act === "inc") setQty(id, (cart[id] || 0) + 1);
  else setQty(id, (cart[id] || 0) - 1, { back: true, srcEl: line.querySelector("img") });
});

/* --- drawers (cart on the right, menu on the left) ----------------------- */
const scrim = $("#scrim");
let openDrawer = null, lastFocus = null;
function open(el, trigger) {
  if (openDrawer) close();
  lastFocus = trigger || document.activeElement;
  scrim.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add("open"); el.classList.add("open"); });
  el.setAttribute("aria-hidden", "false");
  openDrawer = el;
  if (el.id === "menu") $("#menuBtn").setAttribute("aria-expanded", "true");
  setTimeout(() => el.querySelector("[data-close]").focus(), 50);
}
function close() {
  if (!openDrawer) return;
  const el = openDrawer; openDrawer = null;
  scrim.classList.remove("open"); el.classList.remove("open"); el.setAttribute("aria-hidden", "true");
  if (el.id === "menu") $("#menuBtn").setAttribute("aria-expanded", "false");
  if (el.id === "drawer") {
    clearTimeout(arriveTimer); clearTimeout(outTimer);
    $("#lines").classList.remove("arriving");
    if (SHOW_BASKET) {
      document.querySelectorAll("#load img").forEach(img => { img.style.opacity = "0"; });
      $("#load").classList.remove("out");
      dropBackIntoCart();
    }
  }
  setTimeout(() => { if (!openDrawer) scrim.hidden = true; }, reduce ? 0 : 260);
  if (lastFocus) lastFocus.focus();
}

function openCart(trigger) {
  renderCart();
  const lines = $("#lines");
  const animate = SHOW_BASKET && !reduce && Object.keys(cart).length > 0;
  if (animate) {
    lines.classList.add("arriving");
    $("#totals").animate([{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
      { duration: 600, delay: 380, easing: SOFT, fill: "backwards" });
  }
  // measure and launch before the panel starts sliding, so products leave the cart the instant you click
  if (animate) flyIntoPanel();
  open($("#drawer"), trigger);
}
$("#cartBtn").addEventListener("click", e => openCart(e.currentTarget));
$("#totalPill").addEventListener("click", e => openCart(e.currentTarget));
$("#menuBtn").addEventListener("click", e => open($("#menu"), e.currentTarget));
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
scrim.addEventListener("click", close);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { close(); closeBell(); }
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
});
/* Checkout is a full page of its own: address, payment method, then confirm. */
$("#checkout").addEventListener("click", () => {
  const { count } = totalsD();
  if (!count) return;
  location.href = "checkout.html";
});

/* --- menu ---------------------------------------------------------------- */
const lead = { produce: "strawberries", dairy: "milk", pantry: "barilla", drinks: "coke" };
$("#nav").innerHTML = `<h3>Shop by aisle</h3>` +
  SHELVES.map(s => `<button type="button" data-go="${s.id}"><img src="assets/products/${lead[s.id]}.webp" alt="">${s.name}<span>${s.items.length}</span></button>`).join("") +
  `<h3>Your account</h3>
   <button type="button" class="only-mobile" data-go="account"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="#1d241f" stroke-width="1.9"/><path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" stroke="#1d241f" stroke-width="1.9" stroke-linecap="round"/></svg>Account</button>
   <button type="button" class="only-mobile" data-go="notifications" aria-expanded="false" aria-controls="navNotes"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.8H4.4L6 16.5Z" stroke="#1d241f" stroke-width="1.9" stroke-linejoin="round"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" stroke="#1d241f" stroke-width="1.9" stroke-linecap="round"/></svg>Notifications<span class="new" id="navNew">3</span></button>
   <div class="nav-notes only-mobile" id="navNotes" hidden>
     <div class="note"><img src="assets/products/strawberries.webp" alt=""><p><b>Berry season deal</b><br><small>Driscoll's Strawberries are <span data-money="${PRODUCTS.strawberries.price}"></span> this week.</small></p></div>
     <div class="note"><img src="assets/products/eggs.webp" alt=""><p><b>Back in stock</b><br><small>Eggland's Best Cage Free Large Eggs.</small></p></div>
     <div class="note"><img src="assets/products/coke.webp" alt=""><p><b>Free delivery over <span data-money="${FREE_AT}"></span></b><br><small>Stock up on drinks and save the fee.</small></p></div>
   </div>
   <button type="button" data-go="favorites">Favorites<span id="navFav">${favs.size}</span></button>
   <button type="button" data-go="cart">Cart<span id="navCart">0</span></button>
`;
$("#nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-go]"); if (!b) return;
  const go = b.dataset.go;
  if (go === "account") return;   // no account screen exists in the artifact
  if (go === "notifications") {
    const notes = $("#navNotes"), opening = notes.hidden;
    notes.hidden = !opening; b.setAttribute("aria-expanded", opening);
    $("#navNew").hidden = true; $("#bellDot").hidden = true;
    return;
  }
  close();
  if (go === "cart") { setTimeout(() => openCart($("#totalPill")), 280); return; }
  if (go === "favorites") { if (!favOnly) $("#favBtn").click(); window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); return; }
  if (favOnly) $("#favBtn").click();
  q.value = ""; applyFilter();
  setTimeout(() => document.getElementById("shelf-" + go).scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }), 120);
});

/* --- search & favorites -------------------------------------------------- */
const q = $("#q");

/* products that don't match shrink away and close the gap; matches glide in softly */
const gapPx = () => parseFloat(getComputedStyle($(".track")).columnGap) || 0;
function stop(el) { el.getAnimations().filter(a => a.id === "filter").forEach(a => a.cancel()); el.style.overflow = ""; }
function shrinkOut(it, delay) {
  if (it.hidden || it._out) return;
  stop(it); it._out = true;
  const w = it.getBoundingClientRect().width, g = gapPx();
  it.style.overflow = "hidden";
  const a = it.animate([
    { opacity: 1, transform: "scale(1)", flexBasis: w + "px", marginRight: "0px" },
    { opacity: 0, transform: "scale(.55)", offset: .55 },
    { opacity: 0, transform: "scale(.4)", flexBasis: "0px", marginRight: -g + "px" }
  ], { duration: 520, delay, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" });
  a.id = "filter";
  a.onfinish = () => { it.hidden = true; it._out = false; stop(it); };
}
function slideIn(it, delay) {
  if (!it.hidden && !it._out) return;
  stop(it); it._out = false; it.hidden = false;
  const g = gapPx(), w = parseFloat(getComputedStyle(it).flexBasis);
  it.style.overflow = "hidden";
  const a = it.animate([
    { opacity: 0, transform: "translateX(48px) scale(.96)", flexBasis: "0px", marginRight: -g + "px" },
    { opacity: 0, transform: "translateX(48px) scale(.96)", flexBasis: w * .6 + "px", marginRight: "0px", offset: .3 },
    { opacity: 1, transform: "translateX(0) scale(1)", flexBasis: w + "px", marginRight: "0px" }
  ], { duration: 680, delay, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" });
  a.id = "filter";
  a.onfinish = () => stop(it);
}
function shelfOut(sec) {
  if (sec.hidden || sec._out) return;
  stop(sec); sec._out = true;
  const h = sec.getBoundingClientRect().height, m = getComputedStyle(sec).marginTop;
  sec.style.overflow = "hidden";
  const a = sec.animate([
    { opacity: 1, height: h + "px", marginTop: m },
    { opacity: 0, height: "0px", marginTop: "0px" }
  ], { duration: 520, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" });
  a.id = "filter";
  a.onfinish = () => { sec.hidden = true; sec._out = false; stop(sec); };
}
function shelfIn(sec) {
  if (!sec.hidden && !sec._out) return;
  stop(sec); sec._out = false; sec.hidden = false;
  const h = sec.getBoundingClientRect().height, m = getComputedStyle(sec).marginTop;
  sec.style.overflow = "hidden";
  const a = sec.animate([
    { opacity: 0, height: "0px", marginTop: "0px" },
    { opacity: 1, height: h + "px", marginTop: m }
  ], { duration: 600, easing: "cubic-bezier(.22, 1, .36, 1)" });
  a.id = "filter";
  a.onfinish = () => stop(sec);
}

function applyFilter() {
  const term = q.value.trim().toLowerCase();
  $("#clear").hidden = !term;
  let any = false;
  document.querySelectorAll(".shelf").forEach(sec => {
    const all = [...sec.querySelectorAll(".item")];
    const match = it => (!term || term.split(/\s+/).every(w => it.dataset.search.includes(w))) && (!favOnly || favs.has(it.dataset.id));
    const n = all.filter(match).length;
    if (n) any = true;
    sec.querySelector(".shelf-label span").textContent = n === all.length ? `${n} items` : `${n} of ${all.length}`;
    const t = sec.querySelector(".track");
    if (reduce) {
      all.forEach(it => { stop(it); it._out = false; it.hidden = !match(it); });
      sec.hidden = !n; t.scrollLeft = 0; t.dispatchEvent(new Event("scroll"));
      return;
    }
    if (!n) { shelfOut(sec); return; }
    const wasHidden = sec.hidden || sec._out;
    let outs = 0, ins = 0;
    all.forEach(it => match(it) ? slideIn(it, wasHidden ? 0 : 140 + 45 * ins++) : shrinkOut(it, 22 * outs++));
    if (wasHidden) shelfIn(sec);
    t.scrollTo({ left: 0, behavior: "smooth" });
    setTimeout(() => t.dispatchEvent(new Event("scroll")), 900);
  });
  const empty = $("#empty");
  const wasEmptyHidden = empty.hidden;
  empty.hidden = any;
  if (!any && wasEmptyHidden && !reduce) empty.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 500, delay: 250, easing: SOFT, fill: "backwards" });
  empty.innerHTML = favOnly && !term
    ? "<strong>No favorites yet</strong>Tap the heart on any product to save it here."
    : "<strong>Nothing on the shelves for that</strong>Try a brand like “Oreo”, or a word like “milk”.";
}
let filterTimer = null;
q.addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilter, 140); });
$("#clear").addEventListener("click", () => { q.value = ""; applyFilter(); q.focus(); });
function renderFavCount() {
  const c = $("#favCount"); c.textContent = favs.size; c.hidden = !favs.size;
  const n = document.getElementById("navFav"); if (n) n.textContent = favs.size;
}
$("#favBtn").addEventListener("click", () => {
  favOnly = !favOnly;
  $("#favBtn").setAttribute("aria-pressed", favOnly);
  $("#favBtn").setAttribute("aria-label", favOnly ? "Show all products" : "Show favorites");
  applyFilter();
});
renderFavCount();

/* --- mobile: the search strip tucks away while scrolling down ------------ */
const narrowHeader = matchMedia("(max-width: 1000px)");
let lastY = scrollY, scrollTick = 0;
addEventListener("scroll", () => {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
    const y = scrollY, top = $(".top");
    if (!narrowHeader.matches || document.activeElement === q) { top.classList.remove("hide-search"); lastY = y; return; }
    if (y > lastY + 6 && y > 60) top.classList.add("hide-search");
    else if (y < lastY - 6 || y <= 60) top.classList.remove("hide-search");
    if (Math.abs(y - lastY) > 6) lastY = y;
  });
}, { passive: true });

/* --- notifications ------------------------------------------------------- */
const bellPop = $("#bellPop"), bellBtn = $("#bellBtn");
function closeBell() { bellPop.hidden = true; bellBtn.setAttribute("aria-expanded", "false"); }
bellBtn.addEventListener("click", e => {
  e.stopPropagation();
  const opening = bellPop.hidden;
  bellPop.hidden = !opening; bellBtn.setAttribute("aria-expanded", opening);
  $("#bellDot").hidden = true;
});
document.addEventListener("click", e => { if (!bellPop.hidden && !bellPop.contains(e.target)) closeBell(); });

/* --- boot ---------------------------------------------------------------- */
const _rt = renderTotals;
renderTotals = function () { _rt(); const n = document.getElementById("navCart"); if (n) n.textContent = totalsD().count; };
renderCart();

/* --- currency control ---------------------------------------------------- */
document.querySelectorAll("[data-money]").forEach(el => { el.textContent = money(Number(el.dataset.money)); });
paintCurrency();
$("#currencyBtn").addEventListener("click", toggleCurrency);
