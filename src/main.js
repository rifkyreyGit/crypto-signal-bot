import './style.css';
import { createChart } from 'lightweight-charts';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { candles, tickers, pool, usdtIdr } from './api.js';
import { PARAMS, EXIT_MODES, btcRegime, breakevenStop, indicators, status, backtest, stats } from './strategy.js';
import { state, load, save, openPosition, closePosition } from './store.js';
import { notify, setDailyReminder, ensurePermission } from './notify.js';
import { botConfigured, fetchBot, saveBotLogin, sellNow } from './bot.js';

const $ = (s, r = document) => r.querySelector(s);
const view = { tab: 'signals', filter: 'all', rows: [], tick: {}, regime: null, updated: null, loading: false, error: null };

// ---------- format ----------
const nf = (d) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d });
export function rp(v) {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v), d = a >= 1000 || a === 0 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return 'Rp' + nf(d).format(v);
}
// Harga dan uang di app dalam USDT (data Binance)
export function usd(v) {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v), d = a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : a === 0 ? 2 : 8;
  return (v < 0 ? '-$' : '$') + nf(d).format(a);
}
// Perkiraan Rupiah dari jumlah USDT (kurs Indodax), mis. "≈ Rp1,6 jt"
function idr(v) {
  if (!Number.isFinite(v) || !view.usdtIdr) return '';
  const r = v * view.usdtIdr, a = Math.abs(r), sign = r < 0 ? '-' : '';
  const t = a >= 1e9 ? nf(2).format(a / 1e9) + ' M' : a >= 1e6 ? nf(2).format(a / 1e6) + ' jt' : a >= 1e3 ? nf(0).format(a / 1e3) + ' rb' : nf(0).format(a);
  return `≈ ${sign}Rp${t}`;
}
const pct = (v, d = 1) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + nf(d).format(v * 100) + '%' : '-';
const date = (t) => new Date(t * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' });
const cls = (v) => (v >= 0 ? 'up' : 'down');
// Uang di tab Bot/Riwayat mengikuti mata uang bot (IDR di Indodax, USDT di Binance)
const money = (v) => (view.bot && view.bot.stake !== 'USDT' ? rp(v) : usd(v));
// Logo koin disimpan di app (public/logos, diambil dari Binance; CDN Binance menolak hotlink).
// Koin tanpa logo: gambar gagal dimuat dan huruf awal di belakangnya yang tampil.
const coinOf = (pair) => String(pair).split('/')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
function logo(coin, kind = '') {
  const c = coinOf(coin);
  return `<div class="avatar ${kind ? 'a-' + kind : ''}"><span>${c.slice(0, 1)}</span>`
    + `<img src="/logos/${c}.png" alt="" loading="lazy" onerror="this.remove()"></div>`;
}
const mode = () => EXIT_MODES[state.settings.exitMode] ?? EXIT_MODES.balanced;

// ---------- data ----------
async function refresh() {
  if (view.loading) return;
  view.loading = true; view.error = null; render();
  try {
    const [tick, btc, kurs] = await Promise.all([tickers(state.coins), candles('BTC'), usdtIdr()]);
    if (kurs) view.usdtIdr = kurs;
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
    view.error = 'Gagal mengambil data dari Binance. Cek koneksi internet lalu coba lagi.';
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
  for (const p of moved) out.push({ title: `${p.coin}: stop pindah ke impas`, body: `Stop baru ${usd(p.stop)}. Posisi ini tidak bisa rugi lagi (kecuali gap harga).` });
  for (const r of view.rows) {
    if (r.st?.kind !== 'buy') continue;
    const key = `buy:${r.coin}:${r.st.last.time}`;
    if (!seen.has(key)) { seen.add(key); out.push({ title: `BELI ${r.coin}/USDT`, body: `Breakout high 20 hari. Stop saran ${usd(r.st.stop)}.` }); }
  }
  for (const p of state.positions) {
    const why = exitReason(p);
    const key = `exit:${p.id}`;
    if (why && !seen.has(key)) { seen.add(key); out.push({ title: `JUAL ${p.coin}/USDT`, body: `${why}. Buka app untuk menutup posisi.` }); }
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
  if (r.error) return `<div class="card coin muted">${logo(r.coin)}<div class="grow"><b>${r.coin}</b><small>Gagal memuat</small></div></div>`;
  const t = view.tick[r.coin], chg = t ? t.last / t.prev - 1 : NaN;
  return `<button class="card coin" data-coin="${r.coin}">
    ${logo(r.coin, r.st.kind)}
    <div class="grow"><b>${r.coin}<span class="pair">/USDT</span></b>
      <small>${usd(t?.last ?? r.st.last.close)} <span class="${cls(chg)}">${pct(chg)}</span></small></div>
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
      <div class="row"><b>${p.coin}/USDT</b>${why ? '<span class="badge avoid">JUAL</span>' : '<span class="badge hold">TAHAN</span>'}</div>
      <div class="big ${cls(ret)}">${pct(ret, 2)} <small>${usd(p.stake * ret)}</small></div>
      <div class="grid2">
        <span>Masuk<b>${usd(p.entry)}</b></span><span>Sekarang<b>${usd(live)}</b></span>
        <span>${p.beHit ? 'Stop impas ✓' : 'Stop'}<b>${usd(p.stop)}</b></span><span>Modal<b>${usd(p.stake)}</b></span>
      </div>
      ${why ? `<p class="alert">${why}</p>` : `<p class="hint">Tahan selama close harian di atas MA20 dan harga di atas stop.${
        p.beAtr && !p.beHit ? ` Stop pindah ke impas jika harga mencapai ${usd(p.entry + p.beAtr * p.atr)}.` : ''}</p>`}
      <button class="btn ${why ? 'danger' : 'ghost'}" data-close="${p.id}">Tutup posisi di ${usd(live)}</button>
    </div>`;
  }).join('')}</div>`;
}

function botHistory() {
  if (!botConfigured()) return '';
  const b = view.bot;
  if (!b) return `<h3>Transaksi bot</h3>${view.botError ? `<p class="alert">${esc(view.botError)}</p>` : '<div class="skeleton"></div>'}`;
  const n = b.wins + b.losses, pnl = b.closed.reduce((s, t) => s + t.pnl, 0);
  return `<h3>Transaksi bot ${b.dryRun ? '(dry-run)' : '(uang sungguhan)'}</h3>
    <div class="card summary">
      <div><small>Win rate bot</small><b>${n ? nf(0).format((b.wins / n) * 100) + '%' : '-'}</b></div>
      <div><small>Transaksi</small><b>${n}</b></div>
      <div><small>Total P/L</small><b class="${cls(pnl)}">${money(pnl)}</b><small>${b.stake === 'USDT' ? idr(pnl) : ''}</small></div>
    </div>
    <div class="list" style="margin-top:8px">${b.closed.map((t) => `<div class="card trade">
      ${logo(t.pair)}<div class="grow"><b>${esc(t.pair)}</b><small>${ago(t.opened)} → ${ago(t.closedAt)} · ${esc(EXIT_TEXT[t.why] ?? t.why)}</small></div>
      <div class="right"><b class="${cls(t.ret)}">${pct(t.ret, 2)}</b><small>${money(t.pnl)}</small></div></div>`).join('') || '<p class="empty">Bot belum menutup posisi.</p>'}</div>`;
}

function historyView() {
  const c = state.closed, w = c.filter((t) => t.ret > 0).length, pnl = c.reduce((s, t) => s + t.pnl, 0);
  return `${botHistory()}
    <h3>Catatan manual kamu</h3>
    <div class="card summary">
      <div><small>Win rate kamu</small><b>${c.length ? nf(0).format((w / c.length) * 100) + '%' : '-'}</b></div>
      <div><small>Transaksi</small><b>${c.length}</b></div>
      <div><small>Total P/L</small><b class="${cls(pnl)}">${money(pnl)}</b></div>
    </div>
    <div class="list" style="margin-top:8px">${c.map((t) => `<div class="card trade">
      <div class="grow"><b>${t.coin}</b><small>${new Date(t.openedAt).toLocaleDateString('id-ID')} → ${new Date(t.closedAt).toLocaleDateString('id-ID')} · ${t.why}</small></div>
      <div class="right"><b class="${cls(t.ret)}">${pct(t.ret, 2)}</b><small>${money(t.pnl)}</small></div>
    </div>`).join('') || '<p class="empty">Belum ada. Ini untuk posisi yang kamu catat sendiri lewat "Catat beli" di tab Sinyal.</p>'}</div>`;
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
      <p class="hint">Bot dan app memantau 29 koin <b>Binance (USDT)</b> dengan volume terbesar. Uji di Binance (data 2023–Okt 2026, 18 koin yang sama): +397%, win rate 58%, profit factor 2,39. Parameter dipilih di data 2020–2022 yang tidak dipakai untuk menguji. Angka mode exit di bawah dari uji awal di Indodax (biaya 0,8%).</p>
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
      <label>Modal per posisi (paper, USDT)<input type="number" id="stake" inputmode="decimal" value="${s.stakeUsd}" min="5" step="5"></label>
      ${Capacitor.isNativePlatform() ? `
      <label class="sw"><span>Notifikasi sinyal & jual</span><input type="checkbox" id="notif" ${s.notif ? 'checked' : ''}></label>
      <label class="sw"><span>Pengingat harian 07:05</span><input type="checkbox" id="reminder" ${s.reminder ? 'checked' : ''}></label>`
      : '<p class="hint">Versi web tidak bisa mengirim notifikasi. Buka app setelah 07:00 WIB (candle harian tutup) untuk cek sinyal baru.</p>'}
    </div>
    <p class="disclaimer">Paper trading saja: catatan manual di app tidak mengeksekusi order apa pun. Bukan saran investasi.</p>`;
}

