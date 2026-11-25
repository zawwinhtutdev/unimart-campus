<div align="center">

<img src="docs/banner.png" alt="UniMart — storefront, admin console and inventory" width="100%">

# UniMart

**A complete grocery shop — storefront, admin console, inventory and payment verification —**
**built with Python's standard library, SQLite and vanilla JavaScript.**

[![Tests](https://github.com/zawwinhtutdev/unimart-campus/actions/workflows/tests.yml/badge.svg)](https://github.com/zawwinhtutdev/unimart-campus/actions/workflows/tests.yml)
![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Tests](https://img.shields.io/badge/tests-30-success)
![License](https://img.shields.io/badge/license-MIT-blue)
[![Live preview](https://img.shields.io/badge/live%20preview-vercel-black?logo=vercel)](https://unimart-campus-app.vercel.app/)

[Live preview](https://unimart-campus-app.vercel.app/) · [Demo video](#demo-video) · [Overview](#overview) · [Screenshots](#screenshots) · [Quick start](#quick-start) · [Walkthrough](#walkthrough) · [Architecture](#architecture) · [API](#api) · [Testing](#testing)

**Live UI preview:** <https://unimart-campus-app.vercel.app/> — the storefront running on
Vercel (browse, search, favourites, cart, currency). Checkout, accounts and the admin
console need the local app; run `python3 server.py` for the full flow.

</div>

## Demo video

[![UniMart demo video (1:48)](docs/demo/poster.jpg)](docs/demo/UniMart-Campus-Demo.mp4)

A 1:48 narrated walkthrough recorded from the running app: storefront, checkout with
payment-slip upload, and the admin console confirming the payment and moving the order to
packing. Click the image to play it, or download
[UniMart-Campus-Demo.mp4](docs/demo/UniMart-Campus-Demo.mp4) (1920×1080, 18 MB) with
[English subtitles](docs/demo/UniMart-Campus-Demo.srt).

## For the marker

This repository is **public** — open it in an incognito window to confirm it is readable.

**Stack note:** this is a **Python 3 project** (standard library + SQLite) with a vanilla-JavaScript
front end. There is **no pom.xml and no Spring Boot** here; the commands below are the complete
setup and there is nothing to compile or install.

**Run it — step by step:**

    git clone https://github.com/zawwinhtutdev/unimart-campus.git
    cd unimart-campus
    python3 server.py

Then open:

| What | URL |
| --- | --- |
| Storefront | http://127.0.0.1:8000/ |
| Checkout | http://127.0.0.1:8000/checkout.html |
| Admin dashboard | http://127.0.0.1:8000/admin/ |

Test login for the dashboard:

| Username | Password | Role |
| --- | --- | --- |
| admin | unimart123 | full access |
| manager | manager123 | day-to-day; cannot archive products |

These are **demo accounts created by the seed file for local grading** — not secrets. No API keys,
tokens or real credentials are committed anywhere in this repository. Change them before any real
deployment.

The database is created automatically on first run at data/store.db. To reset the demo data:
python3 server.py --reset

### Group members

| Student ID | Full name |
| --- | --- |
| 6631503101 | Zaw Win Htut |

### What each member built

**Solo submission** — Zaw Win Htut designed, built and tested the entire project.

| Area | Work |
| --- | --- |
| Storefront | Shelf UI, baht/USD currency switch, search, cart, sold-out handling |
| Checkout | Address form, three payment methods, PromptPay QR generation, slip upload |
| Accounts | Sign-up/sign-in, sessions, order history |
| Admin console | Dashboard, inventory CRUD, stock ledger, orders, payment review queue |
| Backend | SQLite schema and seed, JSON API, auth, CSRF, rate limiting, static server |
| Quality | 30 API tests, CI workflow, screenshots and documentation |

All 17 commits in this repository are under the **zawwinhtutdev** GitHub account.

---

## Overview

Two apps, one process, one database:

| | |
|---|---|
| 🛒 **Storefront** | Four shelves of groceries priced in Thai baht, with search, favourites, cart and full checkout. |
| 🛠 **Admin console** | Inventory, orders, a 14-day revenue chart, a stock ledger and a payment-slip review queue. |
| 🗄 **Backend** | A single Python file: SQLite schema, seed data, sessions, CSRF, rate limiting and a JSON API. |

The whole thing runs with one command and **zero external dependencies** — no
`npm install`, no `pip install`, no build step.

<div align="center">
<img src="docs/screenshots/storefront-thb.png" alt="Storefront" width="49%">
<img src="docs/screenshots/admin-dashboard.png" alt="Admin dashboard" width="49%">
</div>

---

## Screenshots

**Storefront and checkout**

| | |
|---|---|
| ![Storefront in baht](docs/screenshots/storefront-thb.png) | ![Checkout with PromptPay QR](docs/screenshots/checkout-desktop.png) |
| ![Order confirmation with slip upload](docs/screenshots/checkout-upload.png) | ![Account and order history](docs/screenshots/account-history.png) |

**Admin console**

| | |
|---|---|
| ![Dashboard](docs/screenshots/admin-dashboard.png) | ![Inventory](docs/screenshots/admin-inventory.png) |
| ![Payments queue](docs/screenshots/admin-payments.png) | |

<details>
<summary><b>More screenshots</b> — stock history, day drill-down, product form, mobile</summary>

| | | |
|---|---|---|
| ![Stock history](docs/screenshots/admin-movements.png) | ![Day detail](docs/screenshots/admin-day-detail.png) | ![Product form](docs/screenshots/admin-product-form.png) |
| ![Order detail](docs/screenshots/admin-order-detail.png) | ![Stock adjust](docs/screenshots/admin-stock-adjust.png) | ![Sign in](docs/screenshots/account-signin.png) |
| ![Orders](docs/screenshots/admin-orders.png) | ![Admin sign in](docs/screenshots/admin-login.png) | ![Order confirmation](docs/screenshots/checkout-success.png) |
| ![Storefront in dollars](docs/screenshots/storefront-usd.png) | ![Account on mobile](docs/screenshots/account-mobile.png) | ![Admin menu on mobile](docs/screenshots/admin-mobile-menu.png) |
| ![Mobile inventory](docs/screenshots/admin-mobile-inventory.png) | ![Mobile storefront](docs/screenshots/storefront-mobile.png) | ![Mobile checkout](docs/screenshots/checkout-mobile.png) |

</details>

---

## Quick start

```bash
git clone https://github.com/zawwinhtutdev/unimart-campus.git
cd unimart-campus
python3 server.py
```

| URL | What it is |
|---|---|
| <http://127.0.0.1:8000/> | the storefront |
| <http://127.0.0.1:8000/checkout.html> | checkout (reached from the cart) |
| <http://127.0.0.1:8000/admin/> | the admin console |

**Staff accounts**

| Username | Password | Role |
|---|---|---|
| `admin` | `unimart123` | full access, including archiving products |
| `manager` | `manager123` | day-to-day operations; cannot archive or delete |

**Shopper accounts** are created from the storefront profile icon — sign up with
any email and an 8+ character password.

```bash
python3 server.py --port 9000     # different port
python3 server.py --reset         # reseed demo data (shopper accounts are kept)
```

> The database is created and seeded on first run at `data/store.db`. It is
> git-ignored; delete it (or `--reset`) for a clean slate.

**Live:** the storefront UI is deployed at <https://unimart-campus-app.vercel.app/>
(static host). For accounts, checkout, payments and the admin console, run the app
locally as above — or deploy the full app with [DEPLOY.md](DEPLOY.md) (Render/Docker).

---

## Walkthrough

1. **Storefront** — 66 products on four shelves, priced in baht. Six are sold out
   and cannot be added to the cart. The **฿ / $** control switches currency.
2. **Account** — click the profile icon → *Create account*. Orders placed while
   signed in land in *Your orders*.
3. **Cart → Checkout** — press *Place order* in the cart; a full page opens with
   the delivery address and three payment methods.
4. **Payment slip** — after placing the order, upload a screenshot of the
   transfer. The shop is notified and the order waits for review.
5. **Admin → Payments** — the slip is queued with a sidebar badge. Check it
   against the amount, then **Confirm payment** (or reject with a reason).
   Confirming releases the order to packing.
6. **Dashboard** — KPIs, a 14-day revenue chart where **every column is
   clickable**, top sellers, restock shortcuts and an activity feed.
7. **Inventory** — search, filter, sort, paginate, edit, archive, or adjust stock
   with a reason. Every change is written to the ledger.
8. **Stock history** — the append-only movement log; each product's movements sum
   exactly to its current stock.

---

## Features

<table>
<tr><td valign="top" width="50%">

**Storefront**
- 66 products, four shelves, real product imagery
- Baht base currency with a one-click USD view (fixed 35.5 rate)
- Sold-out marking, favourites, search and aisle menu
- Responsive down to 320px

**Checkout**
- Full-page flow: address → payment → confirmation
- Three payment methods: **PromptPay QR** (real, scannable, generated per order),
  **bank transfer**, **PromptPay ID**
- Payment-slip upload with preview and token-bound security
- Delivery is **gated** on staff confirmation

**Accounts**
- Sign up / sign in / sign out, 30-day sessions
- PBKDF2 passwords, rate-limited auth
- Order history with items, totals and payment state
- Guest checkout still works

</td><td valign="top" width="50%">

**Admin console**
- Dashboard with KPIs, revenue chart, top sellers, low-stock list
- Inventory CRUD, archive/restore, CSV export
- Stock adjustments with reason and full audit trail
- Orders: status workflow, delivery details, payment method
- **Payments queue**: review slips, confirm or reject
- Clickable chart drill-down to a day's orders

**Platform**
- Python standard library only; SQLite; no ORM
- Session cookies, CSRF on every mutation, per-IP rate limits
- Static serving by allowlist (source, data and evidence never exposed)
- Deterministic demo data sized for a campus mini-store
- 30 API tests + CI

</td></tr>
</table>

---

## Architecture

```
browser
  │
  ├── GET /                    storefront        (index.html, css/app.css, js/*)
  ├── GET /checkout.html       checkout page     (js/checkout.js + QR encoder)
  ├── GET /admin/              admin console     (admin/*)
  │
  └── /api/*  ──►  server.py  ──►  SQLite (data/store.db)
                    │
                    ├── staff sessions     fcs cookie  ─┐
                    ├── shopper sessions   fcc cookie  ─┴─ PBKDF2 + CSRF + rate limits
                    ├── JSON API + static file allowlist
                    └── payment slips on disk (data/proofs/, staff-only)
```

**Stack:** Python 3.12 standard library (`http.server`, `sqlite3`, `hashlib`,
`hmac`, `secrets`, `csv`) · SQLite · vanilla JS · hand-written CSS ·
GitHub Actions for CI.

<details>
<summary><b>Data model</b></summary>

| Table | Purpose |
|---|---|
| `products` | id, name, SKU, aisle, baht price, price source, stock, reorder point, active |
| `orders` | reference, customer, totals, fulfilment, payment method, payment status, slip, delivery address |
| `order_items` | line items with snapshotted name and unit price |
| `movements` | append-only stock ledger incl. resulting balance |
| `customers` / `customer_sessions` | shopper accounts and their 30-day sessions |
| `users` / `sessions` | staff accounts and sessions |

</details>

<details>
<summary><b>API reference</b></summary>

All responses are JSON. Mutations require the `X-CSRF-Token` from login/me.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | — | create a shopper account |
| POST | `/api/auth/login` | — | shopper sign-in |
| POST | `/api/auth/logout` | shopper | sign out |
| GET | `/api/auth/me` | shopper | current shopper + CSRF |
| GET | `/api/auth/orders` | shopper | own orders with items |
| POST | `/api/login` | — | **staff** sign-in |
| GET | `/api/stats` | staff | KPIs, 14-day series, top sellers |
| GET | `/api/products` | staff | list with search/filter/sort/paging |
| POST · PATCH · DELETE | `/api/products[/{id}]` | staff | create, update, archive |
| POST | `/api/products/{id}/stock` | staff | stock delta with reason |
| GET | `/api/movements` | staff | stock ledger |
| GET | `/api/orders` · `/api/orders/{id}` | staff | orders and details |
| PATCH | `/api/orders/{id}` | staff | status (blocked until payment confirmed) |
| GET | `/api/payments` | staff | payment queue with counts |
| GET | `/api/payments/{id}/proof` | staff | slip image |
| POST | `/api/payments/{id}/confirm` | staff | confirm or reject a slip |
| GET | `/api/export/products.csv` | staff | CSV export |
| GET | `/api/public/catalog` | — | storefront catalogue with stock flags |
| POST | `/api/public/orders` | — | place an order (address + payment required) |
| POST | `/api/public/orders/{id}/proof` | token | upload a payment slip |

Errors are `{"error": "..."}` with meaningful statuses: 401, 403, 404, 409
(conflict), 422 (validation), 429 (rate limit).

</details>

---

## Testing

```bash
python3 -m unittest discover -s tests -v     # 30 tests, ~4 s
```

Tests run against a throwaway database in a temporary directory, so they never
touch your demo data. They cover authentication and CSRF, product validation and
duplicate SKUs, pagination and filters, stock deltas and overdraw, the ledger,
storefront orders, cancellation restocking, sold-out handling, role restrictions,
CSV export, static-file allowlisting and path traversal, shopper accounts, and
the payment-slip flow (token checks, file validation, staff-only access,
release-on-confirm, rejection rules).

CI runs the suite and a JavaScript syntax check on every push:

[![Tests](https://github.com/zawwinhtutdev/unimart-campus/actions/workflows/tests.yml/badge.svg)](https://github.com/zawwinhtutdev/unimart-campus/actions/workflows/tests.yml)

---

## Project structure

```
server.py                 schema, seed, auth, JSON API, static server
checkout.html             full-page checkout
admin/                    admin console (index.html, admin.css, admin.js)
css/                      storefront and checkout styles
js/                       storefront scripts, account panel, checkout logic
js/vendor/qrcode.js       MIT QR encoder (payment QR)
assets/                   66 product images, 5 webfonts, favicon
data/                     seed_catalog.json, store.db (ignored), proofs/ (ignored)
tests/test_api.py         30 API tests
tools/generate_seed.mjs   rebuilds the seed catalogue from js/data.js
docs/                     banner, screenshots, asset credits
```

---

## Design credit

The storefront's visual design is a study reconstruction of a public grocery
concept demo. Everything that makes this a working shop — the admin console,
inventory and stock ledger, customer accounts, checkout with PromptPay / bank /
QR, payment-slip verification, the API and the test suite — was built for this
project.

Prices are a curated Thai baht catalogue, and the product photographs belong to
their brands (see [docs/ASSETS.md](docs/ASSETS.md)).

---

## Credits and licence

Code is [MIT licensed](LICENSE). Fonts (Bricolage Grotesque, Figtree), product
imagery and the QR encoder are third-party assets with their own terms — see
[docs/ASSETS.md](docs/ASSETS.md).

The storefront's visual design is a study reconstruction of a public grocery concept
demo (freshcarta.netlify.app); all application code was built for this project. It is
not affiliated with or endorsed by that project or any brand shown.
