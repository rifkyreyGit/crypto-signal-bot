# Sinyal Kripto

Bot trading crypto otomatis untuk **Indodax** (pair IDR, candle harian) beserta app pemantau untuk Android dan iPhone. Bot berjalan di [freqtrade](https://www.freqtrade.io/); app menampilkan sinyal, posisi, dan riwayat bot, serta bisa menjual posisi dari HP. Tanpa Telegram.

> Proyek belajar dan portofolio. Bot saat ini berjalan dalam mode **dry-run** (saldo simulasi). Bukan saran investasi; hasil backtest tidak menjamin hasil ke depan.

## Isi

| Bagian | Isi |
|---|---|
| `bot/` | Strategi freqtrade `BreakoutTren.py` dan contoh config (tanpa rahasia) |
| `src/` | App (Vite + vanilla JS): tab Sinyal, Bot, Posisi, Riwayat, Info |
| `android/` | Proyek Capacitor untuk APK Android |
| `functions/` | Cloudflare Pages Functions: proxy data Indodax dan proxy API bot untuk versi web |
| `scripts/` | Riset dan backtest Python, uji paritas JS vs Python |

## Strategi: Breakout Tren

- **BELI**: close menembus high 20 hari, di atas MA50, volume ≥ 1,2x rata-rata 20 hari, dan BTC di atas MA100 (filter pasar)
- **JUAL**: close harian di bawah MA20 (tanpa take profit tetap, untung dibiarkan berjalan selama tren)
- **STOP**: harga masuk − 3×ATR14, paling jauh −15%; naik ke impas (+0,2% bersih) setelah harga naik 2×ATR
- **Portofolio**: maksimal 9 posisi, modal dibagi rata, profit diputar ulang
- **Koin**: 29 koin Indodax dengan volume terbesar dan spread ≤ 0,5%

## Cara riset (jujur, anti-overfitting)

- Parameter dan filter dipilih hanya di data **2020–2022**, lalu diuji di data **2023–Okt 2026** yang tidak dipakai untuk memilih
- Biaya realistis: fee, CFX, PPh 0,21%, dan slippage (diuji 0,6%–1,5% pulang-pergi; tetap untung)
- Sinyal di close hari t, eksekusi di open t+1; stop impas baru aktif setelah candle harian tutup (sama di backtest dan live)
- Logika strategi di app (JavaScript) dicek identik dengan riset Python: **1.541 transaksi, 3 mode exit**

### Hasil backtest freqtrade (data uji 2023–Okt 2026, modal Rp1 juta, 9 slot)

| | Hasil | Win rate | Profit factor | Drawdown maks |
|---|---|---|---|---|
| **Breakout Tren** | **+211%** | **55,6%** | **2,12** | 22% |
| Supertrend (10,3) | +184% | 43,7% | 1,61 | 46% |
| Turtle System 2 | +140% | 35,0% | 1,91 | 19% |
| Turtle System 1 | +104% | 34,9% | 1,39 | 31% |

*Daftar 18 koin awal. Rata-rata ±35% per tahun, tapi tidak merata: lebih banyak bulan datar/rugi kecil, dengan beberapa bulan untung besar.*

### Yang diuji dan tidak dipakai

| Ide | Hasil di data uji |
|---|---|
| Take profit 2% | Win rate 81%, tapi **rugi −24%** |
| Take profit 10% | +102% vs +253% tanpa TP; drawdown lebih besar |
| SL 2% / TP 2% | Butuh win rate 70% untuk impas; rugi |
| Stop maks −10% | 3x lebih sering kena stop; +205% vs +298% |
| Filter ADX, RSI, MA200, Fear & Greed, breadth | Tidak membantu di data uji (beberapa terlihat bagus di data latih: overfitting) |
| RSI(2) Connors, volatility breakout Larry Williams | Impas / rugi di crypto harian |
| Strategi yang sama di forex (10 pair + emas) | Rugi di semua variasi |

## Arsitektur

```
HP (APK / web app di Home Screen)
  ├─ data harga ──► API publik Indodax (lewat proxy Pages untuk web)
  └─ tab Bot ─────► proxy Pages /bot ──► Cloudflare Tunnel ──► API freqtrade (bot di laptop/VPS)
                                                                   └─► Indodax (order)
```

- App hanya bisa **membaca** data bot dan **menjual** posisi (forceexit). Proxy menolak perintah lain (beli paksa, stop bot, dll).
- API key Indodax disarankan **tanpa izin withdraw**.

## Menjalankan

### App

```bash
npm install
npm run dev       # coba di browser (proxy ke Indodax)
npm run apk       # APK debug (butuh JDK 21 + Android SDK)
npm run deploy    # web app ke Cloudflare Pages
```

### Bot

```bash
cp bot/BreakoutTren.py <freqtrade>/user_data/strategies/
cp bot/config.example.json <freqtrade>/user_data/config.breakout.json   # isi username/password API
freqtrade trade -c user_data/config.breakout.json                       # dry-run
cloudflared tunnel --url http://127.0.0.1:8080                          # akses dari HP
```

### Uji paritas JS vs Python

```bash
python scripts/export_parity.py parity.json
npm run parity -- parity.json
```

## Teknologi

Python (pandas, freqtrade), JavaScript (Vite, lightweight-charts), Capacitor (Android), Cloudflare Pages Functions & Tunnel.
