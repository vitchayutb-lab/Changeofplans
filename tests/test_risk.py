"""ทดสอบเครื่องมือวัดความเสี่ยง — โดยเฉพาะค่า β ซึ่งเป็นหัวใจของระบบ"""

import numpy as np
import pytest

from core.risk import (
    alpha,
    annualized_return,
    beta,
    beta_contributions,
    capm_expected_return,
    conditional_var,
    correlation_matrix,
    diversification_score,
    portfolio_beta,
    portfolio_return_series,
    r_squared,
    sharpe_ratio,
    value_at_risk,
    volatility,
)


class TestBeta:
    def test_identical_series_has_beta_one(self):
        """สินทรัพย์ที่เคลื่อนไหวเหมือนตลาดทุกประการต้องได้ β = 1"""
        market = np.random.default_rng(1).normal(0, 0.02, 200)
        assert beta(market, market) == pytest.approx(1.0)

    def test_double_amplitude_has_beta_two(self):
        """ขยับแรงเป็นสองเท่าของตลาด -> β = 2"""
        market = np.random.default_rng(2).normal(0, 0.02, 200)
        assert beta(2.0 * market, market) == pytest.approx(2.0)

    def test_inverse_series_has_negative_beta(self):
        """เคลื่อนไหวสวนทางตลาด -> β ติดลบ"""
        market = np.random.default_rng(3).normal(0, 0.02, 200)
        assert beta(-1.5 * market, market) == pytest.approx(-1.5)

    def test_recovers_known_beta_with_noise(self):
        """โมเดลปัจจัยเดียวที่มี noise ต้องคืนค่า β ใกล้ค่าจริง"""
        rng = np.random.default_rng(42)
        market = rng.normal(0.001, 0.02, 2000)
        asset = 1.8 * market + rng.normal(0, 0.01, 2000)
        assert beta(asset, market) == pytest.approx(1.8, abs=0.05)

    def test_constant_market_returns_zero(self):
        """ตลาดไม่ขยับเลย -> หารด้วยศูนย์ไม่ได้ ต้องคืน 0 ไม่ใช่ error"""
        assert beta([0.01, 0.02, -0.01], [0.0, 0.0, 0.0]) == 0.0

    def test_empty_input_is_safe(self):
        assert beta([], []) == 0.0

    def test_aligns_different_lengths(self):
        """ความยาวไม่เท่ากันต้องตัดให้ตรงกันโดยไม่ error"""
        market = np.random.default_rng(4).normal(0, 0.02, 100)
        asset = 1.5 * market
        assert beta(asset, market[:-10]) != 0.0


class TestRSquared:
    def test_perfect_relationship(self):
        market = np.random.default_rng(5).normal(0, 0.02, 100)
        assert r_squared(2.0 * market, market) == pytest.approx(1.0)

    def test_pure_noise_has_low_r_squared(self):
        rng = np.random.default_rng(6)
        market = rng.normal(0, 0.02, 500)
        noise = rng.normal(0, 0.02, 500)
        assert r_squared(noise, market) < 0.1


class TestAlpha:
    def test_zero_alpha_when_exactly_capm(self):
        """สินทรัพย์ที่ให้ผลตอบแทนตาม β พอดี ต้องมี α ประมาณศูนย์"""
        rng = np.random.default_rng(7)
        market = rng.normal(0.001, 0.02, 1000)
        asset = 1.5 * market  # ไม่มีผลตอบแทนส่วนเกิน
        result = alpha(asset, market, risk_free_rate=0.0)
        assert result == pytest.approx(0.0, abs=0.01)

    def test_positive_alpha_detected(self):
        rng = np.random.default_rng(8)
        market = rng.normal(0.001, 0.02, 1000)
        asset = 1.0 * market + 0.002  # ชนะตลาดวันละ 0.2%
        assert alpha(asset, market, risk_free_rate=0.0) > 0.5


