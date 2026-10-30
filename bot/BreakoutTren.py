"""Breakout Tren: port dari app Sinyal Kripto (crypto-signal-app/src/strategy.js).

BELI  : close > high 20 hari sebelumnya, close > MA50, volume >= 1,2x rata-rata 20 hari, BTC/IDR > MA100
JUAL  : close < MA20
STOP  : masuk - 3x ATR14 (ATR hari sinyal), paling jauh -15%; naik ke impas (+0,2% bersih) setelah harga
        mencapai masuk + BE_ATR x ATR. BE_ATR: None = profit maksimal, 2 = seimbang, 1 = win rate tinggi.
AI    : opsional (config "ai_veto"), Claude memeriksa berita sebelum beli dan boleh menolak. Lihat ai_veto.py.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

from pandas import DataFrame

from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, merge_informative_pair, stoploss_from_absolute

sys.path.insert(0, str(Path(__file__).parent))
import ai_veto  # noqa: E402


def sma(s, n):
    return s.rolling(n).mean()


def wilder(s, n):
    return s.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


class BreakoutTren(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = "1d"
    can_short = False
    minimal_roi = {"0": 100}          # tidak pakai target ROI
    stoploss = -0.99                  # stop sungguhan diatur custom_stoploss
    use_custom_stoploss = True
    use_exit_signal = True
    exit_profit_only = False
    process_only_new_candles = True
    startup_candle_count = 120

    BE_ATR = 2.0                      # mode Seimbang
    STOP_ATR = 3.0
    COST = 0.008                      # biaya pulang-pergi untuk kunci impas; Binance: config "breakout_cost": 0.003
    BE_LOCK = 0.002
    MAX_STOP = 0.15                   # stop awal paling jauh -15% (uji: profit sama, drawdown lebih kecil); None = murni 3 ATR

    @property
    def BTC(self) -> str:
        """Pair BTC untuk filter pasar, mengikuti mata uang bursa (BTC/IDR di Indodax, BTC/USDT di Binance)."""
        return f"BTC/{self.config['stake_currency']}"

    def bot_start(self, **kwargs) -> None:
        self.COST = self.config.get("breakout_cost", self.COST)

    def informative_pairs(self):
        return [(self.BTC, self.timeframe)]

    def populate_indicators(self, df: DataFrame, metadata: dict) -> DataFrame:
        c = df["close"]
        df["ma20"], df["ma50"] = sma(c, 20), sma(c, 50)
        df["vr"] = df["volume"] / sma(df["volume"], 20)
        prev_close = c.shift()
        tr = DataFrame({"a": df["high"] - df["low"], "b": (df["high"] - prev_close).abs(),
                        "c": (df["low"] - prev_close).abs()}).max(axis=1)
        df["atr"] = wilder(tr, 14)
        df["hh20"] = df["high"].rolling(20).max().shift(1)

        btc = self.dp.get_pair_dataframe(self.BTC, self.timeframe)[["date", "close"]].copy()
        btc["ok"] = (btc["close"] > sma(btc["close"], 100)).astype(int)
        df = merge_informative_pair(df, btc[["date", "ok"]], self.timeframe, self.timeframe, ffill=True)
        df["btc_ok"] = df[f"ok_{self.timeframe}"].fillna(0).astype(bool)
        return df

    def populate_entry_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        df.loc[(df["close"] > df["hh20"]) & (df["close"] > df["ma50"]) & df["btc_ok"]
               & (df["vr"] >= 1.2) & (df["volume"] > 0), ["enter_long", "enter_tag"]] = (1, "breakout")
        return df

    def populate_exit_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        df.loc[df["close"] < df["ma20"], ["exit_long", "exit_tag"]] = (1, "close<ma20")
        return df

    def confirm_trade_entry(self, pair: str, order_type: str, amount: float, rate: float, time_in_force: str,
                            current_time: datetime, entry_tag: str | None, side: str, **kwargs) -> bool:
        """AI veto. shadow=true: hanya dicatat, tetap beli (untuk membandingkan dengan/tanpa AI)."""
        cfg = self.config.get("ai_veto") or {}
        if not cfg.get("enabled") or self.config["runmode"].value not in ("dry_run", "live"):
            return True
        key = (pair, current_time.date())
        if not hasattr(self, "_ai_cache"):
            self._ai_cache = {}
        if key not in self._ai_cache:  # satu panggilan per koin per hari
            verdict = ai_veto.check(pair, cfg)
            self._ai_cache[key] = verdict
            ai_veto.log(str(Path(self.config["user_data_dir"]) / "ai_veto.jsonl"),
                        {"time": current_time.isoformat(), "pair": pair, "rate": rate,
                         "shadow": cfg.get("shadow", True), **verdict})
        verdict = self._ai_cache[key]
        return not (verdict["veto"] and not cfg.get("shadow", True))

    def _signal_atr(self, pair: str, trade: Trade):
        """ATR pada candle sinyal (candle harian terakhir yang tutup sebelum posisi dibuka)."""
        df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        before = df[df["date"] + timedelta(days=1) <= trade.open_date_utc]
        return float(before["atr"].iloc[-1]) if len(before) else None

    def _be_touched(self, pair: str, trade: Trade, current_time: datetime, atr: float) -> bool:
        """Target impas tersentuh oleh high candle harian yang SUDAH tutup sejak posisi dibuka.
        Sama dengan riset/app: stop impas berlaku mulai candle berikutnya, baik di backtest maupun live."""
        df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        closed = df[(df["date"] >= trade.open_date_utc) & (df["date"] + timedelta(days=1) <= current_time)]
        return len(closed) > 0 and closed["high"].max() >= trade.open_rate + self.BE_ATR * atr

    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime, current_rate: float,
                        current_profit: float, after_fill: bool, **kwargs) -> float | None:
        atr = trade.get_custom_data("atr")
        if atr is None:
            atr = self._signal_atr(pair, trade)
            if atr is None:
                return None
            trade.set_custom_data("atr", atr)
        stop = trade.open_rate - self.STOP_ATR * atr
        if self.MAX_STOP:
            stop = max(stop, trade.open_rate * (1 - self.MAX_STOP))
        if self.BE_ATR and (trade.get_custom_data("be") or self._be_touched(pair, trade, current_time, atr)):
            trade.set_custom_data("be", True)
            stop = max(stop, trade.open_rate * (1 + self.COST + self.BE_LOCK))
        return stoploss_from_absolute(stop, current_rate, is_short=trade.is_short, leverage=trade.leverage)
