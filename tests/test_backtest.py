"""ทดสอบการทดสอบย้อนหลัง — เน้นว่าต้องไม่มีการแอบดูอนาคต (look-ahead bias)"""

import numpy as np
import pytest

from core.backtest import (
    WARMUP_DAYS,
    annualized_stats,
    drawdown_curves,
    portfolio_backtest,
    run_backtest,
    score_to_exposure,
    signal_score_at,
)


def make_prices(n=250, drift=0.002, vol=0.03, seed=1):
    rng = np.random.default_rng(seed)
    return 100.0 * np.cumprod(1 + rng.normal(drift, vol, n))


class TestSignalScore:
    def test_returns_zero_during_warmup(self):
        prices = make_prices()
        assert signal_score_at(prices, 10) == 0.0

    def test_score_stays_in_range(self):
        prices = make_prices()
        for t in range(WARMUP_DAYS, len(prices)):
            assert -1.0 <= signal_score_at(prices, t) <= 1.0

    def test_uses_only_past_data(self):
        """คะแนน ณ วันที่ t ต้องไม่เปลี่ยน แม้ราคาในอนาคตจะถูกแก้

        เป็นการทดสอบว่าไม่มี look-ahead bias ซึ่งเป็นข้อผิดพลาดที่ทำให้ backtest หลอกตัวเอง
        """
        prices = make_prices()
        t = 100
        before = signal_score_at(prices, t)

        tampered = prices.copy()
        tampered[t + 1:] *= 5.0  # ทำให้อนาคตพุ่งแรง
        after = signal_score_at(tampered, t)

        assert before == pytest.approx(after)

    def test_uptrend_scores_positive(self):
        rising = 100.0 * np.cumprod(np.full(120, 1.01))
        assert signal_score_at(rising, 119) > 0

    def test_downtrend_scores_negative(self):
        falling = 100.0 * np.cumprod(np.full(120, 0.99))
        assert signal_score_at(falling, 119) < 0


class TestExposure:
    def test_negative_score_means_all_cash(self):
        assert score_to_exposure(-0.5) == 0.0

    def test_strong_score_means_fully_invested(self):
        assert score_to_exposure(0.9) == pytest.approx(1.0)

    def test_exposure_never_exceeds_cap(self):
        for score in np.linspace(-1, 1, 21):
            assert 0.0 <= score_to_exposure(score) <= 1.0

    def test_respects_custom_max_exposure(self):
        assert score_to_exposure(1.0, max_exposure=0.5) == pytest.approx(0.5)


class TestRunBacktest:
    def test_equity_curves_have_matching_lengths(self):
        prices = make_prices()
        result = run_backtest("TEST", prices)
        assert result.strategy_equity.size == prices.size
        assert result.buy_hold_equity.size == prices.size

    def test_buy_hold_tracks_the_price(self):
        prices = make_prices()
        result = run_backtest("TEST", prices)
        expected = prices[-1] / prices[0] - 1.0
        assert result.buy_hold_total_return == pytest.approx(expected)

    def test_no_trading_during_warmup(self):
        result = run_backtest("TEST", make_prices())
        assert np.all(result.exposure[:WARMUP_DAYS] == 0.0)

    def test_strategy_avoids_the_worst_of_a_crash(self):
        """ในตลาดขาลงยาว กลยุทธ์ที่ถอยไปถือเงินสดต้องขาดทุนน้อยกว่าการถือ"""
        crash = 100.0 * np.cumprod(np.full(200, 0.985))
        result = run_backtest("CRASH", crash)
        assert result.strategy_total_return > result.buy_hold_total_return

    def test_fees_are_accumulated(self):
        result = run_backtest("TEST", make_prices(seed=3), fee_bps=50.0, slippage_bps=50.0)
        if result.n_trades > 0:
            assert result.fees_paid > 0

    def test_higher_costs_reduce_returns(self):
        prices = make_prices(seed=4)
        cheap = run_backtest("TEST", prices, fee_bps=0.0, slippage_bps=0.0)
        pricey = run_backtest("TEST", prices, fee_bps=100.0, slippage_bps=100.0)
        assert pricey.strategy_total_return <= cheap.strategy_total_return

    def test_exposure_within_bounds(self):
        result = run_backtest("TEST", make_prices())
        assert result.exposure.min() >= 0.0
        assert result.exposure.max() <= 1.0

    def test_summary_has_all_keys(self):
        result = run_backtest("TEST", make_prices())
        summary = result.summary()
        assert "ผลตอบแทนกลยุทธ์ AI" in summary
        assert "ส่วนต่าง" in summary

    def test_excess_return_is_the_difference(self):
        result = run_backtest("TEST", make_prices())
        assert result.excess_return == pytest.approx(
            result.strategy_total_return - result.buy_hold_total_return
        )


class TestPortfolioBacktest:
    def test_blends_multiple_coins(self):
        prices = {"A": make_prices(seed=1), "B": make_prices(seed=2)}
        result = portfolio_backtest(prices, {"A": 0.5, "B": 0.5})
        assert result.symbol == "PORTFOLIO"
        assert result.strategy_equity.size > 1

    def test_single_coin_portfolio_matches_single_backtest(self):
        prices = {"A": make_prices(seed=5)}
        blended = portfolio_backtest(prices, {"A": 1.0})
        single = run_backtest("A", prices["A"])
        assert blended.strategy_total_return == pytest.approx(single.strategy_total_return)

    def test_empty_weights_returns_flat_result(self):
        result = portfolio_backtest({"A": make_prices()}, {})
        assert result.strategy_total_return == 0.0

    def test_ignores_zero_weight_coins(self):
        prices = {"A": make_prices(seed=6), "B": make_prices(seed=7)}
        with_zero = portfolio_backtest(prices, {"A": 1.0, "B": 0.0})
        without = portfolio_backtest({"A": prices["A"]}, {"A": 1.0})
        assert with_zero.strategy_total_return == pytest.approx(without.strategy_total_return)


class TestReporting:
    def test_drawdown_curves_are_never_positive(self):
        result = run_backtest("TEST", make_prices())
        strategy_dd, buy_hold_dd = drawdown_curves(result)
        assert strategy_dd.max() <= 1e-12
        assert buy_hold_dd.max() <= 1e-12

    def test_annualized_stats_keys(self):
        stats = annualized_stats(run_backtest("TEST", make_prices()))
        assert set(stats) == {"strategy_cagr", "buy_hold_cagr", "strategy_vol", "buy_hold_vol"}

    def test_strategy_volatility_is_not_higher_than_buy_hold(self):
        """กลยุทธ์ที่ถือเงินสดบางช่วงต้องผันผวนไม่เกินการถือเต็มเวลา"""
        result = run_backtest("TEST", make_prices(seed=8))
        assert result.strategy_volatility <= annualized_stats(result)["buy_hold_vol"] * 1.05