class TestVolatilityAndRatios:
    def test_volatility_annualizes(self):
        daily = np.full(400, 0.01)
        daily[::2] = -0.01  # sd รายวัน = 0.01
        result = volatility(daily, periods_per_year=365)
        assert result == pytest.approx(0.01 * np.sqrt(365), rel=0.01)

    def test_zero_volatility_gives_zero_sharpe(self):
        assert sharpe_ratio(np.zeros(100)) == 0.0

    def test_annualized_return_compounds(self):
        daily = np.full(365, 0.001)
        expected = (1.001 ** 365) - 1
        assert annualized_return(daily, 365) == pytest.approx(expected, rel=1e-6)

    def test_sharpe_higher_for_smoother_series(self):
        rng = np.random.default_rng(9)
        smooth = rng.normal(0.002, 0.01, 500)
        choppy = rng.normal(0.002, 0.05, 500)
        assert sharpe_ratio(smooth) > sharpe_ratio(choppy)


class TestValueAtRisk:
    def test_var_is_the_fifth_percentile(self):
        returns = np.linspace(-0.10, 0.10, 101)
        assert value_at_risk(returns, 0.95) == pytest.approx(np.percentile(returns, 5))

    def test_cvar_is_worse_than_var(self):
        rng = np.random.default_rng(10)
        returns = rng.normal(0, 0.03, 1000)
        assert conditional_var(returns, 0.95) <= value_at_risk(returns, 0.95)


class TestCapm:
    def test_beta_one_returns_market_return(self):
        assert capm_expected_return(0.04, 1.0, 0.35) == pytest.approx(0.35)

    def test_beta_zero_returns_risk_free(self):
        assert capm_expected_return(0.04, 0.0, 0.35) == pytest.approx(0.04)

    def test_higher_beta_demands_higher_return(self):
        low = capm_expected_return(0.04, 1.0, 0.35)
        high = capm_expected_return(0.04, 2.5, 0.35)
        assert high > low


class TestPortfolioLevel:
    def test_portfolio_beta_is_weighted_sum(self):
        weights = {"A": 0.5, "B": 0.3}
        betas = {"A": 2.0, "B": 1.0}
        assert portfolio_beta(weights, betas) == pytest.approx(0.5 * 2.0 + 0.3 * 1.0)

    def test_cash_dilutes_portfolio_beta(self):
        """น้ำหนักรวมไม่ถึง 100% (ที่เหลือคือเงินสด) ต้องกด β ลง"""
        full = portfolio_beta({"A": 1.0}, {"A": 2.0})
        half = portfolio_beta({"A": 0.5}, {"A": 2.0})
        assert half == pytest.approx(full / 2)

    def test_unknown_symbol_contributes_zero(self):
        assert portfolio_beta({"X": 1.0}, {"A": 2.0}) == 0.0

    def test_contributions_sum_to_portfolio_beta(self):
        weights = {"A": 0.4, "B": 0.35, "C": 0.15}
        betas = {"A": 1.9, "B": 2.4, "C": 0.8}
        contributions = beta_contributions(weights, betas)
        assert sum(contributions.values()) == pytest.approx(portfolio_beta(weights, betas))

    def test_portfolio_return_series_blends_weights(self):
        returns = {"A": np.array([0.10, 0.10]), "B": np.array([0.0, 0.0])}
        series = portfolio_return_series({"A": 0.5, "B": 0.5}, returns)
        assert series == pytest.approx([0.05, 0.05])

    def test_correlation_matrix_diagonal_is_one(self):
        rng = np.random.default_rng(11)
        returns = {"A": rng.normal(0, 0.02, 100), "B": rng.normal(0, 0.02, 100)}
        corr = correlation_matrix(returns)
        assert corr.loc["A", "A"] == pytest.approx(1.0)
        assert corr.loc["B", "B"] == pytest.approx(1.0)


class TestDiversification:
    def test_single_asset_scores_zero(self):
        rng = np.random.default_rng(12)
        returns = {"A": rng.normal(0, 0.02, 100)}
        assert diversification_score(returns, {"A": 1.0}) == 0.0

    def test_uncorrelated_beats_perfectly_correlated(self):
        rng = np.random.default_rng(13)
        base = rng.normal(0, 0.02, 300)

        correlated = {"A": base, "B": base * 1.01}
        independent = {"A": base, "B": rng.normal(0, 0.02, 300)}
        weights = {"A": 0.5, "B": 0.5}

        assert (diversification_score(independent, weights)
                > diversification_score(correlated, weights))
