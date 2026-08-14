"""ทดสอบบอทยิงออเดอร์ — เน้นที่ "ด่านความเสี่ยง" ว่าปิดกั้นได้จริง"""

import pytest

from core.ai_advisor import Advice, Factor
from core.bot_engine import BotConfig, TradingBot
from core.portfolio import Portfolio


def make_advice(symbol="DOGE", signal="BUY", score=0.5, confidence=0.9) -> Advice:
    """สร้างคำแนะนำปลอมเพื่อควบคุมตัวแปรในการทดสอบ"""
    return Advice(
        symbol=symbol,
        signal=signal,
        score=score,
        confidence=confidence,
        factors=[Factor("momentum", "โมเมนตัม", 0.5, 1.0, "")],
        rationale=[],
        target_weight=0.2,
        stop_loss_pct=0.15,
        take_profit_pct=0.35,
    )


@pytest.fixture
def bot() -> TradingBot:
    return TradingBot(BotConfig(order_size_usd=500.0, fee_bps=10.0, slippage_bps=25.0))


class TestExecution:
    def test_buy_signal_opens_a_position(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})

        assert len(report.filled) == 1
        assert portfolio.position("DOGE").is_open

    def test_buy_pays_slippage_above_reference_price(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})
        order = report.filled[0]
        assert order.fill_price > order.reference_price

    def test_sell_receives_less_than_reference_price(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        report = bot.run_cycle(
            portfolio, {"DOGE": 1.0}, {"DOGE": make_advice(signal="SELL", score=-0.5)},
            {"DOGE": 1.2},
        )
        order = next(o for o in report.filled if o.side == "SELL")
        assert order.fill_price < order.reference_price

    def test_fees_are_charged_on_fills(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})
        assert report.total_fees > 0
        assert portfolio.fees_paid == pytest.approx(report.total_fees)

    def test_sell_signal_closes_entire_position(self, bot):
        portfolio = Portfolio(cash=5_000.0, initial_equity=5_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        bot.run_cycle(portfolio, {"DOGE": 1.0},
                      {"DOGE": make_advice(signal="SELL", score=-0.6)}, {"DOGE": 1.2})
        assert not portfolio.position("DOGE").is_open

    def test_reduce_signal_sells_only_part(self, bot):
        portfolio = Portfolio(cash=5_000.0, initial_equity=5_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        bot.run_cycle(portfolio, {"DOGE": 1.0},
                      {"DOGE": make_advice(signal="REDUCE", score=-0.2)}, {"DOGE": 1.2})
        assert portfolio.position("DOGE").quantity == pytest.approx(500.0)

    def test_hold_signal_does_not_trade(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0},
                               {"DOGE": make_advice(signal="HOLD", score=0.0)}, {"DOGE": 1.2})
        assert report.filled == []


class TestRiskGates:
    def test_low_confidence_is_rejected(self):
        bot = TradingBot(BotConfig(min_confidence=0.8))
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0},
                               {"DOGE": make_advice(confidence=0.5)}, {"DOGE": 1.2})

        assert report.filled == []
        assert "ความมั่นใจ" in report.orders[0].reason

    def test_portfolio_beta_ceiling_blocks_the_buy(self):
        """เหรียญ β สูงมากต้องถูกปฏิเสธเมื่อเพดาน β ของพอร์ตต่ำ"""
        bot = TradingBot(BotConfig(order_size_usd=5_000.0, max_portfolio_beta=0.5, max_position_weight=1.0))
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"PEPE": 1.0}, {"PEPE": make_advice("PEPE")},
                               {"PEPE": 3.0})

        assert report.filled == []
        assert "β พอร์ต" in report.orders[0].reason

    def test_position_weight_cap_blocks_oversized_order(self):
        bot = TradingBot(BotConfig(order_size_usd=5_000.0, max_position_weight=0.10))
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.0})

        assert report.filled == []
        assert "เพดานรายเหรียญ" in report.orders[0].reason

    def test_cash_reserve_is_protected(self):
        bot = TradingBot(BotConfig(order_size_usd=9_500.0, cash_reserve_pct=0.20,
                                   max_position_weight=1.0, max_portfolio_beta=5.0))
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.0})

        assert report.filled == []
        assert "เงินสด" in report.orders[0].reason

    def test_max_open_positions_is_enforced(self):
        bot = TradingBot(BotConfig(order_size_usd=100.0, max_open_positions=2,
                                   max_portfolio_beta=10.0))
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        advices = {s: make_advice(s) for s in ["A", "B", "C", "D"]}
        prices = {s: 1.0 for s in advices}
        betas = {s: 1.0 for s in advices}

        report = bot.run_cycle(portfolio, prices, advices, betas)
        assert len(portfolio.open_positions()) == 2
        assert any("ถือครบ" in o.reason for o in report.orders)

    def test_daily_loss_limit_halts_new_entries(self):
        bot = TradingBot(BotConfig(daily_loss_limit_pct=0.05))
        portfolio = Portfolio(cash=9_000.0, initial_equity=10_000.0)  # ขาดทุนไปแล้ว 10%
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})

        assert report.halted
        assert report.filled == []
        assert "วงเงินขาดทุน" in report.halt_reason

    def test_halt_still_allows_risk_reducing_sells(self):
        """ชนวงเงินขาดทุนแล้วต้องยังขายออกได้ — ไม่งั้นคือการขังความเสี่ยงไว้กับตัว"""
        bot = TradingBot(BotConfig(daily_loss_limit_pct=0.05))
        portfolio = Portfolio(cash=1_000.0, initial_equity=10_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)  # มูลค่าพอร์ตต่ำกว่าเงินตั้งต้นมาก

        report = bot.run_cycle(
            portfolio, {"DOGE": 1.0},
            {"DOGE": make_advice(signal="SELL", score=-0.6)}, {"DOGE": 1.2},
        )

        assert report.halted
        assert not portfolio.position("DOGE").is_open
        assert any(o.side == "SELL" and o.is_filled for o in report.orders)


