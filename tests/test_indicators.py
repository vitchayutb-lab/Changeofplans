"""ทดสอบอินดิเคเตอร์ทางเทคนิค"""

import numpy as np
import pytest

from core.indicators import (
    distance_from_sma,
    drawdown_series,
    latest,
    log_returns,
    macd,
    max_drawdown,
    momentum,
    rolling_volatility,
    rsi,
    simple_returns,
    sma,
)


class TestReturns:
    def test_simple_returns_length(self):
        assert simple_returns([1.0, 2.0, 3.0]).size == 2

    def test_simple_returns_values(self):
        assert simple_returns([100.0, 110.0, 99.0]) == pytest.approx([0.10, -0.10])

    def test_log_returns_sum_to_total_growth(self):
        prices = [100.0, 120.0, 90.0, 150.0]
        assert log_returns(prices).sum() == pytest.approx(np.log(150.0 / 100.0))

    def test_single_price_returns_empty(self):
        assert simple_returns([100.0]).size == 0
        assert log_returns([100.0]).size == 0


class TestMovingAverages:
    def test_sma_of_constant_series(self):
        result = sma([5.0] * 10, 3)
        assert result[-1] == pytest.approx(5.0)

    def test_sma_warmup_is_nan(self):
        result = sma([1.0, 2.0, 3.0, 4.0], 3)
        assert np.isnan(result[0]) and np.isnan(result[1])
        assert result[2] == pytest.approx(2.0)

    def test_distance_from_sma_positive_when_above(self):
        prices = list(np.linspace(100, 200, 60))  # ขาขึ้นต่อเนื่อง
        assert distance_from_sma(prices, 30) > 0

    def test_distance_from_sma_negative_when_below(self):
        prices = list(np.linspace(200, 100, 60))  # ขาลงต่อเนื่อง
        assert distance_from_sma(prices, 30) < 0


class TestRsi:
    def test_rsi_is_100_when_only_gains(self):
        prices = list(np.linspace(100, 200, 40))
        assert rsi(prices, 14)[-1] == pytest.approx(100.0)

    def test_rsi_is_low_when_only_losses(self):
        prices = list(np.linspace(200, 100, 40))
        assert rsi(prices, 14)[-1] < 5.0

    def test_rsi_stays_in_bounds(self):
        rng = np.random.default_rng(1)
        prices = 100 * np.cumprod(1 + rng.normal(0, 0.03, 300))
        values = rsi(prices, 14)
        valid = values[~np.isnan(values)]
        assert valid.min() >= 0.0 and valid.max() <= 100.0


class TestMacd:
    def test_macd_positive_in_uptrend(self):
        prices = list(np.linspace(100, 300, 120))
        macd_line, signal_line, hist = macd(prices)
        assert macd_line[-1] > 0

    def test_macd_components_same_length(self):
        prices = list(np.linspace(100, 300, 120))
        macd_line, signal_line, hist = macd(prices)
        assert len(macd_line) == len(signal_line) == len(hist) == 120


class TestDrawdown:
    def test_monotonic_rise_has_no_drawdown(self):
        assert max_drawdown([1.0, 2.0, 3.0, 4.0]) == pytest.approx(0.0)

    def test_halving_is_minus_fifty_percent(self):
        assert max_drawdown([100.0, 50.0]) == pytest.approx(-0.5)

    def test_measures_from_peak_not_start(self):
        # ขึ้นไป 200 แล้วลงมา 100 = -50% จากจุดสูงสุด
        assert max_drawdown([100.0, 200.0, 100.0]) == pytest.approx(-0.5)

    def test_drawdown_series_length_matches(self):
        prices = [100.0, 120.0, 90.0, 150.0]
        assert drawdown_series(prices).size == len(prices)

    def test_drawdown_series_never_positive(self):
        rng = np.random.default_rng(2)
        prices = 100 * np.cumprod(1 + rng.normal(0, 0.03, 200))
        assert drawdown_series(prices).max() <= 1e-12


class TestMomentum:
    def test_positive_in_uptrend(self):
        assert momentum(list(np.linspace(100, 200, 50)), 7) > 0

    def test_negative_in_downtrend(self):
        assert momentum(list(np.linspace(200, 100, 50)), 7) < 0

    def test_short_history_is_safe(self):
        assert momentum([100.0, 101.0], 30) == 0.0


class TestHelpers:
    def test_latest_skips_nan(self):
        assert latest([1.0, 2.0, np.nan]) == 2.0

    def test_latest_all_nan_returns_zero(self):
        assert latest([np.nan, np.nan]) == 0.0

    def test_rolling_volatility_annualizes(self):
        rng = np.random.default_rng(3)
        prices = 100 * np.cumprod(1 + rng.normal(0, 0.02, 200))
        values = rolling_volatility(prices, 30, 365)
        assert values[-1] == pytest.approx(0.02 * np.sqrt(365), rel=0.5)
