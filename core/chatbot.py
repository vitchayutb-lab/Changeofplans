"""แชตบอทที่ตอบเรื่องกระแสมีมและพอร์ต โดยอ้างอิงข้อมูลที่ระบบคำนวณจริง

หลักการสำคัญ: **บอทห้ามแต่งตัวเลขเอง**
ทุกคำตอบต้องมาจาก ``ChatContext`` ซึ่งรวบรวมข้อมูลจริงจากทั้งระบบไว้แล้ว
(ราคา, β, พยากรณ์, มูลค่าเหมาะสม, กระแสโซเชียล, สถานะพอร์ต)

มีสองเส้นทางการตอบ
------------------
1. **เส้นทางกฎ (ค่าเริ่มต้น)** – จับใจความคำถามแล้วประกอบคำตอบจากข้อมูลจริง
   ทำงานได้ทันทีโดยไม่ต้องมี API key และให้ผลเหมือนเดิมทุกครั้ง ทดสอบได้
2. **เส้นทาง Claude** – เมื่อมี ANTHROPIC_API_KEY จะส่ง "สรุปข้อเท็จจริง" ชุดเดียวกัน
   ให้โมเดลเรียบเรียง โมเดลทำหน้าที่เรียบเรียงและให้เหตุผล ไม่ใช่แหล่งข้อเท็จจริง

ถ้าเรียก API ไม่สำเร็จ ระบบจะถอยกลับไปใช้เส้นทางกฎเสมอ ไม่ทำให้หน้าเว็บพัง
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from core.social import SocialPulse, SocialSignal

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """คุณคือผู้ช่วยวิเคราะห์เหรียญมีมในเว็บสาธิตเพื่อการศึกษา

กติกาที่ห้ามละเมิด
1. ตอบโดยอ้างอิง "ข้อเท็จจริงจากระบบ" ที่แนบมาเท่านั้น ห้ามสร้างตัวเลขขึ้นเอง
   ถ้าข้อมูลที่ต้องใช้ไม่มีในสิ่งที่แนบมา ให้บอกตรง ๆ ว่าระบบไม่มีข้อมูลนั้น
2. ห้ามอ้างว่ารู้ราคาหรือเหตุการณ์ล่าสุดนอกเหนือจากที่แนบมา
3. ย้ำเสมอว่านี่เป็นระบบจำลองเพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน
   เมื่อผู้ใช้ถามว่าควรซื้อหรือขาย
4. ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ใช้ตัวเลขจริงประกอบเสมอ
5. ถ้าข้อมูลกระแสโซเชียลเป็นข้อมูลจำลอง ต้องบอกผู้ใช้ให้ชัด อย่าพูดเหมือนเป็นของจริง

