"""ทดสอบการบันทึกสถานะพอร์ต กำไรขาดทุน และการปรับสมดุล"""

import pytest

from core.portfolio import Portfolio, Position, normalize_weights, rebalance_plan


class TestPosition:
    def test_market_value(self):
        assert Position("DOGE", 100.0, 0.10).market_value(0.15) == pytest.approx(15.0)

    def test_unrealized_pnl(self):
        position = Position("DOGE", 100.0, 0.10)
        assert position.unrealized_pnl(0.15) == pytest.approx(5.0)
        assert position.unrealized_pnl_pct(0.15) == pytest.approx(0.5)

    def test_empty_position_is_not_open(self):
        assert not Position("DOGE").is_open

    def test_zero_cost_basis_does_not_divide_by_zero(self):
        assert Position("DOGE", 0.0, 0.0).unrealized_pnl_pct(0.15) == 0.0


class TestPortfolioAccounting:
    def test_buy_reduces_cash_and_adds_quantity(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 1000.0, 0.5)
        assert portfolio.cash == pytest.approx(500.0)
        assert portfolio.position("DOGE").quantity == pytest.approx(1000.0)

    def test_buy_charges_fee(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 100.0, 1.0, fee=5.0)
        assert portfolio.cash == pytest.approx(895.0)
        assert portfolio.fees_paid == pytest.approx(5.0)

    def test_average_cost_updates_across_two_buys(self):
        portfolio = Portfolio(cash=10_000.0)
        portfolio.buy("DOGE", 100.0, 1.0)
        portfolio.buy("DOGE", 100.0, 2.0)
        assert portfolio.position("DOGE").avg_cost == pytest.approx(1.5)

    def test_sell_realizes_profit(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 100.0, 1.0)
        realized = portfolio.sell("DOGE", 100.0, 1.5)
        assert realized == pytest.approx(50.0)
        assert portfolio.realized_pnl == pytest.approx(50.0)

    def test_sell_more_than_held_is_capped(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 100.0, 1.0)
        portfolio.sell("DOGE", 500.0, 1.0)
        assert portfolio.position("DOGE").quantity == 0.0

    def test_selling_everything_clears_the_position(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 100.0, 1.0)
        portfolio.sell("DOGE", 100.0, 1.2)
        assert not portfolio.position("DOGE").is_open
        assert portfolio.position("DOGE").avg_cost == 0.0

    def test_selling_nothing_is_a_noop(self):
        portfolio = Portfolio(cash=1000.0)
        assert portfolio.sell("DOGE", 10.0, 1.0) == 0.0
        assert portfolio.cash == pytest.approx(1000.0)

    def test_equity_is_cash_plus_positions(self):
        portfolio = Portfolio(cash=1000.0)
        portfolio.buy("DOGE", 500.0, 1.0)
        assert portfolio.equity({"DOGE": 1.2}) == pytest.approx(500.0 + 600.0)

    def test_round_trip_conserves_equity_without_fees(self):
        """ซื้อแล้วขายที่ราคาเดิมโดยไม่มีค่าธรรมเนียม มูลค่าพอร์ตต้องเท่าเดิม"""
        portfolio = Portfolio(cash=1000.0, initial_equity=1000.0)
        portfolio.buy("DOGE", 300.0, 2.0)
        portfolio.sell("DOGE", 300.0, 2.0)
        assert portfolio.equity({"DOGE": 2.0}) == pytest.approx(1000.0)


class TestWeights:
    def test_weights_sum_with_cash_to_one(self):
        portfolio = Portfolio(cash=500.0)
        portfolio.buy("DOGE", 500.0, 1.0)  # ใช้เงิน 500 เหลือเงินสด 0
        portfolio.cash = 500.0  # ตั้งเงินสดกลับเป็น 500 เพื่อทดสอบสัดส่วน
        prices = {"DOGE": 1.0}
        total = sum(portfolio.weights(prices).values()) + portfolio.cash_weight(prices)
        assert total == pytest.approx(1.0)

    def test_all_cash_gives_full_cash_weight(self):
        portfolio = Portfolio(cash=1000.0)
        assert portfolio.cash_weight({}) == pytest.approx(1.0)
        assert portfolio.weights({}) == {}

    def test_zero_equity_is_safe(self):
        portfolio = Portfolio(cash=0.0)
        assert portfolio.weights({}) == {}


class TestNormalizeWeights:
    def test_leaves_small_totals_untouched(self):
        raw = {"A": 0.3, "B": 0.2}
        assert normalize_weights(raw, 1.0) == pytest.approx(raw)

    def test_scales_down_when_over_budget(self):
        result = normalize_weights({"A": 0.8, "B": 0.8}, 1.0)
        assert sum(result.values()) == pytest.approx(1.0)

    def test_clips_negative_weights_to_zero(self):
        assert normalize_weights({"A": -0.5, "B": 0.4})["A"] == 0.0

    def test_empty_input_is_safe(self):
        assert normalize_weights({}) == {}


class TestRebalancePlan:
    def test_generates_buy_when_underweight(self):
        orders = rebalance_plan({"A": 0.10}, {"A": 0.30}, equity=10_000.0)
        assert len(orders) == 1
        assert orders[0].side == "BUY"
        assert orders[0].usd_amount == pytest.approx(2000.0)

    def test_generates_sell_when_overweight(self):
        orders = rebalance_plan({"A": 0.50}, {"A": 0.20}, equity=10_000.0)
        assert orders[0].side == "SELL"
        assert orders[0].usd_amount == pytest.approx(3000.0)

    def test_skips_small_gaps(self):
        """ห่างจากเป้าหมายไม่ถึงเกณฑ์ ไม่ควรสร้างออเดอร์ให้เสียค่าธรรมเนียม"""
        assert rebalance_plan({"A": 0.30}, {"A": 0.31}, 10_000.0, threshold=0.02) == []

    def test_sorted_by_largest_gap(self):
        orders = rebalance_plan(
            {"A": 0.10, "B": 0.10},
            {"A": 0.15, "B": 0.40},
            equity=10_000.0,
        )
        assert orders[0].symbol == "B"

    def test_handles_symbol_only_in_target(self):
        orders = rebalance_plan({}, {"NEW": 0.25}, equity=10_000.0)
        assert orders[0].symbol == "NEW"
        assert orders[0].side == "BUY"
