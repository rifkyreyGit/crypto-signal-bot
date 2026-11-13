// Harga live dari stream WebSocket publik Binance (data-stream.binance.vision: tanpa akun, bisa diakses dari
// jaringan Indonesia). Satu koneksi untuk semua koin; koneksi ditutup saat app di latar belakang (hemat baterai)
// dan dibuka lagi saat app dibuka.
const URL = 'wss://data-stream.binance.vision/ws';

let ws = null, want = new Set(), handlers = {}, retry = 0, timer = null;

function send(method, params) {
  if (ws?.readyState === 1 && params.length) ws.send(JSON.stringify({ method, params, id: Date.now() }));
}

function connect() {
  if (ws || document.visibilityState !== 'visible' || !want.size) return;
  const sock = ws = new WebSocket(URL);
  sock.onopen = () => { retry = 0; send('SUBSCRIBE', [...want]); };
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.e === '24hrMiniTicker') handlers.ticker?.(m.s.replace(/USDT$/, ''), +m.c);
    else if (m.e === 'kline') handlers.kline?.(m.s.replace(/USDT$/, ''), m.k);
  };
  sock.onclose = () => {
    if (ws !== sock) return;  // koneksi lama yang sengaja ditutup
    ws = null;
    if (document.visibilityState === 'visible') timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
}

// streams: mis. ['btcusdt@miniTicker', 'solusdt@kline_1d']. Stream yang tidak ada di daftar baru dihentikan.
export function watch(streams) {
  const next = new Set(streams);
  send('UNSUBSCRIBE', [...want].filter((s) => !next.has(s)));
  send('SUBSCRIBE', [...next].filter((s) => !want.has(s)));
  want = next;
  connect();
}

export function onLive(h) { handlers = h; }

document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (document.visibilityState === 'visible') connect();
  else { ws?.close(); ws = null; }
});

export const isLive = () => ws?.readyState === 1;
