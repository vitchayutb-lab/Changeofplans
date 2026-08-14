"""AI Advisor: รวมสัญญาณหลายด้านเป็นคำแนะนำ "ซื้อ / ถือ / ขาย"

ระบบให้คะแนนแบบหลายปัจจัย (multi-factor scoring) แต่ละปัจจัยให้คะแนน -1 ถึง +1
แล้วถ่วงน้ำหนักรวมเป็นคะแนนเดียว จากนั้นแปลงเป็นสัญญาณและระดับความมั่นใจ

    score = Σ (weight_i × factor_i)      โดย Σ weight_i = 1

ข้อดีของวิธีนี้คืออธิบายได้ว่า "ทำไม AI ถึงแนะนำแบบนี้" ไม่ใช่กล่องดำ
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from core.data_sources import Quote
from core.forecast import Forecast
from core.indicators import distance_from_sma, latest, macd, momentum, rsi
from core.risk import RiskProfile


@dataclass(frozen=True)
class Factor:
    """ปัจจัยหนึ่งตัวที่ AI ใช้ตัดสินใจ"""

    key: str
    label: str
    score: float  # -1 (แย่มาก) ถึง +1 (ดีมาก)
    weight: float
    detail: str

    @property
    def contribution(self) -> float:
        return self.score * self.weight


# น้ำหนักของแต่ละปัจจัย รวมกันได้ 1.0
FACTOR_WEIGHTS: dict[str, float] = {
    "momentum": 0.20,
    "trend": 0.15,
    "mean_reversion": 0.10,
    "risk_adjusted": 0.22,
    "forecast": 0.18,
    "risk_penalty": 0.10,
    "liquidity": 0.05,
}

SIGNAL_ORDER = ["SELL", "REDUCE", "HOLD", "BUY", "STRONG BUY"]


@dataclass(frozen=True)
class Advice:
    """คำแนะนำของ AI สำหรับเหรียญหนึ่งตัว"""

    symbol: str
    signal: str  # STRONG BUY / BUY / HOLD / REDUCE / SELL
    score: float  # -1 ถึง +1
    confidence: float  # 0 ถึง 1
    factors: list[Factor]
    rationale: list[str]
    target_weight: float  # สัดส่วนที่ควรถือในพอร์ต (0-1)
    stop_loss_pct: float
    take_profit_pct: float

    @property
    def is_buy(self) -> bool:
        return self.signal in ("BUY", "STRONG BUY")

    @property
    def is_sell(self) -> bool:
        return self.signal in ("SELL", "REDUCE")

    @property
    def emoji(self) -> str:
        return {
            "STRONG BUY": "🟢",
            "BUY": "🟢",
            "HOLD": "🟡",
            "REDUCE": "🟠",
            "SELL": "🔴",
        }[self.signal]

    @property
    def action_text(self) -> str:
        return {
            "STRONG BUY": "เข้าซื้อ — อัปไซด์เด่นชัดเทียบความเสี่ยง",
            "BUY": "ทยอยเข้าซื้อ — สัญญาณบวกแต่ควรแบ่งไม้",
            "HOLD": "ถือไว้ก่อน — ยังไม่มีสัญญาณชัดพอให้ขยับ",
            "REDUCE": "ลดพอร์ตบางส่วน — ความเสี่ยงเริ่มมากกว่าผลตอบแทน",
            "SELL": "ขายออก — ความเสี่ยงสูงเกินผลตอบแทนที่คาดหวัง",
        }[self.signal]

    def factor_by_key(self, key: str) -> Factor | None:
        return next((f for f in self.factors if f.key == key), None)


def _squash(value: float, scale: float) -> float:
    """บีบค่าใด ๆ ให้อยู่ในช่วง -1 ถึง 1 อย่างนุ่มนวลด้วย tanh"""
    return float(np.tanh(value / scale)) if scale else 0.0


def _momentum_factor(prices) -> Factor:
    m7 = momentum(prices, 7)
    m30 = momentum(prices, 30)
    # ให้น้ำหนักโมเมนตัมระยะสั้นมากกว่า เพราะเหรียญมีมหมุนรอบเร็ว
    raw = 0.6 * _squash(m7, 0.18) + 0.4 * _squash(m30, 0.45)
    return Factor(
        key="momentum",
        label="โมเมนตัมราคา",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["momentum"],
        detail=f"7 วัน {m7 * 100:+.1f}% · 30 วัน {m30 * 100:+.1f}%",
    )


def _trend_factor(prices) -> Factor:
    gap = distance_from_sma(prices, 30)
    _, _, hist = macd(prices)
    hist_now = latest(hist)
    price_now = float(np.asarray(prices, dtype=float)[-1])
    hist_norm = hist_now / price_now if price_now else 0.0

    raw = 0.65 * _squash(gap, 0.22) + 0.35 * _squash(hist_norm, 0.02)
    position = "เหนือ" if gap >= 0 else "ใต้"
    return Factor(
        key="trend",
        label="แนวโน้ม (SMA30 + MACD)",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["trend"],
        detail=f"ราคาอยู่{position}เส้น SMA30 {abs(gap) * 100:.1f}% · MACD {'บวก' if hist_now >= 0 else 'ลบ'}",
    )


def _mean_reversion_factor(prices) -> Factor:
    rsi_now = latest(rsi(prices, 14))
    # RSI สูง = ซื้อมากไป ให้คะแนนลบ / RSI ต่ำ = ขายมากไป ให้คะแนนบวก
    raw = -_squash(rsi_now - 50.0, 22.0)
    if rsi_now >= 70:
        note = "เข้าเขตซื้อมากเกินไป เสี่ยงย่อตัว"
    elif rsi_now <= 30:
        note = "เข้าเขตขายมากเกินไป มีโอกาสเด้ง"
    else:
        note = "อยู่ในโซนปกติ"
    return Factor(
        key="mean_reversion",
        label="RSI / การกลับสู่ค่าเฉลี่ย",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["mean_reversion"],
        detail=f"RSI(14) = {rsi_now:.0f} · {note}",
    )


def _risk_adjusted_factor(profile: RiskProfile, forecast: Forecast) -> Factor:
    """หัวใจของการวิเคราะห์: อัปไซด์ที่คาดหวัง "ชนะ" ผลตอบแทนที่ความเสี่ยงเรียกร้องไหม"""
    # แปลงผลตอบแทนคาดหวังในกรอบพยากรณ์ให้เป็นอัตราต่อปีเพื่อเทียบกับ CAPM
    horizon_years = max(forecast.horizon_days / 365.0, 1e-6)
    expected_annual = forecast.expected_return / horizon_years
    excess = expected_annual - profile.required_return

    raw = _squash(excess, 0.55)
    verdict = "สูงกว่า" if excess >= 0 else "ต่ำกว่า"
    return Factor(
        key="risk_adjusted",
        label="ผลตอบแทนเทียบเกณฑ์ CAPM",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["risk_adjusted"],
        detail=(
            f"คาดหวัง {expected_annual * 100:+.0f}%/ปี {verdict}เกณฑ์ที่ β={profile.beta:.2f} "
            f"เรียกร้อง ({profile.required_return * 100:.0f}%/ปี)"
        ),
    )


def _forecast_factor(forecast: Forecast) -> Factor:
    # prob_up 0.5 = เป็นกลาง แปลงเป็นคะแนน -1..1 แล้วปรับด้วยอัตราส่วนได้/เสีย
    directional = _squash(forecast.prob_up - 0.5, 0.12)
    rr = forecast.reward_to_risk
    rr_score = _squash(rr - 1.0, 0.8) if rr > 0 else 0.0
    raw = 0.7 * directional + 0.3 * rr_score
    return Factor(
        key="forecast",
        label=f"พยากรณ์ {forecast.horizon_days} วัน (Monte Carlo)",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["forecast"],
        detail=(
            f"โอกาสราคาขึ้น {forecast.prob_up * 100:.0f}% · "
            f"อัปไซด์ {forecast.upside_potential * 100:+.0f}% / ดาวน์ไซด์ {forecast.downside_risk * 100:+.0f}%"
        ),
    )


def _risk_penalty_factor(profile: RiskProfile) -> Factor:
    """ยิ่ง β และความผันผวนสูง ยิ่งหักคะแนน — เหรียญมีมเสี่ยงพังเร็วกว่าที่คิด"""
    beta_penalty = _squash(max(abs(profile.beta) - 1.5, 0.0), 1.2)
    vol_penalty = _squash(max(profile.volatility - 1.0, 0.0), 0.9)
    dd_penalty = _squash(max(-profile.max_drawdown - 0.5, 0.0), 0.35)
    raw = -(0.4 * beta_penalty + 0.35 * vol_penalty + 0.25 * dd_penalty)
    return Factor(
        key="risk_penalty",
        label="โทษความเสี่ยง (β / ผันผวน / ย่อลึกสุด)",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["risk_penalty"],
        detail=(
            f"β {profile.beta:.2f} · ผันผวน {profile.volatility * 100:.0f}%/ปี · "
            f"ย่อลึกสุด {profile.max_drawdown * 100:.0f}%"
        ),
    )


def _liquidity_factor(quote: Quote) -> Factor:
    ratio = quote.volume_to_mcap
    # ปริมาณซื้อขาย 10% ของมาร์เก็ตแคปต่อวันถือว่าคึกคักมากสำหรับเหรียญมีม
    raw = _squash(ratio - 0.06, 0.10)
    return Factor(
        key="liquidity",
        label="สภาพคล่อง / ความสนใจตลาด",
        score=float(np.clip(raw, -1, 1)),
        weight=FACTOR_WEIGHTS["liquidity"],
        detail=f"ปริมาณซื้อขาย 24 ชม. = {ratio * 100:.1f}% ของมาร์เก็ตแคป",
    )


def _classify(score: float) -> str:
    if score >= 0.35:
        return "STRONG BUY"
    if score >= 0.12:
        return "BUY"
    if score > -0.12:
        return "HOLD"
    if score > -0.35:
        return "REDUCE"
    return "SELL"


def _confidence(score: float, factors: list[Factor], profile: RiskProfile) -> float:
    """ความมั่นใจ = ความแรงของสัญญาณ × ความสอดคล้องของปัจจัย × ความน่าเชื่อถือของโมเดล"""
    strength = min(abs(score) / 0.45, 1.0)

    # ปัจจัยชี้ไปทางเดียวกันมากแค่ไหน (ไม่นับปัจจัยที่เป็นกลาง)
    directional = [f.score for f in factors if abs(f.score) > 0.05]
    if directional:
        same_sign = sum(1 for s in directional if np.sign(s) == np.sign(score))
        agreement = same_sign / len(directional)
    else:
        agreement = 0.5

    # R² ต่ำ = β อธิบายพฤติกรรมราคาได้น้อย ความมั่นใจควรลด
    reliability = 0.5 + 0.5 * min(profile.r_squared * 2.0, 1.0)

    return float(np.clip(0.45 * strength + 0.35 * agreement + 0.20 * reliability, 0.0, 1.0))


def _build_rationale(symbol: str, signal: str, factors: list[Factor],
                     profile: RiskProfile, forecast: Forecast) -> list[str]:
    """เรียงเหตุผลตามน้ำหนักที่มีผลต่อการตัดสินใจจริง"""
    ranked = sorted(factors, key=lambda f: abs(f.contribution), reverse=True)
    lines = [f"{'✅' if f.score >= 0 else '⚠️'} **{f.label}** — {f.detail}" for f in ranked[:4]]

    if profile.r_squared < 0.25:
        lines.append(
            f"ℹ️ R² = {profile.r_squared:.2f} ต่ำ แปลว่าราคา {symbol} ขยับตามปัจจัยเฉพาะตัวมากกว่าตลาด "
            "ค่า β จึงใช้เป็นเกณฑ์อ้างอิงได้จำกัด"
        )
    if abs(profile.beta) > 2.0:
        lines.append(
            f"⚠️ β = {profile.beta:.2f} หมายความว่าถ้าตลาดรวมลง 10% เหรียญนี้มีแนวโน้มลงราว "
            f"{abs(profile.beta) * 10:.0f}%"
        )
    if signal in ("BUY", "STRONG BUY") and forecast.reward_to_risk < 1.2:
        lines.append("⚠️ แม้สัญญาณเป็นบวก แต่อัตราส่วนได้/เสียยังไม่กว้าง ควรคุมขนาดไม้ให้เล็ก")
    return lines


def _target_weight(score: float, profile: RiskProfile, max_weight: float = 0.35) -> float:
    """น้ำหนักที่ควรถือ: แปรผันตามคะแนน แต่หารด้วยความผันผวน (risk parity แบบง่าย)"""
    if score <= 0:
        return 0.0
    vol = max(profile.volatility, 0.3)
    raw = (score / vol) * 0.6
    return float(np.clip(raw, 0.0, max_weight))


def evaluate_coin(symbol: str, prices, quote: Quote, profile: RiskProfile,
                  forecast: Forecast) -> Advice:
    """ประเมินเหรียญหนึ่งตัวแบบครบทุกปัจจัย"""
    factors = [
        _momentum_factor(prices),
        _trend_factor(prices),
        _mean_reversion_factor(prices),
        _risk_adjusted_factor(profile, forecast),
        _forecast_factor(forecast),
        _risk_penalty_factor(profile),
        _liquidity_factor(quote),
    ]

    score = float(np.clip(sum(f.contribution for f in factors), -1.0, 1.0))
    signal = _classify(score)
    confidence = _confidence(score, factors, profile)

    # ยิ่งผันผวนมาก ยิ่งต้องวาง stop ห่างขึ้น ไม่งั้นโดนสะบัดออกก่อน
    daily_vol = profile.volatility / np.sqrt(365.0)
    stop_loss = float(np.clip(daily_vol * 3.5, 0.06, 0.30))
    take_profit = float(np.clip(stop_loss * 2.2, 0.12, 0.70))

    return Advice(
        symbol=symbol,
        signal=signal,
        score=score,
        confidence=confidence,
        factors=factors,
        rationale=_build_rationale(symbol, signal, factors, profile, forecast),
        target_weight=_target_weight(score, profile),
        stop_loss_pct=stop_loss,
        take_profit_pct=take_profit,
    )


# --------------------------------------------------------------------------
# คำแนะนำระดับพอร์ต
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class PortfolioAdvice:
    """สรุปสุขภาพพอร์ตและสิ่งที่ควรทำต่อ"""

    portfolio_beta: float
    target_beta: float
    verdict: str
    headline: str
    warnings: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)

    @property
    def beta_gap(self) -> float:
        return self.portfolio_beta - self.target_beta


def evaluate_portfolio(portfolio_beta_value: float, target_beta: float,
                       weights: dict[str, float], contributions: dict[str, float],
                       advices: dict[str, Advice], diversification: float,
                       portfolio_vol: float) -> PortfolioAdvice:
    """ตีความค่า β ของพอร์ตและออกคำแนะนำเชิงปฏิบัติ"""
    gap = portfolio_beta_value - target_beta
    warnings: list[str] = []
    suggestions: list[str] = []

    if gap > 0.35:
        verdict = "เสี่ยงเกินเป้าหมาย"
        headline = (
            f"พอร์ตมี β = {portfolio_beta_value:.2f} สูงกว่าเป้าหมาย {target_beta:.2f} "
            f"อยู่ {gap:+.2f} — เวลาตลาดย่อ พอร์ตจะย่อแรงกว่าที่รับได้"
        )
    elif gap < -0.35:
        verdict = "อนุรักษ์นิยมเกินเป้าหมาย"
        headline = (
            f"พอร์ตมี β = {portfolio_beta_value:.2f} ต่ำกว่าเป้าหมาย {target_beta:.2f} "
            f"อยู่ {gap:+.2f} — ถ้าตลาดวิ่ง พอร์ตจะตามไม่ทัน"
        )
    else:
        verdict = "สมดุลตามเป้าหมาย"
        headline = (
            f"พอร์ตมี β = {portfolio_beta_value:.2f} ใกล้เป้าหมาย {target_beta:.2f} "
            "ระดับความเสี่ยงเชิงระบบอยู่ในกรอบที่ตั้งไว้"
        )

    # ตัวการที่ดัน β มากที่สุด
    if contributions:
        top = sorted(contributions.items(), key=lambda kv: abs(kv[1]), reverse=True)[:2]
        for symbol, contribution in top:
            share = contribution / portfolio_beta_value if portfolio_beta_value else 0.0
            suggestions.append(
                f"**{symbol}** ดัน β ของพอร์ต {contribution:+.2f} "
                f"(คิดเป็น {share * 100:.0f}% ของความเสี่ยงเชิงระบบทั้งพอร์ต)"
            )

    if gap > 0.35:
        sell_candidates = [s for s, a in advices.items() if a.is_sell and weights.get(s, 0) > 0]
        if sell_candidates:
            suggestions.append(
                "ลดน้ำหนัก " + ", ".join(f"**{s}**" for s in sell_candidates) +
                " ก่อน เพราะ AI ให้สัญญาณลบอยู่แล้ว จะลดทั้ง β และความเสี่ยงเฉพาะตัวพร้อมกัน"
            )
        else:
            suggestions.append("เพิ่มสัดส่วนเงินสด (stablecoin) เพื่อดึง β ของพอร์ตลงโดยไม่ต้องขายตัวที่ยังดี")

    if diversification < 40:
        warnings.append(
            f"คะแนนกระจายความเสี่ยง {diversification:.0f}/100 ต่ำ — เหรียญมีมมักวิ่งไปทางเดียวกัน "
            "การถือหลายตัวจึงไม่ได้ลดความเสี่ยงอย่างที่คิด"
        )
    if portfolio_vol > 1.2:
        warnings.append(
            f"ความผันผวนพอร์ต {portfolio_vol * 100:.0f}%/ปี สูงมาก — ควรกำหนดวงเงินขาดทุนต่อวันไว้ล่วงหน้า"
        )
    concentrated = [s for s, w in weights.items() if w > 0.4]
    for symbol in concentrated:
        warnings.append(f"น้ำหนัก **{symbol}** เกิน 40% ของพอร์ต ความเสี่ยงกระจุกตัวสูง")

    return PortfolioAdvice(
        portfolio_beta=portfolio_beta_value,
        target_beta=target_beta,
        verdict=verdict,
        headline=headline,
        warnings=warnings,
        suggestions=suggestions,
    )
