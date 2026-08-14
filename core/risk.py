"""AI Financial Tools: เครื่องมือวัดความเสี่ยงและผลตอบแทนระดับเหรียญและระดับพอร์ต

หัวใจของโมดูลนี้คือค่า **Beta (β)** ซึ่งคำนวณจากข้อมูลจริงตามนิยาม

    β = Cov(R_asset, R_market) / Var(R_market)

β บอกว่าเหรียญเคลื่อนไหวแรงกว่าตลาดกี่เท่า
  β > 1  = ผันผวนแรงกว่าตลาด (ตลาดขึ้น 1% เหรียญขึ้นมากกว่า 1%)
  β = 1  = เคลื่อนไหวไปพร้อมตลาด
  β < 1  = ผันผวนน้อยกว่าตลาด
  β < 0  = เคลื่อนไหวสวนทางตลาด
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from core.config import PERIODS_PER_YEAR


def _align(asset_returns, market_returns) -> tuple[np.ndarray, np.ndarray]:
    """ตัดให้สองชุดข้อมูลยาวเท่ากัน (ยึดตามช่วงท้ายสุดที่ทับกัน)"""
    a = np.asarray(asset_returns, dtype=float)
    m = np.asarray(market_returns, dtype=float)
    n = min(a.size, m.size)
    if n == 0:
        return np.array([]), np.array([])
    a, m = a[-n:], m[-n:]
    mask = ~(np.isnan(a) | np.isnan(m))
    return a[mask], m[mask]


def beta(asset_returns, market_returns) -> float:
    """β = Cov(Ri, Rm) / Var(Rm)"""
    a, m = _align(asset_returns, market_returns)
    if a.size < 2:
        return 0.0
    market_var = float(np.var(m, ddof=1))
    if market_var == 0.0:
        return 0.0
    covariance = float(np.cov(a, m, ddof=1)[0, 1])
    return covariance / market_var


def alpha(asset_returns, market_returns, risk_free_rate: float = 0.0,
          periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """Jensen's Alpha ต่อปี = ผลตอบแทนส่วนเกินที่อธิบายด้วยตลาดไม่ได้

    α = R_asset - [Rf + β(R_market - Rf)]
    α > 0 หมายถึงเหรียญให้ผลตอบแทนดีกว่าที่ความเสี่ยงเชิงระบบควรจะให้
    """
    a, m = _align(asset_returns, market_returns)
    if a.size < 2:
        return 0.0
    b = beta(a, m)
    asset_annual = float(np.mean(a)) * periods_per_year
    market_annual = float(np.mean(m)) * periods_per_year
    return asset_annual - (risk_free_rate + b * (market_annual - risk_free_rate))


def r_squared(asset_returns, market_returns) -> float:
    """สัดส่วนความเคลื่อนไหวของเหรียญที่อธิบายได้ด้วยตลาด (0-1)

    R² ต่ำแปลว่าค่า β เชื่อถือได้น้อย เพราะราคาเหรียญขยับด้วยปัจจัยเฉพาะตัว
    """
    a, m = _align(asset_returns, market_returns)
    if a.size < 3:
        return 0.0
    if np.std(a) == 0 or np.std(m) == 0:
        return 0.0
    corr = float(np.corrcoef(a, m)[0, 1])
    return corr ** 2


def volatility(returns, periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """ความผันผวนต่อปี (annualized standard deviation)"""
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if r.size < 2:
        return 0.0
    return float(np.std(r, ddof=1) * np.sqrt(periods_per_year))


def annualized_return(returns, periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """ผลตอบแทนทบต้นต่อปีจากผลตอบแทนรายวัน"""
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if r.size == 0:
        return 0.0
    growth = float(np.prod(1.0 + r))
    if growth <= 0:
        return -1.0
    return growth ** (periods_per_year / r.size) - 1.0


def sharpe_ratio(returns, risk_free_rate: float = 0.0,
                 periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """ผลตอบแทนส่วนเกินต่อหนึ่งหน่วยความผันผวนรวม"""
    vol = volatility(returns, periods_per_year)
    if vol == 0.0:
        return 0.0
    return (annualized_return(returns, periods_per_year) - risk_free_rate) / vol


def sortino_ratio(returns, risk_free_rate: float = 0.0,
                  periods_per_year: int = PERIODS_PER_YEAR) -> float:
    """เหมือน Sharpe แต่ลงโทษเฉพาะความผันผวนขาลง"""
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    downside = r[r < 0]
    if downside.size < 2:
        return 0.0
    downside_vol = float(np.std(downside, ddof=1) * np.sqrt(periods_per_year))
    if downside_vol == 0.0:
        return 0.0
    return (annualized_return(r, periods_per_year) - risk_free_rate) / downside_vol


def value_at_risk(returns, confidence: float = 0.95) -> float:
    """VaR แบบ historical: ขาดทุนรายวันที่แย่ที่สุดที่ระดับความเชื่อมั่นที่กำหนด

    คืนค่าเป็นจำนวนติดลบ เช่น -0.08 = มีโอกาส 5% ที่จะขาดทุนเกิน 8% ใน 1 วัน
    """
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if r.size == 0:
        return 0.0
    return float(np.percentile(r, (1.0 - confidence) * 100.0))


def conditional_var(returns, confidence: float = 0.95) -> float:
    """CVaR / Expected Shortfall: ค่าเฉลี่ยของการขาดทุนในส่วนหางที่เลว VaR"""
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if r.size == 0:
        return 0.0
    threshold = value_at_risk(r, confidence)
    tail = r[r <= threshold]
    return float(tail.mean()) if tail.size else threshold


def capm_expected_return(risk_free_rate: float, asset_beta: float,
                         market_expected_return: float) -> float:
    """ผลตอบแทนที่ "ควรได้" ตามความเสี่ยงเชิงระบบ

    E(Ri) = Rf + β * (E(Rm) - Rf)

    ใช้เป็นเส้นเกณฑ์: ถ้าอัปไซด์ที่ประเมินได้ต่ำกว่าค่านี้ แปลว่าไม่คุ้มความเสี่ยง
    """
    return risk_free_rate + asset_beta * (market_expected_return - risk_free_rate)


# --------------------------------------------------------------------------
# ระดับพอร์ตโฟลิโอ
# --------------------------------------------------------------------------

def portfolio_beta(weights: dict[str, float], betas: dict[str, float]) -> float:
    """β ของพอร์ต = ผลรวมถ่วงน้ำหนักของ β รายเหรียญ

    เป็นคุณสมบัติเชิงเส้น: β_p = Σ w_i * β_i
    """
    return float(sum(w * betas.get(sym, 0.0) for sym, w in weights.items()))


def beta_contributions(weights: dict[str, float], betas: dict[str, float]) -> dict[str, float]:
    """แต่ละเหรียญดัน β ของพอร์ตขึ้นเท่าไหร่ (w_i * β_i)

    ใช้ตอบคำถามว่า "ถ้าอยากลดความเสี่ยงพอร์ต ควรตัดตัวไหนก่อน"
    """
    return {sym: w * betas.get(sym, 0.0) for sym, w in weights.items()}


def portfolio_return_series(weights: dict[str, float],
                            returns_by_symbol: dict[str, np.ndarray]) -> np.ndarray:
    """ซีรีส์ผลตอบแทนของพอร์ต โดยถือน้ำหนักคงที่ (rebalance ทุกคาบ)"""
    symbols = [s for s in weights if s in returns_by_symbol]
    if not symbols:
        return np.array([], dtype=float)
    length = min(len(returns_by_symbol[s]) for s in symbols)
    if length == 0:
        return np.array([], dtype=float)
    matrix = np.vstack([np.asarray(returns_by_symbol[s], dtype=float)[-length:] for s in symbols])
    w = np.array([weights[s] for s in symbols], dtype=float)
    return matrix.T @ w


def correlation_matrix(returns_by_symbol: dict[str, np.ndarray]) -> pd.DataFrame:
    """เมทริกซ์สหสัมพันธ์ระหว่างเหรียญ

    ค่าใกล้ 1 ทุกช่องแปลว่าพอร์ตกระจายความเสี่ยงไม่ได้จริง เพราะทุกตัวลงพร้อมกัน
    """
    symbols = [s for s, r in returns_by_symbol.items() if np.asarray(r).size > 1]
    if not symbols:
        return pd.DataFrame()
    length = min(np.asarray(returns_by_symbol[s]).size for s in symbols)
    data = {s: np.asarray(returns_by_symbol[s], dtype=float)[-length:] for s in symbols}
    return pd.DataFrame(data).corr()


def diversification_score(returns_by_symbol: dict[str, np.ndarray],
                          weights: dict[str, float]) -> float:
    """คะแนนการกระจายความเสี่ยง 0-100 (สูง = กระจายได้ดี)

    คิดจาก 1 - ค่าเฉลี่ยสหสัมพันธ์ถ่วงน้ำหนัก ผสมกับความกระจุกตัวของน้ำหนัก (HHI)
    """
    active = {s: w for s, w in weights.items() if w > 0 and s in returns_by_symbol}
    if len(active) <= 1:
        return 0.0

    corr = correlation_matrix({s: returns_by_symbol[s] for s in active})
    if corr.empty:
        return 0.0

    symbols = list(corr.columns)
    pair_values = [
        corr.loc[a, b]
        for i, a in enumerate(symbols)
        for b in symbols[i + 1:]
        if not np.isnan(corr.loc[a, b])
    ]
    avg_corr = float(np.mean(pair_values)) if pair_values else 1.0

    total = sum(active.values())
    normalized = {s: w / total for s, w in active.items()} if total else active
    hhi = sum(w ** 2 for w in normalized.values())
    # HHI = 1 คือกระจุกตัวสุด, = 1/n คือกระจายเท่ากันหมด
    concentration_score = (1.0 - hhi) / (1.0 - 1.0 / len(active)) if len(active) > 1 else 0.0

    corr_score = (1.0 - avg_corr) / 2.0  # map [-1,1] -> [1,0]
    return float(np.clip(100.0 * (0.6 * corr_score + 0.4 * concentration_score), 0.0, 100.0))


@dataclass(frozen=True)
class RiskProfile:
    """สรุปมาตรวัดความเสี่ยงของสินทรัพย์หนึ่งตัว"""

    symbol: str
    beta: float
    alpha: float
    r_squared: float
    volatility: float
    annual_return: float
    sharpe: float
    sortino: float
    var_95: float
    cvar_95: float
    max_drawdown: float
    required_return: float  # ผลตอบแทนขั้นต่ำที่ควรได้ตาม CAPM

    @property
    def risk_grade(self) -> str:
        """จัดเกรดความเสี่ยงจากค่า β เพื่อแสดงบน UI"""
        b = abs(self.beta)
        if b < 0.8:
            return "ต่ำ"
        if b < 1.3:
            return "ปานกลาง"
        if b < 2.0:
            return "สูง"
        return "สูงมาก"


def build_risk_profile(symbol: str, asset_returns, market_returns, prices,
                       risk_free_rate: float, market_expected_return: float,
                       periods_per_year: int = PERIODS_PER_YEAR) -> RiskProfile:
    """คำนวณมาตรวัดความเสี่ยงทั้งชุดของเหรียญหนึ่งตัว"""
    from core.indicators import max_drawdown as _mdd

    b = beta(asset_returns, market_returns)
    return RiskProfile(
        symbol=symbol,
        beta=b,
        alpha=alpha(asset_returns, market_returns, risk_free_rate, periods_per_year),
        r_squared=r_squared(asset_returns, market_returns),
        volatility=volatility(asset_returns, periods_per_year),
        annual_return=annualized_return(asset_returns, periods_per_year),
        sharpe=sharpe_ratio(asset_returns, risk_free_rate, periods_per_year),
        sortino=sortino_ratio(asset_returns, risk_free_rate, periods_per_year),
        var_95=value_at_risk(asset_returns, 0.95),
        cvar_95=conditional_var(asset_returns, 0.95),
        max_drawdown=_mdd(prices),
        required_return=capm_expected_return(risk_free_rate, b, market_expected_return),
    )
