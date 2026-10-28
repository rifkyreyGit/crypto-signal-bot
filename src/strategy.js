// Strategi "Breakout Tren" untuk candle harian Indodax.
// Port dari riset Python (scripts/research.py). Sinyal di close hari t, eksekusi di open hari t+1.

export const PARAMS = {
  breakoutDays: 20,     // close menembus high tertinggi 20 hari sebelumnya
  maTrend: 50,          // close harus di atas MA50
  maExit: 20,           // keluar saat close di bawah MA20
  volRatioMin: 1.2,     // volume minimal 1,2x rata-rata 20 hari
  btcMa: 100,           // filter pasar: BTC di atas MA100
  stopAtr: 3,           // stop loss = harga masuk - 3x ATR14
  cost: 0.008,          // fee 0,3% x2 + slippage 0,2% (pulang-pergi)
  beLock: 0.002,        // stop impas dikunci di +0,2% bersih setelah biaya
};

// Mode exit: stop dipindah ke impas setelah high >= harga masuk + beAtr x ATR.
// Angka uji = data 2023-Okt 2026 (tidak dipakai untuk memilih), 18 koin.
export const EXIT_MODES = {
  profit: { label: 'Profit maksimal', beAtr: null, test: { win: 42.3, avg: 7.5, pf: 2.70 } },
  balanced: { label: 'Seimbang', beAtr: 2, test: { win: 56.4, avg: 5.8, pf: 2.57 } },
  winrate: { label: 'Win rate tinggi', beAtr: 1, test: { win: 62.7, avg: 3.9, pf: 2.39 } },
};

export const breakevenStop = (entry, p = PARAMS) => entry * (1 + p.cost + p.beLock);

const NaNs = (n) => new Array(n).fill(NaN);

export function sma(x, n) {
  const out = NaNs(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// EWM gaya pandas (adjust=False, min_periods=n): mulai dari nilai valid pertama.
function wilder(x, n) {
  const out = NaNs(x.length);
  let y = NaN, count = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    y = count === 0 ? x[i] : y + (x[i] - y) / n;
    count++;
    if (count >= n) out[i] = y;
  }
  return out;
}

export function rsi(close, n = 14) {
  const g = NaNs(close.length), l = NaNs(close.length);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    g[i] = Math.max(d, 0);
    l[i] = Math.max(-d, 0);
  }
  const ag = wilder(g, n), al = wilder(l, n);
  return ag.map((v, i) => 100 - 100 / (1 + v / al[i]));
}

export function atr(c, n = 14) {
  const tr = c.map((k, i) => i === 0 ? k.high - k.low
    : Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)));
  return wilder(tr, n);
}

function prevHigh(c, n) {
  const out = NaNs(c.length);
  for (let i = n; i < c.length; i++) {
    let m = -Infinity;
    for (let j = i - n; j < i; j++) m = Math.max(m, c[j].high);
    out[i] = m;
  }
  return out;
}

// Map tanggal -> apakah BTC di atas MA100 (diisi maju untuk tanggal yang hilang).
export function btcRegime(btc, p = PARAMS) {
  const ma = sma(btc.map((k) => k.close), p.btcMa);
  const m = new Map();
  btc.forEach((k, i) => m.set(k.time, !Number.isNaN(ma[i]) && k.close > ma[i]));
  return m;
}

export function indicators(c, regime, p = PARAMS) {
  const close = c.map((k) => k.close), vol = c.map((k) => k.volume);
  const ma20 = sma(close, p.maExit), ma50 = sma(close, p.maTrend), vma = sma(vol, 20);
  const r = rsi(close), a = atr(c), hh = prevHigh(c, p.breakoutDays);
  let last = false;
  return c.map((k, i) => {
    if (regime.has(k.time)) last = regime.get(k.time);
    const vr = vol[i] / vma[i];
    const ready = ![ma20[i], ma50[i], vr, a[i], hh[i]].some(Number.isNaN);
    const entry = ready && k.close > hh[i] && k.close > ma50[i] && last && vr >= p.volRatioMin;
    const exit = ready && k.close < ma20[i];
    return { ...k, ma20: ma20[i], ma50: ma50[i], rsi: r[i], vr, atr: a[i], hh20: hh[i], btcOk: last, ready, entry, exit };
  });
}

