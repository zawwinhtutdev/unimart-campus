/* ============================================================================
   UniMart replica — motion engine
   Every flight is a sampled cubic Bezier path fed to the Web Animations API.
   There is no GSAP/Lottie/Framer; the only CSS keyframes in the whole UI are
   `@keyframes pulse` (total pill). Everything below is the JS-driven motion:

     fly()      product leaves the shelf -> arc -> cart (or into the panel)
     flyBack()  product leaves cart -> arc -> back onto its shelf spot
     restock()  the next product steps forward into the emptied spot
     dip()      the cart takes the weight: one soft give and return
     settle()   the freshly landed product squashes once
     fadeOut()  a product leaving the basket stack

   Curves are eased once from start to finish (easeIO), sampled densely, and
   driven with `easing: "linear"` so the timing function never fights the path.
   ========================================================================== */
'use strict';

const SOFT = "cubic-bezier(.22, 1, .36, 1)";   // the house easing: fast out, long settle
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* --- curve sampling ------------------------------------------------------ */
const easeIO = t => (1 - Math.cos(Math.PI * t)) / 2;

function curve(p0, p1, p2, n) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = easeIO(i / n), u = 1 - t;
    return { t, x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
  });
}

// cubic version: lets a path swing out to one side and sweep back in, one smooth stroke
function curve4(p0, p1, p2, p3, n) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = easeIO(i / n), u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { t, x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  });
}

// spring curve: starts fast, overshoots a little, settles by the end
const spring = t => 1 - Math.exp(-6.5 * t) * Math.cos(10 * t);

// a point on a cubic curve; past the end (p > 1) it carries on along the arrival direction, for the overshoot
function onCurve4(p0, p1, p2, p3, p) {
  if (p > 1) { const e = p - 1; return { x: p3.x + 3 * (p3.x - p2.x) * e, y: p3.y + 3 * (p3.y - p2.y) * e }; }
  const u = 1 - p, a = u * u * u, b = 3 * u * u * p, c = 3 * u * p * p, d = p * p * p;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/* Two cubic segments joined into one path, then re-parameterised by arc length
   so the sampled speed is uniform along the whole route. */
function pathThrough(segs, n) {
  const dense = [];
  segs.forEach(([p0, p1, p2, p3], k) => {
    for (let j = k ? 1 : 0; j <= 40; j++) {
      const t = j / 40, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      dense.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
  });
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const total = len[len.length - 1] || 1;
  let k = 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = easeIO(i / n), want = f * total;
    while (k < len.length - 1 && len[k] < want) k++;
    const span = len[k] - len[k - 1] || 1, m = (want - len[k - 1]) / span;
    return { t: f, x: dense[k - 1].x + (dense[k].x - dense[k - 1].x) * m, y: dense[k - 1].y + (dense[k].y - dense[k - 1].y) * m };
  });
}

// a gentle lean into the direction of travel, fading to nothing at both ends
const bank = (pts, i) => {
  const j = Math.min(pts.length - 1, i + 1), k = Math.max(0, i - 1);
  return clamp((pts[j].x - pts[k].x) * .35, -9, 9) * Math.sin(Math.PI * pts[i].t);
};

/* --- feedback ------------------------------------------------------------ */

// the cart takes the weight softly: one smooth give and return, no bounce
function dip() {
  $("#cartBtn").animate([
    { transform: "translateY(0)" },
    { transform: "translateY(4px)", offset: .35 },
    { transform: "translateY(0)" }
  ], { duration: 760, easing: "cubic-bezier(.37, 0, .63, 1)" });
}

function settle(el) {
  const base = `translateX(-50%) rotate(${el.style.getPropertyValue("--r") || "0deg"})`;
  el.animate([
    { transform: `${base} scale(1.1, .88)` },
    { transform: `${base} scale(.97, 1.04)`, offset: .45 },
    { transform: `${base} scale(1)` }
  ], { duration: 560, easing: SOFT });
}

const imgBase = img => { const t = getComputedStyle(img).transform; return t === "none" ? "" : t; };

