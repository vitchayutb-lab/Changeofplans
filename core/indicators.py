"""อินดิเคเตอร์ทางเทคนิคพื้นฐาน ใช้เป็น input ให้กับ AI scoring engine

ทุกฟังก์ชันรับ numpy array หรือ pandas Series ของ "ราคาปิด" เรียงจากเก่า -> ใหม่
และคืนค่าเป็น numpy array ที่มีความยาวเท่าเดิม (เติม NaN ช่วงต้นที่ยังคำนวณไม่ได้)
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _as_series(prices) -> pd.Series:
    if isinstance(prices, pd.Series):
        return prices.astype(float)
    return pd.Series(np.asarray(prices, dtype=float))


def simple_returns(prices) -> np.ndarray:
    """อัตราผลตอบแทนรายคาบแบบง่าย r_t = P_t / P_{t-1} - 1 (ความยาว n-1)"""
    p = np.asarray(prices, dtype=float)
    if p.size < 2:
        return np.array([], dtype=float)
    return p[1:] / p[:-1] - 1.0


def log_returns(prices) -> np.ndarray:
    """ผลตอบแทนแบบ log ใช้กับโมเดล GBM"""
    p = np.asarray(prices, dtype=float)
    if p.size < 2:
        return np.array([], dtype=float)
    return np.log(p[1:] / p[:-1])


def sma(prices, window: int) -> np.ndarray:
    """ค่าเฉลี่ยเคลื่อนที่แบบง่าย"""
    return _as_series(prices).rolling(window, min_periods=window).mean().to_numpy()


def ema(prices, span: int) -> np.ndarray:
    """ค่าเฉลี่ยเคลื่อนที่แบบ exponential"""
    return _as_series(prices).ewm(span=span, adjust=False).mean().to_numpy()


def rsi(prices, period: int = 14) -> np.ndarray:
    """Relative Strength Index ตามวิธีของ Wilder (ค่า 0-100)

    RSI > 70 = ซื้อมากเกินไป (overbought), RSI < 30 = ขายมากเกินไป (oversold)
    """
    s = _as_series(prices)
    delta = s.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    # Wilder smoothing เทียบเท่า EMA ที่ alpha = 1/period
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    # ถ้าไม่มีแรงขายเลยในหน้าต่างนั้น ให้ RSI = 100
    out = out.where(~((avg_loss == 0.0) & (avg_gain > 0.0)), 100.0)
    return out.to_numpy()


def macd(prices, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD line, signal line และ histogram"""
    macd_line = ema(prices, fast) - ema(prices, slow)
    signal_line = _as_series(macd_line).ewm(span=signal, adjust=False).mean().to_numpy()
    return macd_line, signal_line, macd_line - signal_line


def rolling_volatility(prices, window: int = 30, periods_per_year: int = 365) -> np.ndarray:
    """ความผันผวนต่อปีแบบเคลื่อนที่ (annualized standard deviation ของผลตอบแทน)"""
    s = _as_series(prices)
    rets = s.pct_change()
    return (rets.rolling(window, min_periods=window).std() * np.sqrt(periods_per_year)).to_numpy()


def max_drawdown(prices) -> float:
    """การขาดทุนสูงสุดจากจุดสูงสุดเดิม คืนค่าเป็นสัดส่วนติดลบ เช่น -0.42 = -42%"""
    p = np.asarray(prices, dtype=float)
    if p.size == 0:
        return 0.0
    running_peak = np.maximum.accumulate(p)
    drawdowns = p / running_peak - 1.0
    return float(drawdowns.min())


def drawdown_series(prices) -> np.ndarray:
    """เส้น drawdown ณ ทุกจุดเวลา"""
    p = np.asarray(prices, dtype=float)
    if p.size == 0:
        return np.array([], dtype=float)
    return p / np.maximum.accumulate(p) - 1.0


def momentum(prices, lookback: int) -> float:
    """ผลตอบแทนสะสมย้อนหลัง N คาบ (เช่น lookback=7 คือโมเมนตัม 7 วัน)"""
    p = np.asarray(prices, dtype=float)
    if p.size <= lookback or p[-lookback - 1] == 0:
        return 0.0
    return float(p[-1] / p[-lookback - 1] - 1.0)


def distance_from_sma(prices, window: int = 30) -> float:
    """ราคาปัจจุบันอยู่ห่างจากเส้นค่าเฉลี่ยกี่ % (บวก = ยืนเหนือเส้น)"""
    line = sma(prices, window)
    if line.size == 0 or np.isnan(line[-1]) or line[-1] == 0:
        return 0.0
    return float(np.asarray(prices, dtype=float)[-1] / line[-1] - 1.0)


def latest(values) -> float:
    """ค่าล่าสุดที่ไม่ใช่ NaN คืน 0.0 ถ้าไม่มีเลย"""
    arr = np.asarray(values, dtype=float)
    valid = arr[~np.isnan(arr)]
    return float(valid[-1]) if valid.size else 0.0
