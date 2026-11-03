// Data pasar publik Binance (pair USDT) dari data-api.binance.vision: tanpa akun, bisa diakses dari
// jaringan Indonesia, dan mengizinkan CORS. Data Indodax (pair IDR, sama dengan bot Indodax) dan kurs
// USDT/IDR lewat proxy /indodax di web (Indodax tidak mengirim header CORS).
import { Capacitor } from '@capacitor/core';

const BINANCE = 'https://data-api.binance.vision';
const INDODAX = Capacitor.isNativePlatform() ? 'https://indodax.com' : '/indodax';
const DAY = 86400;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const toCandle = (k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] });

// Candle harian yang sudah tutup saja (candle hari ini dibuang). days = 0 berarti histori lengkap sejak 2019.
export async function candles(coin, days = 420) {
  const now = Date.now();
  let start = days ? now - days * DAY * 1000 : Date.UTC(2019, 0, 1);
  const out = [];
  for (;;) {
    const raw = await getJson(`${BINANCE}/api/v3/klines?symbol=${coin}USDT&interval=1d&startTime=${start}&limit=1000`);
    out.push(...raw.map(toCandle));
    if (raw.length < 1000) break;
    start = raw.at(-1)[0] + DAY * 1000;
  }
  return out.filter((k) => k.closeTime < now).map(({ closeTime, ...k }) => k);
}

export async function tickers(coins) {
  const symbols = encodeURIComponent(JSON.stringify(coins.map((c) => `${c}USDT`)));
  const rows = await getJson(`${BINANCE}/api/v3/ticker/24hr?symbols=${symbols}`);
  const out = {};
  for (const t of rows) out[t.symbol.slice(0, -4)] = { last: +t.lastPrice, prev: +t.prevClosePrice || +t.openPrice, volUsd: +t.quoteVolume };
  return out;
}

// Candle harian Indodax (pair IDR) yang sudah tutup. days = 0 berarti histori lengkap sejak 2019.
export async function candlesIdx(coin, days = 420) {
  const now = Math.floor(Date.now() / 1000);
  const from = days ? now - days * DAY : Date.UTC(2019, 0, 1) / 1000;
  const raw = await getJson(`${INDODAX}/tradingview/history_v2?symbol=${coin}IDR&tf=1D&from=${from}&to=${now}`);
  return raw
    .filter((k) => k.Time + DAY <= now)
    .map((k) => ({ time: k.Time, open: +k.Open, high: +k.High, low: +k.Low, close: +k.Close, volume: +k.Volume }));
}

export async function tickersIdx() {
  const { tickers: t, prices_24h: p24 } = await getJson(`${INDODAX}/api/summaries`);
  const out = {};
  for (const [pair, v] of Object.entries(t)) {
    if (!pair.endsWith('_idr')) continue;
    out[pair.slice(0, -4).toUpperCase()] = { last: +v.last, prev: +(p24[pair.replace('_', '')] ?? v.last), volIdr: +v.vol_idr };
  }
  return out;
}

// Kurs 1 USDT dalam Rupiah (harga terakhir di Indodax). Gagal = null, app tetap jalan tanpa perkiraan Rupiah.
export async function usdtIdr() {
  try {
    const { ticker } = await getJson(`${INDODAX}/api/ticker/usdtidr`);
    return +ticker.last || null;
  } catch {
    return null;
  }
}

export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (e) { out[i] = { error: e.message }; }
    }
  }));
  return out;
}
