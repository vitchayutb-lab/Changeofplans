"""ทดสอบเครื่องมือให้คำแนะนำของ AI

จุดสำคัญคือ "สัญญาณต้องสอดคล้องกับข้อมูลนำเข้า" — ตลาดขาขึ้นที่ความเสี่ยงต่ำ
ต้องได้คะแนนดีกว่าตลาดขาลงที่ความเสี่ยงสูงเสมอ
"""

import numpy as np
import pytest

from core.ai_advisor import (
    FACTOR_WEIGHTS,
    SIGNAL_ORDER,
    evaluate_coin,
    evaluate_portfolio,
)
from core.data_sources import Quote
from core.forecast import monte_carlo_forecast
from core.risk import RiskProfile


def make_quote(symbol="TEST", price=1.0, volume_ratio=0.10) -> Quote:
    market_cap = 1e9
    return Quote(
        symbol=symbol, name=symbol, price=price,
        pct_change_1h=0.0, pct_change_24h=0.0, pct_change_7d=0.0,
        market_cap=market_cap, volume_24h=market_cap * volume_ratio, source="simulated",
    )


def make_profile(symbol="TEST", beta=1.5, volatility=0.9, r_squared=0.5,
                 required_return=0.50, max_dd=-0.4) -> RiskProfile:
    return RiskProfile(
        symbol=symbol, beta=beta, alpha=0.0, r_squared=r_squared,
        volatility=volatility, annual_return=0.2, sharpe=0.5, sortino=0.6,
        var_95=-0.08, cvar_95=-0.12, max_drawdown=max_dd,
        required_return=required_return,
    )


def trending_prices(daily_drift, n=200, vol=0.02, seed=1):
    rng = np.random.default_rng(seed)
    return 100.0 * np.cumprod(1 + rng.normal(daily_drift, vol, n))


def advise(prices, profile=None, quote=None, beta=1.5):
    profile = profile or make_profile(beta=beta)
    quote = quote or make_quote(price=float(prices[-1]))
    forecast = monte_carlo_forecast("TEST", prices, profile.beta, 0.04, 0.35, seed=11)
    return evaluate_coin("TEST", prices, quote, profile, forecast)


class TestFactorWeights:
    def test_weights_sum_to_one(self):
        assert sum(FACTOR_WEIGHTS.values()) == pytest.approx(1.0)

    def test_all_weights_are_positive(self):
        assert all(w > 0 for w in FACTOR_WEIGHTS.values())


class TestScoring:
    def test_score_stays_in_range(self):
        for drift in (-0.02, -0.005, 0.0, 0.005, 0.02):
            advice = advise(trending_prices(drift))
            assert -1.0 <= advice.score <= 1.0

    def test_confidence_stays_in_range(self):
        for drift in (-0.02, 0.0, 0.02):
            advice = advise(trending_prices(drift))
            assert 0.0 <= advice.confidence <= 1.0

    def test_uptrend_scores_higher_than_downtrend(self):
        up = advise(trending_prices(0.008, seed=3))
        down = advise(trending_prices(-0.008, seed=3))
        assert up.score > down.score

    def test_signal_matches_score_ordering(self):
        """คะแนนสูงกว่าต้องไม่ได้สัญญาณที่แย่กว่า"""
        order = SIGNAL_ORDER
        up = advise(trending_prices(0.008, seed=4))
        down = advise(trending_prices(-0.008, seed=4))
        assert order.index(up.signal) >= order.index(down.signal)

    def test_factor_contributions_sum_to_score(self):
        advice = advise(trending_prices(0.004))
        total = sum(f.contribution for f in advice.factors)
        assert advice.score == pytest.approx(np.clip(total, -1, 1))

    def test_every_factor_has_a_readable_detail(self):
        advice = advise(trending_prices(0.004))
        assert all(f.detail for f in advice.factors)
        assert all(f.label for f in advice.factors)

    def test_rationale_is_not_empty(self):
        advice = advise(trending_prices(0.004))
        assert len(advice.rationale) >= 1


class TestRiskPenalty:
    def test_high_beta_scores_lower_than_low_beta(self):
        """ทุกอย่างเท่ากัน เหรียญ β สูงกว่าต้องได้คะแนนต่ำกว่า"""
        prices = trending_prices(0.004, seed=5)
        calm = advise(prices, profile=make_profile(beta=0.9, volatility=0.6,
                                                   required_return=0.32))
        risky = advise(prices, profile=make_profile(beta=3.0, volatility=2.0,
                                                    required_return=0.97))
        assert risky.score < calm.score

    def test_deep_drawdown_lowers_the_score(self):
        prices = trending_prices(0.004, seed=6)
        shallow = advise(prices, profile=make_profile(max_dd=-0.2))
        deep = advise(prices, profile=make_profile(max_dd=-0.9))
        assert deep.score < shallow.score

    def test_low_r_squared_adds_a_warning(self):
        prices = trending_prices(0.004, seed=7)
        advice = advise(prices, profile=make_profile(r_squared=0.05))
        assert any("R²" in line for line in advice.rationale)

    def test_high_beta_adds_a_warning(self):
        prices = trending_prices(0.004, seed=8)
        advice = advise(prices, profile=make_profile(beta=2.8))
        assert any("β" in line for line in advice.rationale)


