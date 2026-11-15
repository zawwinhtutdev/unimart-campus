# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-11-15

First complete release: a campus mini mart with a storefront, an admin console
and a verified payment workflow.

### Storefront
- Four grocery shelves priced in Thai baht, with a one-click USD view at a fixed
  rate and whole-baht prices.
- Search, favourites, cart and a sold-out state that blocks adding to the cart.
- Curated Thai retail prices with a per-product price source.

### Checkout
- Full-page checkout: delivery address, live order summary and three payment
  methods — scannable PromptPay QR generated per order, bank transfer and
  PromptPay ID.
- Payment-slip upload with preview, bound to the order by a random token.

### Customer accounts
- Sign up, sign in and sign out; 30-day sessions and PBKDF2 password hashing.
- Order history with items, totals, fulfilment and payment state.
- Guest checkout still supported.

### Admin console
- Dashboard with KPIs, a clickable 14-day revenue chart, top sellers, restock
  shortcuts and an activity feed.
- Inventory: search, filters, sorting, pagination, create/edit/archive, stock
  adjustments with a reason, CSV export.
- Orders with delivery and payment details.
- Payments: a slip review queue with confirm/reject; delivery is blocked until
  the payment is confirmed.
- Stock history: an append-only movement ledger that reconciles with stock.

### Platform
- Zero-dependency Python server: schema, deterministic seed, sessions, CSRF,
  rate limiting, JSON API and a static-file allowlist.
- 30 API tests and a GitHub Actions workflow for tests and JavaScript syntax.
