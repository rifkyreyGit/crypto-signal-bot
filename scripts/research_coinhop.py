"""Riset: strategi "lompat koin" ala binance-trade-bot (edeng23/ccxt), dengan dan tanpa stop loss.

Logika inti ditiru dari binance_trade_bot/auto_trader.py (mode scout_multiplier):
  - pegang 1 koin dengan seluruh modal
  - untuk tiap koin lain D: skor = rasio_now - fee*mult*rasio_now - rasio_patokan(C->D), rasio_now = harga C / harga D
  - skor > 0: lompat ke D dengan skor terbesar (jual C -> USDT -> beli D)
  - setelah beli D: rasio_patokan(X->D) = harga X / harga D untuk semua X
Penyederhanaan: dicek sekali sehari di harga close (bot asli tiap detik), jadi jumlah lompatan lebih sedikit.

Varian tambahan: stop loss dari harga beli, trailing stop dari puncak, dan filter BTC > MA100 (pegang USDT
saat pasar lemah). Saat di USDT, masuk lagi ke koin yang semua skornya negatif (cara bridge_scout asli).

  python research_coinhop.py <folder data feather>
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

COINS = ["BTC", "ETH", "SOL", "ZEC", "BNB", "XRP", "PEPE", "NEAR", "ENA", "SUI", "WLD", "UNI", "TRX", "DOGE", "LTC",
         "ADA", "INIT", "LINK", "HYPE", "PUMP", "AVAX", "AAVE", "ARB", "QNT", "AI", "FET", "TAO", "HAEDAL", "BCH"]
FEE = 0.001 + 0.0005   # fee Binance 0,1% + slippage 0,05% per transaksi
MULT = 5               # scout_multiplier bawaan

data_dir = Path(sys.argv[1])
px = {}
for c in COINS:
    f = data_dir / f"{c}_USDT-1d.feather"
    if f.exists():
        d = pd.read_feather(f)
        px[c] = d.set_index(pd.to_datetime(d["date"]).dt.tz_localize(None))["close"]
px = pd.DataFrame(px).sort_index()
btc_ok = px["BTC"] > px["BTC"].rolling(100).mean()


def run(start, end, stop=None, trail=None, regime=False, cooldown=0):
    p = px.loc[start:end]
    days = p.index
    ratio = {}            # (from, to) -> rasio patokan
    tx = 2 * FEE - FEE * FEE
    coin, qty, cash = None, 0.0, 1.0
    entry = peak = 0.0
    wait_until = None
    curve, jumps, stops = [], 0, 0

    def init_ratios(row):
        live = [c for c in row.index if np.isfinite(row[c])]
        for a in live:
            for b in live:
                if a != b and (a, b) not in ratio:
                    ratio[(a, b)] = row[a] / row[b]

    def buy(c, row, amount):
        nonlocal coin, qty, entry, peak
        coin, qty, entry, peak = c, amount * (1 - FEE) / row[c], row[c], row[c]
        for x in row.index:
            if x != c and np.isfinite(row[x]):
                ratio[(x, c)] = row[x] / row[c]

    def scores(c, row):
        out = {}
        for d in row.index:
            if d == c or not np.isfinite(row[d]) or (c, d) not in ratio:
                continue
            r = row[c] / row[d]
            out[d] = (r - tx * MULT * r) - ratio[(c, d)]
        return out

    for day in days:
        row = p.loc[day]
        init_ratios(row)
        ok = bool(btc_ok.get(day, False))
        if coin is not None:
            price = row[coin]
            if not np.isfinite(price):     # koin hilang dari data: jual di harga terakhir
                price = entry
            peak = max(peak, price)
            hit = (stop and price <= entry * (1 - stop)) or (trail and price <= peak * (1 - trail))
            if hit or (regime and not ok):
                cash, coin, qty = qty * price * (1 - FEE), None, 0.0
                stops += bool(hit)
                wait_until = day + pd.Timedelta(days=cooldown)
            else:
                sc = {k: v for k, v in scores(coin, row).items() if v > 0}
                if sc:
                    d = max(sc, key=sc.get)
                    cash_mid = qty * price * (1 - FEE)
                    buy(d, row, cash_mid)
                    jumps += 1
        if coin is None and (not regime or ok) and (wait_until is None or day >= wait_until):
            live = [c for c in row.index if np.isfinite(row[c])]
            for c in live:   # bridge_scout: koin yang tidak langsung ingin ditinggalkan
                if not any(v > 0 for v in scores(c, row).values()):
                    buy(c, row, cash)
                    cash = 0.0
                    break
        curve.append(cash + (qty * row[coin] if coin is not None and np.isfinite(row[coin]) else 0))
    c = pd.Series(curve, index=days)
    years = (days[-1] - days[0]).days / 365.25
    return {"total%": round((c.iloc[-1] - 1) * 100), "CAGR%": round((c.iloc[-1] ** (1 / years) - 1) * 100, 1),
            "maxDD%": round((c / c.cummax() - 1).min() * 100, 1), "lompat": jumps, "kena_stop": stops,
            "koin_akhir": coin or "USDT"}


def btc_hold(start, end):
    b = px["BTC"].loc[start:end]
    return {"total%": round((b.iloc[-1] / b.iloc[0] - 1) * 100), "maxDD%": round((b / b.cummax() - 1).min() * 100, 1)}


variants = {
    "Asli (tanpa stop)": {},
    "Stop -15%": {"stop": 0.15},
    "Stop -10%": {"stop": 0.10},
    "Trailing -20%": {"trail": 0.20},
    "Filter BTC>MA100": {"regime": True},
    "Stop -15% + filter BTC": {"stop": 0.15, "regime": True},
    "Trailing -20% + filter BTC": {"trail": 0.20, "regime": True},
}
for name, (s, e) in {"Latih 2020-2022": ("2020-01-01", "2022-12-31"), "Uji 2023-sekarang": ("2023-01-01", None)}.items():
    rows = {k: run(s, e, **v) for k, v in variants.items()}
    print(f"\n== {name}  (BTC beli-tahan: {btc_hold(s, e)})")
    print(pd.DataFrame(rows).T.to_string())
