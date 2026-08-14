"""พยากรณ์ราคาในอนาคต: "ตอนนี้ราคาจะขึ้นหรือลง"

ใช้ Geometric Brownian Motion (GBM) ซึ่งเป็นโมเดลมาตรฐานของราคาสินทรัพย์

    dS = μ S dt + σ S dW      =>      S_T = S_0 * exp((μ - σ²/2)T + σ√T · Z)

จุดสำคัญคือ **μ (drift) ไม่ได้เดาลอย ๆ** แต่ผสมจาก 3 แหล่ง
  1. ผลตอบแทนที่ควรได้ตามความเสี่ยง (CAPM ผ่านค่า β)
  2. โมเมนตัมที่เกิดขึ้นจริงในอดีตล่าสุด
  3. แรงกดดันการกลับสู่ค่าเฉลี่ยเมื่อราคาหลุดจากเส้นค่าเฉลี่ยไปมาก

ค่าที่ได้จึงเป็น "การกระจายตัวของราคาที่เป็นไปได้" ไม่ใช่คำทำนายจุดเดียว
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.config import PERIODS_PER_YEAR
from core.indicators import distance_from_sma, log_returns, momentum


@dataclass(frozen=True)
class Forecast:
    """ผลการพยากรณ์ราคาในกรอบเวลาที่กำหนด"""

    symbol: str
    horizon_days: int
    spot: float
    drift_annual: float
    volatility_annual: float
    prob_up: float  # ความน่าจะเป็นที่ราคาปลายทาง > ราคาปัจจุบัน
    expected_price: float
    median_price: float
    p05: float  # กรณีเลวร้าย (percentile 5)
    p25: float
    p75: float
    p95: float  # กรณีดีมาก (percentile 95)
    expected_return: float
    percentile_paths: dict[str, np.ndarray]  # เส้นกราฟพัด (fan chart)

    @property
    def downside_risk(self) -> float:
        """โอกาสขาดทุนกรณีเลวร้าย = ราคาที่ percentile 5 ต่ำกว่าปัจจุบันกี่ %"""
        return self.p05 / self.spot - 1.0 if self.spot else 0.0

    @property
    def upside_potential(self) -> float:
        return self.p95 / self.spot - 1.0 if self.spot else 0.0

    @property
    def direction(self) -> str:
        if self.prob_up >= 0.58:
            return "ขาขึ้น"
        if self.prob_up <= 0.42:
            return "ขาลง"
        return "ไม่ชัดเจน"

    @property
    def reward_to_risk(self) -> float:
        """อัปไซด์ต่อดาวน์ไซด์ > 1 = ได้มากกว่าเสียเมื่อเทียบที่ความน่าจะเป็นเท่ากัน"""
        downside = abs(self.downside_risk)
        return self.upside_potential / downside if downside > 1e-9 else 0.0


def estimate_drift(prices, asset_beta: float, risk_free_rate: float,
                   market_expected_return: float,
                   periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """ประเมิน drift ต่อปีจาก CAPM + โมเมนตัม + การกลับสู่ค่าเฉลี่ย"""
    from core.risk import capm_expected_return

    capm = capm_expected_return(risk_free_rate, asset_beta, market_expected_return)

    # โมเมนตัม 30 วันแปลงเป็นอัตราต่อปี แล้วหน่วงไว้เพราะโมเมนตัมมีมสลายตัวเร็ว
    mom_30d = momentum(prices, 30)
    momentum_annual = np.clip(mom_30d * (periods_per_year / 30.0), -3.0, 3.0) * 0.25

    # ราคายิ่งห่างเส้นค่าเฉลี่ย 30 วันมาก ยิ่งมีแรงดึงกลับ
    stretch = distance_from_sma(prices, 30)
    mean_reversion = -np.clip(stretch, -1.0, 1.0) * 0.45

    drift = 0.45 * capm + 0.35 * momentum_annual + 0.20 * mean_reversion
    return float(np.clip(drift, -2.5, 3.0))


def monte_carlo_forecast(symbol: str, prices, asset_beta: float, risk_free_rate: float,
                         market_expected_return: float, horizon_days: int = 30,
                         n_paths: int = 2000, seed: int = 7,
                         periods_per_year: int = PERIODS_PER_YEAR) -> Forecast:
    """จำลองเส้นทางราคา n_paths เส้น แล้วสรุปเป็นการกระจายตัวของราคาปลายทาง"""
    p = np.asarray(prices, dtype=float)
    spot = float(p[-1])

    lr = log_returns(p)
    sigma_daily = float(np.std(lr, ddof=1)) if lr.size > 1 else 0.05
    sigma_annual = sigma_daily * np.sqrt(periods_per_year)

    mu_annual = estimate_drift(p, asset_beta, risk_free_rate, market_expected_return, periods_per_year)
    mu_daily = mu_annual / periods_per_year

    rng = np.random.default_rng(seed)
    dt = 1.0
    # ชดเชย Itô: log-drift = μ - σ²/2
    log_drift = (mu_daily - 0.5 * sigma_daily ** 2) * dt
    shocks = rng.normal(0.0, sigma_daily * np.sqrt(dt), size=(n_paths, horizon_days))
    log_paths = np.cumsum(log_drift + shocks, axis=1)
    paths = spot * np.exp(log_paths)

    terminal = paths[:, -1]
    percentiles = {
        "p05": np.percentile(paths, 5, axis=0),
        "p25": np.percentile(paths, 25, axis=0),
        "p50": np.percentile(paths, 50, axis=0),
        "p75": np.percentile(paths, 75, axis=0),
        "p95": np.percentile(paths, 95, axis=0),
    }

    expected_price = float(terminal.mean())
    return Forecast(
        symbol=symbol,
        horizon_days=horizon_days,
        spot=spot,
        drift_annual=mu_annual,
        volatility_annual=float(sigma_annual),
        prob_up=float((terminal > spot).mean()),
        expected_price=expected_price,
        median_price=float(np.median(terminal)),
        p05=float(np.percentile(terminal, 5)),
        p25=float(np.percentile(terminal, 25)),
        p75=float(np.percentile(terminal, 75)),
        p95=float(np.percentile(terminal, 95)),
        expected_return=expected_price / spot - 1.0 if spot else 0.0,
        percentile_paths=percentiles,
    )


def analytic_prob_up(drift_annual: float, volatility_annual: float, horizon_days: int,
                     periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """ความน่าจะเป็นขาขึ้นแบบสูตรปิด ใช้ตรวจทานผล Monte Carlo

    P(S_T > S_0) = Φ( (μ - σ²/2)·T / (σ√T) )
    """
    from math import erf, sqrt

    t = horizon_days / periods_per_year
    if volatility_annual <= 0 or t <= 0:
        return 0.5
    z = (drift_annual - 0.5 * volatility_annual ** 2) * t / (volatility_annual * sqrt(t))
    # Φ(z) จาก error function
    return float(0.5 * (1.0 + erf(z / sqrt(2.0))))
