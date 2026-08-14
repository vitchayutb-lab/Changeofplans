"""ตัวประสานงานกลาง: รวมข้อมูลตลาด -> ความเสี่ยง -> พยากรณ์ -> คำแนะนำ AI

หน้าเว็บเรียกใช้แค่ ``build_analysis(settings)`` แล้วได้ทุกอย่างที่ต้องแสดงผล
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from core.ai_advisor import Advice, evaluate_coin
from core.config import PERIODS_PER_YEAR, Settings
from core.data_sources import MarketData, Quote, build_market_data
from core.forecast import Forecast, monte_carlo_forecast
from core.risk import RiskProfile, build_risk_profile, correlation_matrix


@dataclass
class Analysis:
    """ผลวิเคราะห์ครบชุดของทุกเหรียญที่ติดตาม"""

    market: MarketData
    profiles: dict[str, RiskProfile]
    forecasts: dict[str, Forecast]
    advices: dict[str, Advice]
    settings: Settings

    @property
    def symbols(self) -> list[str]:
        return self.market.symbols

    @property
    def quotes(self) -> dict[str, Quote]:
        return self.market.quotes

    def spot_prices(self) -> dict[str, float]:
        return {s: q.price for s, q in self.market.quotes.items()}

    def betas(self) -> dict[str, float]:
        return {s: p.beta for s, p in self.profiles.items()}

    def correlations(self) -> pd.DataFrame:
        return correlation_matrix(self.market.returns_by_symbol())

    def suggested_weights(self) -> dict[str, float]:
        """น้ำหนักที่ AI แนะนำ (ผลรวมอาจไม่ถึง 100% ส่วนที่เหลือคือเงินสด)"""
        from core.portfolio import normalize_weights

        return normalize_weights({s: a.target_weight for s, a in self.advices.items()}, max_total=0.9)

    def market_table(self) -> pd.DataFrame:
        """ตารางภาพรวมตลาดสำหรับหน้าแรก"""
        rows = []
        for symbol in self.symbols:
            quote = self.quotes[symbol]
            profile = self.profiles[symbol]
            forecast = self.forecasts[symbol]
            advice = self.advices[symbol]
            rows.append({
                "เหรียญ": symbol,
                "ชื่อ": quote.name,
                "ราคา (USD)": quote.price,
                "24 ชม. (%)": quote.pct_change_24h,
                "7 วัน (%)": quote.pct_change_7d,
                "มาร์เก็ตแคป (USD)": quote.market_cap,
                "Beta (β)": profile.beta,
                "ผันผวน/ปี (%)": profile.volatility * 100.0,
                "โอกาสขึ้น (%)": forecast.prob_up * 100.0,
                "คาดการณ์ 30 วัน (%)": forecast.expected_return * 100.0,
                "คะแนน AI": advice.score,
                "สัญญาณ": advice.signal,
                "ความมั่นใจ (%)": advice.confidence * 100.0,
            })
        return pd.DataFrame(rows)

    def risk_table(self) -> pd.DataFrame:
        """ตารางมาตรวัดความเสี่ยงเชิงลึก"""
        rows = []
        for symbol in self.symbols:
            p = self.profiles[symbol]
            rows.append({
                "เหรียญ": symbol,
                "Beta (β)": p.beta,
                "Alpha/ปี (%)": p.alpha * 100.0,
                "R²": p.r_squared,
                "ผันผวน/ปี (%)": p.volatility * 100.0,
                "Sharpe": p.sharpe,
                "Sortino": p.sortino,
                "VaR 95% ราย 1 วัน (%)": p.var_95 * 100.0,
                "CVaR 95% (%)": p.cvar_95 * 100.0,
                "ย่อลึกสุด (%)": p.max_drawdown * 100.0,
                "เกณฑ์ CAPM (%/ปี)": p.required_return * 100.0,
                "ระดับความเสี่ยง": p.risk_grade,
            })
        return pd.DataFrame(rows)


def build_analysis(settings: Settings) -> Analysis:
    """ดึงข้อมูลและวิเคราะห์ทุกเหรียญตั้งแต่ต้นจนจบ"""
    market = build_market_data(settings)
    market_returns = market.market_returns

    profiles: dict[str, RiskProfile] = {}
    forecasts: dict[str, Forecast] = {}
    advices: dict[str, Advice] = {}

    for index, symbol in enumerate(market.symbols):
        prices = market.prices[symbol]
        asset_returns = market.returns(symbol)

        profile = build_risk_profile(
            symbol=symbol,
            asset_returns=asset_returns,
            market_returns=market_returns,
            prices=prices,
            risk_free_rate=settings.risk_free_rate,
            market_expected_return=settings.market_expected_return,
            periods_per_year=PERIODS_PER_YEAR,
        )

        forecast = monte_carlo_forecast(
            symbol=symbol,
            prices=prices,
            asset_beta=profile.beta,
            risk_free_rate=settings.risk_free_rate,
            market_expected_return=settings.market_expected_return,
            horizon_days=settings.mc_horizon_days,
            n_paths=settings.mc_paths,
            seed=settings.seed + index,
            periods_per_year=PERIODS_PER_YEAR,
        )

        profiles[symbol] = profile
        forecasts[symbol] = forecast
        advices[symbol] = evaluate_coin(symbol, prices, market.quotes[symbol], profile, forecast)

    return Analysis(
        market=market,
        profiles=profiles,
        forecasts=forecasts,
        advices=advices,
        settings=settings,
    )


def portfolio_risk_summary(analysis: Analysis, weights: dict[str, float]) -> dict[str, float]:
    """มาตรวัดความเสี่ยงระดับพอร์ตจากน้ำหนักที่กำหนด"""
    from core.risk import (
        diversification_score,
        portfolio_beta,
        portfolio_return_series,
        sharpe_ratio,
        value_at_risk,
        volatility,
    )

    returns_by_symbol = analysis.market.returns_by_symbol()
    active = {s: w for s, w in weights.items() if w > 0}

    portfolio_returns = portfolio_return_series(active, returns_by_symbol)
    beta_value = portfolio_beta(active, analysis.betas())

    return {
        "beta": beta_value,
        "volatility": volatility(portfolio_returns),
        "sharpe": sharpe_ratio(portfolio_returns, analysis.settings.risk_free_rate),
        "var_95": value_at_risk(portfolio_returns, 0.95),
        "diversification": diversification_score(returns_by_symbol, active),
        "expected_return_capm": (
            analysis.settings.risk_free_rate
            + beta_value * (analysis.settings.market_expected_return - analysis.settings.risk_free_rate)
        ),
        "invested_weight": float(sum(active.values())),
    }


def market_regime(analysis: Analysis) -> dict[str, float | str]:
    """สภาพตลาดรวมในช่วงล่าสุด ใช้เป็นบริบทประกอบคำแนะนำ"""
    index = analysis.market.market_index
    returns = analysis.market.market_returns

    change_7d = float(index[-1] / index[-8] - 1.0) if index.size > 8 else 0.0
    change_30d = float(index[-1] / index[-31] - 1.0) if index.size > 31 else 0.0
    vol_30d = float(np.std(returns[-30:], ddof=1) * np.sqrt(PERIODS_PER_YEAR)) if returns.size > 30 else 0.0

    if change_30d > 0.15:
        regime = "ตลาดกระทิง"
    elif change_30d < -0.15:
        regime = "ตลาดหมี"
    else:
        regime = "ตลาดออกข้าง"

    return {
        "regime": regime,
        "change_7d": change_7d,
        "change_30d": change_30d,
        "volatility": vol_30d,
    }
