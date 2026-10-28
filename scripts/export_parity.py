"""Ekspor candle + transaksi Python untuk dicocokkan dengan strategy.js (npm run parity)."""
import json, sys
from research import load, prep, sim2
MODES = {'profit': None, 'balanced': 2, 'winrate': 1}
data = load(); btc = data['BTC']; out = {}
for coin, d in data.items():
    x = prep(d, btc)
    e = (x.c > x.hh20) & (x.c > x.ma50) & x.btc_ok & (x.vr >= 1.2)
    out[coin] = {
        'candles': [{'time': int(t.timestamp()), 'open': r.open, 'high': r.high, 'low': r.low, 'close': r.close, 'volume': r.volume}
                    for t, r in d.iterrows()],
        'trades': {m: [[int(t.timestamp()), r] for t, r in sim2(x, e, be_atr=be)] for m, be in MODES.items()},
    }
json.dump(out, open(sys.argv[1], 'w'))
