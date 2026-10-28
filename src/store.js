// Penyimpanan lokal di HP (posisi paper trading, riwayat, pengaturan). Tidak ada server.
import { Preferences } from '@capacitor/preferences';

export const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'SUI', 'TRX', 'NEAR',
  'PEPE', 'SHIB', 'HBAR', 'QNT', 'WLD', 'ENA', 'ONDO', 'STRK', 'PENGU', 'HYPE', 'PUFFER', 'FARTCOIN',
  'HAEDAL', 'PIPPIN', 'BR', 'ASTER', 'MYX', 'BEAT', 'SKYAI'];

const DEFAULTS = {
  coins: DEFAULT_COINS,
  positions: [],
  closed: [],
  notified: [],
  bot: { url: '', user: '', pass: '' },
  settings: { stake: 1000000, notif: true, reminder: true, exitMode: 'balanced' },
};

export const state = structuredClone(DEFAULTS);

export async function load() {
  for (const key of Object.keys(DEFAULTS)) {
    const { value } = await Preferences.get({ key });
    if (value) {
      try { state[key] = JSON.parse(value); } catch { /* data rusak: pakai default */ }
    }
  }
  state.settings = { ...DEFAULTS.settings, ...state.settings };
}

export async function save(...keys) {
  for (const key of keys) await Preferences.set({ key, value: JSON.stringify(state[key]) });
}

export function openPosition({ coin, price, stop, atr, beAtr }) {
  const stake = state.settings.stake;
  state.positions.push({ id: Date.now(), coin, entry: price, stake, qty: stake / price, stop, atr, beAtr, openedAt: Date.now() });
  return save('positions');
}

export function closePosition(id, price, why) {
  const i = state.positions.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [p] = state.positions.splice(i, 1);
  const ret = price / p.entry - 1 - 0.008;
  state.closed.unshift({ ...p, exit: price, closedAt: Date.now(), why, ret, pnl: p.stake * ret });
  return save('positions', 'closed');
}
