#!/bin/sh
# Unduh logo koin dari Binance ke public/logos (jalankan ulang kalau daftar koin berubah).
# Contoh: sh scripts/fetch_logos.sh BTC ETH SOL
cd "$(dirname "$0")/.." && mkdir -p public/logos
for c in "$@"; do curl -sf -m 10 -o "public/logos/$c.png" "https://bin.bnbstatic.com/static/assets/logos/$c.png" || echo "tidak ada logo: $c"; done
