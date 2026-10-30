"""Riset ukuran posisi & batas rugi mingguan di atas sinyal BreakoutTren (Binance, 29 koin).

Input: hasil `freqtrade backtesting --export trades` dengan max_open_trades besar (semua sinyal diambil),
lalu portofolio diputar ulang di sini dengan modal & slot terbatas, nilai harian mark-to-market.

  python research_sizing.py <backtest-result.zip> <folder data feather>
"""
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

zip_path, data_dir = sys.argv[1], Path(sys.argv[2])
with zipfile.ZipFile(zip_path) as z:
    name = next(n for n in z.namelist() if n.endswith(".json") and "_config" not in n and "meta" not in n)
    res = json.loads(z.read(name))
trades = pd.DataFrame(res["strategy"]["BreakoutTren"]["trades"])
trades["open"] = pd.to_datetime(trades["open_date"]).dt.tz_localize(None).dt.normalize()
trades["close"] = pd.to_datetime(trades["close_date"]).dt.tz_localize(None).dt.normalize()

closes, stop_dist = {}, []
for pair in trades["pair"].unique():
    df = pd.read_feather(data_dir / f"{pair.replace('/', '_')}-1d.feather")
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
    pc = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    closes[pair] = df.set_index("date")["close"]
    atr_by_date = df.set_index("date")["atr"]
    for _, t in trades[trades["pair"] == pair].iterrows():
        a = atr_by_date.get(t["open"] - pd.Timedelta(days=1), np.nan)
        stop_dist.append((t.name, min(3 * a / t["open_rate"], 0.15)))
trades["stop_dist"] = pd.Series(dict(stop_dist))
closes = pd.DataFrame(closes).ffill()


def run(slots=9, risk=None, cap=1.0, week_limit=None, start=None, end=None):
    """risk=None: bagi rata seperti freqtrade (kas / slot kosong). risk=0.02: rugi di stop = 2% ekuitas.
    week_limit=0.1: berhenti beli selama rugi terealisasi 7 hari terakhir > 10% ekuitas."""
    tr = trades[(trades["open"] >= (start or trades["open"].min())) & (trades["open"] <= (end or trades["open"].max()))]
    days = closes.loc[tr["open"].min():tr["close"].max()].index
    cash, pos, realized, curve, taken = 1.0, {}, [], [], 0
    by_open, by_close = tr.groupby("open"), {}
    for d in days:
        for i in [i for i, p in pos.items() if trades.at[i, "close"] == d]:
            stake = pos.pop(i)
            pnl = stake * trades.at[i, "profit_ratio"]
            cash += stake + pnl
            realized.append((d, pnl))
        eq = cash + sum(s * (1 + _unreal(i, d)) for i, s in pos.items())
        blocked = False
        if week_limit:
            wk = sum(p for dd, p in realized if (d - dd).days < 7)
            blocked = wk < -week_limit * eq
        if d in by_open.groups and not blocked:
            for i in by_open.get_group(d).index:
                if len(pos) >= slots or cash <= 0:
                    break
                if risk is None:
                    stake = cash / (slots - len(pos))
                else:
                    stake = min(risk * eq / trades.at[i, "stop_dist"], cap * eq, cash)
                if stake < 0.001 * eq:
                    continue
                cash -= stake
                pos[i] = stake
                taken += 1
        curve.append(cash + sum(s * (1 + _unreal(i, d)) for i, s in pos.items()))
    c = pd.Series(curve, index=days)
    dd = (c / c.cummax() - 1).min()
    years = (days[-1] - days[0]).days / 365.25
    cagr = c.iloc[-1] ** (1 / years) - 1
    return {"total%": round((c.iloc[-1] - 1) * 100), "CAGR%": round(cagr * 100, 1), "maxDD%": round(dd * 100, 1),
            "CAGR/DD": round(cagr / -dd, 2), "trades": taken}


def _unreal(i, d):
    """Untung/rugi belum terealisasi berdasar close harian (setelah biaya diabaikan)."""
    return closes.at[d, trades.at[i, "pair"]] / trades.at[i, "open_rate"] - 1


variants = {
    "Sekarang: 9 slot bagi rata": dict(),
    "Risiko 1%/trade": dict(risk=0.01, slots=29),
    "Risiko 1,5%/trade": dict(risk=0.015, slots=29),
    "Risiko 2%/trade": dict(risk=0.02, slots=29),
    "Risiko 3%/trade": dict(risk=0.03, slots=29),
    "Risiko 2%, maks 25%/posisi": dict(risk=0.02, slots=29, cap=0.25),
    "9 slot + stop mingguan 5%": dict(week_limit=0.05),
    "9 slot + stop mingguan 10%": dict(week_limit=0.10),
    "9 slot + stop mingguan 15%": dict(week_limit=0.15),
    "Risiko 2% + stop mingguan 10%": dict(risk=0.02, slots=29, week_limit=0.10),
}
rows = {k: run(**v) for k, v in variants.items()}
print(pd.DataFrame(rows).T.to_string())
