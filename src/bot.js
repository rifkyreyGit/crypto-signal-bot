// Klien baca-saja untuk REST API freqtrade (bot BreakoutTren di Mac).
// App sengaja hanya memanggil endpoint GET: tidak ada tombol paksa beli/jual dari HP.
import { Capacitor } from '@capacitor/core';
import { state, save } from './store.js';

export const botConfigured = () => !!(state.bot?.url && state.bot?.user && state.bot?.pass);

// Web (iPhone): lewat proxy /bot di pages.dev, karena *.trycloudflare.com bisa diblokir jaringan HP.
// APK Android: langsung ke tunnel. Dev lokal: langsung juga (Pages Function tidak jalan di Vite).
const viaProxy = !Capacitor.isNativePlatform() && !import.meta.env.DEV;

async function get(path) {
  const { url, user, pass } = state.bot;
  const auth = { Authorization: 'Basic ' + btoa(`${user}:${pass}`) };
  const r = viaProxy
    ? await fetch(`/bot/api/v1/${path}`, { headers: { ...auth, 'X-Bot-Url': url } })
    : await fetch(`${url.replace(/\/+$/, '')}/api/v1/${path}`, { headers: auth });
  if (r.status === 401) throw new Error('Username atau password bot salah.');
  if (r.status === 400) throw new Error('URL bot harus alamat https://….trycloudflare.com dari Terminal.');
  if (r.status === 502 || r.status === 530) throw new Error('Tunnel tidak aktif. Jalankan lagi perintah cloudflared di Mac dan isi URL barunya.');
  if (!r.ok) throw new Error(`Bot membalas ${r.status}.`);
  return r.json();
}

export async function fetchBot() {
  const [config, balance, profit, open, closed] = await Promise.all([
    get('show_config'), get('balance'), get('profit'), get('status'), get('trades?limit=30'),
  ]);
  return {
    dryRun: config.dry_run,
    state: config.state,
    strategy: config.strategy,
    maxOpen: config.max_open_trades,
    total: balance.total,
    start: balance.starting_capital,
    profit: profit.profit_all_coin,
    closedProfit: profit.profit_closed_coin,
    wins: profit.winning_trades,
    losses: profit.losing_trades,
    open: open.map((t) => ({
      pair: t.pair, entry: t.open_rate, now: t.current_rate, ret: t.profit_ratio, pnl: t.profit_abs,
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
