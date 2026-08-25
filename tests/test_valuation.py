"""ทดสอบการประเมินมูลค่าและการกำหนดขนาดการถือครอง"""

import numpy as np
import pytest

from core.ai_advisor import Advice, Factor
from core.forecast import Forecast
from core.portfolio import Portfolio
from core.risk import RiskProfile
from core.valuation import (
    ZONE_ORDER,
    build_position_plan,
    fair_value,
    kelly_fraction,
    plans_summary,
    price_zones,
    target_weight,
)


def make_forecast(symbol="TEST", spot=1.0, median=1.2, p25=0.9, p75=1.6,
                  prob_up=0.6, horizon=30, upside=0.8, downside=-0.4) -> Forecast:
    """สร้างผลพยากรณ์ปลอมเพื่อควบคุมตัวแปรในการทดสอบ"""
    return Forecast(
        symbol=symbol, horizon_days=horizon, spot=spot,
        drift_annual=0.5, volatility_annual=1.0,
        prob_up=prob_up, expected_price=median * 1.1, median_price=median,
        p05=spot * (1 + downside * 1.5), p25=p25, p75=p75,
        p95=spot * (1 + upside), expected_return=median / spot - 1,
        percentile_paths={},
    )


def make_profile(beta=1.5, volatility=1.0, required_return=0.50) -> RiskProfile:
    return RiskProfile(
        symbol="TEST", beta=beta, alpha=0.0, r_squared=0.5,
        volatility=volatility, annual_return=0.2, sharpe=0.5, sortino=0.6,
        var_95=-0.08, cvar_95=-0.12, max_drawdown=-0.4,
        required_return=required_return,
    )


def make_advice(score=0.5, signal="BUY", confidence=0.8) -> Advice:
    return Advice(
        symbol="TEST", signal=signal, score=score, confidence=confidence,
        factors=[Factor("momentum", "โมเมนตัม", score, 1.0, "")],
        rationale=[], target_weight=0.2, stop_loss_pct=0.15, take_profit_pct=0.35,
    )


class TestFairValue:
    def test_discounts_future_price_back(self):
        """มูลค่าวันนี้ต้องต่ำกว่าราคาพยากรณ์ในอนาคตเสมอ เมื่อ required return เป็นบวก"""
        forecast = make_forecast(median=2.0)
        result = fair_value(forecast, required_return=0.50)
        assert result.fair_price < forecast.expected_price

    def test_higher_required_return_lowers_fair_value(self):
        """ยิ่งความเสี่ยงเรียกร้องผลตอบแทนสูง มูลค่าที่ยอมจ่ายวันนี้ยิ่งต่ำ"""
        cheap_risk = fair_value(make_forecast(median=2.0), required_return=0.10)
        dear_risk = fair_value(make_forecast(median=2.0), required_return=2.00)
        assert dear_risk.fair_price < cheap_risk.fair_price

    def test_gap_positive_when_underpriced(self):
        result = fair_value(make_forecast(spot=1.0, median=2.0), required_return=0.10)
        assert result.gap > 0
        assert result.is_undervalued

    def test_gap_negative_when_overpriced(self):
        result = fair_value(make_forecast(spot=1.0, median=0.6), required_return=0.50)
        assert result.gap < 0
        assert not result.is_undervalued

    def test_verdict_matches_gap_direction(self):
        cheap = fair_value(make_forecast(spot=1.0, median=3.0), required_return=0.10)
        dear = fair_value(make_forecast(spot=1.0, median=0.4), required_return=0.50)
        assert "ถูก" in cheap.verdict
        assert "แพง" in dear.verdict

    def test_optimistic_above_pessimistic(self):
        result = fair_value(make_forecast(p25=0.8, p75=1.8), required_return=0.30)
        assert result.pessimistic_price < result.optimistic_price

    def test_longer_horizon_discounts_more(self):
        short = fair_value(make_forecast(median=2.0, horizon=7), required_return=0.60)
        long = fair_value(make_forecast(median=2.0, horizon=180), required_return=0.60)
        assert long.fair_price < short.fair_price

    def test_extreme_negative_required_return_is_safe(self):
        """required return ติดลบสุดขั้วต้องไม่ทำให้หารด้วยศูนย์"""
        result = fair_value(make_forecast(), required_return=-5.0)
        assert np.isfinite(result.fair_price)


