// Generates data/seed_catalog.json from js/data.js so the admin database is
// seeded from the same catalogue the storefront renders. Deterministic: the
// same input always yields the same SKUs and starting stock levels.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const cwd = process.cwd();
const src = readFileSync(cwd + "/js/data.js", "utf8");
const literal = src.match(/const SHELVES = ([\s\S]*?);\n/);
if (!literal) throw new Error("SHELVES literal not found in js/data.js");

const SHELVES = eval("(" + literal[1] + ")");

const shelfPrefix = { produce: "PRD", dairy: "DRY", pantry: "PNT", drinks: "DRK" };
/* Where each curated price is anchored. These are estimates for a demo
   catalogue, not scraped shelf prices - the retailer sites block automation and
   several of these brands are not stocked in Thailand. */
const PRICE_SOURCE = {
  produce: "Makro/Lotus's anchor (Nov 2026)",
  dairy: "Makro/Lotus's anchor (Nov 2026)",
  pantry: "Makro/Lotus's anchor (Nov 2026)",
  drinks: "7-Eleven TH anchor (Nov 2026)",
};
const hash = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);

/* This is a campus mini-store, not a supermarket: stock is seeded at half the
   originally generated levels so the dashboard's inventory value stays believable.
   Change STOCK_SCALE to 1 to restore the larger figures. */
const STOCK_SCALE = 0.5;

const products = [];
SHELVES.forEach((shelf) => {
  shelf.items.forEach(([id, name, price], i) => {
    const h = hash(id);
    const min = Math.max(5, Math.round((20 + (h % 31)) * STOCK_SCALE));   // 10..25
    let stock;
    const slot = products.length;
    if (slot % 11 === 3) stock = 0;                                  // out of stock
    else if (slot % 5 === 1) stock = Math.min(min - 1, 1 + (h % Math.max(1, min - 1))); // below minimum
    else stock = Math.round((min / STOCK_SCALE + (h % 180)) * STOCK_SCALE);             // healthy
    products.push({
      id,
      name,
      sku: `${shelfPrefix[shelf.id]}-${String(i + 1).padStart(3, "0")}`,
      shelf: shelf.id,
      shelf_name: shelf.name,
      price: Math.round(price),          // baht, the base currency
      price_source: PRICE_SOURCE[shelf.id],
      stock,
      min_stock: min,
      image: "assets/products/" + id + ".webp",
      active: 1,
    });
  });
});

mkdirSync(cwd + "/data", { recursive: true });
writeFileSync(
  cwd + "/data/seed_catalog.json",
  JSON.stringify({ generated_from: "js/data.js", count: products.length, products }, null, 2) + "\n"
);

const low = products.filter((p) => p.stock > 0 && p.stock <= p.min_stock).length;
const out = products.filter((p) => p.stock === 0).length;
console.log("products:", products.length, "| low:", low, "| out:", out, "| shelves:", SHELVES.length);
