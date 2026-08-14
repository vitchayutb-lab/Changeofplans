"""บอทยิงออเดอร์อัตโนมัติ (จำลอง)

บอททำงานเป็นรอบ (cycle) แต่ละรอบมี 3 ขั้นตอนตามลำดับความสำคัญ

    1. บริหารความเสี่ยงของสถานะที่ถืออยู่  -> stop-loss / take-profit
    2. ตรวจวงเงินขาดทุนของวัน               -> ถ้าชนเพดาน หยุดเปิดสถานะใหม่ทั้งหมด
    3. ทำตามสัญญาณ AI                       -> ขายตัวที่สัญญาณลบ แล้วซื้อตัวที่สัญญาณบวก

ทุกออเดอร์ต้องผ่าน "ด่านความเสี่ยง" (risk gates) ก่อนถูกส่ง ถ้าไม่ผ่านจะถูกบันทึกไว้
พร้อมเหตุผล ทำให้ตรวจสอบย้อนหลังได้ว่าทำไมบอทถึงไม่เข้าไม้นั้น

**ไม่มีการเชื่อมต่อกับกระดานเทรดจริง** ทุกคำสั่งถูกจับคู่ในระบบจำลองเท่านั้น
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from core.ai_advisor import Advice
from core.portfolio import Portfolio
from core.risk import portfolio_beta


@dataclass(frozen=True)
class BotConfig:
    """พารามิเตอร์ควบคุมพฤติกรรมบอท"""

    order_size_usd: float = 250.0
    max_position_weight: float = 0.30  # ห้ามให้เหรียญเดียวเกิน 30% ของพอร์ต
    max_open_positions: int = 5
    cash_reserve_pct: float = 0.10  # กันเงินสดไว้ไม่ให้บอทใช้จนหมด
    max_portfolio_beta: float = 1.80  # เพดาน β ของพอร์ตหลังเปิดสถานะใหม่
    min_confidence: float = 0.55  # ความมั่นใจขั้นต่ำที่ยอมให้เข้าไม้
    fee_bps: float = 10.0  # ค่าธรรมเนียม 0.10%
    slippage_bps: float = 25.0  # slippage 0.25% (เหรียญมีมสภาพคล่องบาง)
    use_stop_loss: bool = True
    use_take_profit: bool = True
    daily_loss_limit_pct: float = 0.08  # ขาดทุนเกิน 8% ของพอร์ตในวันเดียว = หยุดเทรด
    sell_fraction_on_reduce: float = 0.5  # สัญญาณ REDUCE ขายออกครึ่งเดียว

    @property
    def fee_rate(self) -> float:
        return self.fee_bps / 10_000.0

    @property
    def slippage_rate(self) -> float:
        return self.slippage_bps / 10_000.0


@dataclass(frozen=True)
class OrderResult:
    """ผลของการพยายามส่งออเดอร์หนึ่งรายการ"""

    symbol: str
    side: str  # BUY / SELL
    status: str  # filled / skipped / rejected
    reason: str
    quantity: float = 0.0
    reference_price: float = 0.0
    fill_price: float = 0.0
    notional: float = 0.0
    fee: float = 0.0
    slippage_cost: float = 0.0
    realized_pnl: float = 0.0
    trigger: str = "signal"  # signal / stop-loss / take-profit / rebalance
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))

    @property
    def is_filled(self) -> bool:
        return self.status == "filled"

    @property
    def icon(self) -> str:
        if self.status == "filled":
            return "🟢" if self.side == "BUY" else "🔴"
        return "⏭️" if self.status == "skipped" else "⛔"

    def as_row(self) -> dict:
        return {
            "เวลา": self.timestamp,
            "เหรียญ": self.symbol,
            "ฝั่ง": self.side,
            "สถานะ": self.status,
            "ทริกเกอร์": self.trigger,
            "จำนวน": self.quantity,
            "ราคาที่จับคู่": self.fill_price,
            "มูลค่า (USD)": self.notional,
            "ค่าธรรมเนียม": self.fee,
            "กำไรที่รับรู้": self.realized_pnl,
            "เหตุผล": self.reason,
        }


@dataclass
class CycleReport:
    """สรุปผลการทำงานหนึ่งรอบของบอท"""

    orders: list[OrderResult] = field(default_factory=list)
    halted: bool = False
    halt_reason: str = ""
    beta_before: float = 0.0
    beta_after: float = 0.0
    equity_before: float = 0.0
    equity_after: float = 0.0

    @property
    def filled(self) -> list[OrderResult]:
        return [o for o in self.orders if o.is_filled]

    @property
    def turnover(self) -> float:
        return sum(o.notional for o in self.filled)

    @property
    def total_fees(self) -> float:
        return sum(o.fee for o in self.filled)


class TradingBot:
    """เครื่องยนต์จับคู่คำสั่งจำลอง พร้อมด่านความเสี่ยงก่อนส่งทุกออเดอร์"""

    def __init__(self, config: BotConfig):
        self.config = config

    # ------------------------------------------------------------------
    # การจับคู่คำสั่ง
    # ------------------------------------------------------------------

    def _fill_price(self, reference_price: float, side: str) -> float:
        """ราคาที่จับคู่ได้จริงหลังรวม slippage (ซื้อแพงขึ้น / ขายถูกลง)"""
        drift = self.config.slippage_rate
        return reference_price * (1.0 + drift) if side == "BUY" else reference_price * (1.0 - drift)

    def _execute_buy(self, portfolio: Portfolio, symbol: str, usd_amount: float,
                     price: float, reason: str, trigger: str = "signal") -> OrderResult:
        fill_price = self._fill_price(price, "BUY")
        quantity = usd_amount / fill_price if fill_price > 0 else 0.0
        notional = quantity * fill_price
        fee = notional * self.config.fee_rate

        if notional + fee > portfolio.cash:
            return OrderResult(symbol, "BUY", "rejected", "เงินสดไม่พอสำหรับออเดอร์นี้",
                               trigger=trigger)

        portfolio.buy(symbol, quantity, fill_price, fee)
        return OrderResult(
            symbol=symbol,
            side="BUY",
            status="filled",
            reason=reason,
            quantity=quantity,
            reference_price=price,
            fill_price=fill_price,
            notional=notional,
            fee=fee,
            slippage_cost=quantity * (fill_price - price),
            trigger=trigger,
        )

    def _execute_sell(self, portfolio: Portfolio, symbol: str, quantity: float,
                      price: float, reason: str, trigger: str = "signal") -> OrderResult:
        position = portfolio.position(symbol)
        quantity = min(quantity, position.quantity)
        if quantity <= 0:
            return OrderResult(symbol, "SELL", "skipped", "ไม่มีสถานะให้ขาย", trigger=trigger)

        fill_price = self._fill_price(price, "SELL")
        notional = quantity * fill_price
        fee = notional * self.config.fee_rate
        realized = portfolio.sell(symbol, quantity, fill_price, fee)

        return OrderResult(
            symbol=symbol,
            side="SELL",
            status="filled",
            reason=reason,
            quantity=quantity,
            reference_price=price,
            fill_price=fill_price,
            notional=notional,
            fee=fee,
            slippage_cost=quantity * (price - fill_price),
            realized_pnl=realized,
            trigger=trigger,
        )

    # ------------------------------------------------------------------
    # ด่านความเสี่ยง
    # ------------------------------------------------------------------

    def _check_buy_gates(self, portfolio: Portfolio, symbol: str, advice: Advice,
                         prices: dict[str, float], betas: dict[str, float],
                         order_usd: float) -> str | None:
        """คืนเหตุผลที่ "ห้ามซื้อ" หรือ None ถ้าผ่านทุกด่าน"""
        cfg = self.config
        equity = portfolio.equity(prices)

        if advice.confidence < cfg.min_confidence:
            return (f"ความมั่นใจ {advice.confidence * 100:.0f}% ต่ำกว่าเกณฑ์ "
                    f"{cfg.min_confidence * 100:.0f}%")

        usable_cash = portfolio.cash - equity * cfg.cash_reserve_pct
        if order_usd > usable_cash:
            return (f"เงินสดที่ใช้ได้เหลือ ${max(usable_cash, 0):,.0f} "
                    f"(กันสำรองไว้ {cfg.cash_reserve_pct * 100:.0f}%)")

        current_value = portfolio.position(symbol).market_value(prices.get(symbol, 0.0))
        projected_weight = (current_value + order_usd) / equity if equity > 0 else 1.0
        if projected_weight > cfg.max_position_weight:
            return (f"น้ำหนักจะขึ้นไป {projected_weight * 100:.0f}% เกินเพดานรายเหรียญ "
                    f"{cfg.max_position_weight * 100:.0f}%")

        open_count = len(portfolio.open_positions())
        if symbol not in portfolio.open_positions() and open_count >= cfg.max_open_positions:
            return f"ถือครบ {cfg.max_open_positions} เหรียญแล้ว"

        # จำลองน้ำหนักหลังซื้อ แล้วคำนวณ β ของพอร์ตล่วงหน้า
        projected = {
            s: p.market_value(prices.get(s, 0.0)) / equity
            for s, p in portfolio.open_positions().items()
        } if equity > 0 else {}
        projected[symbol] = projected.get(symbol, 0.0) + order_usd / equity if equity > 0 else 0.0
        projected_beta = portfolio_beta(projected, betas)
        if projected_beta > cfg.max_portfolio_beta:
            return (f"β พอร์ตจะขึ้นไป {projected_beta:.2f} เกินเพดาน "
                    f"{cfg.max_portfolio_beta:.2f}")

        return None

    def _risk_management_orders(self, portfolio: Portfolio, prices: dict[str, float],
                                advices: dict[str, Advice]) -> list[OrderResult]:
        """ตรวจ stop-loss / take-profit ของสถานะที่ถืออยู่ก่อนทำอย่างอื่น"""
        cfg = self.config
        results: list[OrderResult] = []

        for symbol, position in list(portfolio.open_positions().items()):
            price = prices.get(symbol, 0.0)
            if price <= 0:
                continue
            advice = advices.get(symbol)
            pnl_pct = position.unrealized_pnl_pct(price)

            stop_loss = advice.stop_loss_pct if advice else 0.15
            take_profit = advice.take_profit_pct if advice else 0.35

            if cfg.use_stop_loss and pnl_pct <= -stop_loss:
                results.append(self._execute_sell(
                    portfolio, symbol, position.quantity, price,
                    f"ตัดขาดทุนอัตโนมัติที่ {pnl_pct * 100:.1f}% (เกณฑ์ -{stop_loss * 100:.1f}%)",
                    trigger="stop-loss",
                ))
            elif cfg.use_take_profit and pnl_pct >= take_profit:
                # ทำกำไรครึ่งไม้ แล้วปล่อยที่เหลือวิ่งต่อ
                results.append(self._execute_sell(
                    portfolio, symbol, position.quantity * 0.5, price,
                    f"ทำกำไรบางส่วนที่ {pnl_pct * 100:+.1f}% (เกณฑ์ +{take_profit * 100:.1f}%)",
                    trigger="take-profit",
                ))

        return results

    # ------------------------------------------------------------------
    # รอบการทำงานหลัก
    # ------------------------------------------------------------------

    def run_cycle(self, portfolio: Portfolio, prices: dict[str, float],
                  advices: dict[str, Advice], betas: dict[str, float],
                  day_start_equity: float | None = None) -> CycleReport:
        """รันบอทหนึ่งรอบ คืนรายงานทุกออเดอร์พร้อมเหตุผล"""
        cfg = self.config
        equity_before = portfolio.equity(prices)
        weights_before = portfolio.weights(prices)

        report = CycleReport(
            beta_before=portfolio_beta(weights_before, betas),
            equity_before=equity_before,
        )

        # ขั้นที่ 1 — บริหารความเสี่ยงของสถานะเดิม
        report.orders.extend(self._risk_management_orders(portfolio, prices, advices))

        # ขั้นที่ 2 — วงเงินขาดทุนของวัน
        # หมายเหตุ: การชนวงเงินหยุดเฉพาะ "การเปิดสถานะใหม่" แต่ยังปล่อยให้ขายได้
        # เพราะการห้ามขายตอนพอร์ตกำลังเจ็บคือการขังความเสี่ยงไว้กับตัว
        baseline = day_start_equity if day_start_equity is not None else portfolio.initial_equity
        if baseline > 0:
            drawdown_today = portfolio.equity(prices) / baseline - 1.0
            if drawdown_today <= -cfg.daily_loss_limit_pct:
                report.halted = True
                report.halt_reason = (
                    f"พอร์ตขาดทุน {drawdown_today * 100:.1f}% ชนวงเงินขาดทุนของวัน "
                    f"(-{cfg.daily_loss_limit_pct * 100:.0f}%) บอทหยุดเปิดสถานะใหม่ "
                    "แต่ยังปิดสถานะที่มีสัญญาณลบได้ตามปกติ"
                )

        # ขั้นที่ 3 — ทำตามสัญญาณ AI (ขายก่อนเพื่อปลดเงินสดมาใช้ซื้อ)
        ranked = sorted(advices.items(), key=lambda kv: kv[1].score)

        for symbol, advice in ranked:
            if not advice.is_sell:
                continue
            position = portfolio.position(symbol)
            if not position.is_open:
                continue
            price = prices.get(symbol, 0.0)
            fraction = 1.0 if advice.signal == "SELL" else cfg.sell_fraction_on_reduce
            report.orders.append(self._execute_sell(
                portfolio, symbol, position.quantity * fraction, price,
                f"สัญญาณ {advice.signal} (คะแนน {advice.score:+.2f}) — {advice.action_text}",
            ))

        if report.halted:
            report.equity_after = portfolio.equity(prices)
            report.beta_after = portfolio_beta(portfolio.weights(prices), betas)
            return report

        for symbol, advice in sorted(advices.items(), key=lambda kv: kv[1].score, reverse=True):
            if not advice.is_buy:
                if advice.signal == "HOLD" and portfolio.position(symbol).is_open:
                    report.orders.append(OrderResult(
                        symbol, "BUY", "skipped",
                        f"สัญญาณ HOLD (คะแนน {advice.score:+.2f}) — คงสถานะเดิมไว้",
                    ))
                continue

            price = prices.get(symbol, 0.0)
            if price <= 0:
                report.orders.append(OrderResult(symbol, "BUY", "rejected", "ไม่มีราคาอ้างอิง"))
                continue

            # ไม้ใหญ่ขึ้นตามความมั่นใจ แต่ไม่เกิน 1.5 เท่าของขนาดไม้มาตรฐาน
            size_multiplier = float(np.clip(0.6 + advice.confidence, 0.6, 1.5))
            order_usd = cfg.order_size_usd * size_multiplier

            blocked = self._check_buy_gates(portfolio, symbol, advice, prices, betas, order_usd)
            if blocked:
                report.orders.append(OrderResult(symbol, "BUY", "rejected", blocked))
                continue

            report.orders.append(self._execute_buy(
                portfolio, symbol, order_usd, price,
                f"สัญญาณ {advice.signal} (คะแนน {advice.score:+.2f}, "
                f"ความมั่นใจ {advice.confidence * 100:.0f}%)",
            ))

        report.equity_after = portfolio.equity(prices)
        report.beta_after = portfolio_beta(portfolio.weights(prices), betas)
        return report
