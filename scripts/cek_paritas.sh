#!/bin/bash
# Cek bulanan di VPS: trade live tiap bot vs backtest di periode yang sama. Laporan ke ~/paritas/laporan/.
# Pakai: ~/paritas/cek_paritas.sh      (dijalankan cron tiap tanggal 1, bisa juga manual kapan saja)
set -u
cd "$(dirname "$0")"
OUT=laporan/$(date +%F).txt
mkdir -p laporan

# folder bot | config | strategi | file database | tanggal mulai dry-run
BOTS=(
  "binance|config.binance.json|BreakoutTren|tradesv3.binance.dryrun.sqlite|2026-10-29"
  "binance-dua|config.dua.json|BreakoutDua|tradesv3.dua.dryrun.sqlite|2026-11-03"
  "indodax|config.breakout.json|BreakoutTren|tradesv3.breakout.dryrun.sqlite|2026-11-03"
)

{
  echo "Laporan paritas $(date '+%F %H:%M')"
  echo
  for b in "${BOTS[@]}"; do
    IFS='|' read -r dir cfg strat db mulai <<<"$b"
    ud=$HOME/$dir/user_data
    dl=$(date -d "$mulai -200 days" +%Y%m%d)
    # mulai sehari lebih awal: sinyal di candle hari sebelumnya bisa langsung dibeli bot di hari mulai
    bt=$(date -d "$mulai -1 day" +%Y%m%d)
    run() { docker run --rm -v "$ud":/freqtrade/user_data freqtrade-ai "$@" -c "user_data/$cfg" >>"$ud/paritas.log" 2>&1; }
    rm -rf "$ud/paritas" "$ud/paritas.log" && mkdir -p "$ud/paritas"
    run download-data --timerange "$dl-" -t 1d || { echo "=== $dir: GAGAL download data (lihat $ud/paritas.log) ==="; echo; continue; }
    run backtesting -s "$strat" --timerange "$bt-" --export trades --backtest-directory user_data/paritas \
      || { echo "=== $dir: GAGAL backtest (lihat $ud/paritas.log) ==="; echo; continue; }
    python3 paritas.py "$dir" "$ud/$db" "$(ls "$ud"/paritas/*.zip | head -1)" "$mulai"
  done
} > "$OUT" 2>&1
cat "$OUT"
