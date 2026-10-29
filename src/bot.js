// Klien untuk REST API freqtrade (bot BreakoutTren di Mac).
// Selain membaca data, app hanya bisa satu aksi: menjual (forceexit) posisi yang sudah dibuka bot.
import { Capacitor } from '@capacitor/core';
import { state, save } from './store.js';

export const botConfigured = () => !!(state.bot?.url && state.bot?.user && state.bot?.pass);

// Web (iPhone): lewat proxy /bot di pages.dev, karena *.trycloudflare.com bisa diblokir jaringan HP.
// APK Android: langsung ke tunnel. Dev lokal: langsung juga (Pages Function tidak jalan di Vite).
const viaProxy = !Capacitor.isNativePlatform() && !import.meta.env.DEV;

async function call(path, body) {
  const { url, user, pass } = state.bot;
  const headers = { Authorization: 'Basic ' + btoa(`${user}:${pass}`) };
  const init = body ? { method: 'POST', body: JSON.stringify(body) } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = viaProxy
    ? await fetch(`/bot/api/v1/${path}`, { ...init, headers: { ...headers, 'X-Bot-Url': url } })
    : await fetch(`${url.replace(/\/+$/, '')}/api/v1/${path}`, { ...init, headers });
  if (r.status === 401) throw new Error('Username atau password bot salah.');
  if (r.status === 400) throw new Error('URL bot harus alamat https://….trycloudflare.com dari Terminal.');
  // freqtrade membalas 502 kalau perintah ditolak (mis. posisi sudah tertutup), jadi untuk jual bedakan dari tunnel mati
  if (body && r.status === 502) throw new Error('bot menolak perintah jual (posisi mungkin sudah tertutup). Muat ulang tab Bot untuk cek.');
  if (r.status === 502 || r.status === 530) throw new Error('Tunnel tidak aktif. Jalankan lagi perintah cloudflared di Mac dan isi URL barunya.');
  if (!r.ok) {
    const detail = await r.json().then((j) => j.detail || j.error).catch(() => null);
    throw new Error(`Bot membalas ${r.status}${detail ? `: ${detail}` : ''}.`);
  }
  return r.json();
}

const get = (path) => call(path);

// Jual satu posisi sekarang juga (tercatat sebagai "Ditutup manual" / force_exit di bot).
export const sellNow = (tradeId) => call('forceexit', { tradeid: String(tradeId) });

export async function fetchBot() {
  const [config, balance, profit, open, closed] = await Promise.all([
    get('show_config'), get('balance'), get('profit'), get('status'), get('trades?limit=30'),
  ]);
  return {
    dryRun: config.dry_run,
    state: config.state,
    strategy: config.strategy,
    maxOpen: config.max_open_trades,
    stake: config.stake_currency,
    exchange: config.exchange,
    // balance.total freqtrade kadang tidak menghitung nilai koin yang dipegang (harga tidak terbaca),
    // jadi saldo = kas IDR + nilai posisi terbuka di harga sekarang
    total: (balance.currencies.find((c) => c.currency === balance.stake)?.balance ?? 0)
      + open.reduce((s, t) => s + t.amount * t.current_rate, 0),
    start: balance.starting_capital,
    profit: profit.profit_all_coin,
    closedProfit: profit.profit_closed_coin,
    wins: profit.winning_trades,
    losses: profit.losing_trades,
    open: open.map((t) => ({
      id: t.trade_id, pair: t.pair, entry: t.open_rate, now: t.current_rate, ret: t.profit_ratio, pnl: t.profit_abs,
      stop: t.stop_loss_abs, stake: t.stake_amount, opened: t.open_date,
    })),
    closed: closed.trades.filter((t) => !t.is_open).reverse().map((t) => ({
      pair: t.pair, ret: t.profit_ratio, pnl: t.profit_abs, why: t.exit_reason, opened: t.open_date, closedAt: t.close_date,
    })),
  };
}

// URL sering tersalin dari kotak log cloudflared dengan spasi, '|', atau huruf kapital otomatis dari iPhone.
export function cleanUrl(raw) {
  let u = raw.replace(/[\s|]+/g, '').replace(/\/api\/v1.*$/i, '').replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/^https?:\/\/[^/]+/i, (host) => host.toLowerCase());
}

export async function saveBotLogin(url, user, pass) {
  state.bot = { url: cleanUrl(url), user: user.trim(), pass: pass.trim() };
  await save('bot');
}
