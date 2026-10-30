"""Uji "Time Machine": apakah simulasi Monte Carlo saat sinyal bisa membedakan trade bagus vs jelek?

Untuk tiap sinyal, ambil return harian 90 hari terakhir koin itu, acak ulang 2000 jalur 60 hari, jalankan
aturan keluar yang sama (stop 3 ATR maks -15%, impas setelah +2 ATR, keluar close < MA20). Lalu kelompokkan
sinyal menurut perkiraan Monte Carlo dan bandingkan dengan hasil sebenarnya.

  python research_montecarlo.py <backtest-result.zip> <folder data feather>
"""
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

N, H, LOOK, COST = 2000, 60, 90, 0.003
rng = np.random.default_rng(19)

zip_path, data_dir = sys.argv[1], Path(sys.argv[2])
with zipfile.ZipFile(zip_path) as z:
    name = next(n for n in z.namelist() if n.endswith(".json") and "_config" not in n and "meta" not in n)
    trades = pd.DataFrame(json.loads(z.read(name))["strategy"]["BreakoutTren"]["trades"])
trades["open"] = pd.to_datetime(trades["open_date"]).dt.tz_localize(None).dt.normalize()


def simulate(hist_close, atr, entry):
    """hist_close: close 19 hari terakhir + hari sinyal (untuk MA20). Kembalikan (E[ret], P(untung), P(stop))."""
    rets = np.diff(np.log(hist_close[-LOOK - 1:]))
    paths = entry * np.exp(np.cumsum(rng.choice(rets, size=(N, H)), axis=1))
    stop0 = max(entry - 3 * atr, entry * 0.85)
    be_price, be_stop = entry + 2 * atr, entry * (1 + COST + 0.002)
    out, stopped = np.empty(N), np.zeros(N, bool)
    tail = hist_close[-19:]
    for k in range(N):
        p, stop, closes = paths[k], stop0, list(tail)
        r = p[-1] / entry - 1
        for t in range(H):
            # harga harian kasar: close saja (tanpa high/low intrahari)
            if p[t] <= stop:
                r, stopped[k] = stop / entry - 1, stop < be_stop
                break
            closes.append(p[t])
            if p[t] < np.mean(closes[-20:]):
                r = p[t] / entry - 1
                break
            if p[t] >= be_price:
                stop = max(stop, be_stop)
        out[k] = r - COST
    return out.mean(), (out > 0).mean(), stopped.mean()


rows = []
for pair, g in trades.groupby("pair"):
    df = pd.read_feather(data_dir / f"{pair.replace('/', '_')}-1d.feather")
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
    pc = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    df = df.set_index("date")
    for _, t in g.iterrows():
        hist = df.loc[:t["open"] - pd.Timedelta(days=1)]
        if len(hist) < LOOK + 2:
            continue
        ev, pwin, pstop = simulate(hist["close"].to_numpy(), hist["atr"].iloc[-1], t["open_rate"])
        rows.append({"pair": pair, "date": t["open"], "mc_ev": ev, "mc_win": pwin, "mc_stop": pstop,
                     "actual": t["profit_ratio"]})

r = pd.DataFrame(rows)
for col in ["mc_ev", "mc_win"]:
    r["bucket"] = pd.qcut(r[col], 4, labels=["Q1 terendah", "Q2", "Q3", "Q4 tertinggi"])
    s = r.groupby("bucket", observed=True).agg(n=("actual", "size"), mc=(col, "mean"),
                                               win_nyata=("actual", lambda x: (x > 0).mean()),
                                               avg_nyata=("actual", "mean"))
    print(f"\nKelompok menurut {col}:\n{s.round(3).to_string()}")
print("\nKorelasi Spearman mc_ev vs hasil nyata:", round(r["mc_ev"].corr(r["actual"], method="spearman"), 3))
print("Korelasi Spearman mc_win vs hasil nyata:", round(r["mc_win"].corr(r["actual"], method="spearman"), 3))
