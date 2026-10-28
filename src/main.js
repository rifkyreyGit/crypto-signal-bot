import './style.css';
import { createChart } from 'lightweight-charts';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { candles, tickers, pool } from './api.js';
import { PARAMS, EXIT_MODES, btcRegime, breakevenStop, indicators, status, backtest, stats } from './strategy.js';
import { state, load, save, openPosition, closePosition } from './store.js';
import { notify, setDailyReminder, ensurePermission } from './notify.js';

const $ = (s, r = document) => r.querySelector(s);
const view = { tab: 'signals', filter: 'all', rows: [], tick: {}, regime: null, updated: null, loading: false, error: null };

// ---------- format ----------
const nf = (d) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d });
export function rp(v) {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v), d = a >= 1000 || a === 0 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return 'Rp' + nf(d).format(v);
}
const pct = (v, d = 1) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + nf(d).format(v * 100) + '%' : '-';
const date = (t) => new Date(t * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' });
const cls = (v) => (v >= 0 ? 'up' : 'down');
const mode = () => EXIT_MODES[state.settings.exitMode] ?? EXIT_MODES.balanced;

// ---------- data ----------
async function refresh() {
  if (view.loading) return;
  view.loading = true; view.error = null; render();
  try {
    const [tick, btc] = await Promise.all([tickers(), candles('BTC')]);
    const regime = btcRegime(btc);
    const rows = await pool(state.coins, 4, async (coin) => {
      const c = coin === 'BTC' ? btc : await candles(coin);
      const x = indicators(c, regime);
      return { coin, x, st: status(x) };
    });
    view.tick = tick;
    view.rows = rows.map((r, i) => r.error ? { coin: state.coins[i], error: r.error } : r);
    view.regime = btcRegime(btc).get(btc.at(-1).time);
    view.updated = new Date();
    await checkAlerts();
  } catch (e) {
    view.error = 'Gagal mengambil data dari Indodax. Cek koneksi internet lalu coba lagi.';
  } finally {
    view.loading = false;
    render();
  }
}

// Stop naik ke impas setelah harga (high candle sejak masuk atau harga live) mencapai masuk + beAtr x ATR.
function updateStops() {
  let moved = [];
  for (const p of state.positions) {
    if (!p.beAtr || p.beHit) continue;
    const row = view.rows.find((r) => r.coin === p.coin && r.x);
    const since = row?.x.filter((k) => k.time * 1000 >= p.openedAt) ?? [];  // candle yang mulai setelah posisi dibuka
    const high = Math.max(view.tick[p.coin]?.last ?? 0, ...since.map((k) => k.high));
    if (high >= p.entry + p.beAtr * p.atr) {
      p.beHit = true;
      p.stop = Math.max(p.stop, breakevenStop(p.entry));
      moved.push(p);
    }
  }
  return moved;
}

// Posisi: keluar saat close harian < MA20 (setelah posisi dibuka) atau harga live <= stop.
function exitReason(p) {
  const row = view.rows.find((r) => r.coin === p.coin && r.x);
  const live = view.tick[p.coin]?.last;
  if (Number.isFinite(live) && live <= p.stop) return p.beHit ? 'Stop impas tersentuh (untung tipis terkunci)' : 'Stop loss tersentuh';
  const k = row?.x.at(-1);
  if (k && k.time * 1000 > p.openedAt - 86400000 && k.exit) return 'Close harian di bawah MA20';
  return null;
}

async function checkAlerts() {
  const moved = updateStops();
  if (moved.length) await save('positions');
  if (!state.settings.notif) return;
  const seen = new Set(state.notified), out = [];
  for (const p of moved) out.push({ title: `${p.coin}: stop pindah ke impas`, body: `Stop baru ${rp(p.stop)}. Posisi ini tidak bisa rugi lagi (kecuali gap harga).` });
  for (const r of view.rows) {
    if (r.st?.kind !== 'buy') continue;
    const key = `buy:${r.coin}:${r.st.last.time}`;
    if (!seen.has(key)) { seen.add(key); out.push({ title: `BELI ${r.coin}/IDR`, body: `Breakout high 20 hari. Stop saran ${rp(r.st.stop)}.` }); }
  }
  for (const p of state.positions) {
    const why = exitReason(p);
    const key = `exit:${p.id}`;
    if (why && !seen.has(key)) { seen.add(key); out.push({ title: `JUAL ${p.coin}/IDR`, body: `${why}. Buka app untuk menutup posisi.` }); }
  }
  state.notified = [...seen].slice(-300);
  await save('notified');
  await notify(out);
}

// ---------- komponen ----------
function spark(x, kind) {
  const pts = x.slice(-60).map((k) => k.close);
  const lo = Math.min(...pts), hi = Math.max(...pts), w = 84, h = 32;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * w},${h - ((v - lo) / (hi - lo || 1)) * h}`).join('');
  return `<svg class="spark ${kind}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

const dots = (n) => `<span class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
const badge = (st) => `<span class="badge ${st.kind}">${st.label}</span>`;

function coinCard(r) {
  if (r.error) return `<div class="card coin muted"><div class="avatar">${r.coin[0]}</div><div class="grow"><b>${r.coin}</b><small>Gagal memuat</small></div></div>`;
  const t = view.tick[r.coin], chg = t ? t.last / t.prev - 1 : NaN;
  return `<button class="card coin" data-coin="${r.coin}">
    <div class="avatar a-${r.st.kind}">${r.coin.slice(0, 1)}</div>
    <div class="grow"><b>${r.coin}<span class="pair">/IDR</span></b>
      <small>${rp(t?.last ?? r.st.last.close)} <span class="${cls(chg)}">${pct(chg)}</span></small></div>
    ${spark(r.x, r.st.kind)}
    <div class="right">${badge(r.st)}${dots(r.st.score)}</div>
  </button>`;
}

const ORDER = { buy: 0, watch: 1, wait: 2, avoid: 3, na: 4 };

function signalsView() {
  const ok = view.rows.filter((r) => r.st);
  const list = view.rows
    .filter((r) => view.filter === 'all' || r.st?.kind === view.filter)
    .sort((a, b) => (ORDER[a.st?.kind] ?? 9) - (ORDER[b.st?.kind] ?? 9) || (b.st?.score ?? 0) - (a.st?.score ?? 0));
  const n = (k) => ok.filter((r) => r.st.kind === k).length;
  const regime = view.regime == null ? '' : view.regime
    ? `<div class="banner good"><b>Pasar sehat</b><span>BTC di atas MA100. Sinyal BELI aktif.</span></div>`
    : `<div class="banner bad"><b>Pasar lemah</b><span>BTC di bawah MA100. Bot tidak membuka posisi baru sampai tren pulih.</span></div>`;
  return `${regime}
    <div class="stats3">
      <div><b class="up">${n('buy')}</b><small>Beli</small></div>
      <div><b class="warn">${n('watch')}</b><small>Pantau</small></div>
      <div><b>${state.positions.length}</b><small>Posisi</small></div>
    </div>
    <div class="seg">${[['all', 'Semua'], ['buy', 'Beli'], ['watch', 'Pantau'], ['avoid', 'Hindari']]
      .map(([k, l]) => `<button data-filter="${k}" class="${view.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="list">${list.map(coinCard).join('') || emptyText()}</div>`;
}

function emptyText() {
  if (view.loading) return '<div class="skeleton"></div>'.repeat(6);
  if (view.error) return `<p class="empty">${view.error}</p>`;
  return '<p class="empty">Tidak ada koin di kategori ini.</p>';
}

function positionsView() {
  if (!state.positions.length) return `<p class="empty">Belum ada posisi.<br>Buka koin bersinyal <b>BELI</b> lalu ketuk “Catat beli”.</p>`;
  return `<div class="list">${state.positions.map((p) => {
    const live = view.tick[p.coin]?.last, ret = live / p.entry - 1 - PARAMS.cost, why = exitReason(p);
    return `<div class="card pos">
      <div class="row"><b>${p.coin}/IDR</b>${why ? '<span class="badge avoid">JUAL</span>' : '<span class="badge hold">TAHAN</span>'}</div>
      <div class="big ${cls(ret)}">${pct(ret, 2)} <small>${rp(p.stake * ret)}</small></div>
      <div class="grid2">
        <span>Masuk<b>${rp(p.entry)}</b></span><span>Sekarang<b>${rp(live)}</b></span>
        <span>${p.beHit ? 'Stop impas ✓' : 'Stop'}<b>${rp(p.stop)}</b></span><span>Modal<b>${rp(p.stake)}</b></span>
      </div>
      ${why ? `<p class="alert">${why}</p>` : `<p class="hint">Tahan selama close harian di atas MA20 dan harga di atas stop.${
        p.beAtr && !p.beHit ? ` Stop pindah ke impas jika harga mencapai ${rp(p.entry + p.beAtr * p.atr)}.` : ''}</p>`}
      <button class="btn ${why ? 'danger' : 'ghost'}" data-close="${p.id}">Tutup posisi di ${rp(live)}</button>
    </div>`;
  }).join('')}</div>`;
}

function historyView() {
  const c = state.closed, w = c.filter((t) => t.ret > 0).length, pnl = c.reduce((s, t) => s + t.pnl, 0);
  return `<div class="card summary">
      <div><small>Win rate kamu</small><b>${c.length ? nf(0).format((w / c.length) * 100) + '%' : '-'}</b></div>
      <div><small>Transaksi</small><b>${c.length}</b></div>
      <div><small>Total P/L</small><b class="${cls(pnl)}">${rp(pnl)}</b></div>
    </div>
    <h3>Riwayat posisi</h3>
    <div class="list">${c.map((t) => `<div class="card trade">
      <div class="grow"><b>${t.coin}</b><small>${new Date(t.openedAt).toLocaleDateString('id-ID')} → ${new Date(t.closedAt).toLocaleDateString('id-ID')} · ${t.why}</small></div>
      <div class="right"><b class="${cls(t.ret)}">${pct(t.ret, 2)}</b><small>${rp(t.pnl)}</small></div>
    </div>`).join('') || '<p class="empty">Belum ada posisi yang ditutup.</p>'}</div>`;
}

function infoView() {
  const s = state.settings;
  return `<div class="card">
      <h3>Strategi: Breakout Tren</h3>
      <ol class="rules">
        <li><b>BELI</b> jika close harian menembus high 20 hari, di atas MA50, volume ≥ ${PARAMS.volRatioMin}x rata-rata, dan BTC di atas MA100.</li>
        <li><b>JUAL</b> jika close harian turun di bawah MA20.</li>
        <li><b>Stop loss</b> di harga masuk − ${PARAMS.stopAtr}× ATR14, lalu naik ke impas sesuai mode exit.</li>
      </ol>
      <p class="hint">Hasil uji pada 18 koin (biaya 0,8% per transaksi pulang-pergi). Parameter dipilih di data 2020–2022, lalu diuji di data 2023–Okt 2026 yang tidak dipakai untuk memilih.</p>
    </div>
    <div class="card">
      <h3>Mode exit</h3>
      <div class="modes">${Object.entries(EXIT_MODES).map(([k, m]) => `
        <button data-mode="${k}" class="mode ${state.settings.exitMode === k ? 'on' : ''}">
          <b>${m.label}</b>
          <small>${m.beAtr ? `Stop pindah ke impas setelah naik ${m.beAtr} ATR` : 'Tanpa stop impas, biarkan untung berjalan'}</small>
          <span class="grid3"><span>Win rate<b>${nf(1).format(m.test.win)}%</b></span><span>Rata-rata<b>+${nf(1).format(m.test.avg)}%</b></span><span>PF<b>${nf(2).format(m.test.pf)}</b></span></span>
        </button>`).join('')}</div>
      <p class="hint">Win rate makin tinggi karena banyak posisi ditutup di impas dengan untung tipis, tapi untung rata-rata per transaksi turun. Pembanding: strategi lama (MA/RSI/volume) win rate 35,1%, PF 2,06.</p>
      <p class="hint">Sudah diuji dan <b>tidak</b> dipakai karena tidak membantu di data uji: ADX, RSI, MA50&gt;MA200, Fear &amp; Greed Index, breadth pasar, kekuatan relatif vs BTC. Hasil masa lalu tidak menjamin hasil ke depan.</p>
    </div>
    <div class="card settings">
      <h3>Pengaturan</h3>
      <label>Modal per posisi (paper)<input type="number" id="stake" inputmode="numeric" value="${s.stake}" min="10000" step="10000"></label>
      ${Capacitor.isNativePlatform() ? `
      <label class="sw"><span>Notifikasi sinyal & jual</span><input type="checkbox" id="notif" ${s.notif ? 'checked' : ''}></label>
      <label class="sw"><span>Pengingat harian 07:05</span><input type="checkbox" id="reminder" ${s.reminder ? 'checked' : ''}></label>`
      : '<p class="hint">Versi web tidak bisa mengirim notifikasi. Buka app setelah 07:00 WIB (candle harian tutup) untuk cek sinyal baru.</p>'}
    </div>
    <p class="disclaimer">Paper trading saja: app ini tidak terhubung ke akun Indodax dan tidak mengeksekusi order. Bukan saran investasi.</p>`;
}

// ---------- detail ----------
async function openDetail(coin) {
  const r = view.rows.find((x) => x.coin === coin);
  if (!r?.st) return;
  const { st } = r, t = view.tick[coin], held = state.positions.some((p) => p.coin === coin);
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-bar"></div>
    <div class="row"><h2>${coin}<span class="pair">/IDR</span></h2>${badge(st)}</div>
    <div class="price">${rp(t?.last ?? st.last.close)}</div>
    <div id="chart"></div>
    <ul class="checks">${st.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.text}</li>`).join('')}</ul>
    <div class="grid2 card flat">
      <span>Close terakhir<b>${rp(st.last.close)}</b></span><span>High 20 hari<b>${rp(st.last.hh20)}</b></span>
      <span>MA20 / MA50<b>${rp(st.last.ma20)} / ${rp(st.last.ma50)}</b></span><span>Stop saran<b>${rp(st.stop)}</b></span>
    </div>
    <h3>Uji strategi di ${coin} sejak 2019 · mode ${mode().label}</h3>
    <div id="bt" class="card flat"><div class="skeleton small"></div></div>
    ${held ? '<p class="hint center">Kamu sudah memegang posisi koin ini.</p>'
      : `<button class="btn ${st.kind === 'buy' ? 'primary' : 'ghost'}" id="buy">${st.kind === 'buy' ? 'Catat beli' : 'Catat beli (tanpa sinyal)'} · ${rp(state.settings.stake)}</button>`}`;
  $('#overlay').classList.add('show');
  sheet.scrollTop = 0;
  const chart = drawChart($('#chart'), r.x.slice(-150));
  $('#buy')?.addEventListener('click', async () => {
    if (st.kind !== 'buy' && !confirm('Belum ada sinyal BELI. Tetap catat posisi?')) return;
    const price = view.tick[coin]?.last ?? st.last.close;
    await openPosition({ coin, price, stop: price - PARAMS.stopAtr * st.last.atr, atr: st.last.atr, beAtr: mode().beAtr });
    closeDetail(); view.tab = 'positions'; render();
  });
  try {
    view.btcFull ??= await candles('BTC', 0);
    const full = indicators(coin === 'BTC' ? view.btcFull : await candles(coin, 0), btcRegime(view.btcFull));
    const trades = backtest(full, mode().beAtr), s = stats(trades);
    chart?.markers(trades);
    $('#bt').innerHTML = s.n ? `<div class="grid4">
        <span>Win rate<b>${nf(0).format(s.winRate * 100)}%</b></span><span>Transaksi<b>${s.n}</b></span>
        <span>Profit factor<b>${Number.isFinite(s.pf) ? nf(2).format(s.pf) : '∞'}</b></span><span>Rata-rata<b class="${cls(s.avg)}">${pct(s.avg)}</b></span></div>
        <div class="trades">${trades.slice(-6).reverse().map((t) => `<div><span>${date(t.entryTime)}</span><span>${t.why}</span><b class="${cls(t.ret)}">${pct(t.ret)}</b></div>`).join('')}</div>`
      : '<p class="hint">Belum ada transaksi di histori koin ini.</p>';
  } catch {
    $('#bt').innerHTML = '<p class="hint">Gagal memuat histori lengkap.</p>';
  }
}

function closeDetail() {
  $('#overlay').classList.remove('show');
  $('#chart')?._chart?.remove();
}

function drawChart(el, x) {
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const chart = createChart(el, {
    height: 240, autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: color('--muted'), fontFamily: 'inherit' },
    grid: { vertLines: { visible: false }, horzLines: { color: color('--line') } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
    localization: { locale: 'id-ID', priceFormatter: (v) => rp(v).slice(2) },
    handleScroll: false, handleScale: false,
  });
  el._chart = chart;
  const cs = chart.addCandlestickSeries({ upColor: color('--up'), downColor: color('--down'), wickUpColor: color('--up'), wickDownColor: color('--down'), borderVisible: false });
  cs.setData(x.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  const line = (key, c) => chart.addLineSeries({ color: c, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false })
    .setData(x.filter((k) => Number.isFinite(k[key])).map((k) => ({ time: k.time, value: k[key] })));
  line('ma20', color('--accent'));
  line('ma50', color('--warn'));
  chart.timeScale().fitContent();
  const from = x[0].time;
  return {
    markers(trades) {
      const m = [];
      for (const t of trades.filter((t) => t.entryTime >= from)) {
        m.push({ time: t.entryTime, position: 'belowBar', color: color('--up'), shape: 'arrowUp', text: 'B' });
        if (!t.open) m.push({ time: t.exitTime, position: 'aboveBar', color: color('--down'), shape: 'arrowDown', text: 'J' });
      }
      cs.setMarkers(m.sort((a, b) => a.time - b.time));
    },
  };
}

// ---------- shell ----------
const TABS = [
  ['signals', 'Sinyal', 'M3 17l6-6 4 4 8-8M15 7h6v6'],
  ['positions', 'Posisi', 'M4 7h16v12H4zM9 7V5h6v2'],
  ['history', 'Riwayat', 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4'],
  ['info', 'Info', 'M12 16v-4M12 8h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18'],
];

function render() {
  const body = { signals: signalsView, positions: positionsView, history: historyView, info: infoView }[view.tab]();
  const last = view.rows.find((r) => r.x)?.x.at(-1);
  $('#app').innerHTML = `
    <header>
      <div><h1>${TABS.find((t) => t[0] === view.tab)[1]}</h1>
        <small>${view.loading ? 'Memuat data Indodax…' : view.updated ? `Candle ${date(last.time)} · cek ${view.updated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></div>
      <button id="refresh" class="icon ${view.loading ? 'spin' : ''}" aria-label="Muat ulang">
        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg></button>
    </header>
    ${view.error && view.rows.length ? `<p class="alert">${view.error}</p>` : ''}
    <main>${body}</main>
    <nav>${TABS.map(([k, l, d]) => `<button data-tab="${k}" class="${view.tab === k ? 'on' : ''}">
      <svg viewBox="0 0 24 24"><path d="${d}"/></svg><span>${l}</span>${k === 'positions' && state.positions.length ? `<em>${state.positions.length}</em>` : ''}</button>`).join('')}</nav>`;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (e.target.id === 'overlay') return closeDetail();
  if (!t) return;
  if (t.id === 'refresh') return refresh();
  if (t.dataset.tab) { view.tab = t.dataset.tab; render(); window.scrollTo(0, 0); }
  if (t.dataset.filter) { view.filter = t.dataset.filter; render(); }
  if (t.dataset.mode) { state.settings.exitMode = t.dataset.mode; await save('settings'); render(); }
  if (t.dataset.coin) openDetail(t.dataset.coin);
  if (t.dataset.close) {
    const p = state.positions.find((x) => x.id === +t.dataset.close);
    const price = view.tick[p.coin]?.last;
    if (!Number.isFinite(price)) return;
    if (!confirm(`Tutup ${p.coin} di ${rp(price)}?`)) return;
    await closePosition(p.id, price, exitReason(p) ?? 'Ditutup manual');
    render();
  }
});

document.addEventListener('change', async (e) => {
  const s = state.settings;
  if (e.target.id === 'stake') s.stake = Math.max(10000, +e.target.value || s.stake);
  if (e.target.id === 'notif') { s.notif = e.target.checked; if (s.notif) await ensurePermission(); }
  if (e.target.id === 'reminder') { s.reminder = e.target.checked; await setDailyReminder(s.reminder); }
  await save('settings');
});

// Muat ulang saat app kembali dibuka (HP Android maupun web app di iPhone).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!view.updated || Date.now() - view.updated > 5 * 60000)) refresh();
});
if (Capacitor.isNativePlatform()) CapApp.addListener('backButton', () => {
  if ($('#overlay').classList.contains('show')) closeDetail();
  else if (view.tab !== 'signals') { view.tab = 'signals'; render(); }
  else CapApp.minimizeApp();
});

(async () => {
  await load();
  render();
  await setDailyReminder(state.settings.reminder);
  refresh();
})();
