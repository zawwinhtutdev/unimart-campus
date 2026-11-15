#!/usr/bin/env python3
"""
UniMart Admin - application server.

Zero external dependencies: Python 3 standard library only (http.server,
sqlite3, hashlib, hmac, secrets, csv, json). It does three jobs:

  1. serves the existing static storefront unchanged (index.html, css/, js/,
     assets/) so the replica keeps its no-build-step property;
  2. serves the admin console at /admin/;
  3. exposes a JSON REST API at /api/ backed by SQLite, with session-cookie
     authentication, PBKDF2 password hashing, CSRF tokens on mutations and
     an append-only stock movement ledger.

Run:  python3 server.py            (http://127.0.0.1:8000)
      python3 server.py --port 9000 --reset
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import io
import json
import mimetypes
import os
import random
import re
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
# FC_DB lets the test suite point the server at a throwaway database.
DB_PATH = Path(os.environ.get("FC_DB") or (DATA_DIR / "store.db"))
SEED_PATH = DATA_DIR / "seed_catalog.json"

SESSION_COOKIE = "fcs"            # staff session (admin console)
CUSTOMER_COOKIE = "fcc"           # shopper session (storefront)
CUSTOMER_SESSION_DAYS = 30
SESSION_HOURS = 12
LOGIN_LIMIT = int(os.environ.get("FC_LOGIN_LIMIT", "10"))   # attempts per IP per 5 min
PBKDF2_ROUNDS = 260_000
MAX_BODY = 1 << 20          # 1 MiB request body cap
MAX_PROOF_BODY = 8 << 20    # slips are uploaded as base64 JSON, so allow headroom
MAX_PROOF_BYTES = 5 << 20   # decoded image cap
PROOF_DIR = DB_PATH.parent / "proofs"     # follows FC_DB, so tests stay in tmp
PAYMENT_STATUSES = ["awaiting", "submitted", "confirmed", "rejected"]
FREE_AT = 500.0             # free delivery threshold in baht, matches the storefront
FEE = 39.0                  # delivery fee in baht below the threshold

DAILY_REVENUE_MIN = 1000      # seeded daily takings, in baht
DAILY_REVENUE_MAX = 5000

SHELF_NAMES = {
    "produce": "Fresh Produce",
    "dairy": "Dairy, Eggs & Deli",
    "pantry": "Pantry & Snacks",
    "drinks": "Drinks",
}
REASONS = ["restock", "sale", "adjustment", "damage", "return", "opening"]
# There is no unpaid state: walk-in orders are paid at the counter and delivery
# orders are prepaid, so every order starts at "paid".
ORDER_STATUSES = ["paid", "packing", "shipped", "delivered", "cancelled"]
FULFILMENTS = ["walk-in", "delivery"]
# payment options offered at checkout
PAYMENT_METHODS = ["qr", "bank", "promptpay"]
PAYMENT_LABELS = {"qr": "QR code", "bank": "Bank transfer", "promptpay": "PromptPay"}


# ---------------------------------------------------------------------------
# errors / helpers
# ---------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, status: int, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra or {}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def money(v: float) -> float:
    return round(float(v) + 1e-9, 2)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()


def status_of(stock: int, min_stock: int) -> str:
    if stock <= 0:
        return "out"
    if stock <= min_stock:
        return "low"
    return "ok"


def product_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["shelf_name"] = SHELF_NAMES.get(d["shelf"], d["shelf"])
    d["status"] = status_of(d["stock"], d["min_stock"])
    d["value"] = money(d["stock"] * d["price"])
    d["active"] = bool(d["active"])
    return d


# ---------------------------------------------------------------------------
# schema + seed
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  id          TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  csrf        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sku        TEXT UNIQUE NOT NULL,
  shelf      TEXT NOT NULL,
  price      INTEGER NOT NULL CHECK (price >= 0),   -- base currency: Thai baht
  price_source TEXT,                                -- where the curated price came from
  stock      INTEGER NOT NULL CHECK (stock >= 0),
  min_stock  INTEGER NOT NULL DEFAULT 10 CHECK (min_stock >= 0),
  active     INTEGER NOT NULL DEFAULT 1,
  image      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ref        TEXT UNIQUE NOT NULL,
  customer   TEXT NOT NULL DEFAULT 'Walk-in customer',
  subtotal   REAL NOT NULL,
  fee        REAL NOT NULL DEFAULT 0,
  total      REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'paid',
  channel    TEXT NOT NULL DEFAULT 'web',
  fulfilment TEXT NOT NULL DEFAULT 'delivery',   -- walk-in (paid at counter) or prepaid delivery
  customer_id INTEGER,                           -- set when a signed-in shopper checks out
  ship_name  TEXT,
  ship_phone TEXT,
  ship_address TEXT,
  payment    TEXT,                               -- qr | bank | promptpay
  payment_status TEXT NOT NULL DEFAULT 'confirmed', -- awaiting | submitted | confirmed | rejected
  payment_proof  TEXT,                            -- stored slip image, reviewed by staff
  payment_note   TEXT,
  payment_uploaded_at TEXT,
  payment_checked_at TEXT,
  payment_checked_by TEXT,
  access_token   TEXT,                            -- lets a guest upload a slip for their own order
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  note        TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  stock_after INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_shelf  ON products(shelf);
CREATE INDEX IF NOT EXISTS idx_movements_prod  ON movements(product_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_order     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product   ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at);
"""


def init_db(reset: bool = False) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    kept_customers = []
    if reset and DB_PATH.exists():
        # Reseeding refreshes the demo catalogue and orders. Shopper accounts are
        # real user data, so carry them across the reset instead of deleting them.
        try:
            old = connect()
            kept_customers = [dict(r) for r in old.execute("SELECT * FROM customers").fetchall()]
            old.close()
        except sqlite3.Error:
            kept_customers = []
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(DB_PATH) + suffix)
            if p.exists():
                p.unlink()
    conn = connect()
    with conn:
        conn.executescript(SCHEMA)
        # lightweight migration: add columns introduced after a database was made
        order_cols = {r["name"] for r in conn.execute("PRAGMA table_info(orders)")}
        if "customer_id" not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN customer_id INTEGER")
        for col in ("ship_name", "ship_phone", "ship_address", "payment"):
            if col not in order_cols:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {col} TEXT")
        if "payment_status" not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'confirmed'")
        for col in ("payment_proof", "payment_note", "payment_uploaded_at", "payment_checked_at",
                    "payment_checked_by", "access_token"):
            if col not in order_cols:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {col} TEXT")
    if conn.execute("SELECT COUNT(*) c FROM products").fetchone()["c"] == 0:
        with conn:          # one transaction: seed commits atomically or not at all
            seed(conn)
    if kept_customers:
        with conn:
            for c in kept_customers:
                conn.execute(
                    "INSERT OR IGNORE INTO customers (id,name,email,password_hash,salt,created_at)"
                    " VALUES (?,?,?,?,?,?)",
                    (c["id"], c["name"], c["email"], c["password_hash"], c["salt"], c["created_at"]))
        print(f"  kept {len(kept_customers)} shopper account(s) across the reset")
    conn.close()


