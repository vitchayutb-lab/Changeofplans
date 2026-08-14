"""โครงสร้างพอร์ตโฟลิโอ: สถานะการถือครอง กำไรขาดทุน และการปรับสมดุล"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Position:
    """สถานะการถือครองเหรียญหนึ่งตัว"""

    symbol: str
    quantity: float = 0.0
    avg_cost: float = 0.0  # ต้นทุนเฉลี่ยต่อหน่วย

    def market_value(self, price: float) -> float:
        return self.quantity * price

    def cost_basis(self) -> float:
        return self.quantity * self.avg_cost

    def unrealized_pnl(self, price: float) -> float:
        return self.market_value(price) - self.cost_basis()

    def unrealized_pnl_pct(self, price: float) -> float:
        cost = self.cost_basis()
        return self.unrealized_pnl(price) / cost if cost > 0 else 0.0

    @property
    def is_open(self) -> bool:
        return self.quantity > 1e-12


@dataclass
class Portfolio:
    """พอร์ตแบบ long-only ที่มีเงินสด (stablecoin) เป็นส่วนหนึ่งของสินทรัพย์"""

    cash: float = 10_000.0
    positions: dict[str, Position] = field(default_factory=dict)
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    initial_equity: float = 10_000.0

    def position(self, symbol: str) -> Position:
        return self.positions.setdefault(symbol, Position(symbol=symbol))

    def positions_value(self, prices: dict[str, float]) -> float:
        return sum(p.market_value(prices.get(s, 0.0)) for s, p in self.positions.items())

    def equity(self, prices: dict[str, float]) -> float:
        """มูลค่าพอร์ตรวม = เงินสด + มูลค่าตลาดของทุกเหรียญ"""
        return self.cash + self.positions_value(prices)

    def weights(self, prices: dict[str, float]) -> dict[str, float]:
        """สัดส่วนของแต่ละเหรียญเทียบมูลค่าพอร์ตรวม (เงินสดไม่ถูกนับเป็นเหรียญ)"""
        total = self.equity(prices)
        if total <= 0:
            return {s: 0.0 for s in self.positions}
        return {
            s: p.market_value(prices.get(s, 0.0)) / total
            for s, p in self.positions.items()
            if p.is_open
        }

    def cash_weight(self, prices: dict[str, float]) -> float:
        total = self.equity(prices)
        return self.cash / total if total > 0 else 1.0

    def unrealized_pnl(self, prices: dict[str, float]) -> float:
        return sum(p.unrealized_pnl(prices.get(s, 0.0)) for s, p in self.positions.items())

    def total_pnl(self, prices: dict[str, float]) -> float:
        return self.equity(prices) - self.initial_equity

    def total_return(self, prices: dict[str, float]) -> float:
        if self.initial_equity <= 0:
            return 0.0
        return self.equity(prices) / self.initial_equity - 1.0

    # ----------------------------------------------------------------------
    # การเคลื่อนไหวของพอร์ต
    # ----------------------------------------------------------------------

    def buy(self, symbol: str, quantity: float, price: float, fee: float = 0.0) -> None:
        """เพิ่มสถานะและเฉลี่ยต้นทุนใหม่"""
        if quantity <= 0:
            return
        cost = quantity * price + fee
        pos = self.position(symbol)
        new_qty = pos.quantity + quantity
        pos.avg_cost = (pos.cost_basis() + quantity * price) / new_qty if new_qty > 0 else price
        pos.quantity = new_qty
        self.cash -= cost
        self.fees_paid += fee

    def sell(self, symbol: str, quantity: float, price: float, fee: float = 0.0) -> float:
        """ปิดสถานะบางส่วน/ทั้งหมด คืนกำไรขาดทุนที่เกิดขึ้นจริง"""
        pos = self.position(symbol)
        quantity = min(quantity, pos.quantity)
        if quantity <= 0:
            return 0.0
        proceeds = quantity * price - fee
        realized = quantity * (price - pos.avg_cost) - fee
        pos.quantity -= quantity
        if pos.quantity <= 1e-12:
            pos.quantity = 0.0
            pos.avg_cost = 0.0
        self.cash += proceeds
        self.realized_pnl += realized
        self.fees_paid += fee
        return realized

    def open_positions(self) -> dict[str, Position]:
        return {s: p for s, p in self.positions.items() if p.is_open}

    def snapshot(self, prices: dict[str, float]) -> list[dict]:
        """ตารางสรุปสถานะสำหรับแสดงบนหน้าเว็บ"""
        rows = []
        for symbol, pos in self.open_positions().items():
            price = prices.get(symbol, 0.0)
            rows.append({
                "เหรียญ": symbol,
                "จำนวน": pos.quantity,
                "ต้นทุนเฉลี่ย": pos.avg_cost,
                "ราคาปัจจุบัน": price,
                "มูลค่า (USD)": pos.market_value(price),
                "กำไร/ขาดทุน (USD)": pos.unrealized_pnl(price),
                "กำไร/ขาดทุน (%)": pos.unrealized_pnl_pct(price) * 100.0,
            })
        return rows


@dataclass(frozen=True)
class RebalanceOrder:
    """คำสั่งปรับสมดุลหนึ่งรายการ"""

    symbol: str
    side: str  # BUY / SELL
    usd_amount: float
    current_weight: float
    target_weight: float

    @property
    def weight_gap(self) -> float:
        return self.target_weight - self.current_weight


def rebalance_plan(current_weights: dict[str, float], target_weights: dict[str, float],
                   equity: float, threshold: float = 0.02) -> list[RebalanceOrder]:
    """เทียบน้ำหนักปัจจุบันกับเป้าหมาย แล้วออกเป็นรายการคำสั่งซื้อ/ขาย

    ข้ามรายการที่ห่างจากเป้าหมายน้อยกว่า threshold เพื่อไม่ให้เสียค่าธรรมเนียมโดยเปล่าประโยชน์
    """
    symbols = set(current_weights) | set(target_weights)
    orders: list[RebalanceOrder] = []

    for symbol in sorted(symbols):
        current = current_weights.get(symbol, 0.0)
        target = target_weights.get(symbol, 0.0)
        gap = target - current
        if abs(gap) < threshold:
            continue
        orders.append(RebalanceOrder(
            symbol=symbol,
            side="BUY" if gap > 0 else "SELL",
            usd_amount=abs(gap) * equity,
            current_weight=current,
            target_weight=target,
        ))

    return sorted(orders, key=lambda o: abs(o.weight_gap), reverse=True)


def normalize_weights(raw: dict[str, float], max_total: float = 1.0) -> dict[str, float]:
    """ปรับผลรวมน้ำหนักไม่ให้เกิน max_total (ส่วนที่เหลือคือเงินสด)"""
    total = sum(max(w, 0.0) for w in raw.values())
    if total <= max_total or total == 0:
        return {s: max(w, 0.0) for s, w in raw.items()}
    scale = max_total / total
    return {s: max(w, 0.0) * scale for s, w in raw.items()}


def equity_curve(returns: np.ndarray, starting_equity: float = 10_000.0) -> np.ndarray:
    """แปลงซีรีส์ผลตอบแทนเป็นเส้นมูลค่าพอร์ต"""
    r = np.asarray(returns, dtype=float)
    if r.size == 0:
        return np.array([starting_equity])
    return starting_equity * np.concatenate([[1.0], np.cumprod(1.0 + r)])