class TestKelly:
    def test_no_edge_returns_zero(self):
        """โอกาสชนะต่ำและอัตราจ่ายแย่ = ไม่ควรลงเงินเลย"""
        assert kelly_fraction(prob_up=0.30, reward_to_risk=1.0) == 0.0

    def test_positive_edge_returns_positive_size(self):
        assert kelly_fraction(prob_up=0.70, reward_to_risk=2.0) > 0

    def test_respects_the_cap(self):
        assert kelly_fraction(prob_up=0.99, reward_to_risk=10.0, cap=0.20) == pytest.approx(0.20)

    def test_grows_with_win_probability(self):
        low = kelly_fraction(prob_up=0.55, reward_to_risk=2.0)
        high = kelly_fraction(prob_up=0.75, reward_to_risk=2.0)
        assert high > low

    def test_grows_with_payoff_ratio(self):
        low = kelly_fraction(prob_up=0.60, reward_to_risk=1.2)
        high = kelly_fraction(prob_up=0.60, reward_to_risk=4.0)
        assert high > low

    def test_fraction_scales_the_result(self):
        full = kelly_fraction(prob_up=0.70, reward_to_risk=2.0, fraction=1.0, cap=1.0)
        quarter = kelly_fraction(prob_up=0.70, reward_to_risk=2.0, fraction=0.25, cap=1.0)
        assert quarter == pytest.approx(full * 0.25)

    def test_zero_payoff_is_safe(self):
        assert kelly_fraction(prob_up=0.9, reward_to_risk=0.0) == 0.0

    def test_matches_the_formula(self):
        """ตรวจกับสูตรตรง ๆ: p=0.6, b=2 -> (0.6*2 - 0.4)/2 = 0.4"""
        result = kelly_fraction(prob_up=0.6, reward_to_risk=2.0, fraction=1.0, cap=1.0)
        assert result == pytest.approx(0.4)


class TestPriceZones:
    def test_boundaries_are_ordered(self):
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=1.0)
        assert (zones.strong_buy_below < zones.accumulate_below
                < zones.trim_above < zones.exit_above)

    def test_fair_price_sits_in_hold_zone(self):
        fair = fair_value(make_forecast(), 0.5)
        zones = price_zones(fair, annual_volatility=1.0)
        assert zones.zone_of(zones.fair_price) == "ถือ"

    def test_cheap_price_is_strong_buy(self):
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=1.0)
        assert zones.zone_of(zones.strong_buy_below * 0.5) == "ซื้อเพิ่มหนัก"

    def test_expensive_price_is_exit(self):
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=1.0)
        assert zones.zone_of(zones.exit_above * 2.0) == "ขายออก"

    def test_higher_volatility_widens_the_hold_zone(self):
        fair = fair_value(make_forecast(), 0.5)
        calm = price_zones(fair, annual_volatility=0.4)
        wild = price_zones(fair, annual_volatility=3.0)

        calm_width = calm.trim_above - calm.accumulate_below
        wild_width = wild.trim_above - wild.accumulate_below
        assert wild_width > calm_width

    def test_all_boundaries_stay_positive(self):
        """ความผันผวนสูงมากต้องไม่ทำให้ขอบล่างติดลบ"""
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=20.0)
        assert zones.strong_buy_below > 0

    def test_every_zone_name_is_known(self):
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=1.0)
        for row in zones.as_rows():
            assert row["โซน"] in ZONE_ORDER

    def test_rows_cover_all_five_zones(self):
        zones = price_zones(fair_value(make_forecast(), 0.5), annual_volatility=1.0)
        assert len(zones.as_rows()) == 5