def seed(conn: sqlite3.Connection) -> None:
    """Seed products from data/seed_catalog.json, then synthesise a coherent
    30-day order history whose stock movements reconcile exactly with the
    current stock column. Every product's ledger sums to its opening balance."""
    catalog = json.loads(SEED_PATH.read_text())
    stamp = now()

    for p in catalog["products"]:
        conn.execute(
            "INSERT INTO products (id,name,sku,shelf,price,price_source,stock,min_stock,active,image,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (p["id"], p["name"], p["sku"], p["shelf"], p["price"], p.get("price_source"),
             p["stock"], p["min_stock"], p.get("active", 1), p.get("image"), stamp, stamp),
        )

    for username, password, role in (("admin", "unimart123", "admin"),
                                     ("manager", "manager123", "manager")):
        salt = secrets.token_hex(16)
        conn.execute(
            "INSERT INTO users (username,password_hash,salt,role,created_at) VALUES (?,?,?,?,?)",
            (username, hash_password(password, salt), salt, role, stamp),
        )

    rng = random.Random(20261115)
    products = [dict(r) for r in conn.execute("SELECT id,name,price,stock FROM products").fetchall()]
    customers = ["Amelia Hart", "Noah Silva", "Kateryna Bondar", "Diego Ramos", "Mei Lin",
                 "Samuel Okafor", "Priya Nair", "Lucas Meyer", "Hana Sato", "Walk-in customer"]
    addresses = [
        "12/4 Ratchadamnoen Rd, Tambon Si Phum, Mueang Chiang Rai 57000",
        "88 Moo 3, Tambon Nang Lae, Mueang Chiang Rai 57100",
        "245 Phahonyothin Rd, Tambon Wiang, Mueang Chiang Rai 57000",
        "9/1 Sanambin Rd, Tambon Rop Wiang, Mueang Chiang Rai 57000",
        "37 Moo 6, Tambon Tha Sai, Mueang Chiang Rai 57100",
    ]
    status_weights = (("delivered", 55), ("shipped", 18), ("packing", 10),
                      ("paid", 12), ("cancelled", 5))

    # Generate a day's orders until that day's takings land inside the target
    # band. A day is built from real baskets, so the bar heights in the dashboard
    # are an outcome of order lines rather than a number picked for the chart.
    orders = []
    for day in range(30, -1, -1):
        target = rng.randint(DAILY_REVENUE_MIN, DAILY_REVENUE_MAX - 900)   # headroom for the last basket
        day_total = 0.0
        for _ in range(80):                                                 # safety valve
            picks = rng.sample(products, rng.randint(1, 4))
            items = [(p, rng.randint(1, 3)) for p in picks]
            subtotal = money(sum(p["price"] * q for p, q in items))
            # walk-in customers take the basket with them and pay at the counter;
            # delivery orders are prepaid and carry the fee when small
            fulfilment = rng.choices(FULFILMENTS, weights=[62, 38])[0]
            fee = FEE if (fulfilment == "delivery" and subtotal < FREE_AT) else 0.0
            total = money(subtotal + fee)
            if day_total + total > DAILY_REVENUE_MAX and day_total >= DAILY_REVENUE_MIN:
                break
            created = (datetime.now() - timedelta(days=day, hours=rng.randint(0, 20),
                                                  minutes=rng.randint(0, 59))).strftime("%Y-%m-%d %H:%M:%S")
            status = rng.choices([s for s, _ in status_weights], weights=[w for _, w in status_weights])[0]
            buyer = rng.choice(customers)
            orders.append({"items": items, "subtotal": subtotal, "fee": fee,
                           "total": total, "status": status, "fulfilment": fulfilment,
                           "created_at": created, "customer": buyer,
                           "ship_name": buyer if fulfilment == "delivery" else None,
                           "ship_phone": ("08" + "".join(str(rng.randint(0, 9)) for _ in range(8)))
                                         if fulfilment == "delivery" else None,
                           "ship_address": rng.choice(addresses) if fulfilment == "delivery" else None,
                           "payment": rng.choice(PAYMENT_METHODS) if fulfilment == "delivery" else None})
            if status != "cancelled":
                day_total += total
            if day_total >= target:
                break

    orders.sort(key=lambda o: o["created_at"])
    for i, o in enumerate(orders, start=1):
        o["ref"] = f"FC-{o['created_at'][:4]}-{i:04d}"
        cur = conn.execute(
            "INSERT INTO orders (ref,customer,subtotal,fee,total,status,channel,fulfilment,"
            "ship_name,ship_phone,ship_address,payment,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (o["ref"], o["customer"], o["subtotal"], o["fee"], o["total"], o["status"], "web",
             o["fulfilment"], o["ship_name"], o["ship_phone"], o["ship_address"], o["payment"],
             o["created_at"]),
        )
        o["id"] = cur.lastrowid
        for p, qty in o["items"]:
            conn.execute(
                "INSERT INTO order_items (order_id,product_id,name,qty,unit_price) VALUES (?,?,?,?,?)",
                (o["id"], p["id"], p["name"], qty, p["price"]),
            )

    # Ledger: opening balance per product (current stock + everything sold),
    # then one negative movement per sold unit, in chronological order.
    sold: dict[str, int] = {}
    for o in orders:
        if o["status"] == "cancelled":
            continue
        for p, qty in o["items"]:
            sold[p["id"]] = sold.get(p["id"], 0) + qty

    opening_at = (datetime.now() - timedelta(days=31)).strftime("%Y-%m-%d %H:%M:%S")
    balance: dict[str, int] = {}
    for p in products:
        opening = p["stock"] + sold.get(p["id"], 0)
        balance[p["id"]] = opening
        conn.execute(
            "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (p["id"], opening, "opening", "Opening balance (demo data)", "system", opening, opening_at),
        )
    for o in orders:
        if o["status"] == "cancelled":
            continue
        for p, qty in o["items"]:
            balance[p["id"]] -= qty
            conn.execute(
                "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (p["id"], -qty, "sale", f"Order {o['ref']}", "storefront", balance[p["id"]], o["created_at"]),
            )
    for p in products:
        if balance[p["id"]] != p["stock"]:
            print(f"  ! ledger drift for {p['id']}: {balance[p['id']]} != {p['stock']}")
    print(f"  seeded {len(products)} products, {len(orders)} orders")


# ---------------------------------------------------------------------------
# rate limiting (login)
# ---------------------------------------------------------------------------
_attempts: dict[str, list] = {}
_attempt_lock = __import__("threading").Lock()


def rate_limit(key: str, limit: int = 10, window: int = 300) -> None:
    with _attempt_lock:
        bucket = _attempts.setdefault(key, [])
        cutoff = time.time() - window
        bucket[:] = [t for t in bucket if t > cutoff]
        if len(bucket) >= limit:
            raise ApiError(429, "Too many attempts. Try again in a few minutes.")
        bucket.append(time.time())


