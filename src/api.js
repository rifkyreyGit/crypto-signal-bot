// Data publik Indodax. Di HP, CapacitorHttp mem-bypass CORS; di browser dev lewat proxy Vite.
import { Capacitor } from '@capacitor/core';

const BASE = Capacitor.isNativePlatform() ? 'https://indodax.com' : '/indodax';
const DAY = 86400;

async function getJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`Indodax ${r.status}`);
  return r.json();
}

// Candle harian yang sudah tutup saja (candle hari ini dibuang).
export async function candles(coin, days = 420) {
  const now = Math.floor(Date.now() / 1000);
  const from = days ? now - days * DAY : 1546300800;
  const raw = await getJson(`/tradingview/history_v2?symbol=${coin}IDR&tf=1D&from=${from}&to=${now}`);
  return raw
    .filter((k) => k.Time + DAY <= now)
    .map((k) => ({ time: k.Time, open: +k.Open, high: +k.High, low: +k.Low, close: +k.Close, volume: +k.Volume }));
}

export async function tickers() {
  const { tickers: t, prices_24h: p24 } = await getJson('/api/summaries');
  const out = {};
  for (const [pair, v] of Object.entries(t)) {
    if (!pair.endsWith('_idr')) continue;
    const prev = +(p24[pair.replace('_', '')] ?? v.last);
    out[pair.slice(0, -4).toUpperCase()] = { last: +v.last, prev, volIdr: +v.vol_idr };
  }
  return out;
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