รูปแบบคำตอบ: ย่อหน้าสั้น ๆ หรือหัวข้อย่อยไม่เกิน 5 บรรทัด ไม่ต้องทักทายยืดยาว"""


@dataclass
class ChatContext:
    """ข้อเท็จจริงทั้งหมดที่บอทได้รับอนุญาตให้ใช้ตอบ"""

    analysis: object              # core.analytics.Analysis
    pulse: SocialPulse
    portfolio: object | None = None
    plans: list = field(default_factory=list)   # core.valuation.PositionPlan

    @property
    def symbols(self) -> list[str]:
        return list(self.analysis.symbols)

    def signal(self, symbol: str) -> SocialSignal | None:
        return self.pulse.signals.get(symbol)

    def plan(self, symbol: str):
        return next((p for p in self.plans if p.symbol == symbol), None)


def detect_symbol(question: str, symbols: list[str]) -> str | None:
    """หาว่าผู้ใช้ถามถึงเหรียญไหน — จับทั้งตัวย่อและชื่อเต็ม"""
    from core.config import COIN_NAMES

    upper = question.upper()
    for symbol in symbols:
        if re.search(rf"\b{re.escape(symbol)}\b", upper):
            return symbol

    # ชื่อเต็มต้องเทียบแบบขอบเขตคำด้วย ไม่งั้น "dogecoin" จะไปแมตช์ใน "dogecoinmaxi"
    lowered = question.lower()
    for symbol in symbols:
        name = COIN_NAMES.get(symbol, "")
        if name and re.search(rf"(?<!\w){re.escape(name.lower())}(?!\w)", lowered):
            return symbol
    return None


def detect_intent(question: str) -> str:
    """จับใจความว่าผู้ใช้อยากรู้อะไร"""
    q = question.lower()

    def has(*words: str) -> bool:
        return any(w in q for w in words)

    # พอร์ตต้องมาก่อนความเสี่ยง ไม่งั้น "พอร์ตฉันเสี่ยงไปไหม" จะถูกตอบเป็น
    # ความเสี่ยงรายเหรียญ ทั้งที่ผู้ใช้ถามถึงพอร์ตของตัวเอง
    if has("พอร์ต", "portfolio", "ของฉัน", "ที่ถือ"):
        return "portfolio"
    if has("กระแส", "buzz", "trend", "เทรนด์", "ฮิต", "ดัง", "โซเชียล", "social", "hype", "พูดถึง"):
        return "buzz"
    if has("ซื้อ", "ขาย", "ถือ", "buy", "sell", "hold", "ควรทำ", "แนะนำ"):
        return "action"
    if has("เสี่ยง", "beta", "บีต้า", "risk", "ผันผวน", "volatil"):
        return "risk"
    if has("มูลค่า", "แพง", "ถูก", "fair", "value", "ประเมิน"):
        return "valuation"
    if has("ราคา", "price", "เท่าไห", "เท่าไร"):
        return "price"
    if has("เทียบ", "compare", "ดีกว่า", "ตัวไหน", "อันไหน"):
        return "compare"
    return "overview"


# --------------------------------------------------------------------------
# สรุปข้อเท็จจริงเป็นข้อความ (ใช้ทั้งเส้นทางกฎและส่งให้ Claude)
# --------------------------------------------------------------------------

def _coin_facts(context: ChatContext, symbol: str) -> str:
    quote = context.analysis.quotes[symbol]
    profile = context.analysis.profiles[symbol]
    forecast = context.analysis.forecasts[symbol]
    advice = context.analysis.advices[symbol]
    signal = context.signal(symbol)
    plan = context.plan(symbol)

    lines = [
        f"[{symbol} — {quote.name}]",
        f"ราคา {quote.price:.8g} USD · 24 ชม. {quote.pct_change_24h:+.2f}% · "
        f"7 วัน {quote.pct_change_7d:+.2f}%",
        f"มาร์เก็ตแคป {quote.market_cap:,.0f} · ปริมาณซื้อขาย 24 ชม. {quote.volume_24h:,.0f}",
        f"Beta {profile.beta:.2f} (ความเสี่ยง{profile.risk_grade}) · R² {profile.r_squared:.2f} · "
        f"ผันผวน {profile.volatility * 100:.0f}%/ปี",
        f"VaR 95% ราย 1 วัน {profile.var_95 * 100:.1f}% · ย่อลึกสุด {profile.max_drawdown * 100:.0f}%",
        f"พยากรณ์ {forecast.horizon_days} วัน: โอกาสขึ้น {forecast.prob_up * 100:.0f}% · "
        f"อัปไซด์ {forecast.upside_potential * 100:+.0f}% · ดาวน์ไซด์ {forecast.downside_risk * 100:+.0f}%",
        f"คะแนน AI {advice.score:+.2f} · สัญญาณ {advice.signal} · "
        f"ความมั่นใจ {advice.confidence * 100:.0f}%",
    ]

    if plan:
        lines.append(
            f"มูลค่าเหมาะสม {plan.fair.fair_price:.8g} ({plan.fair.verdict}, "
            f"ส่วนต่าง {plan.fair.gap * 100:+.1f}%) · โซนราคา {plan.zones.current_zone} · "
            f"ถืออยู่ {plan.current_weight * 100:.1f}% ควรถือ {plan.target_weight * 100:.1f}% "
            f"({plan.action})"
        )

    if signal:
        lines.append(
            f"กระแสโซเชียล: คะแนน {signal.buzz_score:.0f}/100 · {signal.trend} · "
            f"ถูกพูดถึง {signal.mentions_24h} ครั้งใน 24 ชม. ({signal.mention_change * 100:+.0f}%) · "
            f"อารมณ์ {signal.sentiment:+.2f} ({signal.mood})"
        )
        if signal.search_rank:
            lines.append(f"ติดอันดับค้นหายอดนิยมอันดับ {signal.search_rank}")
        if signal.posts:
            sample = " | ".join(p.title[:80] for p in signal.posts[:3])
            lines.append(f"ตัวอย่างหัวข้อที่คนพูดถึง: {sample}")

    return "\n".join(lines)


def build_context_brief(context: ChatContext, focus: str | None = None) -> str:
    """สรุปข้อเท็จจริงทั้งหมดเป็นข้อความเดียว"""
    from core.analytics import market_regime

    regime = market_regime(context.analysis)
    pulse = context.pulse

    header = [
        "=== ข้อเท็จจริงจากระบบ ===",
        f"แหล่งราคา: {'จริงจาก CoinMarketCap' if context.analysis.market.source == 'live' else 'ข้อมูลจำลอง'}",
        f"แหล่งกระแสโซเชียล: {'ข้อมูลจริง' if pulse.source == 'live' else ('ผสม' if pulse.source == 'mixed' else 'ข้อมูลจำลอง')}",
        f"สภาพตลาดรวม: {regime['regime']} (30 วัน {float(regime['change_30d']) * 100:+.1f}%)",
        f"ดัชนีกระแสมีม: {pulse.hype_index:.0f}/100 ({pulse.market_mood})",
    ]

    hottest = pulse.hottest()
    if hottest:
        header.append(
            f"เหรียญที่กระแสแรงสุดตอนนี้: {hottest.symbol} "
            f"(คะแนน {hottest.buzz_score:.0f}, {hottest.trend})"
        )

    if context.portfolio is not None:
        spot = context.analysis.spot_prices()
        equity = context.portfolio.equity(spot)
        weights = context.portfolio.weights(spot)
        from core.risk import portfolio_beta

        header.append(
            f"พอร์ตผู้ใช้: มูลค่า {equity:,.0f} USD · เงินสด {context.portfolio.cash:,.0f} · "
            f"β พอร์ต {portfolio_beta(weights, context.analysis.betas()):.2f} · "
            f"ถืออยู่ {len(context.portfolio.open_positions())} เหรียญ"
        )

    body = [_coin_facts(context, focus)] if focus else [
        _coin_facts(context, s) for s in context.symbols
    ]
    return "\n".join(header) + "\n\n" + "\n\n".join(body)


# --------------------------------------------------------------------------
# เส้นทางกฎ
# --------------------------------------------------------------------------

def _answer_buzz(context: ChatContext, symbol: str | None) -> str:
    pulse = context.pulse
    caveat = ("\n\n_หมายเหตุ: กระแสโซเชียลชุดนี้เป็นข้อมูลจำลอง_"
              if pulse.source == "simulated" else "")

    if symbol:
        signal = context.signal(symbol)
        if not signal:
            return f"ระบบไม่มีข้อมูลกระแสของ {symbol}"
        lines = [
            f"**{symbol} — {signal.trend}** (คะแนนกระแส {signal.buzz_score:.0f}/100)",
            f"- ถูกพูดถึง {signal.mentions_24h} ครั้งใน 24 ชม. "
            f"เปลี่ยนแปลง {signal.mention_change * 100:+.0f}% จากวันก่อน",
            f"- อารมณ์ของข้อความ {signal.sentiment:+.2f} — {signal.mood}",
            f"- ยอดปฏิสัมพันธ์รวม {signal.engagement:,}",
        ]
        if signal.search_rank:
            lines.append(f"- ติดอันดับค้นหายอดนิยมอันดับ {signal.search_rank}")
        if signal.posts:
            lines.append("- ตัวอย่างที่คนพูดถึง:")
            lines += [f"    · {p.title[:100]}" for p in signal.posts[:3]]
        return "\n".join(lines) + caveat

    ranked = pulse.ranked()[:5]
    lines = [
        f"**ดัชนีกระแสมีมรวม {pulse.hype_index:.0f}/100 — {pulse.market_mood}**",
        "",
        "เหรียญที่กระแสแรงสุดตอนนี้:",
    ]
    for i, s in enumerate(ranked, 1):
        lines.append(
            f"{i}. **{s.symbol}** — คะแนน {s.buzz_score:.0f} · {s.trend} · "
            f"พูดถึง {s.mentions_24h} ครั้ง ({s.mention_change * 100:+.0f}%) · {s.mood}"
        )
    return "\n".join(lines) + caveat


def _answer_action(context: ChatContext, symbol: str | None) -> str:
    disclaimer = "\n\n_ระบบสาธิตเพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน_"

    if not symbol:
        buys = [s for s in context.symbols if context.analysis.advices[s].is_buy]
        sells = [s for s in context.symbols if context.analysis.advices[s].is_sell]
        lines = ["**สรุปสัญญาณทั้งพอร์ต**", ""]
        lines.append(f"- ฝั่งซื้อ: {', '.join(buys) if buys else 'ไม่มี'}")
        lines.append(f"- ฝั่งขาย/ลด: {', '.join(sells) if sells else 'ไม่มี'}")
        lines.append("- ที่เหลือคือถือไว้ก่อน")
        lines.append("\nถามเจาะรายเหรียญได้ เช่น “DOGE ควรซื้อไหม”")
        return "\n".join(lines) + disclaimer

    advice = context.analysis.advices[symbol]
    profile = context.analysis.profiles[symbol]
    forecast = context.analysis.forecasts[symbol]
    plan = context.plan(symbol)
    signal = context.signal(symbol)

    lines = [
        f"**{symbol}: {advice.emoji} {advice.signal}** — {advice.action_text}",
        "",
        f"- คะแนน AI {advice.score:+.2f} · ความมั่นใจ {advice.confidence * 100:.0f}%",
        f"- β {profile.beta:.2f} · โอกาสขึ้นใน {forecast.horizon_days} วัน "
        f"{forecast.prob_up * 100:.0f}%",
    ]
    if plan:
        lines.append(
            f"- มูลค่าเหมาะสม {plan.fair.fair_price:.8g} ({plan.fair.verdict} "
            f"{plan.fair.gap * 100:+.1f}%) · อยู่โซน **{plan.zones.current_zone}**"
        )
        if abs(plan.delta_value) > 1:
            verb = "ซื้อเพิ่ม" if plan.delta_value > 0 else "ลดลง"
            lines.append(f"- แผนแนะนำ: {verb} ประมาณ {abs(plan.delta_value):,.0f} USD "
                         f"({plan.action})")
    if signal:
        lines.append(f"- กระแสโซเชียล: {signal.trend} คะแนน {signal.buzz_score:.0f}/100")
        if signal.buzz_score >= 60 and advice.is_sell:
            lines.append("- ⚠️ กระแสแรงแต่สัญญาณเชิงปริมาณเป็นลบ — "
                         "ระวังการไล่ราคาตามกระแส")
    return "\n".join(lines) + disclaimer


def _answer_risk(context: ChatContext, symbol: str | None) -> str:
    if not symbol:
        betas = context.analysis.betas()
        ranked = sorted(betas.items(), key=lambda kv: kv[1], reverse=True)
        lines = ["**ความเสี่ยงเรียงจากสูงไปต่ำ (ค่า β)**", ""]
        for s, b in ranked:
            grade = context.analysis.profiles[s].risk_grade
            lines.append(f"- **{s}** β {b:.2f} ({grade}) · "
                         f"ผันผวน {context.analysis.profiles[s].volatility * 100:.0f}%/ปี")
        lines.append("\nβ = 2.0 หมายถึงตลาดขยับ 10% เหรียญนี้มักขยับราว 20%")
        return "\n".join(lines)

    p = context.analysis.profiles[symbol]
    return "\n".join([
        f"**ความเสี่ยงของ {symbol}**",
        "",
        f"- β {p.beta:.2f} — ระดับ{p.risk_grade} "
        f"(ตลาดขยับ 10% เหรียญนี้มักขยับราว {abs(p.beta) * 10:.0f}%)",
        f"- ความผันผวน {p.volatility * 100:.0f}%/ปี · Sharpe {p.sharpe:.2f}",
        f"- VaR 95%: วันแย่ ๆ 5% ของวันทั้งหมด ขาดทุนอย่างน้อย {abs(p.var_95) * 100:.1f}%",
        f"- ย่อลึกสุดที่เคยเกิด {p.max_drawdown * 100:.0f}%",
        f"- R² {p.r_squared:.2f}" + (" — ต่ำ แปลว่า β อธิบายราคาได้จำกัด"
                                     if p.r_squared < 0.25 else ""),
        f"- เกณฑ์ CAPM: ที่ความเสี่ยงนี้ควรได้ผลตอบแทน {p.required_return * 100:.0f}%/ปี ถึงจะคุ้ม",
    ])


def _answer_portfolio(context: ChatContext) -> str:
    if context.portfolio is None:
        return "ระบบยังไม่มีข้อมูลพอร์ตของคุณ — ตั้งค่าได้ในแท็บ “พอร์ต & ค่า β”"

    from core.risk import portfolio_beta

    spot = context.analysis.spot_prices()
    equity = context.portfolio.equity(spot)
    weights = context.portfolio.weights(spot)
    beta = portfolio_beta(weights, context.analysis.betas())
    positions = context.portfolio.open_positions()

    lines = [
        f"**พอร์ตของคุณ: {equity:,.0f} USD**",
        "",
        f"- เงินสด {context.portfolio.cash:,.0f} USD "
        f"({context.portfolio.cash_weight(spot) * 100:.0f}%)",
        f"- β พอร์ต {beta:.2f}",
        f"- กำไร/ขาดทุนรวม {context.portfolio.total_pnl(spot):+,.0f} USD "
        f"({context.portfolio.total_return(spot) * 100:+.2f}%)",
    ]
    if positions:
        lines.append("- ที่ถืออยู่:")
        for s, pos in positions.items():
            pnl = pos.unrealized_pnl_pct(spot.get(s, 0.0)) * 100
            lines.append(f"    · {s} {weights.get(s, 0) * 100:.1f}% ของพอร์ต ({pnl:+.1f}%)")
    else:
        lines.append("- ยังไม่มีเหรียญในพอร์ต ถือเงินสดทั้งหมด")
    return "\n".join(lines)


def _answer_valuation(context: ChatContext, symbol: str | None) -> str:
    if not context.plans:
        return "ระบบยังไม่ได้คำนวณมูลค่าเหมาะสม — เปิดแท็บ “มูลค่า & แผนถือครอง” ก่อน"

    if symbol:
        plan = context.plan(symbol)
        if not plan:
            return f"ไม่มีข้อมูลมูลค่าของ {symbol}"
        return "\n".join([
            f"**มูลค่าเหมาะสมของ {symbol}**",
            "",
            f"- ราคาตลาด {plan.spot:.8g} · มูลค่าเหมาะสม {plan.fair.fair_price:.8g}",
            f"- **{plan.fair.verdict}** ({plan.fair.gap * 100:+.1f}%)",
            f"- อยู่ในโซน **{plan.zones.current_zone}** ของบันไดราคา",
            f"- ต่ำกว่า {plan.zones.accumulate_below:.8g} = ทยอยซื้อ · "
            f"สูงกว่า {plan.zones.trim_above:.8g} = ทยอยขาย",
        ])

    cheap = sorted(context.plans, key=lambda p: p.fair.gap, reverse=True)[:3]
    lines = ["**เหรียญที่ถูกกว่ามูลค่ามากที่สุด**", ""]
    for p in cheap:
        lines.append(f"- **{p.symbol}** {p.fair.gap * 100:+.1f}% ({p.fair.verdict}) · "
                     f"โซน {p.zones.current_zone}")
    return "\n".join(lines)


def _answer_price(context: ChatContext, symbol: str | None) -> str:
    if symbol:
        q = context.analysis.quotes[symbol]
        return "\n".join([
            f"**{symbol} — {q.name}**",
            "",
            f"- ราคา {q.price:.8g} USD",
            f"- 24 ชม. {q.pct_change_24h:+.2f}% · 7 วัน {q.pct_change_7d:+.2f}%",
            f"- มาร์เก็ตแคป {q.market_cap:,.0f} USD",
            f"- ปริมาณซื้อขาย 24 ชม. {q.volume_24h:,.0f} USD",
        ])

    lines = ["**ราคาเหรียญที่ติดตาม**", ""]
    for s in context.symbols:
        q = context.analysis.quotes[s]
        lines.append(f"- **{s}** {q.price:.8g} ({q.pct_change_24h:+.2f}% ใน 24 ชม.)")
    return "\n".join(lines)


def _answer_compare(context: ChatContext) -> str:
    scored = sorted(context.symbols,
                    key=lambda s: context.analysis.advices[s].score, reverse=True)
    lines = ["**เรียงตามคะแนน AI**", ""]
    for s in scored:
        a = context.analysis.advices[s]
        sig = context.signal(s)
        buzz = f" · กระแส {sig.buzz_score:.0f}" if sig else ""
        lines.append(f"- **{s}** คะแนน {a.score:+.2f} · {a.signal}{buzz}")
    return "\n".join(lines)


def _answer_overview(context: ChatContext) -> str:
    from core.analytics import market_regime

    regime = market_regime(context.analysis)
    pulse = context.pulse
    hottest = pulse.hottest()

    lines = [
        f"**ภาพรวมตอนนี้ — {regime['regime']}**",
        "",
        f"- ตลาดรวม 30 วัน {float(regime['change_30d']) * 100:+.1f}%",
        f"- ดัชนีกระแสมีม {pulse.hype_index:.0f}/100 ({pulse.market_mood})",
    ]
    if hottest:
        lines.append(f"- กระแสแรงสุด: **{hottest.symbol}** "
                     f"(คะแนน {hottest.buzz_score:.0f}, {hottest.trend})")

    buys = [s for s in context.symbols if context.analysis.advices[s].is_buy]
    if buys:
        lines.append(f"- AI ให้สัญญาณฝั่งซื้อ: {', '.join(buys)}")

    lines += [
        "",
        "ลองถามได้ เช่น:",
        "· “ตอนนี้เหรียญไหนกระแสแรงสุด”",
        "· “DOGE ควรซื้อไหม”",
        "· “พอร์ตฉันเสี่ยงเกินไปหรือเปล่า”",
    ]
    return "\n".join(lines)


def answer_with_rules(question: str, context: ChatContext) -> str:
    """ตอบด้วยกฎล้วน — ไม่ต้องใช้ API key และให้ผลเหมือนเดิมทุกครั้ง"""
    symbol = detect_symbol(question, context.symbols)
    intent = detect_intent(question)

    if intent == "buzz":
        return _answer_buzz(context, symbol)
    if intent == "action":
        return _answer_action(context, symbol)
    if intent == "risk":
        return _answer_risk(context, symbol)
    if intent == "portfolio":
        return _answer_portfolio(context)
    if intent == "valuation":
        return _answer_valuation(context, symbol)
    if intent == "price":
        return _answer_price(context, symbol)
    if intent == "compare":
        return _answer_compare(context)
    return _answer_overview(context)


# --------------------------------------------------------------------------
# เส้นทาง Claude
# --------------------------------------------------------------------------

def has_llm_credentials() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


@dataclass(frozen=True)
class ChatReply:
    """คำตอบหนึ่งครั้ง พร้อมบอกว่ามาจากเส้นทางไหน"""

    text: str
    used_llm: bool
    error: str | None = None

    @property
    def engine_label(self) -> str:
        if self.used_llm:
            return f"ตอบโดย Claude ({MODEL}) อ้างอิงข้อมูลจากระบบ"
        return "ตอบจากกฎในระบบ (ไม่ได้ใช้ LLM)"


def answer_with_claude(question: str, context: ChatContext,
                       history: list[dict] | None = None) -> ChatReply:
    """ส่งข้อเท็จจริงให้ Claude เรียบเรียง ถ้าล้มเหลวถอยไปใช้กฎ"""
    if not has_llm_credentials():
        return ChatReply(answer_with_rules(question, context), used_llm=False)

    try:
        import anthropic
    except ImportError:
        return ChatReply(
            answer_with_rules(question, context), used_llm=False,
            error="ยังไม่ได้ติดตั้งไลบรารี anthropic — ใช้เส้นทางกฎแทน",
        )

    focus = detect_symbol(question, context.symbols)
    brief = build_context_brief(context, focus)

    messages = list(history or [])
    messages.append({
        "role": "user",
        "content": f"{brief}\n\n=== คำถามของผู้ใช้ ===\n{question}",
    })

    try:
        client = anthropic.Anthropic()
        with client.messages.stream(
            model=MODEL,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            messages=messages,
        ) as stream:
            response = stream.get_final_message()
    except Exception as exc:
        return ChatReply(
            answer_with_rules(question, context), used_llm=False,
            error=f"เรียก Claude ไม่สำเร็จ ({type(exc).__name__}) — ใช้เส้นทางกฎแทน",
        )

    if response.stop_reason == "refusal":
        return ChatReply(
            answer_with_rules(question, context), used_llm=False,
            error="โมเดลปฏิเสธคำถามนี้ — ใช้เส้นทางกฎแทน",
        )

    text = "\n".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        return ChatReply(answer_with_rules(question, context), used_llm=False,
                         error="โมเดลไม่ได้ส่งข้อความกลับมา — ใช้เส้นทางกฎแทน")
    return ChatReply(text, used_llm=True)


def answer(question: str, context: ChatContext, use_llm: bool = True,
           history: list[dict] | None = None) -> ChatReply:
    """จุดเข้าหลักของแชตบอท"""
    if use_llm and has_llm_credentials():
        return answer_with_claude(question, context, history)
    return ChatReply(answer_with_rules(question, context), used_llm=False)
