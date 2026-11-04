"""Seberapa sering bot terlihat jelek dalam jendela pendek (mis. 4 minggu), padahal jangka panjangnya untung?

Kurva saldo harian mark-to-market dari hasil `freqtrade backtesting --export trades`, lalu dihitung:
peluang jendela N hari berakhir rugi / tanpa transaksi, jendela terburuk, dan lama terpanjang di bawah puncak.

  python research_windows.py <backtest-result.zip> <folder data feather>
"""
import json
import sys
import zipfile
from pathlib import Path

import pandas as pd

zip_path, data_dir = sys.argv[1], Path(sys.argv[2])
with zipfile.ZipFile(zip_path) as z:
    name = next(n for n in z.namelist() if n.endswith(".json") and "_config" not in n and "meta" not in n)
    res = json.loads(z.read(name))
strat = next(iter(res["strategy"].values()))
t = pd.DataFrame(strat["trades"])
start_cap = strat["starting_balance"]
for c in ("open_date", "close_date"):
    t[c] = pd.to_datetime(t[c]).dt.tz_localize(None).dt.normalize()

closes = {}
for pair in t["pair"].unique():
    d = pd.read_feather(data_dir / f"{pair.replace('/', '_')}-1d.feather")
    closes[pair] = d.set_index(pd.to_datetime(d["date"]).dt.tz_localize(None))["close"]
closes = pd.DataFrame(closes).ffill()
days = closes.loc[t["open_date"].min():t["close_date"].max()].index

eq = []
for d in days:
    done = t[t["close_date"] <= d]["profit_abs"].sum()
    op = t[(t["open_date"] <= d) & (t["close_date"] > d)]
    unreal = sum(r.amount * (closes.at[d, r.pair] - r.open_rate) for r in op.itertuples())
    eq.append(start_cap + done + unreal)
eq = pd.Series(eq, index=days)
entries = t.groupby("open_date").size().reindex(days, fill_value=0)

dd = eq / eq.cummax() - 1
under = (dd < 0).astype(int)
longest = (under.groupby((under == 0).cumsum()).cumsum()).max()
print(f"Periode {days[0].date()} s/d {days[-1].date()}, total {(eq.iloc[-1] / start_cap - 1) * 100:+.0f}%, "
      f"rugi terdalam harian {dd.min() * 100:.0f}%, terlama di bawah puncak {longest} hari, {len(t)} transaksi\n")
for n in (7, 28, 91, 182, 365):
    r = eq.pct_change(n).dropna()
    k = entries.rolling(n).sum().dropna()
    print(f"Jendela {n:>3} hari: rugi {(r < 0).mean() * 100:4.0f}% | rugi >10% {(r < -0.10).mean() * 100:4.0f}% | "
          f"tanpa transaksi {(k == 0).mean() * 100:4.0f}% | terburuk {r.min() * 100:+5.0f}% | median {r.median() * 100:+5.1f}%")