class TestTargetWeightAndStops:
    def test_negative_score_targets_zero_weight(self):
        advice = advise(trending_prices(-0.012, seed=9))
        if advice.score <= 0:
            assert advice.target_weight == 0.0

    def test_target_weight_never_exceeds_cap(self):
        for seed in range(5):
            advice = advise(trending_prices(0.01, seed=seed))
            assert advice.target_weight <= 0.35

    def test_more_volatile_coin_gets_smaller_target_weight(self):
        prices = trending_prices(0.008, seed=10)
        calm = advise(prices, profile=make_profile(beta=1.5, volatility=0.5))
        wild = advise(prices, profile=make_profile(beta=1.5, volatility=2.5))
        assert wild.target_weight <= calm.target_weight

    def test_stop_loss_widens_with_volatility(self):
        prices = trending_prices(0.004, seed=11)
        calm = advise(prices, profile=make_profile(volatility=0.4))
        wild = advise(prices, profile=make_profile(volatility=2.5))
        assert wild.stop_loss_pct > calm.stop_loss_pct

    def test_take_profit_is_wider_than_stop_loss(self):
        """อัตราส่วนได้/เสียต้องเข้าข้างเราเสมอ"""
        advice = advise(trending_prices(0.004, seed=12))
        assert advice.take_profit_pct > advice.stop_loss_pct

    def test_stops_stay_within_sane_bounds(self):
        for vol in (0.1, 0.9, 5.0):
            advice = advise(trending_prices(0.004), profile=make_profile(volatility=vol))
            assert 0.06 <= advice.stop_loss_pct <= 0.30
            assert 0.12 <= advice.take_profit_pct <= 0.70


class TestSignalHelpers:
    def test_buy_and_sell_flags_are_exclusive(self):
        for drift in (-0.02, -0.004, 0.0, 0.004, 0.02):
            advice = advise(trending_prices(drift))
            assert not (advice.is_buy and advice.is_sell)

    def test_every_signal_has_an_action_text(self):
        for drift in (-0.02, 0.0, 0.02):
            advice = advise(trending_prices(drift))
            assert advice.action_text
            assert advice.emoji


class TestPortfolioAdvice:
    def test_flags_portfolio_above_target_beta(self):
        result = evaluate_portfolio(2.5, 1.2, {"A": 0.8}, {"A": 2.0}, {}, 60.0, 0.9)
        assert result.verdict == "เสี่ยงเกินเป้าหมาย"
        assert result.beta_gap > 0

    def test_flags_portfolio_below_target_beta(self):
        result = evaluate_portfolio(0.4, 1.2, {"A": 0.2}, {"A": 0.4}, {}, 60.0, 0.9)
        assert result.verdict == "อนุรักษ์นิยมเกินเป้าหมาย"

    def test_balanced_portfolio_is_reported_as_such(self):
        result = evaluate_portfolio(1.25, 1.2, {"A": 0.5}, {"A": 1.25}, {}, 60.0, 0.9)
        assert result.verdict == "สมดุลตามเป้าหมาย"

    def test_low_diversification_raises_a_warning(self):
        result = evaluate_portfolio(1.2, 1.2, {"A": 0.5}, {"A": 1.2}, {}, 20.0, 0.9)
        assert any("กระจายความเสี่ยง" in w for w in result.warnings)

    def test_concentration_raises_a_warning(self):
        result = evaluate_portfolio(1.2, 1.2, {"A": 0.7}, {"A": 1.2}, {}, 60.0, 0.9)
        assert any("กระจุกตัว" in w for w in result.warnings)

    def test_high_volatility_raises_a_warning(self):
        result = evaluate_portfolio(1.2, 1.2, {"A": 0.3}, {"A": 1.2}, {}, 60.0, 2.0)
        assert any("ความผันผวนพอร์ต" in w for w in result.warnings)

    def test_names_the_biggest_beta_contributor(self):
        result = evaluate_portfolio(
            1.5, 1.2, {"A": 0.3, "B": 0.2}, {"A": 0.4, "B": 1.1}, {}, 60.0, 0.9,
        )
        assert any("B" in s for s in result.suggestions)
