"""ทดสอบการพยากรณ์ราคาด้วย Monte Carlo"""

import numpy as np
import pytest

from core.forecast import analytic_prob_up, estimate_drift, monte_carlo_forecast


def make_prices(n=200, daily_drift=0.0, vol=0.03, seed=1):
    rng = np.random.default_rng(seed)
    returns = rng.normal(daily_drift, vol, n)
    return 100.0 * np.cumprod(1 + returns)


class TestMonteCarloForecast:
    def test_spot_matches_last_price(self):
        prices = make_prices()
        result = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35)
        assert result.spot == pytest.approx(prices[-1])

    def test_percentiles_are_ordered(self):
        result = monte_carlo_forecast("TEST", make_prices(), 1.5, 0.04, 0.35)
        assert result.p05 < result.p25 < result.median_price < result.p75 < result.p95

    def test_prob_up_within_bounds(self):
        result = monte_carlo_forecast("TEST", make_prices(), 1.5, 0.04, 0.35)
        assert 0.0 <= result.prob_up <= 1.0

    def test_fan_paths_have_horizon_length(self):
        result = monte_carlo_forecast("TEST", make_prices(), 1.5, 0.04, 0.35, horizon_days=21)
        for path in result.percentile_paths.values():
            assert path.size == 21

    def test_reproducible_with_same_seed(self):
        prices = make_prices()
        a = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35, seed=99)
        b = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35, seed=99)
        assert a.prob_up == b.prob_up
        assert a.expected_price == pytest.approx(b.expected_price)

    def test_different_seeds_give_different_paths(self):
        prices = make_prices()
        a = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35, seed=1)
        b = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35, seed=2)
        assert a.expected_price != b.expected_price

    def test_higher_volatility_widens_the_range(self):
        calm = monte_carlo_forecast("CALM", make_prices(vol=0.01, seed=5), 1.0, 0.04, 0.35)
        wild = monte_carlo_forecast("WILD", make_prices(vol=0.09, seed=5), 1.0, 0.04, 0.35)
        calm_width = (calm.p95 - calm.p05) / calm.spot
        wild_width = (wild.p95 - wild.p05) / wild.spot
        assert wild_width > calm_width

    def test_direction_label_matches_probability(self):
        result = monte_carlo_forecast("TEST", make_prices(), 1.5, 0.04, 0.35)
        if result.prob_up >= 0.58:
            assert result.direction == "ขาขึ้น"
        elif result.prob_up <= 0.42:
            assert result.direction == "ขาลง"
        else:
            assert result.direction == "ไม่ชัดเจน"

    def test_upside_and_downside_bracket_the_spot(self):
        result = monte_carlo_forecast("TEST", make_prices(), 1.5, 0.04, 0.35)
        assert result.downside_risk < 0 < result.upside_potential


class TestDrift:
    def test_drift_is_bounded(self):
        """แม้ราคาพุ่งแรงมาก drift ต้องไม่หลุดกรอบจนพยากรณ์เพี้ยน"""
        rocket = 100.0 * np.cumprod(np.full(200, 1.08))  # +8% ทุกวัน
        drift = estimate_drift(rocket, 2.0, 0.04, 0.35)
        assert -2.5 <= drift <= 3.0

    def test_higher_beta_raises_capm_component(self):
        prices = make_prices()
        low = estimate_drift(prices, 0.5, 0.04, 0.35)
        high = estimate_drift(prices, 2.5, 0.04, 0.35)
        assert high > low


class TestAnalyticProbability:
    def test_zero_drift_is_slightly_below_half(self):
        """drift = 0 แต่มี σ²/2 ถ่วง ทำให้โอกาสขึ้นต่ำกว่า 50% เล็กน้อย"""
        result = analytic_prob_up(0.0, 0.8, 30)
        assert 0.35 < result < 0.5

    def test_strong_drift_pushes_probability_up(self):
        assert analytic_prob_up(2.0, 0.5, 30) > 0.6

    def test_zero_volatility_returns_half(self):
        assert analytic_prob_up(0.5, 0.0, 30) == 0.5

    def test_agrees_with_monte_carlo(self):
        """สูตรปิดกับการจำลองต้องให้ผลใกล้เคียงกัน — เป็นการตรวจทานซึ่งกันและกัน"""
        prices = make_prices(vol=0.03, seed=7)
        mc = monte_carlo_forecast("TEST", prices, 1.5, 0.04, 0.35,
                                  horizon_days=30, n_paths=20000, seed=3)
        analytic = analytic_prob_up(mc.drift_annual, mc.volatility_annual, 30)
        assert mc.prob_up == pytest.approx(analytic, abs=0.02)
