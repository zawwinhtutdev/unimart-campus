"""
API tests for the UniMart admin server.

Run:  python3 -m unittest discover -s tests -v

The suite starts the real HTTP handler in a background thread against a
throwaway SQLite file (FC_DB), so nothing here touches data/store.db.
"""
import base64
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_TMP = tempfile.mkdtemp(prefix="unimart-tests-")
os.environ["FC_DB"] = str(Path(_TMP) / "test.db")
os.environ["FC_QUIET"] = "1"
os.environ["FC_LOGIN_LIMIT"] = "10000"   # the suite logs in far more than a human would

import server  # noqa: E402  (import after FC_DB is set)


class Client:
    """Minimal cookie-aware HTTP client."""

    def __init__(self, base):
        self.base = base
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def request(self, method, path, body=None, csrf=True, headers=None):
        data = None
        hdrs = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        if csrf and self.csrf and method in ("POST", "PATCH", "DELETE"):
            hdrs["X-CSRF-Token"] = self.csrf
        req = urllib.request.Request(self.base + path, data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req) as r:
                raw = r.read()
                status = r.status
                ctype = r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
            ctype = e.headers.get("Content-Type", "")
        payload = None
        if "json" in ctype:
            payload = json.loads(raw.decode() or "null")
        else:
            payload = raw.decode("utf-8", "replace")
        return status, payload, ctype

    def login(self, username="admin", password="unimart123"):
        status, body, _ = self.request("POST", "/api/login",
                                       {"username": username, "password": password}, csrf=False)
        if status == 200:
            self.csrf = body["csrf"]
        return status, body


ORDER_ADDRESS = {
    "name": "Test Buyer",
    "phone": "0812345678",
    "line1": "12/4 Test Road, Tambon Si Phum",
    "line2": "",
    "city": "Mueang Chiang Rai",
    "postcode": "57000",
}


class UniMartApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db(reset=True)
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.httpd.daemon_threads = True
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        self.c = Client(self.base)
        status, _ = self.c.login()
        self.assertEqual(status, 200, "admin login should succeed")

    # -- basics ------------------------------------------------------------
    def test_health(self):
        status, body, _ = self.c.request("GET", "/api/health", csrf=False)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_requires_authentication(self):
        anon = Client(self.base)
        for path in ("/api/stats", "/api/products", "/api/orders", "/api/movements"):
            status, body, _ = anon.request("GET", path)
            self.assertEqual(status, 401, path)
            self.assertIn("error", body)

    def test_login_rejects_bad_password(self):
        status, body = Client(self.base).login(password="wrong")
        self.assertEqual(status, 401)

    def test_session_and_csrf_are_issued(self):
        status, body, _ = self.c.request("GET", "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["username"], "admin")
        self.assertTrue(body["csrf"])

    def test_mutations_require_csrf(self):
        no_csrf = Client(self.base)
        no_csrf.login()
        no_csrf.csrf = None
        status, body, _ = no_csrf.request("POST", "/api/products",
                                          {"name": "No Token", "sku": "NOPE-1", "shelf": "pantry",
                                           "price": 1, "stock": 1}, csrf=False)
        self.assertEqual(status, 403)
        self.assertIn("CSRF", body["error"])

    # -- catalogue ---------------------------------------------------------
    def test_stats_shape(self):
        status, body, _ = self.c.request("GET", "/api/stats")
        self.assertEqual(status, 200)
        kpis = body["kpis"]
        self.assertGreaterEqual(kpis["products"], 66)   # other tests may add products
        self.assertGreater(kpis["value"], 0)
        self.assertEqual(len(body["series"]), 14)
        self.assertLessEqual(len(body["top"]), 6)
        self.assertEqual(len(body["shelves"]), 4)

    def test_products_pagination_sorting_and_filters(self):
        status, body, _ = self.c.request("GET", "/api/products?per=5&page=2&sort=stock&dir=asc")
        self.assertEqual(status, 200)
        self.assertEqual(body["per"], 5)
        self.assertEqual(body["page"], 2)
        self.assertEqual(len(body["items"]), 5)
        self.assertEqual(body["pages"], -(-body["total"] // 5))   # ceil(total/per)
        stocks = [p["stock"] for p in body["items"]]
        self.assertEqual(stocks, sorted(stocks), "ascending stock sort")

        status, low, _ = self.c.request("GET", "/api/products?status=low&per=100")
        self.assertEqual(status, 200)
        self.assertGreater(low["total"], 0)
        for p in low["items"]:
            self.assertEqual(p["status"], "low")
            self.assertGreater(p["stock"], 0)
            self.assertLessEqual(p["stock"], p["min_stock"])

        status, search, _ = self.c.request("GET", "/api/products?search=milk")
        self.assertGreater(search["total"], 0)
        self.assertTrue(all("milk" in p["name"].lower() or "milk" in p["sku"].lower() for p in search["items"]))

    def test_product_create_validation_and_archive(self):
        payload = {"name": "Test Cocoa", "sku": "TST-COCOA", "shelf": "pantry",
                   "price": 35, "price_source": "test anchor", "stock": 7, "min_stock": 4}
        status, body, _ = self.c.request("POST", "/api/products", payload)
        self.assertEqual(status, 201)
        pid = body["product"]["id"]
        self.assertEqual(body["product"]["sku"], "TST-COCOA")
        self.assertEqual(body["product"]["status"], "ok")

        # duplicate SKU
        dup = dict(payload, name="Other", sku="TST-COCOA")
        status, body, _ = self.c.request("POST", "/api/products", dup)
        self.assertEqual(status, 409)

        # validation
        for bad, label in (
            (dict(payload, name="", sku="TST-2"), "empty name"),
            (dict(payload, name="X", sku="TST 3"), "space in sku"),
            (dict(payload, name="X", sku="TST-4", shelf="nope"), "unknown shelf"),
            (dict(payload, name="X", sku="TST-5", price=-1), "negative price"),
            (dict(payload, name="X", sku="TST-6", stock=-5), "negative stock"),
            (dict(payload, name="X", sku="TST-7", price=100001), "price out of range"),
        ):
            status, body, _ = self.c.request("POST", "/api/products", bad)
            self.assertEqual(status, 422, label)
            self.assertIn("error", body)

        # update price
        status, body, _ = self.c.request("PATCH", f"/api/products/{pid}", {"price": 425})
        self.assertEqual(status, 200)
        self.assertEqual(body["product"]["price"], 425)
        self.assertEqual(body["product"]["price_source"], "test anchor")

        # archive hides it from the active list
        status, _, _ = self.c.request("PATCH", f"/api/products/{pid}", {"active": False})
        self.assertEqual(status, 200)
        status, listed, _ = self.c.request("GET", "/api/products?search=TST-COCOA")
        self.assertEqual(listed["total"], 0)
        status, archived, _ = self.c.request("GET", "/api/products?status=inactive&search=TST-COCOA")
        self.assertEqual(archived["total"], 1)

        # restore
        status, _, _ = self.c.request("PATCH", f"/api/products/{pid}", {"active": True})
        self.assertEqual(status, 200)
        status, listed, _ = self.c.request("GET", "/api/products?search=TST-COCOA")
        self.assertEqual(listed["total"], 1)

    def test_prices_are_whole_baht(self):
        status, body, _ = self.c.request("POST", "/api/products",
                                         {"name": "Rounding Test", "sku": "TST-ROUND", "shelf": "pantry",
                                          "price": 35.4, "stock": 1})
        self.assertEqual(status, 201)
        self.assertEqual(body["product"]["price"], 35, "prices are stored as whole baht")
        self.assertIsInstance(body["product"]["price"], int)

        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        self.assertTrue(all(isinstance(p["price"], int) for p in catalog["items"]),
                        "the storefront catalogue publishes whole-baht prices")

    # -- stock ledger ------------------------------------------------------
    def test_stock_adjustments_write_ledger_entries(self):
        status, body, _ = self.c.request("POST", "/api/products",
                                         {"name": "Ledger Test", "sku": "TST-LEDGER", "shelf": "drinks",
                                          "price": 2, "stock": 10, "min_stock": 5})
        pid = body["product"]["id"]

        status, body, _ = self.c.request("POST", f"/api/products/{pid}/stock",
                                         {"delta": 10, "reason": "restock", "note": "PO 12"})
        self.assertEqual(status, 200)
        self.assertEqual(body["product"]["stock"], 20)

        status, body, _ = self.c.request("POST", f"/api/products/{pid}/stock",
                                         {"delta": -5, "reason": "damage"})
        self.assertEqual(status, 200)
        self.assertEqual(body["product"]["stock"], 15)
        self.assertEqual(body["product"]["status"], "ok")

        # cannot remove more than exists
        status, body, _ = self.c.request("POST", f"/api/products/{pid}/stock",
                                         {"delta": -999, "reason": "damage"})
        self.assertEqual(status, 409)

        # zero deltas are rejected
        status, body, _ = self.c.request("POST", f"/api/products/{pid}/stock", {"delta": 0})
        self.assertEqual(status, 422)

        status, moves, _ = self.c.request("GET", f"/api/movements?product={pid}&per=50")
        self.assertEqual(status, 200)
        reasons = [m["reason"] for m in moves["items"]]
        self.assertIn("opening", reasons)
        self.assertIn("restock", reasons)
        self.assertIn("damage", reasons)
        actors = {m["actor"] for m in moves["items"]}
        self.assertIn("admin", actors)
        # newest first
        self.assertEqual(moves["items"][0]["delta"], -5)

    # -- storefront orders -------------------------------------------------
    def test_public_order_decrements_stock_and_appears_in_admin(self):
        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        in_stock = [p for p in catalog["items"] if p["stock"] > 5]
        self.assertTrue(in_stock)
        target = in_stock[0]
        before = target["stock"]

        anon = Client(self.base)
        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {target["id"]: 2, "bananas": 1}, "address": ORDER_ADDRESS, "payment": "qr"}, csrf=False)
        self.assertEqual(status, 201)
        ref = body["ref"]
        self.assertTrue(ref.startswith("FC-"))
        self.assertGreater(body["total"], 0)
        self.assertEqual(body["payment"], "qr")
        self.assertEqual(body["payment_label"], "QR code")
        self.assertIn("Test Road", body["ship_address"])

        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        after = next(p for p in catalog["items"] if p["id"] == target["id"])["stock"]
        self.assertEqual(after, before - 2)

        status, orders, _ = self.c.request("GET", f"/api/orders?q={ref}")
        self.assertEqual(orders["total"], 1)
        order = orders["items"][0]
        self.assertEqual(order["status"], "paid", "orders start paid - there is no unpaid state")
        self.assertEqual(order["fulfilment"], "delivery", "storefront orders are prepaid delivery")
        self.assertEqual(order["units"], 3)

    def test_cancelling_an_order_returns_units_to_stock(self):
        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        target = next(p for p in catalog["items"] if p["stock"] > 5)
        before = target["stock"]

        anon = Client(self.base)
        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {target["id"]: 3}, "address": ORDER_ADDRESS, "payment": "bank"}, csrf=False)
        ref = body["ref"]
        status, orders, _ = self.c.request("GET", f"/api/orders?q={ref}")
        oid = orders["items"][0]["id"]

        status, body, _ = self.c.request("PATCH", f"/api/orders/{oid}", {"status": "cancelled"})
        self.assertEqual(status, 200)
        self.assertEqual(body["order"]["status"], "cancelled")

        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        after = next(p for p in catalog["items"] if p["id"] == target["id"])["stock"]
        self.assertEqual(after, before, "cancelling restores the stock")

        status, moves, _ = self.c.request("GET", f"/api/movements?product={target['id']}&per=5")
        self.assertIn("return", [m["reason"] for m in moves["items"]])

    def test_sold_out_product_cannot_be_ordered(self):
        status, catalog, _ = self.c.request("GET", "/api/public/catalog", csrf=False)
        sold = [p for p in catalog["items"] if p["sold_out"]]
        self.assertTrue(sold, "seed data should include sold-out products")
        anon = Client(self.base)
        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {sold[0]["id"]: 1}, "address": ORDER_ADDRESS, "payment": "promptpay"}, csrf=False)
        self.assertEqual(status, 409)
        self.assertIn("adjusted", body)

    def test_orders_can_be_filtered_by_day(self):
        status, orders, _ = self.c.request("GET", "/api/orders?per=5")
        self.assertEqual(status, 200)
        self.assertTrue(orders["items"], "seed data should contain orders")
        day = orders["items"][0]["created_at"][:10]

        status, filtered, _ = self.c.request("GET", f"/api/orders?date={day}&per=100")
        self.assertEqual(status, 200)
        self.assertTrue(filtered["total"] > 0)
        for o in filtered["items"]:
            self.assertTrue(o["created_at"].startswith(day))

        status, body, _ = self.c.request("GET", "/api/orders?date=not-a-date")
        self.assertEqual(status, 422)

    def test_order_validation(self):
        anon = Client(self.base)
        status, body, _ = anon.request("POST", "/api/public/orders", {"items": {}}, csrf=False)
        self.assertEqual(status, 422)
        status, body, _ = anon.request("POST", "/api/public/orders", {"items": "nope"}, csrf=False)
        self.assertEqual(status, 422)

    def test_checkout_requires_address_and_payment(self):
        anon = Client(self.base)

        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {"bananas": 1}}, csrf=False)
        self.assertEqual(status, 422)
        self.assertIn("address", body["error"].lower())

        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {"bananas": 1}, "address": ORDER_ADDRESS}, csrf=False)
        self.assertEqual(status, 422)
        self.assertIn("payment", body["error"].lower())

        bad = dict(ORDER_ADDRESS, postcode="abc")
        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {"bananas": 1}, "address": bad, "payment": "qr"}, csrf=False)
        self.assertEqual(status, 422)
        self.assertIn("Postcode", body["error"])

        bad = dict(ORDER_ADDRESS, phone="123")
        status, body, _ = anon.request("POST", "/api/public/orders",
                                       {"items": {"bananas": 1}, "address": bad, "payment": "qr"}, csrf=False)
        self.assertEqual(status, 422)
        self.assertIn("phone", body["error"].lower())

    # -- shopper accounts --------------------------------------------------
    def test_customer_signup_and_order_history(self):
        anon = Client(self.base)
        email = "nok.tester@example.com"
        status, body, _ = anon.request("POST", "/api/auth/signup",
                                       {"name": "Nok Tester", "email": email, "password": "supersecret"},
                                       csrf=False)
        self.assertEqual(status, 201)
        self.assertEqual(body["customer"]["email"], email)
        anon.csrf = body["csrf"]

        status, me, _ = anon.request("GET", "/api/auth/me")
        self.assertEqual(status, 200)
        self.assertEqual(me["customer"]["name"], "Nok Tester")

        status, order, _ = anon.request("POST", "/api/public/orders", {"items": {"bananas": 1}, "address": ORDER_ADDRESS, "payment": "qr"}, csrf=False)
        self.assertEqual(status, 201)
        self.assertTrue(order["signed_in"])
        self.assertEqual(order["customer"], "Nok Tester")

        status, hist, _ = anon.request("GET", "/api/auth/orders")
        self.assertEqual(status, 200)
        self.assertTrue(any(o["ref"] == order["ref"] for o in hist["items"]))
        self.assertTrue(hist["items"][0]["items"], "history includes line items")

    def test_signup_validation(self):
        anon = Client(self.base)
        cases = (
            ({"name": "", "email": "a@b.co", "password": "12345678"}, "missing name"),
            ({"name": "X", "email": "not-an-email", "password": "12345678"}, "bad email"),
            ({"name": "X", "email": "short@example.com", "password": "short"}, "short password"),
        )
        for payload, label in cases:
            status, body, _ = anon.request("POST", "/api/auth/signup", payload, csrf=False)
            self.assertEqual(status, 422, label)

    def test_duplicate_email_and_customer_login(self):
        email = "dup.tester@example.com"
        first = Client(self.base)
        status, body, _ = first.request("POST", "/api/auth/signup",
                                        {"name": "Dup", "email": email, "password": "supersecret"}, csrf=False)
        self.assertEqual(status, 201)
        second = Client(self.base)
        status, body, _ = second.request("POST", "/api/auth/signup",
                                         {"name": "Dup2", "email": email, "password": "supersecret"}, csrf=False)
        self.assertEqual(status, 409)

        status, body, _ = second.request("POST", "/api/auth/login",
                                         {"email": email, "password": "supersecret"}, csrf=False)
        self.assertEqual(status, 200)
        self.assertEqual(body["customer"]["email"], email)
        status, body, _ = second.request("POST", "/api/auth/login",
                                         {"email": email, "password": "wrongpass"}, csrf=False)
        self.assertEqual(status, 401)

    def test_guest_orders_do_not_enter_an_account(self):
        guest = Client(self.base)
        status, order, _ = guest.request("POST", "/api/public/orders", {"items": {"bananas": 1}, "address": ORDER_ADDRESS, "payment": "qr"}, csrf=False)
        self.assertEqual(status, 201)
        self.assertFalse(order["signed_in"])

        status, body, _ = guest.request("POST", "/api/auth/signup",
                                        {"name": "Fresh", "email": "fresh.account@example.com",
                                         "password": "supersecret"}, csrf=False)
        self.assertEqual(status, 201)
        guest.csrf = body["csrf"]
        status, hist, _ = guest.request("GET", "/api/auth/orders")
        self.assertEqual(status, 200)
        self.assertFalse(any(o["ref"] == order["ref"] for o in hist["items"]))

    def test_customer_logout_clears_session(self):
        anon = Client(self.base)
        status, body, _ = anon.request("POST", "/api/auth/signup",
                                       {"name": "Bye", "email": "bye.account@example.com",
                                        "password": "supersecret"}, csrf=False)
        self.assertEqual(status, 201)
        anon.csrf = body["csrf"]
        status, _, _ = anon.request("POST", "/api/auth/logout")
        self.assertEqual(status, 200)
        status, _, _ = anon.request("GET", "/api/auth/me")
        self.assertEqual(status, 401)

    # -- payment slips -----------------------------------------------------
    def _place_order(self, client, payment="qr"):
        status, order, _ = client.request(
            "POST", "/api/public/orders",
            {"items": {"bananas": 2}, "address": ORDER_ADDRESS, "payment": payment}, csrf=False)
        self.assertEqual(status, 201)
        return order

    def _slip(self):
        # a genuine, small PNG (32x32) rather than an empty placeholder
        import struct
        import zlib
        import random
        width = height = 64
        rnd = random.Random(7)
        raw = b"".join(
            b"\x00" + bytes(rnd.randrange(256) for _ in range(width * 3)) for _ in range(height))

        def chunk(kind, data):
            return (struct.pack(">I", len(data)) + kind + data +
                    struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

        png = (b"\x89PNG\r\n\x1a\n" +
               chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
               chunk(b"IDAT", zlib.compress(raw)) +
               chunk(b"IEND", b""))
        self.assertGreater(len(png), 128)
        return "data:image/png;base64," + base64.b64encode(png).decode()

    def test_payment_slip_upload_and_manual_confirmation(self):
        anon = Client(self.base)
        order = self._place_order(anon)
        oid, token = order["id"], order["access_token"]
        self.assertEqual(order["payment_status"], "awaiting")

        status, body, _ = anon.request("POST", f"/api/public/orders/{oid}/proof",
                                       {"token": "wrong", "image": self._slip()}, csrf=False)
        self.assertEqual(status, 403)

        status, body, _ = anon.request("POST", f"/api/public/orders/{oid}/proof",
                                       {"token": token, "image": self._slip()}, csrf=False)
        self.assertEqual(status, 200)
        self.assertEqual(body["payment_status"], "submitted")

        status, queue, _ = self.c.request("GET", "/api/payments?status=submitted")
        self.assertEqual(status, 200)
        self.assertTrue(any(o["id"] == oid for o in queue["items"]))

        status, body, ctype = self.c.request("GET", f"/api/payments/{oid}/proof")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "image/png")
        status, _, _ = Client(self.base).request("GET", f"/api/payments/{oid}/proof")
        self.assertEqual(status, 401, "slips are staff-only")

        # delivery cannot start before the payment is verified
        status, body, _ = self.c.request("PATCH", f"/api/orders/{oid}", {"status": "packing"})
        self.assertEqual(status, 409)

        status, body, _ = self.c.request("POST", f"/api/payments/{oid}/confirm",
                                         {"action": "confirm"})
        self.assertEqual(status, 200)
        self.assertEqual(body["order"]["payment_status"], "confirmed")
        self.assertEqual(body["order"]["status"], "packing", "confirmed payment releases the order")

        status, body, _ = self.c.request("PATCH", f"/api/orders/{oid}", {"status": "shipped"})
        self.assertEqual(status, 200)

    def test_payment_rejection_requires_a_reason(self):
        anon = Client(self.base)
        order = self._place_order(anon, payment="bank")
        oid, token = order["id"], order["access_token"]
        anon.request("POST", f"/api/public/orders/{oid}/proof",
                     {"token": token, "image": self._slip()}, csrf=False)

        status, body, _ = self.c.request("POST", f"/api/payments/{oid}/confirm",
                                         {"action": "reject"})
        self.assertEqual(status, 422)

        status, body, _ = self.c.request("POST", f"/api/payments/{oid}/confirm",
                                         {"action": "reject", "note": "amount does not match"})
        self.assertEqual(status, 200)
        self.assertEqual(body["order"]["payment_status"], "rejected")
        self.assertEqual(body["order"]["payment_note"], "amount does not match")

        # delivery stays blocked after a rejection
        status, body, _ = self.c.request("PATCH", f"/api/orders/{oid}", {"status": "packing"})
        self.assertEqual(status, 409)

    def test_proof_upload_validates_file_and_token(self):
        anon = Client(self.base)
        order = self._place_order(anon)
        oid, token = order["id"], order["access_token"]

        status, body, _ = anon.request("POST", f"/api/public/orders/{oid}/proof",
                                       {"token": token, "image": "not-an-image"}, csrf=False)
        self.assertEqual(status, 422)

        status, body, _ = anon.request("POST", "/api/public/orders/999999/proof",
                                       {"token": token, "image": self._slip()}, csrf=False)
        self.assertEqual(status, 404)

    # -- roles -------------------------------------------------------------
    def test_manager_cannot_archive_products(self):
        mgr = Client(self.base)
        status, body = mgr.login("manager", "manager123")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["role"], "manager")

        # a manager can still adjust stock (operational task)
        status, body, _ = mgr.request("POST", "/api/products/bananas/stock",
                                      {"delta": 1, "reason": "adjustment"})
        self.assertEqual(status, 200)

        status, body, _ = mgr.request("PATCH", "/api/products/bananas", {"active": False})
        self.assertEqual(status, 403)
        status, body, _ = mgr.request("DELETE", "/api/products/bananas")
        self.assertEqual(status, 403)

    # -- export ------------------------------------------------------------
    def test_csv_export(self):
        status, body, ctype = self.c.request("GET", "/api/export/products.csv")
        self.assertEqual(status, 200)
        self.assertIn("text/csv", ctype)
        lines = body.strip().splitlines()
        self.assertEqual(lines[0], "sku,name,shelf,price_thb,price_source,stock,min_stock,status,value_thb,active")
        self.assertIn("Makro/Lotus's anchor", lines[1] + lines[2] + lines[3])
        self.assertGreater(len(lines), 60)

    # -- static serving ----------------------------------------------------
    def test_static_allowlist_and_storefront(self):
        anon = Client(self.base)
        status, body, ctype = anon.request("GET", "/", csrf=False)
        self.assertEqual(status, 200)
        self.assertIn("UniMart", body)

        for path in ("/css/app.css", "/js/app.js", "/js/api.js", "/admin/", "/admin/admin.js",
                     "/assets/products/milk.webp"):
            status, _, _ = anon.request("GET", path, csrf=False)
            self.assertEqual(status, 200, path)

        for path in ("/server.py", "/data/store.db", "/data/seed_catalog.json",
                     "/_capture/index.html", "/tests/test_api.py", "/css/../server.py"):
            status, _, _ = anon.request("GET", path, csrf=False)
            self.assertEqual(status, 404, path)

    def test_unknown_endpoint_and_method(self):
        status, body, _ = self.c.request("GET", "/api/nope")
        self.assertEqual(status, 404)
        status, body, _ = self.c.request("DELETE", "/api/stats")
        self.assertEqual(status, 405)

    # -- unit level --------------------------------------------------------
    def test_rate_limiter_trips(self):
        key = "unittest:rate"
        with server._attempt_lock:
            server._attempts.pop(key, None)
        for _ in range(10):
            server.rate_limit(key, limit=10, window=300)
        with self.assertRaises(server.ApiError) as ctx:
            server.rate_limit(key, limit=10, window=300)
        self.assertEqual(ctx.exception.status, 429)
        with server._attempt_lock:
            server._attempts.pop(key, None)

    def test_password_hashing_is_salted(self):
        a = server.hash_password("secret", "aa" * 16)
        b = server.hash_password("secret", "bb" * 16)
        self.assertNotEqual(a, b)
        self.assertEqual(a, server.hash_password("secret", "aa" * 16))
        self.assertNotEqual(a, server.hash_password("secreu", "aa" * 16))


if __name__ == "__main__":
    unittest.main(verbosity=2)
