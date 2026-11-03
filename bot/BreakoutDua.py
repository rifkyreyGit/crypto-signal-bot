"""Breakout Dua Arah: BreakoutTren + short untuk Binance futures, leverage 1x. Hanya untuk riset.

Metode short (config "breakout_dua": {"metode": ...}), semuanya hanya saat BTC < MA100 (kecuali short_filter_btc=false):
  breakdown : close < low 20 hari sebelumnya, close < MA50, volume >= 1,2x  → tutup close > MA20 (cermin BreakoutTren)
  turtle    : close < low 55 hari sebelumnya (Turtle System 2)               → tutup close > high 20 hari sebelumnya
  rally     : sell the rally, tren turun (MA20 < MA50, close < MA50), kemarin close >= MA20 dan hari ini close < MA20
              (pantulan gagal)                                               → tutup close > MA50
  tsmom     : momentum deret waktu: return 60 hari < 0 dan return 20 hari < 0 → tutup return 20 hari > 0
Stop short: masuk + short_stop_atr x ATR14 (default 3), paling jauh +15%; impas setelah low <= masuk - 2 ATR.
Opsi: "arah": "dua" | "long" | "short"; "short_pairs": ["BTC/USDT:USDT", ...] untuk membatasi koin short.
Butuh "trading_mode": "futures", "margin_mode": "isolated", pair format "BTC/USDT:USDT".
"""
import sys
from pathlib import Path

from pandas import DataFrame

sys.path.insert(0, str(Path(__file__).parent))
from BreakoutTren import BreakoutTren  # noqa: E402


class BreakoutDua(BreakoutTren):
    can_short = True

    def bot_start(self, **kwargs) -> None:
        super().bot_start(**kwargs)
        cfg = self.config.get("breakout_dua") or {}
        self.ARAH = cfg.get("arah", "dua")
        self.METODE = cfg.get("metode", "breakdown")
        self.SHORT_FILTER_BTC = cfg.get("short_filter_btc", True)
        self.SHORT_PAIRS = cfg.get("short_pairs")
        self.SHORT_STOP_ATR = cfg.get("short_stop_atr", self.STOP_ATR)

    def populate_indicators(self, df: DataFrame, metadata: dict) -> DataFrame:
        df = super().populate_indicators(df, metadata)
        c = df["close"]
        df["ll20"] = df["low"].rolling(20).min().shift(1)
        df["ll55"] = df["low"].rolling(55).min().shift(1)
        df["ret20"], df["ret60"] = c / c.shift(20) - 1, c / c.shift(60) - 1
        df["btc_down"] = ~df["btc_ok"] & df[f"ok_{self.timeframe}"].notna()
        return df

    def populate_entry_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        if self.ARAH in ("dua", "long"):
            df = super().populate_entry_trend(df, metadata)
        if self.ARAH not in ("dua", "short") or (self.SHORT_PAIRS and metadata["pair"] not in self.SHORT_PAIRS):
            return df
        c = df["close"]
        if self.METODE == "turtle":
            sig = c < df["ll55"]
        elif self.METODE == "rally":
            sig = (df["ma20"] < df["ma50"]) & (c < df["ma50"]) & (c.shift() >= df["ma20"].shift()) & (c < df["ma20"])
        elif self.METODE == "tsmom":
            sig = (df["ret60"] < 0) & (df["ret20"] < 0)
        else:
            sig = (c < df["ll20"]) & (c < df["ma50"]) & (df["vr"] >= 1.2)
        if self.SHORT_FILTER_BTC:
            sig &= df["btc_down"]
        df.loc[sig & (df["volume"] > 0), ["enter_short", "enter_tag"]] = (1, f"short_{self.METODE}")
        return df

    def populate_exit_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        df = super().populate_exit_trend(df, metadata)
        c = df["close"]
        if self.METODE == "turtle":
            out = c > df["hh20"]
        elif self.METODE == "rally":
            out = c > df["ma50"]
        elif self.METODE == "tsmom":
            out = df["ret20"] > 0
        else:
            out = c > df["ma20"]
        df.loc[out, ["exit_short", "exit_tag"]] = (1, "tutup_short")
        return df

    def custom_stoploss(self, pair, trade, current_time, current_rate, current_profit, after_fill, **kwargs):
        if not trade.is_short:
            return super().custom_stoploss(pair, trade, current_time, current_rate, current_profit, after_fill, **kwargs)
        base, self.STOP_ATR = self.STOP_ATR, self.SHORT_STOP_ATR
        try:
            return super().custom_stoploss(pair, trade, current_time, current_rate, current_profit, after_fill, **kwargs)
        finally:
            self.STOP_ATR = base

    def leverage(self, pair: str, current_time, current_rate: float, proposed_leverage: float,
                 max_leverage: float, entry_tag, side: str, **kwargs) -> float:
        return 1.0
