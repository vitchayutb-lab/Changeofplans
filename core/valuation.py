"""ประเมินมูลค่าและขนาดการถือครอง: "ถือเท่านี้ ควรซื้อเพิ่มหรือขายออก"

โมดูลนี้ตอบ 3 คำถามที่ต่อกันเป็นลำดับ

    1. เหรียญนี้ "ควรมีมูลค่าเท่าไหร่" วันนี้        -> fair_value()
    2. ที่มูลค่านั้น "ควรถือเป็นสัดส่วนเท่าไหร่"     -> target_weight()
    3. เทียบกับที่ถืออยู่จริง "ต้องซื้อ/ขายเท่าไหร่" -> build_position_plan()

**มูลค่าเหมาะสม (fair value)** ใช้หลักคิดลดกระแสเงินสด: เอาราคาที่โมเดลคาดว่าจะ
เป็นในอนาคต มาคิดลดกลับด้วยผลตอบแทนที่ความเสี่ยงเรียกร้อง (CAPM)

    fair = P_future / (1 + required_return) ^ T

ถ้า fair > ราคาปัจจุบัน แปลว่าของถูกกว่าที่ควรเป็น -> น่าซื้อเพิ่ม
ถ้า fair < ราคาปัจจุบัน แปลว่าแพงเกินความเสี่ยงที่แบก -> ควรลด

**ทำไมถึงใช้ค่าคาดหวัง (mean) ไม่ใช่ค่ากลาง (median)**
ตอนแรกโมดูลนี้ใช้ median เพราะกลัวหางขวาของ lognormal ดึงค่าเฉลี่ยให้สูงเกินจริง
แต่วิธีนั้นผิดหลัก เพราะ median ของ lognormal มีตัวหน่วง −σ²/2 ติดมาอยู่แล้ว
ซึ่งเป็นการหักความเสี่ยงรอบหนึ่ง พอเอามาคิดลดด้วย required_return ที่เป็นการหัก
ความเสี่ยงอีกรอบ เท่ากับ **ลงโทษความผันผวนซ้ำสองครั้ง** ผลคือเหรียญผันผวนสูง
จะออกมา "แพงกว่ามูลค่า" เสมอไม่ว่าพื้นฐานจะเป็นอย่างไร ระบบจึงแทบไม่เคยแนะนำให้ซื้อ

หลัก CAPM ที่ถูกต้องคือคิดลด **ค่าคาดหวัง** ด้วยอัตราที่ปรับความเสี่ยงแล้ว
ตัวอัตราคิดลดจึงทำหน้าที่หักความเสี่ยงเพียงครั้งเดียว (ค่ากลางยังแสดงไว้เป็น
ตัวเลขอ้างอิงแบบอนุรักษ์นิยมในชื่อ conservative_price)

**ขนาดการถือครอง** ใช้ Kelly Criterion แบบเศษส่วน ซึ่งเป็นสูตรมาตรฐานของการกำหนด
ขนาดเดิมพันเมื่อรู้โอกาสชนะและอัตราจ่าย

    f* = (p·b − q) / b     โดย p = โอกาสขึ้น, q = 1−p, b = อัตราได้ต่อเสีย

Kelly เต็มสูตรก้าวร้าวเกินไปสำหรับสินทรัพย์ผันผวนสูง จึงใช้เพียงเศษหนึ่งส่วน
(ค่าเริ่มต้น 25%) และมีเพดานกำกับอีกชั้น
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from core.ai_advisor import Advice
from core.forecast import Forecast
from core.risk import RiskProfile

# ระดับความกว้างของโซนราคา คิดเป็นจำนวนเท่าของส่วนเบี่ยงเบนมาตรฐานในกรอบพยากรณ์
ZONE_INNER_SIGMA = 0.35  # ขอบเขต "ถือ"
ZONE_OUTER_SIGMA = 1.00  # ขอบเขต "ทยอยซื้อ/ทยอยขาย"

ZONE_ORDER = ["ซื้อเพิ่มหนัก", "ทยอยซื้อ", "ถือ", "ทยอยขาย", "ขายออก"]


@dataclass(frozen=True)
class FairValue:
    """มูลค่าเหมาะสมของเหรียญหนึ่งตัว ณ วันนี้"""

    symbol: str
    spot: float
    fair_price: float  # ค่าคาดหวังคิดลดแล้ว — ตัวเลขหลักที่ใช้ตัดสินใจ
    conservative_price: float  # ค่ากลางคิดลดแล้ว (ต่ำกว่าเสมอเมื่อผันผวนสูง)
    optimistic_price: float  # กรณีดี (percentile 75 คิดลดแล้ว)
    pessimistic_price: float  # กรณีแย่ (percentile 25 คิดลดแล้ว)
    required_return: float
    horizon_days: int

    @property
    def gap(self) -> float:
        """ราคาปัจจุบันถูก/แพงกว่ามูลค่าเหมาะสมกี่ % (บวก = ถูกกว่าที่ควร)"""
        return self.fair_price / self.spot - 1.0 if self.spot > 0 else 0.0

    @property
    def verdict(self) -> str:
        gap = self.gap
        if gap >= 0.25:
            return "ถูกกว่ามูลค่ามาก"
        if gap >= 0.08:
            return "ถูกกว่ามูลค่า"
        if gap > -0.08:
            return "ใกล้เคียงมูลค่า"
        if gap > -0.25:
            return "แพงกว่ามูลค่า"
        return "แพงกว่ามูลค่ามาก"

    @property
    def is_undervalued(self) -> bool:
        return self.gap > 0.08


@dataclass(frozen=True)
class PriceZones:
    """บันไดราคา: ที่ระดับราคาไหนควรทำอะไร"""

    symbol: str
    spot: float
    fair_price: float
    strong_buy_below: float
    accumulate_below: float
    trim_above: float
    exit_above: float

    def zone_of(self, price: float) -> str:
        """ราคานี้ตกอยู่ในโซนไหน"""
        if price < self.strong_buy_below:
            return "ซื้อเพิ่มหนัก"
        if price < self.accumulate_below:
            return "ทยอยซื้อ"
        if price <= self.trim_above:
            return "ถือ"
        if price <= self.exit_above:
            return "ทยอยขาย"
        return "ขายออก"

    @property
    def current_zone(self) -> str:
        return self.zone_of(self.spot)

    def as_rows(self) -> list[dict]:
        """ตารางบันไดราคาสำหรับแสดงบนหน้าเว็บ (เรียงจากถูกไปแพง)"""
        return [
            {"โซน": "ซื้อเพิ่มหนัก", "ช่วงราคา": f"ต่ำกว่า {self.strong_buy_below:.8g}",
             "ควรทำ": "ของถูกผิดปกติเทียบมูลค่า — เพิ่มน้ำหนักได้เต็มที่ตามเพดาน"},
            {"โซน": "ทยอยซื้อ",
             "ช่วงราคา": f"{self.strong_buy_below:.8g} – {self.accumulate_below:.8g}",
             "ควรทำ": "ต่ำกว่ามูลค่าพอควร — แบ่งไม้เข้าซื้อ"},
            {"โซน": "ถือ",
             "ช่วงราคา": f"{self.accumulate_below:.8g} – {self.trim_above:.8g}",
             "ควรทำ": "ราคาใกล้มูลค่าเหมาะสม — คงน้ำหนักเดิม"},
            {"โซน": "ทยอยขาย",
             "ช่วงราคา": f"{self.trim_above:.8g} – {self.exit_above:.8g}",
             "ควรทำ": "เริ่มแพงกว่ามูลค่า — ทยอยลดน้ำหนัก ล็อกกำไรบางส่วน"},
            {"โซน": "ขายออก", "ช่วงราคา": f"สูงกว่า {self.exit_above:.8g}",
             "ควรทำ": "แพงเกินความเสี่ยงที่แบก — ปิดสถานะ"},
        ]


@dataclass(frozen=True)
class PositionPlan:
    """แผนปฏิบัติของเหรียญหนึ่งตัว: ถืออยู่เท่าไหร่ ควรถือเท่าไหร่ ต้องทำอะไร"""

    symbol: str
    spot: float
    current_qty: float
    current_value: float
    current_weight: float
    target_weight: float
    target_value: float
    kelly_weight: float  # น้ำหนักดิบจาก Kelly ก่อนผสมกับคะแนน AI
    fair: FairValue
    zones: PriceZones
    action: str  # ซื้อเพิ่ม / เปิดสถานะใหม่ / ถือ / ลดบางส่วน / ขายทั้งหมด
    rationale: list[str] = field(default_factory=list)

    @property
    def delta_value(self) -> float:
        """ต้องซื้อเพิ่ม (บวก) หรือขายออก (ลบ) กี่ดอลลาร์"""
        return self.target_value - self.current_value

    @property
    def delta_qty(self) -> float:
        return self.delta_value / self.spot if self.spot > 0 else 0.0

    @property
    def is_buy(self) -> bool:
        return self.delta_value > 0

    @property
    def is_sell(self) -> bool:
        return self.delta_value < 0

    @property
    def unrealized_pnl_pct(self) -> float:
        return 0.0  # กำไรขาดทุนมาจากอ็อบเจกต์ Portfolio ไม่ใช่แผนนี้

    @property
    def icon(self) -> str:
        return {"ซื้อเพิ่ม": "🟢", "เปิดสถานะใหม่": "🟢", "ถือ": "🟡",
                "ลดบางส่วน": "🟠", "ขายทั้งหมด": "🔴"}.get(self.action, "⚪")


# --------------------------------------------------------------------------
# 1) มูลค่าเหมาะสม
# --------------------------------------------------------------------------

def fair_value(forecast: Forecast, required_return: float) -> FairValue:
    """คิดลดราคาพยากรณ์กลับมาเป็นมูลค่าที่ควรเป็นวันนี้"""
    horizon_years = max(forecast.horizon_days / 365.0, 1e-9)
    discount = (1.0 + max(required_return, -0.99)) ** horizon_years

    return FairValue(
        symbol=forecast.symbol,
        spot=forecast.spot,
        fair_price=forecast.expected_price / discount,
        conservative_price=forecast.median_price / discount,
        optimistic_price=forecast.p75 / discount,
        pessimistic_price=forecast.p25 / discount,
        required_return=required_return,
        horizon_days=forecast.horizon_days,
    )


def price_zones(fair: FairValue, annual_volatility: float) -> PriceZones:
    """สร้างบันไดราคาโดยให้ความกว้างของโซนแปรตามความผันผวนของเหรียญนั้น

    เหรียญที่เหวี่ยงแรงต้องมีโซน "ถือ" กว้างกว่า ไม่งั้นจะสั่งซื้อ-ขายทุกวัน
    """
    horizon_years = max(fair.horizon_days / 365.0, 1e-9)
    sigma = max(annual_volatility, 0.05) * np.sqrt(horizon_years)
    # กันไม่ให้โซนกว้างจนราคาติดลบเมื่อความผันผวนสูงมาก
    sigma = float(np.clip(sigma, 0.02, 0.80))

    fair_price = fair.fair_price
    return PriceZones(
        symbol=fair.symbol,
        spot=fair.spot,
        fair_price=fair_price,
        strong_buy_below=fair_price * (1.0 - ZONE_OUTER_SIGMA * sigma),
        accumulate_below=fair_price * (1.0 - ZONE_INNER_SIGMA * sigma),
        trim_above=fair_price * (1.0 + ZONE_INNER_SIGMA * sigma),
        exit_above=fair_price * (1.0 + ZONE_OUTER_SIGMA * sigma),
    )


# --------------------------------------------------------------------------
# 2) ขนาดการถือครองที่เหมาะสม
# --------------------------------------------------------------------------

def kelly_fraction(prob_up: float, reward_to_risk: float,
                   fraction: float = 0.25, cap: float = 0.25) -> float:
    """สัดส่วนเงินที่ควรลงตาม Kelly แบบเศษส่วน

    f* = (p·b − q) / b   แล้วคูณด้วย fraction เพื่อลดความก้าวร้าว
    คืน 0 เมื่อไม่มีความได้เปรียบ (ไม่แนะนำให้ลงเงินเลย)
    """
    b = reward_to_risk
    if b <= 0:
        return 0.0

    p = float(np.clip(prob_up, 0.0, 1.0))
    q = 1.0 - p
    edge = (p * b - q) / b

    if edge <= 0:
        return 0.0
    return float(np.clip(edge * fraction, 0.0, cap))


def target_weight(advice: Advice, forecast: Forecast, profile: RiskProfile,
                  fair: FairValue, max_weight: float = 0.25,
                  kelly_fraction_used: float = 0.25) -> tuple[float, float]:
    """น้ำหนักเป้าหมายของเหรียญนี้ในพอร์ต คืน (น้ำหนักสุดท้าย, น้ำหนักดิบจาก Kelly)

    ผสม 3 อย่างเข้าด้วยกัน
      * Kelly    — ขนาดที่เหมาะกับโอกาสชนะและอัตราจ่าย
      * คะแนน AI — สัญญาณรวมจาก 7 ปัจจัย
      * ส่วนลด   — ราคาถูกกว่ามูลค่ายิ่งมาก ยิ่งกล้าถือเยอะขึ้น
    """
    kelly = kelly_fraction(forecast.prob_up, forecast.reward_to_risk,
                           fraction=kelly_fraction_used, cap=max_weight)

    if advice.score <= 0:
        return 0.0, kelly

    # ตัวคูณจากคะแนน AI: คะแนน 0 -> 0 เท่า, คะแนน 0.5 ขึ้นไป -> 1 เท่า
    score_multiplier = float(np.clip(advice.score / 0.5, 0.0, 1.0))

    # ตัวคูณจากส่วนลดมูลค่า: แพงกว่ามูลค่า 25% -> 0.5 เท่า, ถูกกว่า 25% -> 1.5 เท่า
    valuation_multiplier = float(np.clip(1.0 + fair.gap * 2.0, 0.4, 1.6))

    weight = kelly * score_multiplier * valuation_multiplier

    # เหรียญผันผวนสูงมากต้องถูกกดขนาดลงอีกชั้น
    if profile.volatility > 1.5:
        weight *= float(np.clip(1.5 / profile.volatility, 0.4, 1.0))

    return float(np.clip(weight, 0.0, max_weight)), kelly


# --------------------------------------------------------------------------
# 3) แผนปฏิบัติรายเหรียญ
# --------------------------------------------------------------------------

def _classify_action(current_weight: float, target: float, zone: str,
                     threshold: float) -> str:
    gap = target - current_weight

    if target <= 1e-6 and current_weight > 1e-6:
        return "ขายทั้งหมด"
    if abs(gap) < threshold:
        return "ถือ"
    if gap > 0:
        return "เปิดสถานะใหม่" if current_weight <= 1e-6 else "ซื้อเพิ่ม"
    return "ลดบางส่วน"


def _plan_rationale(fair: FairValue, zones: PriceZones, advice: Advice,
                    forecast: Forecast, kelly: float, action: str) -> list[str]:
    lines = [
        f"มูลค่าเหมาะสมประเมินได้ {fair.fair_price:.8g} เทียบราคาตลาด {fair.spot:.8g} "
        f"— {fair.verdict} ({fair.gap * 100:+.1f}%)",
        f"ราคาปัจจุบันอยู่ในโซน **{zones.current_zone}** ของบันไดราคา",
        f"Kelly แนะนำขนาดไม้ {kelly * 100:.1f}% ของพอร์ต "
        f"(โอกาสขึ้น {forecast.prob_up * 100:.0f}%, ได้ต่อเสีย {forecast.reward_to_risk:.2f} เท่า)",
    ]

    if advice.score <= 0:
        lines.append(
            f"คะแนน AI ติดลบ ({advice.score:+.2f}) จึงกดน้ำหนักเป้าหมายเหลือศูนย์ "
            "ไม่ว่ามูลค่าจะดูถูกแค่ไหน"
        )
    if fair.gap > 0.25 and action in ("ซื้อเพิ่ม", "เปิดสถานะใหม่"):
        lines.append("ส่วนลดจากมูลค่ากว้างผิดปกติ — ตรวจสอบด้วยว่ามีข่าวร้ายเฉพาะตัวหรือไม่")
    if forecast.reward_to_risk < 1.0:
        lines.append(
            f"อัตราได้/เสียต่ำกว่า 1 ({forecast.reward_to_risk:.2f}) — ฝั่งเสียกว้างกว่าฝั่งได้"
        )
    return lines


def build_position_plan(symbol: str, spot: float, current_qty: float, equity: float,
                        advice: Advice, forecast: Forecast, profile: RiskProfile,
                        required_return: float, max_weight: float = 0.25,
                        rebalance_threshold: float = 0.02,
                        kelly_fraction_used: float = 0.25) -> PositionPlan:
    """สร้างแผนปฏิบัติของเหรียญหนึ่งตัว"""
    fair = fair_value(forecast, required_return)
    zones = price_zones(fair, profile.volatility)

    current_value = current_qty * spot
    current_weight = current_value / equity if equity > 0 else 0.0

    weight, kelly = target_weight(advice, forecast, profile, fair,
                                  max_weight, kelly_fraction_used)
    action = _classify_action(current_weight, weight, zones.current_zone, rebalance_threshold)

    return PositionPlan(
        symbol=symbol,
        spot=spot,
        current_qty=current_qty,
        current_value=current_value,
        current_weight=current_weight,
        target_weight=weight,
        target_value=weight * equity,
        kelly_weight=kelly,
        fair=fair,
        zones=zones,
        action=action,
        rationale=_plan_rationale(fair, zones, advice, forecast, kelly, action),
    )


def scale_to_budget(weights: dict[str, float], budget: float,
                    max_weight: float) -> dict[str, float]:
    """ขยาย/ย่อน้ำหนักทั้งชุดให้ผลรวมเท่ากับสัดส่วนที่ต้องการลงทุน

    เหตุผล: Kelly แบบเศษส่วนให้ตัวเลขที่เล็กมากเมื่อความได้เปรียบน้อย ถ้าใช้ค่าดิบ
    ระบบจะสั่งถือเงินสดเกือบทั้งพอร์ตตลอดเวลา จนใช้งานจริงไม่ได้

    วิธีที่ถูกต้องกว่าคือแยกสองเรื่องออกจากกัน
      * Kelly กำหนด **สัดส่วนเปรียบเทียบ** ว่าเหรียญไหนควรได้น้ำหนักมากกว่ากัน
      * budget กำหนด **ระดับความเสี่ยงรวม** ที่ผู้ใช้ยอมรับได้

    ถ้าไม่มีเหรียญไหนได้น้ำหนักบวกเลย (โมเดลไม่เห็นความได้เปรียบ) จะไม่ขยายอะไร
    ทั้งสิ้น — พอร์ตถือเงินสดตามที่ควรเป็น
    """
    positive = {s: w for s, w in weights.items() if w > 0}
    total = sum(positive.values())
    if total <= 0 or budget <= 0:
        return {s: 0.0 for s in weights}

    scaled = {s: 0.0 for s in weights}
    remaining_budget = budget
    remaining = dict(positive)

    # จัดสรรแบบวนซ้ำ เพราะตัวที่ชนเพดานต้องคืนส่วนเกินให้ตัวอื่น
    for _ in range(len(positive) + 1):
        if not remaining or remaining_budget <= 1e-12:
            break
        pool = sum(remaining.values())
        if pool <= 0:
            break

        capped_this_round = {}
        for symbol, raw in remaining.items():
            share = raw / pool * remaining_budget
            if share >= max_weight:
                capped_this_round[symbol] = max_weight

        if not capped_this_round:
            for symbol, raw in remaining.items():
                scaled[symbol] += raw / pool * remaining_budget
            break

        for symbol, value in capped_this_round.items():
            scaled[symbol] = value
            remaining_budget -= value
            remaining.pop(symbol)

    return scaled


def build_all_plans(analysis, portfolio, max_weight: float = 0.25,
                    rebalance_threshold: float = 0.02,
                    kelly_fraction_used: float = 0.25,
                    invested_budget: float | None = 0.70) -> list[PositionPlan]:
    """สร้างแผนของทุกเหรียญที่ติดตาม (ทั้งที่ถืออยู่และยังไม่ได้ถือ)

    invested_budget = สัดส่วนของพอร์ตที่ต้องการให้ลงทุนรวมกัน (ที่เหลือคือเงินสด)
    ตั้งเป็น None เพื่อใช้ค่าดิบจาก Kelly โดยไม่ปรับสเกล
    """
    spot_prices = analysis.spot_prices()
    equity = portfolio.equity(spot_prices)

    plans = []
    for symbol in analysis.symbols:
        position = portfolio.positions.get(symbol)
        plans.append(build_position_plan(
            symbol=symbol,
            spot=spot_prices[symbol],
            current_qty=position.quantity if position else 0.0,
            equity=equity,
            advice=analysis.advices[symbol],
            forecast=analysis.forecasts[symbol],
            profile=analysis.profiles[symbol],
            required_return=analysis.profiles[symbol].required_return,
            max_weight=max_weight,
            rebalance_threshold=rebalance_threshold,
            kelly_fraction_used=kelly_fraction_used,
        ))

    if invested_budget is not None:
        scaled = scale_to_budget({p.symbol: p.target_weight for p in plans},
                                 invested_budget, max_weight)
        plans = [_rescale_plan(p, scaled[p.symbol], equity, rebalance_threshold)
                 for p in plans]

    # เรียงให้รายการที่ต้องลงมือทำมากที่สุดอยู่บนสุด
    return sorted(plans, key=lambda p: abs(p.delta_value), reverse=True)


def _rescale_plan(plan: PositionPlan, weight: float, equity: float,
                  threshold: float) -> PositionPlan:
    """สร้างแผนใหม่ด้วยน้ำหนักเป้าหมายที่ปรับสเกลแล้ว"""
    from dataclasses import replace

    action = _classify_action(plan.current_weight, weight,
                              plan.zones.current_zone, threshold)
    return replace(plan, target_weight=weight, target_value=weight * equity,
                   action=action)


def plans_summary(plans: list[PositionPlan]) -> dict[str, float]:
    """สรุปยอดรวมของแผนทั้งหมด"""
    buys = [p for p in plans if p.is_buy and p.action != "ถือ"]
    sells = [p for p in plans if p.is_sell and p.action != "ถือ"]

    return {
        "buy_count": len(buys),
        "sell_count": len(sells),
        "hold_count": sum(1 for p in plans if p.action == "ถือ"),
        "buy_value": sum(p.delta_value for p in buys),
        "sell_value": abs(sum(p.delta_value for p in sells)),
        "net_cash_needed": sum(p.delta_value for p in plans if p.action != "ถือ"),
        "target_invested": sum(p.target_weight for p in plans),
        "undervalued_count": sum(1 for p in plans if p.fair.is_undervalued),
    }