function shadowTo(img, from, to, opts) {
  const sh = img.parentElement.querySelector(".base");
  if (sh) return sh.animate([{ transform: from }, { transform: to }], opts);
}

/* The taken product leaves an empty spot; the next one from the back of the shelf
   (unseen until now) moves forward into the light to fill it.
   One row back: base planted on the same shelf line (no lift at all), just a
   little smaller so it reads as further back and always hides fully behind the
   front product. */
const DEPTH = "scale(.9)";
const SHADOW_BACK = "translateX(-50%) scaleX(.9)";

function restock(img) {
  img.getAnimations().forEach(a => a.cancel());
  const base = imgBase(img);
  img.animate([
    { transform: `${base} ${DEPTH}` },
    { transform: `${base} ${DEPTH}`, offset: .3, easing: "cubic-bezier(.45, 0, .2, 1)" },
    { transform: base || "none" }
  ], { duration: 1000 });
  const shadow = img.parentElement.querySelector(".base");
  if (shadow) {
    shadow.getAnimations().forEach(a => a.cancel());
    shadow.animate([
      { transform: SHADOW_BACK },
      { transform: SHADOW_BACK, offset: .3, easing: "cubic-bezier(.45, 0, .2, 1)" },
      { transform: "translateX(-50%) scaleX(1)" }
    ], { duration: 1000 });
  }
}

/* --- flights ------------------------------------------------------------- */

function makeLoadImg(id) {
  const el = document.createElement("img");
  el.alt = ""; el.src = `assets/products/${id}.webp`;
  return el;
}

function fadeOut(el) {
  el.removeAttribute("data-id"); el.removeAttribute("data-under");
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: SOFT }).onfinish = () => el.remove();
}

/* Into the cart: one fluid arc from the shelf into the basket. Partway down, at
   the exact moment the product reaches the rim, the real in-cart product takes
   over the same path (same position, speed and size), so the rest of the fall
   happens behind the rim and mesh with no stop and no hook. */
