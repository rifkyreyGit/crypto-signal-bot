// Cocokkan strategy.js dengan riset Python. Data: python scripts/export_parity.py <file.json>
import { readFileSync } from 'node:fs';
import { btcRegime, indicators, backtest, EXIT_MODES } from '../src/strategy.js';

const data = JSON.parse(readFileSync(process.argv[2] ?? 'parity.json', 'utf8'));
const regime = btcRegime(data.BTC.candles);
let bad = 0, total = 0;
for (const [coin, { candles, trades }] of Object.entries(data)) {
  const x = indicators(candles, regime);
  for (const [mode, { beAtr }] of Object.entries(EXIT_MODES)) {
    const py = trades[mode], js = backtest(x, beAtr);
    total += py.length;
    const same = js.length === py.length && js.every((t, i) => t.entryTime === py[i][0] && Math.abs(t.ret - py[i][1]) < 1e-9);
    if (!same) { bad++; console.log(`${coin} [${mode}]: JS ${js.length} vs Python ${py.length} transaksi`); }
  }
}
console.log(bad ? `GAGAL: ${bad} kasus berbeda` : `OK: ${total} transaksi (${Object.keys(data).length} koin x 3 mode) identik`);
process.exit(bad ? 1 : 0);
