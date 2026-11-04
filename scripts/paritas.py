"""Bandingkan trade bot live (dry-run) dengan backtest di periode yang sama.

Kalau keduanya sama, bot menjalankan aturannya dengan benar (walau sedang rugi). Kalau beda, ada yang perlu
dicek: bug, data candle berbeda, veto delisting, atau bot sempat mati.

  python3 paritas.py <nama bot> <tradesv3.sqlite> <backtest-result.zip> <tanggal mulai YYYY-MM-DD>
"""
import json
import sqlite3
import sys
import zipfile
from datetime import date, timedelta

name, db_path, zip_path, start = sys.argv[1], sys.argv[2], sys.argv[3], date.fromisoformat(sys.argv[4])

with zipfile.ZipFile(zip_path) as z:
    res = json.loads(z.read(next(n for n in z.namelist() if n.endswith(".json") and "_config" not in n and "meta" not in n)))
bt = [{"pair": t["pair"], "short": bool(t.get("is_short")), "open": date.fromisoformat(t["open_date"][:10]),
       "close": None if t.get("is_open") else t["close_date"][:10], "rate": t["open_rate"],
       "ret": t["profit_ratio"], "why": t.get("exit_reason") or "masih terbuka"}
      for s in res["strategy"].values() for t in s["trades"]]
bt = [t for t in bt if t["open"] >= start]

con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
live = [{"pair": p, "short": bool(sh), "open": date.fromisoformat(o[:10]), "close": c[:10] if c else None,
         "rate": r, "ret": pr, "why": w or "masih terbuka"}
        for p, sh, o, c, r, pr, w in con.execute(
            "select pair, is_short, open_date, close_date, open_rate, close_profit, exit_reason from trades")]
live = [t for t in live if t["open"] >= start]


def match(t, pool):
    """Pasangan dengan pair & arah sama, dibuka di hari yang sama atau selisih 1 hari."""
    for u in pool:
        if u["pair"] == t["pair"] and u["short"] == t["short"] and abs((u["open"] - t["open"]).days) <= 1:
            pool.remove(u)
            return u
    return None


def fmt(t):
    arah = " SHORT" if t["short"] else ""
    ret = f"{t['ret'] * 100:+.1f}%" if t["ret"] is not None else "-"
    return f"{t['pair']}{arah} masuk {t['open']} @ {t['rate']:.6g} -> {ret} ({t['why']})"


left = list(bt)
pairs, only_live = [], []
for t in sorted(live, key=lambda x: x["open"]):
    u = match(t, left)
    (pairs.append((t, u)) if u else only_live.append(t))
only_bt = left

print(f"=== {name}: {start} s/d {date.today()} ===")
print(f"Live {len(live)} trade, backtest {len(bt)} trade, cocok {len(pairs)}")
for t, u in pairs:
    beda = (t["rate"] / u["rate"] - 1) * 100
    note = "" if abs(beda) < 1 and t["why"] == u["why"] else "  <- cek"
    print(f"  COCOK  live: {fmt(t)}\n         uji : {fmt(u)}  (harga masuk beda {beda:+.2f}%){note}")
for t in only_live:
    print(f"  HANYA LIVE   : {fmt(t)}")
for t in only_bt:
    print(f"  HANYA BACKTEST: {fmt(t)}")
ok = not only_live and not only_bt
print("KESIMPULAN: " + ("SAMA. Bot menjalankan aturannya dengan benar." if ok else
      "ADA BEDA. Cek baris di atas (veto delisting, bot mati, harga masuk telat, atau beli/jual manual)."))
print()
