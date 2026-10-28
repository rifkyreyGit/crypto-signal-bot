# Sinyal Kripto

App Android untuk sinyal crypto Indodax (pair IDR, candle harian). Mandiri: data diambil langsung dari API publik Indodax di HP, notifikasi lokal, tanpa server dan tanpa Telegram. Paper trading saja, tidak terhubung ke akun dan tidak mengeksekusi order. Bukan saran investasi.

## Strategi: Breakout Tren

- **BELI**: close menembus high 20 hari, di atas MA50, volume ≥ 1,2x rata-rata 20 hari, BTC di atas MA100
- **JUAL**: close di bawah MA20
- **Stop**: masuk − 3×ATR14, lalu naik ke impas (+0,2% bersih) sesuai mode exit

Uji 18 koin, biaya 0,8% pulang-pergi. Parameter dipilih di data 2020–2022, diuji di data 2023–Okt 2026:

| Mode | Win rate | Rata-rata/transaksi | Profit factor |
|---|---|---|---|
| Strategi lama (MA/RSI/volume) | 35,1% | +8,6% | 2,06 |
| Profit maksimal | 42,3% | +7,5% | 2,70 |
| Seimbang (impas +2 ATR, default) | 56,4% | +5,8% | 2,57 |
| Win rate tinggi (impas +1 ATR) | 62,7% | +3,9% | 2,39 |

Filter yang diuji dan **tidak** dipakai karena tidak membantu di data uji: ADX, RSI, MA50>MA200, Fear & Greed Index, breadth pasar, kekuatan relatif vs BTC, trailing ATR. Lihat `scripts/research_filters.py` dan `scripts/research_exits.py`.

## Build

```bash
npm install
npm run dev     # coba di browser (proxy ke Indodax)
npm run apk     # APK debug di android/app/build/outputs/apk/debug/
```

### iPhone (web app)

```bash
npx wrangler login   # sekali saja
npm run deploy       # Cloudflare Pages + proxy Indodax di functions/
```

Buka URL `*.pages.dev` di Safari iPhone → Bagikan → Tambah ke Layar Utama. Versi web tidak punya notifikasi.

Butuh JDK 21 (`brew install openjdk@21`) dan Android SDK (`JAVA_HOME`, `ANDROID_HOME`).

## Uji paritas JS vs Python

```bash
python scripts/export_parity.py parity.json   # pakai venv freqtrade (pandas + data feather)
npm run parity -- parity.json
```