class TestRiskManagement:
    def test_stop_loss_closes_a_losing_position(self, bot):
        portfolio = Portfolio(cash=5_000.0, initial_equity=5_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        # ราคาร่วง 25% เกินเกณฑ์ stop-loss ที่ 15%
        report = bot.run_cycle(portfolio, {"DOGE": 0.75},
                               {"DOGE": make_advice(signal="HOLD", score=0.0)}, {"DOGE": 1.2})

        stop = next(o for o in report.orders if o.trigger == "stop-loss")
        assert stop.is_filled
        assert not portfolio.position("DOGE").is_open

    def test_take_profit_sells_half(self, bot):
        portfolio = Portfolio(cash=5_000.0, initial_equity=5_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        # ราคาขึ้น 50% เกินเกณฑ์ take-profit ที่ 35%
        report = bot.run_cycle(portfolio, {"DOGE": 1.5},
                               {"DOGE": make_advice(signal="HOLD", score=0.0)}, {"DOGE": 1.2})

        take = next(o for o in report.orders if o.trigger == "take-profit")
        assert take.is_filled
        assert portfolio.position("DOGE").quantity == pytest.approx(500.0)

    def test_stop_loss_can_be_disabled(self):
        bot = TradingBot(BotConfig(use_stop_loss=False, use_take_profit=False))
        portfolio = Portfolio(cash=5_000.0, initial_equity=5_000.0)
        portfolio.buy("DOGE", 1000.0, 1.0)
        report = bot.run_cycle(portfolio, {"DOGE": 0.5},
                               {"DOGE": make_advice(signal="HOLD", score=0.0)}, {"DOGE": 1.2})

        assert not any(o.trigger == "stop-loss" for o in report.orders)
        assert portfolio.position("DOGE").is_open


class TestReport:
    def test_report_records_beta_before_and_after(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.5})

        assert report.beta_before == pytest.approx(0.0)
        assert report.beta_after > 0.0

    def test_turnover_matches_filled_notional(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 1.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})
        assert report.turnover == pytest.approx(sum(o.notional for o in report.filled))

    def test_every_order_carries_a_reason(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        advices = {
            "DOGE": make_advice("DOGE"),
            "SHIB": make_advice("SHIB", signal="SELL", score=-0.5),
            "PEPE": make_advice("PEPE", confidence=0.1),
        }
        prices = {s: 1.0 for s in advices}
        report = bot.run_cycle(portfolio, prices, advices, {s: 1.2 for s in advices})

        assert all(o.reason for o in report.orders)

    def test_missing_price_is_rejected_not_crashed(self, bot):
        portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        report = bot.run_cycle(portfolio, {"DOGE": 0.0}, {"DOGE": make_advice()}, {"DOGE": 1.2})
        assert report.orders[0].status == "rejected"