function fly(img, target, done, onLaunch) {
  const a = img.getBoundingClientRect();
  const go = () => {
    const cr = $("#cartBtn").getBoundingClientRect();
    let b, rot = 0;
    if (target) { b = target.getBoundingClientRect(); rot = parseFloat(target.style.getPropertyValue("--r")) || 0; }
    else b = { left: cr.left + cr.width / 2 - 25, top: cr.top + cr.height * .3, width: 50, height: cr.height * .55 };
    const wrap = document.createElement("div"); wrap.className = "flyer";
    Object.assign(wrap.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", transformOrigin: "50% 100%" });
    const im = img.cloneNode(); im.removeAttribute("loading"); im.alt = ""; im.removeAttribute("style");
    im.style.filter = "none";   // the shadow is animated on the carrier instead
    wrap.appendChild(im); document.body.appendChild(wrap);
    if (onLaunch) onLaunch();

    const s = b.height / a.height;
    const P0 = { x: a.left + a.width / 2, y: a.top + a.height };
    const P2 = { x: b.left + b.width / 2, y: b.top + b.height };
    // swing up and out away from the cart, sweep over, then come down into the basket from above
    const dist = Math.hypot(P2.x - P0.x, P2.y - P0.y);
    const side = P2.x >= P0.x ? -1 : 1;
    const C1 = { x: P0.x + side * clamp(dist * .18, 60, 150), y: P0.y - clamp(dist * .3, 120, 230) };
    // the last part of the sweep comes down almost straight into the basket opening
    const C2 = { x: P2.x + side * clamp(dist * .08, 30, 80), y: Math.min(P0.y, P2.y) - clamp(dist * .22, 90, 200) };
    const N = 60;
    const pts = curve4(P0, C1, C2, P2, N);
    const D = clamp(800 + dist * .4, 1000, 1350);
    const f = i => {
      const q = pts[i].t;
      return { x: pts[i].x, y: pts[i].y, sc: (1 + (s - 1) * q) * (1 + .06 * Math.sin(Math.PI * q)), r: rot * q + bank(pts, i), h: Math.sin(Math.PI * q) };
    };

    // where the descent meets the rim: hand over there
    const rimTop = cr.top + cr.height * (42 / 140);
    let cut = N;
    const mouthL = cr.left + cr.width * (30 / 300), mouthR = cr.left + cr.width * (270 / 300);
    if (target) for (let i = 1; i <= N; i++) {
      const half = a.width * (1 + (s - 1) * pts[i].t) / 2;
      if (pts[i].y > pts[i - 1].y && pts[i].y >= rimTop - 3 && pts[i].x - half >= mouthL && pts[i].x + half <= mouthR) { cut = Math.max(1, i); break; }
      if (pts[i].y > pts[i - 1].y && pts[i].y >= rimTop + 6) { cut = Math.max(1, i - 1); break; }
    }

    const kf = [];
    for (let i = 0; i <= cut; i++) {
      const v = f(i);
      kf.push({ offset: i / cut, transform: `translate(${v.x - P0.x}px, ${v.y - P0.y}px) rotate(${v.r}deg) scale(${v.sc})`,
        filter: `drop-shadow(0 ${2 + 18 * v.h}px ${2 + 14 * v.h}px rgba(0,0,0,${.3 - .1 * v.h}))` });
    }
    const flyDur = D * cut / N;
    wrap.animate(kf, { duration: flyDur, easing: "linear", fill: "forwards" }).onfinish = () => {
      wrap.remove();
      if (target) target.style.opacity = "";
    };
    if (target && cut < N) {
      const tk = [];
      for (let i = cut; i <= N; i++) {
        const v = f(i);
        tk.push({ offset: (i - cut) / (N - cut), transform: `translateX(-50%) translate(${v.x - P2.x}px, ${v.y - P2.y}px) rotate(${v.r}deg) scale(${v.sc / s})` });
      }
      target.animate(tk, { duration: D - flyDur, delay: flyDur, easing: "linear" });
    }
    setTimeout(() => { dip(); done(); }, D);
  };
  if (target && target.decode) target.decode().catch(() => {}).then(go);
  else go();
}

/* Back to the shelf: the product on the shelf steps back a row to make room, the
   returning one arcs over and sets down in front, and the one behind is hidden by
   it again. It comes in from the left — the side away from its own +/- button —
   so it never brushes the button on the way up. */
function flyBack(id, s, fromPanel) {
  const item = document.querySelector(`.item[data-id="${id}"]`);
  if (!item || item.hidden) return;
  const img = item.querySelector(".pic img");
  img.getAnimations().forEach(a => a.cancel());
  const t = img.getBoundingClientRect(), tr = item.parentElement.getBoundingClientRect();
  if (t.bottom < 0 || t.top > innerHeight || t.right < tr.left || t.left > tr.right) return;
  const base = imgBase(img);
  const recedeOpts = { duration: 520, delay: 260, easing: "cubic-bezier(.45, 0, .2, 1)", fill: "forwards" };
  const recede = img.animate([{ transform: base || "none" }, { transform: `${base} ${DEPTH}` }], recedeOpts);
  const recedeShadow = shadowTo(img, "translateX(-50%) scaleX(1)", SHADOW_BACK, recedeOpts);
  const wrap = document.createElement("div"); wrap.className = fromPanel ? "flyer over" : "flyer";
  const im = document.createElement("img"); im.src = `assets/products/${id}.webp`; im.alt = "";
  wrap.appendChild(im); document.body.appendChild(wrap);
  im.style.filter = "none";
  Object.assign(wrap.style, { left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px", transformOrigin: "50% 100%" });
  const P0 = { x: s.left + s.width / 2, y: s.top + s.height };
  const P2 = { x: t.left + t.width / 2, y: t.top + t.height };
  const dist = Math.hypot(P2.x - P0.x, P2.y - P0.y);
  const btnEl = item.querySelector(".ctl > *");
  const clear = btnEl ? Math.max(40, P2.y - btnEl.getBoundingClientRect().top + 10) : 60;
  const Q = { x: P2.x - 30, y: P2.y - clear };   // just above button height, beside the spot
  const inX = Math.max(Q.x - 120, 40);
  const C1 = { x: P0.x + (inX - P0.x) * .3, y: P0.y - clamp(dist * .3, 110, 220) };
  const k0 = s.height / t.height;
  const N = 72;
  const pts = pathThrough([
    [P0, C1, { x: inX, y: Q.y }, Q],
    [Q, { x: Q.x + (Q.x - inX) / 3, y: Q.y }, { x: P2.x, y: P2.y - clear * .6 }, P2]
  ], N);
  const D = clamp(800 + dist * .4, 1000, 1350);
  const kf = pts.map((p, i) => {
    const q = p.t, h = Math.sin(Math.PI * q);
    return { offset: i / N, transform: `translate(${p.x - P2.x}px, ${p.y - P2.y}px) rotate(${bank(pts, i)}deg) scale(${(k0 + (1 - k0) * q) * (1 + .05 * h)})`,
      filter: `drop-shadow(0 ${2 + 16 * h}px ${2 + 12 * h}px rgba(0,0,0,${.3 - .1 * h}))` };
  });
  // The product flies in front of everything until the moment it would touch its
  // own + / – button. From that exact point a copy inside the shelf slot (which
  // sits under the button, like the resting product) carries on along the same
  // path at the same speed, so it tucks in behind the button.
  const btn = item.querySelector(".ctl > *");
  let cut = N;
  if (btn && !fromPanel) {
    const br = btn.getBoundingClientRect(), pad = 6;
    for (let i = Math.floor(N * .4); i <= N; i++) {
      const q = pts[i].t, sc = (k0 + (1 - k0) * q) * (1 + .05 * Math.sin(Math.PI * q));
      const w = t.width * sc, h = t.height * sc, x = pts[i].x, y = pts[i].y;
      // only once its base is back above the shelf surface, so it never slips under the price tag or shelf edge
      if (y <= P2.y + 1 && x + w / 2 > br.left - pad && x - w / 2 < br.right + pad && y > br.top - pad && y - h < br.bottom + pad) { cut = i; break; }
    }
  }
  const finish = () => { recede.cancel(); if (recedeShadow) recedeShadow.cancel(); };
  const first = kf.slice(0, cut + 1).map((k, i) => ({ ...k, offset: i / cut }));
  const flyDur = D * cut / N;
  wrap.animate(first, { duration: flyDur, easing: "linear", fill: "forwards" }).onfinish = () => {
    if (cut >= N) { wrap.remove(); finish(); return; }
    const ghost = img.cloneNode();
    ghost.removeAttribute("loading"); ghost.alt = "";
    Object.assign(ghost.style, { position: "absolute", left: img.offsetLeft + "px", top: img.offsetTop + "px",
      width: img.offsetWidth + "px", height: img.offsetHeight + "px", maxWidth: "none", maxHeight: "none", margin: "0", transformOrigin: "50% 100%" });
    const rest = kf.slice(cut).map((k, i) => ({ offset: i / (N - cut), transform: `${base} ${k.transform}` }));
    ghost.style.transform = rest[0].transform;
    img.after(ghost);
    wrap.remove();
    ghost.animate(rest, { duration: D - flyDur, easing: "linear", fill: "forwards" }).onfinish = () => { finish(); ghost.remove(); };
  };
}

/* Closing the cart: nothing flies. The products rise up inside the basket from
   underneath, one after another, until the cart is full again. */
function dropBackIntoCart() {
  const loads = [...document.querySelectorAll("#load img")].filter(i => i.dataset.id || i.dataset.under);
  loads.forEach(img => { img.getAnimations().forEach(a => a.cancel()); img.style.opacity = ""; });
  if (reduce) return;
  // bottom of the pile first: back row, then front row; copies underneath before the one on top
  const order = loads.slice().sort((x, y) => (+x.style.zIndex || 0) - (+y.style.zIndex || 0));
  order.forEach((img, i) => {
    const rot = img.style.getPropertyValue("--r") || "0deg", sc = img.style.getPropertyValue("--s") || "1";
    const pre = "translateX(-50%)", post = `rotate(${rot}) scale(${sc})`;
    img.animate([
      { transform: `${pre} translateY(210%) ${post}`, easing: "cubic-bezier(.2, .8, .25, 1)" },
      { transform: `${pre} translateY(-4%) ${post}`, offset: .72, easing: "cubic-bezier(.4, 0, .4, 1)" },
      { transform: `${pre} ${post}` }
    ], { duration: 620, delay: 120 + i * 55, fill: "backwards" });
  });
}

/* Opening the cart: each product lifts out of the cart and drops into its row in
   the panel, on a spring that pops out of the basket, overshoots a touch past the
   row, then settles. Row offsets stagger 55 ms and stop staggering after 10. */
function flyIntoPanel() {
  const lines = $("#lines");
  if (!lines.classList.contains("arriving")) return;
  // the panel is still off-screen: work out where each row will be once it has slid in
  const dr = $("#drawer").getBoundingClientRect();
  const shift = dr.left - (document.documentElement.clientWidth - dr.width);
  const at = r => ({ left: r.left - shift, top: r.top, width: r.width, height: r.height, bottom: r.bottom });
  const box = at(lines.getBoundingClientRect());
  const c = $("#cartBtn").getBoundingClientRect();
  const rows = [...lines.querySelectorAll(".line")];
  let end = 0;
  rows.forEach((row, i) => {
    const delay = Math.min(i, 10) * 55;
    const tImg = row.querySelector("img");
    const t = at(tImg.getBoundingClientRect());
    const src = document.querySelector(`#load img[data-id="${row.dataset.id}"]`);
    let s = src && src.getBoundingClientRect();
    if (!s || s.width < 2) s = { left: c.left + c.width / 2 - 26, top: c.top + c.height * .2, width: 52, height: 52 };
    document.querySelectorAll(`#load img[data-id="${row.dataset.id}"], #load img[data-under="${row.dataset.id}"]`).forEach(u =>
      u.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, delay, fill: "forwards" }));
    const onScreen = t.top < box.bottom && t.bottom > box.top;
    if (!onScreen) { setTimeout(() => row.classList.add("in"), delay + 500); end = Math.max(end, delay + 500); return; }
    // it stays in the cart until its turn, then that same product rises out and curves into its row
    const wrap = document.createElement("div"); wrap.className = "flyer over";
    Object.assign(wrap.style, { left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px", transformOrigin: "50% 100%", opacity: "0" });
    const im = document.createElement("img"); im.src = tImg.src; im.alt = "";
    wrap.appendChild(im); document.body.appendChild(wrap);
    const P0 = { x: s.left + s.width / 2, y: s.top + s.height }, P3 = { x: t.left + t.width / 2, y: t.top + t.height };
    const k0 = s.height / t.height;
    const C1 = { x: P0.x - 40, y: P0.y - 180 }, C2 = { x: P3.x - 130, y: P3.y - 80 };
    const N = 56, D = 900;
    const kf = [];
    let prev = null;
    for (let j = 0; j <= N; j++) {
      const p = spring(j / N), at = onCurve4(P0, C1, C2, P3, p);
      const lean = prev ? clamp((at.x - prev.x) * .5, -10, 10) * Math.max(0, 1 - j / N) : 0;
      prev = at;
      kf.push({ offset: j / N, opacity: 1,
        transform: `translate(${at.x - P3.x}px, ${at.y - P3.y}px) rotate(${lean}deg) scale(${k0 + (1 - k0) * p})` });
    }
    wrap.animate(kf, { duration: D, delay, easing: "linear", fill: "forwards" }).onfinish = () => {
      wrap.remove();
      row.classList.add("in");
      tImg.animate([{ transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 380, easing: SOFT });
    };
    end = Math.max(end, delay + D);
  });
  outTimer = setTimeout(() => $("#load").classList.add("out"), end - 700);
  arriveTimer = setTimeout(() => { lines.classList.remove("arriving"); rows.forEach(r => r.classList.remove("in")); }, end + 700);
}
