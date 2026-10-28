// Notifikasi lokal di HP (tanpa Telegram, tanpa server).
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const native = Capacitor.isNativePlatform();
const REMINDER_ID = 7000;

export async function ensurePermission() {
  if (!native) return false;
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'granted') return true;
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}

export async function notify(items) {
  if (!items.length) return;
  if (!native) { console.info('notif', items); return; }
  if (!(await ensurePermission())) return;
  await LocalNotifications.schedule({
    notifications: items.map((n, i) => ({ id: (Date.now() % 100000) * 10 + i, title: n.title, body: n.body })),
  });
}

// Candle harian Indodax tutup pukul 07:00 WIB; pengingat 07:05 untuk membuka app dan cek sinyal baru.
export async function setDailyReminder(on) {
  if (!native) return;
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
  if (!on || !(await ensurePermission())) return;
  await LocalNotifications.schedule({
    notifications: [{
      id: REMINDER_ID,
      title: 'Candle harian sudah tutup',
      body: 'Buka app untuk cek sinyal BELI dan posisi yang perlu ditutup.',
      schedule: { on: { hour: 7, minute: 5 }, allowWhileIdle: true },
    }],
  });
}