// Backtest per koin, satu posisi pada satu waktu. Sama persis dengan sim() di riset Python.
export function backtest(x, beAtr = null, p = PARAMS) {
  const trades = [];
  let i = 0;
  while (i < x.length - 1) {
    if (!x[i].entry) { i++; continue; }
    const j = i + 1, entry = x[j].open, be = breakevenStop(entry, p);
    let stop = entry - p.stopAtr * x[i].atr;
    let k = j, exitPrice, why;
    for (;;) {
      if (x[k].low <= stop) { exitPrice = k > j ? Math.min(stop, x[k].open) : stop; why = stop >= be ? 'Stop impas' : 'Stop loss'; break; }
      if (k + 1 >= x.length) { exitPrice = x[k].close; why = 'Masih terbuka'; break; }
      if (x[k].exit) { exitPrice = x[k + 1].open; why = 'Close < MA20'; k++; break; }
      if (beAtr && x[k].high >= entry + beAtr * x[i].atr) stop = Math.max(stop, be);
      k++;
    }
    trades.push({ entryTime: x[j].time, exitTime: x[k].time, entry, exit: exitPrice, why,
      ret: exitPrice / entry - 1 - p.cost, open: why === 'Masih terbuka' });
    i = k + 1;
  }
  return trades;
}

export function stats(trades) {
  const done = trades.filter((t) => !t.open);
  const wins = done.filter((t) => t.ret > 0);
  const gain = wins.reduce((s, t) => s + t.ret, 0);
  const loss = -done.filter((t) => t.ret <= 0).reduce((s, t) => s + t.ret, 0);
  return {
    n: done.length,
    winRate: done.length ? wins.length / done.length : NaN,
    avg: done.length ? done.reduce((s, t) => s + t.ret, 0) / done.length : NaN,
    pf: loss > 0 ? gain / loss : (gain > 0 ? Infinity : NaN),
    compounded: done.reduce((v, t) => v * (1 + t.ret), 1) - 1,
  };
}

// Status hari terakhir yang sudah tutup, dengan alasan dalam bahasa sehari-hari.
export function status(x, p = PARAMS) {
  const k = x[x.length - 1];
  if (!k || !k.ready) return { kind: 'na', label: 'Data kurang', reasons: ['Histori belum cukup untuk indikator.'], score: 0 };
  const checks = [
    { ok: k.btcOk, text: k.btcOk ? 'Pasar sehat: BTC di atas MA100' : 'Pasar lemah: BTC di bawah MA100' },
    { ok: k.close > k.ma50, text: k.close > k.ma50 ? 'Harga di atas MA50 (tren naik)' : 'Harga di bawah MA50' },
    { ok: k.close > k.hh20, text: k.close > k.hh20 ? 'Menembus high 20 hari' : `${pctTo(k.close, k.hh20)} lagi ke high 20 hari` },
    { ok: k.vr >= p.volRatioMin, text: `Volume ${dec(k.vr)}x rata-rata (min ${dec(p.volRatioMin)}x)` },
  ];
  const score = checks.filter((c) => c.ok).length;
  const near = k.close > k.ma50 && k.btcOk && k.close >= k.hh20 * 0.97 && !k.entry;
  const kind = k.entry ? 'buy' : k.exit ? 'avoid' : near ? 'watch' : 'wait';
  const label = { buy: 'BELI', avoid: 'HINDARI', watch: 'PANTAU', wait: 'TUNGGU' }[kind];
  return { kind, label, checks, score, stop: k.close - p.stopAtr * k.atr, last: k };
}

const dec = (v) => v.toFixed(1).replace('.', ',');

function pctTo(a, b) {
  return `${dec((b / a - 1) * 100)}%`;
}
