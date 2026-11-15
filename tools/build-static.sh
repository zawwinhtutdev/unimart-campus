#!/usr/bin/env bash
# Build a static-only copy of the storefront for Vercel / GitHub Pages.
# The Python API cannot run there, so this ships the shop front end only:
# browsing, search, favourites, cart and currency switching work; checkout,
# accounts and the admin console need the real server (see DEPLOY.md).
set -euo pipefail

# Stock levels for the sold-out badges, captured at build time.
python3 tools/export_stock.py

rm -rf dist
mkdir -p dist

cp index.html checkout.html dist/
cp -R css js assets dist/

echo "static build: $(find dist -type f | wc -l | tr -d ' ') files"