// ---------- detail ----------
async function openDetail(coin) {
  const r = view.rows.find((x) => x.coin === coin);
  if (!r?.st) return;
  const { st } = r, t = view.tick[coin], held = state.positions.some((p) => p.coin === coin);
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-bar"></div>
    <button class="back" id="back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Kembali</button>
    <div class="row"><div class="title-coin">${logo(coin)}<h2>${coin}<span class="pair">/USDT</span></h2></div>${badge(st)}</div>
    <div class="price">${money(t?.last ?? st.last.close)}</div>
    <div id="chart"></div>
    <ul class="checks">${st.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.text}</li>`).join('')}</ul>
    <div class="grid2 card flat">
      <span>Close terakhir<b>${money(st.last.close)}</b></span><span>High 20 hari<b>${money(st.last.hh20)}</b></span>
      <span>MA20 / MA50<b>${money(st.last.ma20)} / ${money(st.last.ma50)}</b></span><span>Stop saran<b>${money(st.stop)}</b></span>
    </div>
    <h3>Uji strategi di ${coin} sejak 2019 · mode ${mode().label}</h3>
    <div id="bt" class="card flat"><div class="skeleton small"></div></div>
    ${held ? '<p class="hint center">Kamu sudah memegang posisi koin ini.</p>'
      : `<button class="btn ${st.kind === 'buy' ? 'primary' : 'ghost'}" id="buy">${st.kind === 'buy' ? 'Catat beli' : 'Catat beli (tanpa sinyal)'} · ${money(state.settings.stakeUsd)}</button>`}`;
  $('#overlay').classList.add('show');
  if (!history.state?.sheet) history.pushState({ sheet: 1 }, '');  // tombol/gesture kembali menutup detail
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

function closeDetail(fromHistory = false) {
  $('#overlay').classList.remove('show');
  $('#chart')?._chart?.remove();
  if (!fromHistory && history.state?.sheet) history.back();
}

window.addEventListener('popstate', () => {
  if ($('#overlay').classList.contains('show')) closeDetail(true);
});

function drawChart(el, x) {
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const chart = createChart(el, {
    height: 240, autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: color('--muted'), fontFamily: 'inherit' },
    grid: { vertLines: { visible: false }, horzLines: { color: color('--line') } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
    localization: { locale: 'id-ID', priceFormatter: (v) => money(v).slice(2) },
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

// ---------- bot (freqtrade di Mac) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const EXIT_TEXT = { 'close<ma20': 'Close < MA20', trailing_stop_loss: 'Stop impas', stop_loss: 'Stop loss', force_exit: 'Ditutup manual' };
const ago = (d) => new Date(d.replace(' ', 'T') + (d.endsWith('Z') || d.includes('+') ? '' : 'Z')).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

async function loadBot() {
  if (!botConfigured() || view.botLoading) return;
  view.botLoading = true; view.botError = null; render();
  try { view.bot = await fetchBot(); view.botUpdated = new Date(); }
  catch (e) { view.botError = /^(Bot|Username|URL|Tunnel)/.test(e.message) ? e.message : `Bot tidak bisa dihubungi di ${state.bot.url}. Cek URL-nya, dan pastikan Mac menyala serta bot dan tunnel jalan.`; }
  finally { view.botLoading = false; render(); }
}

function botLoginForm() {
  const b = state.bot;
  return `<div class="card settings">
      <h3>Hubungkan ke bot</h3>
      <p class="hint">Isi dari file <b>bot-login.txt</b> di folder freqtrade di Mac.</p>
      <label>URL bot<input id="bot-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…" value="${esc(b.url)}"></label>
      <label>Username<input id="bot-user" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="username" value="${esc(b.user)}"></label>
      <label>Password<input id="bot-pass" type="password" autocomplete="current-password" value="${esc(b.pass)}"></label>
      <button class="btn primary" id="bot-save">Simpan & hubungkan</button>
    </div>
    <p class="disclaimer">App hanya membaca data bot. Beli/jual tetap dilakukan bot sendiri.</p>`;
}

function botView() {
  if (!botConfigured() || view.botEdit) return botLoginForm();
  const b = view.bot;
  if (!b) return view.botError ? `<p class="alert">${esc(view.botError)}</p><button class="btn ghost" data-bot="edit">Ubah koneksi</button>`
    : '<div class="skeleton"></div>'.repeat(3);
  const n = b.wins + b.losses, ret = b.profit / b.start;
  return `${view.botError ? `<p class="alert">${esc(view.botError)}</p>` : ''}
    <div class="banner ${b.dryRun ? 'good' : 'bad'}"><b>${b.dryRun ? 'DRY-RUN · saldo simulasi' : 'LIVE · uang sungguhan'}</b>
      <span>${esc(b.exchange ?? '')} · ${esc(b.strategy)} · status ${esc(b.state)} · ${b.open.length}/${b.maxOpen} posisi</span></div>
    <div class="card summary">
      <div><small>Saldo</small><b>${money(b.total)}</b><small>${b.stake === 'USDT' ? idr(b.total) : ''}</small></div>
      <div><small>Profit</small><b class="${cls(ret)}">${pct(ret)}</b><small>${money(b.profit)}${b.stake === 'USDT' && idr(b.profit) ? '<br>' + idr(b.profit) : ''}</small></div>
      <div><small>Win rate</small><b>${n ? nf(0).format((b.wins / n) * 100) + '%' : '-'}</b></div>
    </div>
    <h3>Posisi terbuka</h3>
    <div class="list">${b.open.map((t) => `<div class="card pos">
      <div class="row"><div class="title-coin">${logo(t.pair)}<b>${esc(t.pair)}</b></div><span class="${cls(t.ret)}">${pct(t.ret, 2)} · ${money(t.pnl)} <small style="display:inline">${b.stake === 'USDT' ? idr(t.pnl) : ''}</small></span></div>
      <div class="grid2" style="margin-top:10px">
        <span>Masuk<b>${money(t.entry)}</b></span><span>Sekarang<b>${money(t.now)}</b></span>
        <span>Stop${t.stop >= t.entry ? ' impas ✓' : ''}<b>${money(t.stop)}</b></span><span>Modal<b>${money(t.stake)}</b></span>
      </div>
      <button class="btn danger" data-sell="${t.id}" ${view.selling === t.id ? 'disabled' : ''}>${view.selling === t.id ? 'Menjual…' : `Jual sekarang di ±${money(t.now)}`}</button></div>`).join('') || '<p class="empty">Belum ada posisi. Bot menunggu sinyal breakout.</p>'}</div>
    <h3>Transaksi selesai (${n})</h3>
    <div class="list">${b.closed.slice(0, 20).map((t) => `<div class="card trade">
      ${logo(t.pair)}<div class="grow"><b>${esc(t.pair)}</b><small>${ago(t.opened)} → ${ago(t.closedAt)} · ${esc(EXIT_TEXT[t.why] ?? t.why)}</small></div>
      <div class="right"><b class="${cls(t.ret)}">${pct(t.ret, 2)}</b><small>${money(t.pnl)}</small></div></div>`).join('') || '<p class="empty">Belum ada.</p>'}</div>
    <button class="btn ghost" data-bot="edit">Ubah koneksi bot</button>`;
}

// ---------- shell ----------
const TABS = [
  ['signals', 'Sinyal', 'M3 17l6-6 4 4 8-8M15 7h6v6'],
  ['bot', 'Bot', 'M5 9h14v10H5zM9 13h.01M15 13h.01M12 5v4M10 16h4'],
  ['positions', 'Posisi', 'M4 7h16v12H4zM9 7V5h6v2'],
  ['history', 'Riwayat', 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4'],
  ['info', 'Info', 'M12 16v-4M12 8h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18'],
];

function render() {
  const body = { signals: signalsView, bot: botView, positions: positionsView, history: historyView, info: infoView }[view.tab]();
  const last = view.rows.find((r) => r.x)?.x.at(-1);
  const sub = view.tab === 'bot'
    ? (view.botLoading ? 'Menghubungi bot…' : view.botUpdated ? `Data bot · cek ${view.botUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : '')
    : view.loading ? 'Memuat data Binance…' : view.updated ? `Candle ${date(last.time)} · cek ${view.updated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : '';
  const spinning = view.tab === 'bot' ? view.botLoading : view.loading;
  $('#app').innerHTML = `
    <header>
      <div><h1>${TABS.find((t) => t[0] === view.tab)[1]}</h1>
        <small>${sub}</small></div>
      <button id="refresh" class="icon ${spinning ? 'spin' : ''}" aria-label="Muat ulang">
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
  if (t.id === 'back') return closeDetail();
  if (t.id === 'refresh') return view.tab === 'bot' || view.tab === 'history' ? loadBot() : refresh();
  if (t.dataset.tab) {
    view.tab = t.dataset.tab; render(); window.scrollTo(0, 0);
    if ((view.tab === 'bot' || view.tab === 'history') && (!view.botUpdated || Date.now() - view.botUpdated > 60000)) loadBot();
  }
  if (t.dataset.bot === 'edit') { view.botEdit = true; render(); }
  if (t.dataset.sell && !view.selling) {
    const p = view.bot?.open.find((x) => String(x.id) === t.dataset.sell);
    if (!p) return;
    const akun = view.bot.dryRun ? 'saldo simulasi (dry-run)' : 'UANG SUNGGUHAN';
    if (!confirm(`Jual ${p.pair} sekarang?\n\nHarga ±${money(p.now)} · hasil ${pct(p.ret, 2)} (${money(p.pnl)})\nAkun: ${akun}\n\nBot akan menjual di harga pasar saat ini.`)) return;
    view.selling = p.id; render();
    try { await sellNow(p.id); view.botError = null; }
    catch (err) { view.botError = `Gagal menjual ${p.pair}: ${err.message}`; }
    finally { view.selling = null; }
    setTimeout(loadBot, 1500);
  }
  if (t.id === 'bot-save') {
    await saveBotLogin($('#bot-url').value, $('#bot-user').value, $('#bot-pass').value);
    view.botEdit = false; view.bot = null; loadBot();
  }
  if (t.dataset.filter) { view.filter = t.dataset.filter; render(); }
  if (t.dataset.mode) { state.settings.exitMode = t.dataset.mode; await save('settings'); render(); }
  if (t.dataset.coin) openDetail(t.dataset.coin);
  if (t.dataset.close) {
    const p = state.positions.find((x) => x.id === +t.dataset.close);
    const price = view.tick[p.coin]?.last;
    if (!Number.isFinite(price)) return;
    if (!confirm(`Tutup ${p.coin} di ${usd(price)}?`)) return;
    await closePosition(p.id, price, exitReason(p) ?? 'Ditutup manual');
    render();
  }
});

document.addEventListener('change', async (e) => {
  const s = state.settings;
  if (e.target.id === 'stake') s.stakeUsd = Math.max(5, +e.target.value || s.stakeUsd);
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
