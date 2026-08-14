"""ทดสอบย้อนหลัง (backtest) กลยุทธ์ของ AI เทียบกับการซื้อแล้วถือ

เป้าหมายคือตอบว่า "ถ้าเชื่อสัญญาณของบอทมาตลอด 6 เดือนที่ผ่านมา ผลจะดีกว่าถือเฉย ๆ ไหม"

กติกาที่ยึดเพื่อไม่ให้ผลลัพธ์หลอกตัวเอง
  * ใช้เฉพาะข้อมูลถึงวันที่ t ในการตัดสินใจ แล้วรับผลตอบแทนของวันที่ t+1 (ไม่มี look-ahead)
  * หักค่าธรรมเนียมและ slippage ทุกครั้งที่ปรับสัดส่วนการถือครอง
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.config import PERIODS_PER_YEAR
from core.indicators import drawdown_series, max_drawdown, rsi, sma
from core.risk import annualized_return, sharpe_ratio, volatility

WARMUP_DAYS = 40  # ต้องมีข้อมูลพอสำหรับ SMA30 และ RSI14 ก่อนเริ่มเทรด


@dataclass(frozen=True)
class BacktestResult:
    """ผลการทดสอบย้อนหลังของเหรียญหนึ่งตัว"""

    symbol: str
    strategy_equity: np.ndarray
    buy_hold_equity: np.ndarray
    exposure: np.ndarray  # สัดส่วนการถือครองในแต่ละวัน (0-1)
    strategy_returns: np.ndarray
    buy_hold_returns: np.ndarray
    n_trades: int
    fees_paid: float

    @property
    def strategy_total_return(self) -> float:
        return float(self.strategy_equity[-1] / self.strategy_equity[0] - 1.0)

    @property
    def buy_hold_total_return(self) -> float:
        return float(self.buy_hold_equity[-1] / self.buy_hold_equity[0] - 1.0)

    @property
    def excess_return(self) -> float:
        return self.strategy_total_return - self.buy_hold_total_return

    @property
    def strategy_max_drawdown(self) -> float:
        return max_drawdown(self.strategy_equity)

    @property
    def buy_hold_max_drawdown(self) -> float:
        return max_drawdown(self.buy_hold_equity)

    @property
    def strategy_sharpe(self) -> float:
        return sharpe_ratio(self.strategy_returns)

    @property
    def buy_hold_sharpe(self) -> float:
        return sharpe_ratio(self.buy_hold_returns)

    @property
    def strategy_volatility(self) -> float:
        return volatility(self.strategy_returns)

    @property
    def avg_exposure(self) -> float:
        return float(np.mean(self.exposure)) if self.exposure.size else 0.0

    @property
    def win_rate(self) -> float:
        """สัดส่วนวันที่ถือแล้วได้กำไร"""
        active = self.strategy_returns[self.exposure[:-1] > 0.05] if self.exposure.size > 1 else np.array([])
        if active.size == 0:
            return 0.0
        return float((active > 0).mean())

    def summary(self) -> dict:
        return {
            "ผลตอบแทนกลยุทธ์ AI": self.strategy_total_return,
            "ผลตอบแทนซื้อแล้วถือ": self.buy_hold_total_return,
            "ส่วนต่าง": self.excess_return,
            "ย่อลึกสุด (AI)": self.strategy_max_drawdown,
            "ย่อลึกสุด (ถือ)": self.buy_hold_max_drawdown,
            "Sharpe (AI)": self.strategy_sharpe,
            "Sharpe (ถือ)": self.buy_hold_sharpe,
            "จำนวนครั้งที่ปรับพอร์ต": self.n_trades,
        }


def signal_score_at(prices: np.ndarray, index: int) -> float:
    """คะแนนสัญญาณ ณ วันที่ index โดยใช้ข้อมูลถึงวันนั้นเท่านั้น

    เป็นเวอร์ชันย่อของ AI Advisor (ตัด Monte Carlo ออกเพื่อความเร็ว)
    ใช้ปัจจัยเดียวกัน 3 ตัว: โมเมนตัม แนวโน้ม และ RSI
    """
    window = prices[: index + 1]
    if window.size < WARMUP_DAYS:
        return 0.0

    mom_7 = window[-1] / window[-8] - 1.0 if window.size > 8 else 0.0
    mom_30 = window[-1] / window[-31] - 1.0 if window.size > 31 else 0.0
    momentum_score = 0.6 * np.tanh(mom_7 / 0.18) + 0.4 * np.tanh(mom_30 / 0.45)

    sma30 = sma(window, 30)
    gap = window[-1] / sma30[-1] - 1.0 if not np.isnan(sma30[-1]) and sma30[-1] > 0 else 0.0
    trend_score = np.tanh(gap / 0.22)

    rsi_values = rsi(window, 14)
    rsi_now = rsi_values[-1] if not np.isnan(rsi_values[-1]) else 50.0
    reversion_score = -np.tanh((rsi_now - 50.0) / 22.0)

    return float(np.clip(0.45 * momentum_score + 0.35 * trend_score + 0.20 * reversion_score, -1, 1))


def score_to_exposure(score: float, max_exposure: float = 1.0) -> float:
    """แปลงคะแนนเป็นสัดส่วนการถือครอง (long-only)

    คะแนน <= 0 = ถือเงินสด, คะแนน 0.5 ขึ้นไป = ถือเต็มพิกัด
    """
    if score <= 0.05:
        return 0.0
    return float(np.clip(score / 0.5, 0.0, 1.0) * max_exposure)


def run_backtest(symbol: str, prices, fee_bps: float = 10.0, slippage_bps: float = 25.0,
                 starting_equity: float = 10_000.0, max_exposure: float = 1.0) -> BacktestResult:
    """เดินไปข้างหน้าวันต่อวัน ตัดสินใจด้วยข้อมูลในอดีตเท่านั้น"""
    p = np.asarray(prices, dtype=float)
    n = p.size
    cost_rate = (fee_bps + slippage_bps) / 10_000.0

    asset_returns = p[1:] / p[:-1] - 1.0

    exposure = np.zeros(n)
    strategy_returns = np.zeros(n - 1)
    fees_paid = 0.0
    n_trades = 0
    equity = starting_equity

    for t in range(n - 1):
        target = score_to_exposure(signal_score_at(p, t), max_exposure) if t >= WARMUP_DAYS else 0.0
        previous = exposure[t - 1] if t > 0 else 0.0

        turnover = abs(target - previous)
        # ปรับพอร์ตเฉพาะเมื่อสัดส่วนเปลี่ยนเกิน 5% เพื่อลดค่าธรรมเนียมจากการขยับจุกจิก
        if turnover < 0.05:
            target = previous
            turnover = 0.0
        elif turnover > 0:
            n_trades += 1

        cost = turnover * cost_rate
        fees_paid += cost * equity
        exposure[t] = target

        # ได้รับผลตอบแทนของวันถัดไปตามสัดส่วนที่ถือ ณ สิ้นวันนี้
        period_return = target * asset_returns[t] - cost
        strategy_returns[t] = period_return
        equity *= 1.0 + period_return

    exposure[-1] = exposure[-2] if n > 1 else 0.0

    strategy_equity = starting_equity * np.concatenate([[1.0], np.cumprod(1.0 + strategy_returns)])
    buy_hold_equity = starting_equity * p / p[0]

    return BacktestResult(
        symbol=symbol,
        strategy_equity=strategy_equity,
        buy_hold_equity=buy_hold_equity,
        exposure=exposure,
        strategy_returns=strategy_returns,
        buy_hold_returns=asset_returns,
        n_trades=n_trades,
        fees_paid=fees_paid,
    )


def portfolio_backtest(prices_by_symbol: dict[str, np.ndarray], weights: dict[str, float],
                       fee_bps: float = 10.0, slippage_bps: float = 25.0,
                       starting_equity: float = 10_000.0) -> BacktestResult:
    """รวมผล backtest ของหลายเหรียญตามน้ำหนักที่กำหนด"""
    symbols = [s for s in weights if s in prices_by_symbol and weights[s] > 0]
    if not symbols:
        empty = np.array([starting_equity])
        return BacktestResult("PORTFOLIO", empty, empty, np.array([0.0]),
                              np.array([]), np.array([]), 0, 0.0)

    total_weight = sum(weights[s] for s in symbols)
    normalized = {s: weights[s] / total_weight for s in symbols}

    results = {
        s: run_backtest(s, prices_by_symbol[s], fee_bps, slippage_bps, starting_equity)
        for s in symbols
    }
    length = min(r.strategy_returns.size for r in results.values())

    strategy_returns = sum(
        normalized[s] * results[s].strategy_returns[-length:] for s in symbols
    )
    buy_hold_returns = sum(
        normalized[s] * results[s].buy_hold_returns[-length:] for s in symbols
    )
    exposure = sum(normalized[s] * results[s].exposure[-(length + 1):] for s in symbols)

    return BacktestResult(
        symbol="PORTFOLIO",
        strategy_equity=starting_equity * np.concatenate([[1.0], np.cumprod(1.0 + strategy_returns)]),
        buy_hold_equity=starting_equity * np.concatenate([[1.0], np.cumprod(1.0 + buy_hold_returns)]),
        exposure=np.asarray(exposure, dtype=float),
        strategy_returns=np.asarray(strategy_returns, dtype=float),
        buy_hold_returns=np.asarray(buy_hold_returns, dtype=float),
        n_trades=sum(r.n_trades for r in results.values()),
        fees_paid=sum(r.fees_paid for r in results.values()),
    )


def drawdown_curves(result: BacktestResult) -> tuple[np.ndarray, np.ndarray]:
    """เส้น drawdown ของทั้งสองกลยุทธ์ ใช้วาดกราฟเปรียบเทียบ"""
    return drawdown_series(result.strategy_equity), drawdown_series(result.buy_hold_equity)


def annualized_stats(result: BacktestResult) -> dict[str, float]:
    """ตัวเลขสรุปแบบต่อปี"""
    return {
        "strategy_cagr": annualized_return(result.strategy_returns, PERIODS_PER_YEAR),
        "buy_hold_cagr": annualized_return(result.buy_hold_returns, PERIODS_PER_YEAR),
        "strategy_vol": volatility(result.strategy_returns, PERIODS_PER_YEAR),
        "buy_hold_vol": volatility(result.buy_hold_returns, PERIODS_PER_YEAR),
    }