# ---------------------------------------------------------------------------
# request handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "UniMartAdmin/1.0"
    protocol_version = "HTTP/1.1"

    # -- plumbing ----------------------------------------------------------
    def log_message(self, fmt, *args):
        if os.environ.get("FC_QUIET"):
            return
        sys.stderr.write("%s  %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    def _headers(self, status, ctype, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def send_json(self, payload, status=200, extra=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self._headers(status, "application/json; charset=utf-8", len(body), extra)
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error_json(self, status, message, extra=None):
        self.send_json({"error": message, **(extra or {})}, status)

    def body(self, limit: int = MAX_BODY) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Bad Content-Length")
        if length > limit:
            raise ApiError(413, "Request body too large")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON body")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON body must be an object")
        return data

    def cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = SimpleCookie(raw)
            return jar[name].value if name in jar else None
        except Exception:
            return None

    def session(self):
        sid = self.cookie(SESSION_COOKIE)
        if not sid:
            return None
        conn = connect()
        try:
            row = conn.execute(
                "SELECT s.id, s.csrf, s.expires_at, u.id AS uid, u.username, u.role"
                " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", (sid,)
            ).fetchone()
            if not row:
                return None
            if row["expires_at"] < now():
                with conn:
                    conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
                return None
            return dict(row)
        finally:
            conn.close()

    def require(self) -> dict:
        s = self.session()
        if not s:
            raise ApiError(401, "Not authenticated")
        if self.command in ("POST", "PATCH", "PUT", "DELETE"):
            token = self.headers.get("X-CSRF-Token") or ""
            if not hmac.compare_digest(token, s["csrf"]):
                raise ApiError(403, "Invalid CSRF token")
        return s

    # -- shopper accounts --------------------------------------------------
    def customer_session(self):
        sid = self.cookie(CUSTOMER_COOKIE)
        if not sid:
            return None
        conn = connect()
        try:
            row = conn.execute(
                "SELECT s.id, s.csrf, s.expires_at, c.id AS cid, c.name, c.email"
                " FROM customer_sessions s JOIN customers c ON c.id = s.customer_id"
                " WHERE s.id = ?", (sid,)
            ).fetchone()
            if not row:
                return None
            if row["expires_at"] < now():
                with conn:
                    conn.execute("DELETE FROM customer_sessions WHERE id = ?", (sid,))
                return None
            return dict(row)
        finally:
            conn.close()

    def require_customer(self) -> dict:
        s = self.customer_session()
        if not s:
            raise ApiError(401, "Please sign in")
        if self.command in ("POST", "PATCH", "PUT", "DELETE"):
            token = self.headers.get("X-CSRF-Token") or ""
            if not hmac.compare_digest(token, s["csrf"]):
                raise ApiError(403, "Invalid CSRF token")
        return s

    def start_customer_session(self, conn, customer_id: int):
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(days=CUSTOMER_SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        with conn:
            conn.execute("DELETE FROM customer_sessions WHERE expires_at < ?", (now(),))
            conn.execute(
                "INSERT INTO customer_sessions (id,customer_id,csrf,created_at,expires_at)"
                " VALUES (?,?,?,?,?)", (sid, customer_id, csrf, now(), expires))
        return sid, csrf

    # -- verbs -------------------------------------------------------------
    def do_GET(self):    self.dispatch("GET")
    def do_HEAD(self):   self.dispatch("HEAD")
    def do_POST(self):   self.dispatch("POST")
    def do_PATCH(self):  self.dispatch("PATCH")
    def do_DELETE(self): self.dispatch("DELETE")

    def dispatch(self, method):
        try:
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            if path.startswith("/api/"):
                self.api(method, path, query)
            elif method in ("GET", "HEAD") and not path.startswith("/api/"):
                self.static(path)
            else:
                raise ApiError(405, "Method not allowed")
        except ApiError as e:
            self.send_error_json(e.status, e.message, e.extra)
        except BrokenPipeError:
            pass
        except Exception as e:  # pragma: no cover - defensive
            import traceback
            traceback.print_exc()
            try:
                self.send_error_json(500, "Internal server error")
            except Exception:
                pass

    # -- static ------------------------------------------------------------
    # Allowlist: only the storefront's public files and the admin bundle are
    # reachable. Source, the database, tests and the capture evidence in
    # _capture/ are never served, whatever path is requested.
    PUBLIC_DIRS = {"assets", "css", "js", "admin"}

    def static(self, path: str):
        if path == "/admin":
            self.send_response(301)
            self.send_header("Location", "/admin/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        parts = [p for p in path.split("/") if p]
        if not parts:
            parts = ["index.html"]
        if any(p in (".", "..") or p.startswith(".") for p in parts):
            return self.send_error_json(404, "Not found")

        if parts[0] == "admin":
            base, rest = ROOT / "admin", parts[1:] or ["index.html"]
        elif parts[0] in self.PUBLIC_DIRS:
            base, rest = ROOT, parts
        elif len(parts) == 1 and parts[0] in ("index.html", "checkout.html"):
            base, rest = ROOT, parts
        else:
            return self.send_error_json(404, "Not found")

        target = base.joinpath(*rest).resolve()
        if base.resolve() not in target.parents and target != base.resolve():
            return self.send_error_json(404, "Not found")
        if not target.is_file():
            return self.send_error_json(404, "Not found")

        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        data = target.read_bytes()
        self._headers(200, ctype, len(data))
        if self.command != "HEAD":
            self.wfile.write(data)

    # -- api router --------------------------------------------------------
    def api(self, method, path, query):
        routes = [
            ("POST",   r"/api/auth/signup",               self.h_signup),
            ("POST",   r"/api/auth/login",                self.h_customer_login),
            ("POST",   r"/api/auth/logout",               self.h_customer_logout),
            ("GET",    r"/api/auth/me",                   self.h_customer_me),
            ("GET",    r"/api/auth/orders",               self.h_customer_orders),
            ("POST",   r"/api/login",                     self.h_login),
            ("POST",   r"/api/logout",                    self.h_logout),
            ("GET",    r"/api/me",                        self.h_me),
            ("GET",    r"/api/health",                    self.h_health),
            ("GET",    r"/api/meta",                      self.h_meta),
            ("GET",    r"/api/stats",                     self.h_stats),
            ("GET",    r"/api/products",                  self.h_products_list),
            ("POST",   r"/api/products",                  self.h_product_create),
            ("GET",    r"/api/products/([\w-]+)",         self.h_product_one),
            ("PATCH",  r"/api/products/([\w-]+)",         self.h_product_update),
            ("DELETE", r"/api/products/([\w-]+)",         self.h_product_delete),
            ("POST",   r"/api/products/([\w-]+)/stock",   self.h_stock_adjust),
            ("GET",    r"/api/movements",                 self.h_movements),
            ("GET",    r"/api/orders",                    self.h_orders_list),
            ("GET",    r"/api/orders/(\d+)",              self.h_order_one),
            ("PATCH",  r"/api/orders/(\d+)",              self.h_order_update),
            ("GET",    r"/api/export/products.csv",       self.h_export_products),
            ("GET",    r"/api/public/catalog",            self.h_public_catalog),
            ("POST",   r"/api/public/orders",             self.h_public_order),
            ("POST",   r"/api/public/orders/(\d+)/proof", self.h_upload_proof),
            ("GET",    r"/api/payments",                  self.h_payments_list),
            ("GET",    r"/api/payments/(\d+)/proof",      self.h_payment_proof),
            ("POST",   r"/api/payments/(\d+)/confirm",    self.h_payment_confirm),
        ]
        path_matched = False
        for verb, pattern, fn in routes:
            m = re.fullmatch(pattern, path)
            if not m:
                continue
            if verb == method:
                return fn(m, query)
            path_matched = True        # same path, different verb -> 405 after the scan
        if path_matched:
            raise ApiError(405, "Method not allowed")
        raise ApiError(404, "Unknown endpoint")

    # -- auth --------------------------------------------------------------
    def h_health(self, m, q):
        self.send_json({"ok": True, "service": "unimart-admin", "time": now()})

    def h_login(self, m, q):
        ip = self.client_address[0]
        rate_limit("login:" + ip, limit=LOGIN_LIMIT)
        data = self.body()
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        if not username or not password:
            raise ApiError(400, "Username and password are required")
        conn = connect()
        try:
            user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if not user or not hmac.compare_digest(
                    hash_password(password, user["salt"]), user["password_hash"]):
                raise ApiError(401, "Invalid username or password")
            sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            expires = (datetime.now() + timedelta(hours=SESSION_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
            with conn:
                conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
                conn.execute(
                    "INSERT INTO sessions (id,user_id,csrf,created_at,expires_at) VALUES (?,?,?,?,?)",
                    (sid, user["id"], csrf, now(), expires))
            self.send_json({"user": {"username": user["username"], "role": user["role"]},
                            "csrf": csrf},
                           200, {"Set-Cookie": f"{SESSION_COOKIE}={sid}; HttpOnly; SameSite=Lax; Path=/; "
                                                 f"Max-Age={SESSION_HOURS * 3600}"})
        finally:
            conn.close()

    def h_logout(self, m, q):
        s = self.require()
        conn = connect()
        with conn:
            conn.execute("DELETE FROM sessions WHERE id = ?", (s["id"],))
        conn.close()
        self.send_json({"ok": True}, 200,
                       {"Set-Cookie": f"{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})

    def h_me(self, m, q):
        s = self.session()
        if not s:
            raise ApiError(401, "Not authenticated")
        self.send_json({"user": {"username": s["username"], "role": s["role"]}, "csrf": s["csrf"]})

    def h_meta(self, m, q):
        self.send_json({"shelves": [{"id": k, "name": v} for k, v in SHELF_NAMES.items()],
                        "reasons": REASONS, "statuses": ORDER_STATUSES})

    # -- shopper auth ------------------------------------------------------
    def h_signup(self, m, q):
        rate_limit("signup:" + self.client_address[0], limit=20)
        data = self.body()
        name = str(data.get("name", "")).strip()[:60]
        email = str(data.get("email", "")).strip().lower()[:120]
        password = str(data.get("password", ""))
        if not name:
            raise ApiError(422, "Please enter your name")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email or ""):
            raise ApiError(422, "Please enter a valid email address")
        if len(password) < 8:
            raise ApiError(422, "Password must be at least 8 characters")
        conn = connect()
        try:
            if conn.execute("SELECT 1 FROM customers WHERE email = ?", (email,)).fetchone():
                raise ApiError(409, "An account with that email already exists")
            salt = secrets.token_hex(16)
            with conn:
                cur = conn.execute(
                    "INSERT INTO customers (name,email,password_hash,salt,created_at) VALUES (?,?,?,?,?)",
                    (name, email, hash_password(password, salt), salt, now()))
                cid = cur.lastrowid
            sid, csrf = self.start_customer_session(conn, cid)
            self.send_json({"customer": {"id": cid, "name": name, "email": email}, "csrf": csrf},
                           201, {"Set-Cookie": self.customer_cookie(sid)})
        finally:
            conn.close()

    def customer_cookie(self, sid: str, clear: bool = False) -> str:
        if clear:
            return f"{CUSTOMER_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
        return (f"{CUSTOMER_COOKIE}={sid}; HttpOnly; SameSite=Lax; Path=/; "
                f"Max-Age={CUSTOMER_SESSION_DAYS * 86400}")

    def h_customer_login(self, m, q):
        rate_limit("customer-login:" + self.client_address[0], limit=LOGIN_LIMIT)
        data = self.body()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM customers WHERE email = ?", (email,)).fetchone()
            if not row or not hmac.compare_digest(hash_password(password, row["salt"]),
                                                  row["password_hash"]):
                raise ApiError(401, "Email or password is incorrect")
            sid, csrf = self.start_customer_session(conn, row["id"])
            self.send_json({"customer": {"id": row["id"], "name": row["name"], "email": row["email"]},
                            "csrf": csrf}, 200, {"Set-Cookie": self.customer_cookie(sid)})
        finally:
            conn.close()

    def h_customer_logout(self, m, q):
        s = self.require_customer()
        conn = connect()
        with conn:
            conn.execute("DELETE FROM customer_sessions WHERE id = ?", (s["id"],))
        conn.close()
        self.send_json({"ok": True}, 200, {"Set-Cookie": self.customer_cookie("", clear=True)})

    def h_customer_me(self, m, q):
        s = self.customer_session()
        if not s:
            raise ApiError(401, "Not signed in")
        self.send_json({"customer": {"id": s["cid"], "name": s["name"], "email": s["email"]},
                        "csrf": s["csrf"]})

    def h_customer_orders(self, m, q):
        s = self.require_customer()
        conn = connect()
        try:
            rows = conn.execute(
                "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
                (s["cid"],)).fetchall()
            items = []
            for o in rows:
                lines = conn.execute(
                    "SELECT i.product_id, i.name, i.qty, i.unit_price, p.image FROM order_items i"
                    " LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?",
                    (o["id"],)).fetchall()
                d = dict(o)
                d["items"] = [dict(x) for x in lines]
                items.append(d)
            self.send_json({"customer": {"id": s["cid"], "name": s["name"], "email": s["email"]},
                            "items": items, "total": len(items)})
        finally:
            conn.close()

    # -- stats -------------------------------------------------------------
    def h_stats(self, m, q):
        self.require()
        conn = connect()
        try:
            agg = conn.execute("""
                SELECT COUNT(*) total,
                       SUM(stock) units,
                       SUM(stock * price) value,
                       SUM(CASE WHEN stock > 0 AND stock <= min_stock THEN 1 ELSE 0 END) low,
                       SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) out
                FROM products WHERE active = 1""").fetchone()

            month = conn.execute("""
                SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders
                WHERE status != 'cancelled' AND created_at >= datetime('now','-30 days')""").fetchone()
            today = conn.execute("""
                SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders
                WHERE status != 'cancelled' AND date(created_at) = date('now','localtime')""").fetchone()

            series = []
            for i in range(13, -1, -1):
                day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
                row = conn.execute("""
                    SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders
                    WHERE status != 'cancelled' AND date(created_at) = ?""", (day,)).fetchone()
                series.append({"date": day, "orders": row["n"], "revenue": money(row["revenue"])})

            top = [dict(r) for r in conn.execute("""
                SELECT oi.product_id AS id, MAX(oi.name) AS name, MAX(p.image) AS image,
                       SUM(oi.qty) AS qty, ROUND(SUM(oi.qty * oi.unit_price), 2) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id AND o.status != 'cancelled'
                JOIN products p ON p.id = oi.product_id
                WHERE o.created_at >= datetime('now','-30 days')
                GROUP BY oi.product_id ORDER BY qty DESC LIMIT 6""").fetchall()]

            low_items = [product_row(r) for r in conn.execute(
                "SELECT * FROM products WHERE active = 1 AND stock <= min_stock"
                " ORDER BY (CAST(stock AS REAL) / MAX(min_stock,1)) ASC, stock ASC LIMIT 8").fetchall()]

            recent = [dict(r) for r in conn.execute("""
                SELECT m.id, m.product_id, m.delta, m.reason, m.note, m.actor, m.stock_after, m.created_at,
                       p.name AS product_name, p.image
                FROM movements m JOIN products p ON p.id = m.product_id
                ORDER BY m.id DESC LIMIT 8""").fetchall()]

            shelves = [dict(r) for r in conn.execute("""
                SELECT shelf, COUNT(*) count, SUM(stock) units, ROUND(SUM(stock*price),2) value,
                       SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) low
                FROM products WHERE active = 1 GROUP BY shelf ORDER BY shelf""").fetchall()]
            for s in shelves:
                s["name"] = SHELF_NAMES.get(s["shelf"], s["shelf"])

            total_orders = conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
            self.send_json({
                "kpis": {
                    "products": agg["total"], "units": agg["units"] or 0,
                    "value": money(agg["value"] or 0), "low": agg["low"] or 0, "out": agg["out"] or 0,
                    "orders_30d": month["n"], "revenue_30d": money(month["revenue"]),
                    "orders_today": today["n"], "revenue_today": money(today["revenue"]),
                    "avg_order": money(month["revenue"] / month["n"]) if month["n"] else 0.0,
                    "orders_total": total_orders,
                },
                "series": series, "top": top, "low_items": low_items,
                "recent": recent, "shelves": shelves,
            })
        finally:
            conn.close()

    # -- products ----------------------------------------------------------
    def h_products_list(self, m, q):
        self.require()
        search = (q.get("search") or "").strip()
        shelf = q.get("shelf") or ""
        status = q.get("status") or ""
        sort = q.get("sort") or "name"
        direction = "DESC" if (q.get("dir") or "asc").lower() == "desc" else "ASC"
        page = max(1, int(q.get("page") or 1))
        per = min(100, max(1, int(q.get("per") or 12)))
        include_inactive = q.get("inactive") == "1"

        sort_map = {"name": "name COLLATE NOCASE", "stock": "stock", "price": "price",
                    "sku": "sku", "shelf": "shelf", "updated": "updated_at", "value": "stock*price"}
        order_by = sort_map.get(sort, "name COLLATE NOCASE")

        where, params = [], []
        if not include_inactive and status != "inactive":
            where.append("active = 1")
        if status == "inactive":
            where.append("active = 0")
        if search:
            where.append("(name LIKE ? OR sku LIKE ? OR id LIKE ?)")
            params += [f"%{search}%"] * 3
        if shelf:
            where.append("shelf = ?")
            params.append(shelf)
        if status in ("ok", "low", "out"):
            if status == "out":
                where.append("stock <= 0")
            elif status == "low":
                where.append("stock > 0 AND stock <= min_stock")
            else:
                where.append("stock > min_stock")
        clause = (" WHERE " + " AND ".join(where)) if where else ""

        conn = connect()
        try:
            total = conn.execute(f"SELECT COUNT(*) c FROM products{clause}", params).fetchone()["c"]
            rows = conn.execute(
                f"SELECT * FROM products{clause} ORDER BY {order_by} {direction} LIMIT ? OFFSET ?",
                params + [per, (page - 1) * per]).fetchall()
            self.send_json({"items": [product_row(r) for r in rows], "page": page, "per": per,
                            "total": total, "pages": max(1, (total + per - 1) // per)})
        finally:
            conn.close()

    def h_product_one(self, m, q):
        self.require()
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM products WHERE id = ?", (m.group(1),)).fetchone()
            if not row:
                raise ApiError(404, "Product not found")
            moves = [dict(r) for r in conn.execute(
                "SELECT * FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 20",
                (m.group(1),)).fetchall()]
            self.send_json({"product": product_row(row), "movements": moves})
        finally:
            conn.close()

    def _validate_product(self, data, conn, existing=None) -> dict:
        name = str(data.get("name", existing["name"] if existing else "")).strip()
        sku = str(data.get("sku", existing["sku"] if existing else "")).strip().upper()
        shelf = str(data.get("shelf", existing["shelf"] if existing else "")).strip()
        if not name or len(name) > 120:
            raise ApiError(422, "Name is required (max 120 characters)")
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,23}", sku or ""):
            raise ApiError(422, "SKU must be 2-24 characters: A-Z, 0-9, hyphen")
        if shelf not in SHELF_NAMES:
            raise ApiError(422, "Unknown shelf")
        try:
            price = int(round(float(data.get("price", existing["price"] if existing else 0))))
            stock = int(data.get("stock", existing["stock"] if existing else 0))
            min_stock = int(data.get("min_stock", existing["min_stock"] if existing else 10))
        except (TypeError, ValueError):
            raise ApiError(422, "Price and stock must be numeric")
        if price < 0 or price > 100000:
            raise ApiError(422, "Price must be a whole number of baht between 0 and 100000")
        if stock < 0 or min_stock < 0:
            raise ApiError(422, "Stock values cannot be negative")
        if min_stock > 100000 or stock > 1000000:
            raise ApiError(422, "Stock value out of range")
        image = data.get("image", existing["image"] if existing else None)
        source = str(data.get("price_source", existing["price_source"] if existing else "") or "").strip()[:120]
        clash = conn.execute("SELECT id FROM products WHERE sku = ?", (sku,)).fetchone()
        if clash and (not existing or clash["id"] != existing["id"]):
            raise ApiError(409, "That SKU is already in use")
        return {"name": name, "sku": sku, "shelf": shelf, "price": price, "price_source": source,
                "stock": stock, "min_stock": min_stock, "image": image}

    def h_product_create(self, m, q):
        s = self.require()
        data = self.body()
        conn = connect()
        try:
            v = self._validate_product(data, conn)
            pid = str(data.get("id") or "").strip().lower()
            if not pid:
                base = re.sub(r"[^a-z0-9]+", "-", v["name"].lower()).strip("-")[:40] or "product"
                pid, n = base, 2
                while conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
                    pid, n = f"{base}-{n}", n + 1
            elif not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,49}", pid):
                raise ApiError(422, "Product id must be lowercase letters, digits or hyphen")
            elif conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
                raise ApiError(409, "Product id already exists")
            stamp = now()
            with conn:
                conn.execute(
                    "INSERT INTO products (id,name,sku,shelf,price,price_source,stock,min_stock,active,image,created_at,updated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,1,?,?,?)",
                    (pid, v["name"], v["sku"], v["shelf"], v["price"], v["price_source"], v["stock"],
                     v["min_stock"], v["image"] or f"assets/products/{pid}.webp", stamp, stamp))
                if v["stock"]:
                    conn.execute(
                        "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                        " VALUES (?,?,?,?,?,?,?)",
                        (pid, v["stock"], "opening", "Product created", s["username"], v["stock"], stamp))
            row = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            self.send_json({"product": product_row(row)}, 201)
        finally:
            conn.close()

    def h_product_update(self, m, q):
        s = self.require()
        pid = m.group(1)
        data = self.body()
        conn = connect()
        try:
            existing = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            if not existing:
                raise ApiError(404, "Product not found")
            v = self._validate_product(data, conn, existing)
            stamp = now()
            with conn:
                conn.execute(
                    "UPDATE products SET name=?, sku=?, shelf=?, price=?, price_source=?, min_stock=?, image=?, updated_at=?"
                    " WHERE id=?",
                    (v["name"], v["sku"], v["shelf"], v["price"], v["price_source"], v["min_stock"],
                     v["image"], stamp, pid))
                if "stock" in data and v["stock"] != existing["stock"]:
                    delta = v["stock"] - existing["stock"]
                    conn.execute(
                        "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                        " VALUES (?,?,?,?,?,?,?)",
                        (pid, delta, "adjustment", "Edited via product form", s["username"], v["stock"], stamp))
                    conn.execute("UPDATE products SET stock=? WHERE id=?", (v["stock"], pid))
                if "active" in data:
                    if s["role"] != "admin":
                        raise ApiError(403, "Only an administrator can archive or restore products")
                    conn.execute("UPDATE products SET active=? WHERE id=?",
                                 (1 if data["active"] else 0, pid))
            row = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            self.send_json({"product": product_row(row)})
        finally:
            conn.close()

    def h_product_delete(self, m, q):
        s = self.require()
        if s["role"] != "admin":
            raise ApiError(403, "Only an administrator can delete products")
        pid = m.group(1)
        conn = connect()
        try:
            if not conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
                raise ApiError(404, "Product not found")
            with conn:
                conn.execute("UPDATE products SET active = 0, updated_at = ? WHERE id = ?", (now(), pid))
            self.send_json({"ok": True, "archived": pid})
        finally:
            conn.close()

    def h_stock_adjust(self, m, q):
        s = self.require()
        pid = m.group(1)
        data = self.body()
        try:
            delta = int(data.get("delta"))
        except (TypeError, ValueError):
            raise ApiError(422, "delta must be an integer")
        if delta == 0 or abs(delta) > 100000:
            raise ApiError(422, "delta must be a non-zero value under 100000")
        reason = str(data.get("reason") or "adjustment")
        if reason not in REASONS or reason in ("opening", "sale"):
            reason = "adjustment"
        note = str(data.get("note") or "").strip()[:200]
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            if not row:
                raise ApiError(404, "Product not found")
            new_stock = row["stock"] + delta
            if new_stock < 0:
                raise ApiError(409, f"Only {row['stock']} in stock - cannot remove {-delta}")
            with conn:
                conn.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?",
                             (new_stock, now(), pid))
                cur = conn.execute(
                    "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (pid, delta, reason, note, s["username"], new_stock, now()))
            fresh = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            self.send_json({"product": product_row(fresh), "movement_id": cur.lastrowid})
        finally:
            conn.close()

    # -- movements ---------------------------------------------------------
    def h_movements(self, m, q):
        self.require()
        page = max(1, int(q.get("page") or 1))
        per = min(100, max(1, int(q.get("per") or 20)))
        where, params = [], []
        if q.get("product"):
            where.append("m.product_id = ?")
            params.append(q["product"])
        if q.get("reason"):
            where.append("m.reason = ?")
            params.append(q["reason"])
        if q.get("q"):
            where.append("(p.name LIKE ? OR m.note LIKE ? OR m.actor LIKE ?)")
            params += [f"%{q['q']}%"] * 3
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        conn = connect()
        try:
            total = conn.execute(
                f"SELECT COUNT(*) c FROM movements m JOIN products p ON p.id=m.product_id{clause}",
                params).fetchone()["c"]
            rows = conn.execute(
                f"SELECT m.*, p.name AS product_name, p.image FROM movements m"
                f" JOIN products p ON p.id = m.product_id{clause}"
                f" ORDER BY m.id DESC LIMIT ? OFFSET ?", params + [per, (page - 1) * per]).fetchall()
            self.send_json({"items": [dict(r) for r in rows], "page": page, "per": per,
                            "total": total, "pages": max(1, (total + per - 1) // per)})
        finally:
            conn.close()

    # -- orders ------------------------------------------------------------
    def h_orders_list(self, m, q):
        self.require()
        page = max(1, int(q.get("page") or 1))
        per = min(100, max(1, int(q.get("per") or 10)))
        where, params = [], []
        if q.get("status"):
            where.append("o.status = ?")
            params.append(q["status"])
        if q.get("date"):
            day = q["date"]
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                raise ApiError(422, "date must be YYYY-MM-DD")
            where.append("date(o.created_at) = ?")
            params.append(day)
        if q.get("q"):
            where.append("(o.ref LIKE ? OR o.customer LIKE ?)")
            params += [f"%{q['q']}%"] * 2
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        conn = connect()
        try:
            total = conn.execute(f"SELECT COUNT(*) c FROM orders o{clause}", params).fetchone()["c"]
            rows = conn.execute(
                f"SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) items_count,"
                f" (SELECT COALESCE(SUM(qty),0) FROM order_items i WHERE i.order_id=o.id) units"
                f" FROM orders o{clause} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?",
                params + [per, (page - 1) * per]).fetchall()
            self.send_json({"items": [dict(r) for r in rows], "page": page, "per": per,
                            "total": total, "pages": max(1, (total + per - 1) // per)})
        finally:
            conn.close()

    def h_order_one(self, m, q):
        self.require()
        conn = connect()
        try:
            order = conn.execute("SELECT * FROM orders WHERE id = ?", (m.group(1),)).fetchone()
            if not order:
                raise ApiError(404, "Order not found")
            items = [dict(r) for r in conn.execute(
                "SELECT i.*, p.image FROM order_items i LEFT JOIN products p ON p.id = i.product_id"
                " WHERE i.order_id = ?", (m.group(1),)).fetchall()]
            self.send_json({"order": dict(order), "items": items})
        finally:
            conn.close()

    def h_order_update(self, m, q):
        s = self.require()
        data = self.body()
        status = str(data.get("status") or "")
        if status not in ORDER_STATUSES:
            raise ApiError(422, "Invalid order status")
        conn = connect()
        try:
            order = conn.execute("SELECT * FROM orders WHERE id = ?", (m.group(1),)).fetchone()
            if not order:
                raise ApiError(404, "Order not found")
            if order["status"] == status:
                return self.send_json({"order": dict(order)})
            if status in ("packing", "shipped", "delivered") and order["payment_status"] != "confirmed":
                raise ApiError(409, "Confirm the payment slip before processing this order")
            with conn:
                conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order["id"]))
                # cancelling a live order returns its units to stock, with a ledger entry
                if status == "cancelled" and order["status"] != "cancelled":
                    for it in conn.execute("SELECT * FROM order_items WHERE order_id = ?",
                                           (order["id"],)).fetchall():
                        prod = conn.execute("SELECT stock FROM products WHERE id = ?",
                                            (it["product_id"],)).fetchone()
                        if not prod:
                            continue
                        new = prod["stock"] + it["qty"]
                        conn.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?",
                                     (new, now(), it["product_id"]))
                        conn.execute(
                            "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                            " VALUES (?,?,?,?,?,?,?)",
                            (it["product_id"], it["qty"], "return", f"Cancelled {order['ref']}",
                             s["username"], new, now()))
                # un-cancelling re-takes stock
                elif order["status"] == "cancelled" and status != "cancelled":
                    for it in conn.execute("SELECT * FROM order_items WHERE order_id = ?",
                                           (order["id"],)).fetchall():
                        prod = conn.execute("SELECT stock FROM products WHERE id = ?",
                                            (it["product_id"],)).fetchone()
                        if not prod:
                            continue
                        new = max(0, prod["stock"] - it["qty"])
                        conn.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?",
                                     (new, now(), it["product_id"]))
                        conn.execute(
                            "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                            " VALUES (?,?,?,?,?,?,?)",
                            (it["product_id"], -(it["qty"]), "sale", f"Reopened {order['ref']}",
                             s["username"], new, now()))
            fresh = conn.execute("SELECT * FROM orders WHERE id = ?", (order["id"],)).fetchone()
            self.send_json({"order": dict(fresh)})
        finally:
            conn.close()

    # -- export ------------------------------------------------------------
    def h_export_products(self, m, q):
        self.require()
        conn = connect()
        try:
            rows = conn.execute("SELECT * FROM products ORDER BY shelf, sku").fetchall()
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["sku", "name", "shelf", "price_thb", "price_source", "stock",
                        "min_stock", "status", "value_thb", "active"])
            for r in rows:
                p = product_row(r)
                w.writerow([p["sku"], p["name"], p["shelf"], int(p["price"]),
                            p["price_source"] or "", p["stock"], p["min_stock"],
                            p["status"], f"{p['value']:.2f}", int(p["active"])])
            body = buf.getvalue().encode()
            self._headers(200, "text/csv; charset=utf-8", len(body),
                          {"Content-Disposition": 'attachment; filename="unimart-inventory.csv"'})
            if self.command != "HEAD":
                self.wfile.write(body)
        finally:
            conn.close()

    # -- public (storefront) ----------------------------------------------
    def h_public_catalog(self, m, q):
        conn = connect()
        try:
            rows = conn.execute(
                "SELECT id,name,price,shelf,stock,min_stock,image FROM products"
                " WHERE active = 1 ORDER BY shelf, sku").fetchall()
            self.send_json({"items": [{
                "id": r["id"], "name": r["name"], "price": r["price"], "shelf": r["shelf"],
                "image": r["image"], "stock": r["stock"],
                "sold_out": r["stock"] <= 0,
                "low": 0 < r["stock"] <= r["min_stock"],
            } for r in rows]})
        finally:
            conn.close()

    def h_upload_proof(self, m, q):
        """The shopper uploads a screenshot of their transfer for this order."""
        rate_limit("proof:" + self.client_address[0], limit=30)
        order_id = int(m.group(1))
        data = self.body(limit=MAX_PROOF_BODY)
        token = str(data.get("token") or "")
        image = data.get("image") or ""
        if not isinstance(image, str):
            raise ApiError(422, "Send the slip as an image data URL")
        parsed = re.match(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$", image)
        if not parsed:
            raise ApiError(422, "Upload a PNG, JPEG or WebP image")
        ext = {"png": "png", "jpeg": "jpg", "webp": "webp"}[parsed.group(1).split("/")[1]]
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", parsed.group(2)), validate=True)
        except Exception:
            raise ApiError(422, "That image could not be read")
        if len(raw) > MAX_PROOF_BYTES:
            raise ApiError(413, "That image is larger than 5 MB")
        if len(raw) < 128:
            raise ApiError(422, "That image looks empty")

        conn = connect()
        try:
            order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if not order:
                raise ApiError(404, "Order not found")
            if not order["access_token"] or not hmac.compare_digest(token, order["access_token"]):
                raise ApiError(403, "That upload link is not valid for this order")
            if order["status"] == "cancelled":
                raise ApiError(409, "This order was cancelled")
            PROOF_DIR.mkdir(parents=True, exist_ok=True)
            name = f"{order_id}-{secrets.token_hex(8)}.{ext}"
            (PROOF_DIR / name).write_bytes(raw)
            with conn:
                conn.execute(
                    "UPDATE orders SET payment_status='submitted', payment_proof=?, payment_note=NULL,"
                    " payment_uploaded_at=?, payment_checked_at=NULL, payment_checked_by=NULL WHERE id=?",
                    (name, now(), order_id))
            self.send_json({"ok": True, "payment_status": "submitted"}, 200)
        finally:
            conn.close()

    # -- staff payment review ---------------------------------------------
    def h_payments_list(self, m, q):
        self.require()
        wanted = q.get("status") or "submitted"
        if wanted not in PAYMENT_STATUSES and wanted != "all":
            raise ApiError(422, "Unknown payment status")
        conn = connect()
        try:
            counts = {r["payment_status"]: r["n"] for r in conn.execute(
                "SELECT payment_status, COUNT(*) n FROM orders GROUP BY payment_status").fetchall()}
            sql = ("SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) items_count"
                   " FROM orders o")
            params = []
            if wanted != "all":
                sql += " WHERE o.payment_status = ?"
                params.append(wanted)
            sql += " ORDER BY o.id DESC LIMIT 100"
            rows = conn.execute(sql, params).fetchall()
            self.send_json({"items": [dict(r) for r in rows], "counts": counts, "status": wanted})
        finally:
            conn.close()

    def h_payment_proof(self, m, q):
        self.require()
        conn = connect()
        try:
            row = conn.execute("SELECT payment_proof FROM orders WHERE id = ?",
                               (int(m.group(1)),)).fetchone()
        finally:
            conn.close()
        if not row or not row["payment_proof"]:
            raise ApiError(404, "No slip has been uploaded")
        path = PROOF_DIR / row["payment_proof"]
        if not path.is_file():
            raise ApiError(404, "The slip file is missing")
        ctype = {"png": "image/png", "webp": "image/webp"}.get(path.suffix.lstrip("."), "image/jpeg")
        body = path.read_bytes()
        self._headers(200, ctype, len(body), {"Cache-Control": "no-store"})
        if self.command != "HEAD":
            self.wfile.write(body)

    def h_payment_confirm(self, m, q):
        s = self.require()
        data = self.body()
        action = str(data.get("action") or "")
        note = str(data.get("note") or "").strip()[:200]
        if action not in ("confirm", "reject"):
            raise ApiError(422, "action must be confirm or reject")
        if action == "reject" and not note:
            raise ApiError(422, "Add a reason for rejecting the slip")
        conn = connect()
        try:
            order = conn.execute("SELECT * FROM orders WHERE id = ?", (int(m.group(1)),)).fetchone()
            if not order:
                raise ApiError(404, "Order not found")
            if not order["payment_proof"]:
                raise ApiError(409, "No payment slip has been uploaded for this order")
            new_status = "confirmed" if action == "confirm" else "rejected"
            with conn:
                conn.execute(
                    "UPDATE orders SET payment_status=?, payment_note=?, payment_checked_at=?,"
                    " payment_checked_by=? WHERE id=?",
                    (new_status, note or None, now(), s["username"], order["id"]))
                if action == "confirm" and order["status"] == "paid":
                    # payment verified: the shop can start picking and packing
                    conn.execute("UPDATE orders SET status='packing' WHERE id=?", (order["id"],))
            fresh = conn.execute("SELECT * FROM orders WHERE id = ?", (order["id"],)).fetchone()
            self.send_json({"order": dict(fresh)})
        finally:
            conn.close()

    def h_public_order(self, m, q):
        ip = self.client_address[0]
        rate_limit("order:" + ip, limit=30, window=300)
        data = self.body()
        items = data.get("items")
        if not isinstance(items, dict) or not items:
            raise ApiError(422, "items must be a non-empty object of {productId: quantity}")
        shopper = self.customer_session()

        # delivery details + payment choice come from the checkout page
        addr = data.get("address")
        if not isinstance(addr, dict):
            raise ApiError(422, "A delivery address is required")
        payment = str(data.get("payment") or "")
        if payment not in PAYMENT_METHODS:
            raise ApiError(422, "Choose a payment method")
        ship_name = str(addr.get("name") or (shopper["name"] if shopper else "")).strip()[:60]
        phone = re.sub(r"\s+", "", str(addr.get("phone") or ""))[:20]
        line1 = str(addr.get("line1") or "").strip()[:120]
        line2 = str(addr.get("line2") or "").strip()[:120]
        city = str(addr.get("city") or "").strip()[:80]
        postcode = str(addr.get("postcode") or "").strip()
        if len(ship_name) < 2:
            raise ApiError(422, "Enter the recipient's name")
        if not re.fullmatch(r"\+?\d{9,15}", phone):
            raise ApiError(422, "Enter a valid phone number")
        if len(line1) < 5:
            raise ApiError(422, "Enter the delivery address")
        if len(city) < 2:
            raise ApiError(422, "Enter the city or province")
        if not re.fullmatch(r"\d{5}", postcode):
            raise ApiError(422, "Postcode must be 5 digits")
        ship_address = ", ".join([p for p in (line1, line2, city, postcode) if p])
        customer = shopper["name"] if shopper else (ship_name or "Guest")

        conn = connect()
        try:
            lines, subtotal, adjusted = [], 0.0, []
            for pid, qty in items.items():
                try:
                    qty = int(qty)
                except (TypeError, ValueError):
                    raise ApiError(422, "Quantities must be integers")
                if qty <= 0:
                    continue
                row = conn.execute("SELECT * FROM products WHERE id = ? AND active = 1",
                                   (str(pid),)).fetchone()
                if not row:
                    continue
                take = min(qty, row["stock"])
                if take <= 0:
                    adjusted.append({"id": pid, "reason": "sold out"})
                    continue
                if take < qty:
                    adjusted.append({"id": pid, "reason": f"only {take} available"})
                lines.append((row, take))
                subtotal += row["price"] * take
            if not lines:
                raise ApiError(409, "None of those products are in stock", {"adjusted": adjusted})
            subtotal = money(subtotal)
            fee = FEE if subtotal < FREE_AT else 0.0
            total = money(subtotal + fee)
            stamp = now()
            access_token = secrets.token_urlsafe(24)
            with conn:
                cur = conn.execute(
                    "INSERT INTO orders (ref,customer,subtotal,fee,total,status,channel,fulfilment,"
                    "customer_id,ship_name,ship_phone,ship_address,payment,payment_status,access_token,created_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("PENDING", customer, subtotal, fee, total, "paid", "web", "delivery",
                     shopper["cid"] if shopper else None, ship_name, phone, ship_address,
                     payment, "awaiting", access_token, stamp))
                oid = cur.lastrowid
                ref = f"FC-{stamp[:4]}-{oid:04d}"
                conn.execute("UPDATE orders SET ref = ? WHERE id = ?", (ref, oid))
                for row, take in lines:
                    conn.execute(
                        "INSERT INTO order_items (order_id,product_id,name,qty,unit_price)"
                        " VALUES (?,?,?,?,?)",
                        (oid, row["id"], row["name"], take, row["price"]))
                    new = row["stock"] - take
                    conn.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?",
                                 (new, stamp, row["id"]))
                    conn.execute(
                        "INSERT INTO movements (product_id,delta,reason,note,actor,stock_after,created_at)"
                        " VALUES (?,?,?,?,?,?,?)",
                        (row["id"], -take, "sale", f"Order {ref}", "storefront", new, stamp))
            self.send_json({"id": oid, "ref": ref, "total": total, "subtotal": subtotal, "fee": fee,
                            "items": len(lines), "adjusted": adjusted,
                            "customer": customer, "signed_in": bool(shopper),
                            "payment": payment, "payment_label": PAYMENT_LABELS.get(payment),
                            "payment_status": "awaiting", "access_token": access_token,
                            "ship_name": ship_name, "ship_phone": phone,
                            "ship_address": ship_address}, 201)
        finally:
            conn.close()


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="UniMart Admin server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--reset", action="store_true", help="drop and reseed the database")
    args = ap.parse_args()

    print("UniMart Admin")
    init_db(reset=args.reset)
    url = f"http://{args.bind}:{args.port}"
    print(f"  storefront  {url}/")
    print(f"  admin       {url}/admin/   (admin / unimart123)")
    print(f"  database    {DB_PATH.relative_to(ROOT)}")
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
        server.server_close()


if __name__ == "__main__":
    main()