class TestTargetWeight:
    def test_negative_score_targets_zero(self):
        """คะแนน AI ติดลบต้องไม่แนะนำให้ถือ แม้มูลค่าจะดูถูก"""
        fair = fair_value(make_forecast(spot=1.0, median=5.0), 0.3)
        weight, _ = target_weight(make_advice(score=-0.4), make_forecast(),
                                  make_profile(), fair)
        assert weight == 0.0

    def test_never_exceeds_cap(self):
        fair = fair_value(make_forecast(spot=1.0, median=10.0), 0.1)
        weight, _ = target_weight(make_advice(score=1.0),
                                  make_forecast(prob_up=0.95, upside=5.0),
                                  make_profile(volatility=0.3), fair, max_weight=0.15)
        assert weight <= 0.15

    def test_undervalued_gets_bigger_weight(self):
        forecast = make_forecast(prob_up=0.7)
        cheap = fair_value(make_forecast(spot=1.0, median=2.5), 0.2)
        dear = fair_value(make_forecast(spot=1.0, median=0.9), 0.2)

        cheap_weight, _ = target_weight(make_advice(), forecast, make_profile(), cheap)
        dear_weight, _ = target_weight(make_advice(), forecast, make_profile(), dear)
        assert cheap_weight > dear_weight

    def test_high_volatility_shrinks_weight(self):
        forecast = make_forecast(prob_up=0.7)
        fair = fair_value(make_forecast(spot=1.0, median=1.5), 0.2)

        calm, _ = target_weight(make_advice(), forecast, make_profile(volatility=0.8), fair)
        wild, _ = target_weight(make_advice(), forecast, make_profile(volatility=4.0), fair)
        assert wild < calm

    def test_returns_raw_kelly_alongside(self):
        fair = fair_value(make_forecast(), 0.3)
        weight, kelly = target_weight(make_advice(), make_forecast(prob_up=0.7),
                                      make_profile(), fair)
        assert kelly >= 0
        assert weight <= kelly * 1.6 + 1e-9  # ตัวคูณมูลค่าสูงสุดคือ 1.6


class TestPositionPlan:
    def _plan(self, current_qty=0.0, score=0.5, equity=10_000.0, median=1.5, prob_up=0.7):
        return build_position_plan(
            symbol="TEST", spot=1.0, current_qty=current_qty, equity=equity,
            advice=make_advice(score=score),
            forecast=make_forecast(spot=1.0, median=median, prob_up=prob_up),
            profile=make_profile(), required_return=0.30,
        )

    def test_opens_a_new_position_when_none_held(self):
        plan = self._plan(current_qty=0.0)
        if plan.target_weight > 0.02:
            assert plan.action == "เปิดสถานะใหม่"
            assert plan.is_buy

    def test_sells_everything_when_score_turns_negative(self):
        plan = self._plan(current_qty=2000.0, score=-0.5)
        assert plan.target_weight == 0.0
        assert plan.action == "ขายทั้งหมด"
        assert plan.delta_value == pytest.approx(-2000.0)

    def test_delta_qty_matches_delta_value(self):
        plan = self._plan(current_qty=500.0)
        assert plan.delta_qty == pytest.approx(plan.delta_value / plan.spot)

    def test_current_weight_uses_equity(self):
        plan = self._plan(current_qty=2500.0, equity=10_000.0)
        assert plan.current_weight == pytest.approx(0.25)

    def test_holds_when_already_at_target(self):
        """ถือใกล้เป้าหมายแล้วต้องไม่สั่งซื้อขายให้เสียค่าธรรมเนียม"""
        plan = self._plan(current_qty=0.0)
        at_target = build_position_plan(
            symbol="TEST", spot=1.0, current_qty=plan.target_value, equity=10_000.0,
            advice=make_advice(score=0.5),
            forecast=make_forecast(spot=1.0, median=1.5, prob_up=0.7),
            profile=make_profile(), required_return=0.30,
        )
        assert at_target.action == "ถือ"

    def test_rationale_is_populated(self):
        plan = self._plan(current_qty=100.0)
        assert len(plan.rationale) >= 3
        assert any("มูลค่าเหมาะสม" in line for line in plan.rationale)

    def test_zero_equity_does_not_crash(self):
        plan = self._plan(current_qty=0.0, equity=0.0)
        assert plan.current_weight == 0.0

    def test_every_action_has_an_icon(self):
        for score in (-0.6, 0.0, 0.5):
            for qty in (0.0, 1500.0):
                plan = self._plan(current_qty=qty, score=score)
                assert plan.icon != "⚪"


class TestPlansSummary:
    def test_counts_add_up(self):
        plans = [
            build_position_plan("A", 1.0, 0.0, 10_000, make_advice(score=0.6),
                                make_forecast(median=2.0, prob_up=0.75),
                                make_profile(), 0.3),
            build_position_plan("B", 1.0, 3000.0, 10_000, make_advice(score=-0.5),
                                make_forecast(median=0.5, prob_up=0.3),
                                make_profile(), 0.3),
        ]
        summary = plans_summary(plans)
        total = summary["buy_count"] + summary["sell_count"] + summary["hold_count"]
        assert total == len(plans)

    def test_sell_value_is_reported_positive(self):
        plans = [build_position_plan("B", 1.0, 3000.0, 10_000, make_advice(score=-0.5),
                                     make_forecast(median=0.5, prob_up=0.3),
                                     make_profile(), 0.3)]
        assert plans_summary(plans)["sell_value"] > 0

    def test_empty_input_is_safe(self):
        summary = plans_summary([])
        assert summary["buy_count"] == 0
        assert summary["net_cash_needed"] == 0


class TestIntegrationWithPortfolio:
    def test_plan_reflects_real_portfolio_holdings(self):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        portfolio.buy("TEST", 1000.0, 1.0)

        plan = build_position_plan(
            symbol="TEST", spot=1.0,
            current_qty=portfolio.position("TEST").quantity,
            equity=portfolio.equity({"TEST": 1.0}),
            advice=make_advice(score=0.5), forecast=make_forecast(prob_up=0.7),
            profile=make_profile(), required_return=0.30,
        )
        assert plan.current_value == pytest.approx(1000.0)
        assert plan.current_weight == pytest.approx(0.10)


class TestScaleToBudget:
    def test_scales_up_to_the_budget(self):
        """Kelly ดิบให้ค่าน้อยมาก ต้องขยายให้ถึงงบลงทุนที่ตั้งไว้"""
        from core.valuation import scale_to_budget

        result = scale_to_budget({"A": 0.02, "B": 0.01, "C": 0.005}, 0.70, 0.25)
        assert sum(result.values()) == pytest.approx(0.70)

    def test_preserves_relative_ranking(self):
        """ตัวที่ Kelly ให้น้ำหนักมากกว่า ต้องยังมากกว่าหลังปรับสเกล"""
        from core.valuation import scale_to_budget

        result = scale_to_budget({"A": 0.04, "B": 0.02, "C": 0.01}, 0.60, 0.50)
        assert result["A"] > result["B"] > result["C"]

    def test_respects_the_per_coin_cap(self):
        from core.valuation import scale_to_budget

        result = scale_to_budget({"A": 0.9, "B": 0.05}, 0.80, 0.25)
        assert max(result.values()) <= 0.25 + 1e-9

    def test_redistributes_when_one_hits_the_cap(self):
        """ตัวที่ชนเพดานต้องคืนส่วนเกินให้ตัวอื่น ไม่ใช่ทิ้งไป"""
        from core.valuation import scale_to_budget

        result = scale_to_budget({"A": 0.90, "B": 0.05, "C": 0.05}, 0.60, 0.25)
        assert result["A"] == pytest.approx(0.25)
        # B และ C ต้องได้ส่วนที่เหลือไปแบ่งกัน
        assert result["B"] + result["C"] == pytest.approx(0.35, abs=1e-6)

    def test_all_zero_weights_stay_in_cash(self):
        """โมเดลไม่เห็นความได้เปรียบเลย = ไม่ควรถูกบังคับให้ลงทุน"""
        from core.valuation import scale_to_budget

        assert sum(scale_to_budget({"A": 0.0, "B": 0.0}, 0.70, 0.25).values()) == 0.0

    def test_zero_budget_means_all_cash(self):
        from core.valuation import scale_to_budget

        assert sum(scale_to_budget({"A": 0.05}, 0.0, 0.25).values()) == 0.0

    def test_cannot_exceed_what_the_caps_allow(self):
        """สองเหรียญที่เพดาน 25% รวมกันได้มากสุด 50% แม้งบจะตั้งไว้ 90%"""
        from core.valuation import scale_to_budget

        result = scale_to_budget({"A": 0.5, "B": 0.5}, 0.90, 0.25)
        assert sum(result.values()) == pytest.approx(0.50)


class TestFairValueUsesExpectedNotMedian:
    def test_uses_expected_price_so_volatility_is_not_penalised_twice(self):
        """ค่ากลางของ lognormal มีตัวหน่วง −σ²/2 อยู่แล้ว ถ้าเอามาคิดลดอีกจะลงโทษซ้ำ

        มูลค่าเหมาะสมจึงต้องอิงค่าคาดหวัง และต้องสูงกว่าตัวเลขอนุรักษ์นิยมเสมอ
        เมื่อค่าคาดหวังสูงกว่าค่ากลาง
        """
        forecast = make_forecast(median=1.2)  # expected_price = median * 1.1
        result = fair_value(forecast, required_return=0.40)

        assert result.fair_price > result.conservative_price
        assert result.fair_price == pytest.approx(
            forecast.expected_price / (1.40 ** (30 / 365)), rel=1e-9
        )

    def test_conservative_price_still_available(self):
        result = fair_value(make_forecast(median=1.2), required_return=0.40)
        assert result.conservative_price > 0
