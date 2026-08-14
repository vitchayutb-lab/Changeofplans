"""ส่วนแสดงผลของแต่ละแท็บบนหน้าเว็บ

แยกออกจาก app.py เพื่อให้ไฟล์หลักอ่านง่ายและทดสอบทีละส่วนได้
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

from core.ai_advisor import evaluate_portfolio
from core.analytics import Analysis, market_regime, portfolio_risk_summary
from core.backtest import annualized_stats, drawdown_curves, portfolio_backtest, run_backtest
from core.bot_engine import BotConfig, TradingBot
from core.indicators import sma
from core.portfolio import Portfolio, rebalance_plan
from core.risk import beta_contributions
from ui import charts
from ui.theme import (
    CRITICAL,
    GOOD,
    POS,
    TEXT_PRIMARY,
    WARNING,
    delta_color,
    format_price,
    format_usd,
    stat_card,
)

DISCLAIMER = (
    "⚠️ <b>ข้อจำกัดความรับผิดชอบ</b> — เว็บไซต์นี้เป็น <b>ระบบสาธิต</b> ทั้งการยิงออเดอร์และ "
    "การพยากรณ์ราคาเป็นการจำลองด้วยแบบจำลองทางสถิติ ไม่มีการเชื่อมต่อกับกระดานเทรดจริง "
    "และไม่ใช่คำแนะนำการลงทุน การเทรดเหรียญมีมมีความเสี่ยงสูงมากและอาจสูญเสียเงินต้นทั้งหมด"
)


def render_stat_row(cards: list[str]) -> None:
    """วางการ์ดตัวเลขเรียงเป็นแถวเดียว"""
    columns = st.columns(len(cards))
    for column, card in zip(columns, cards):
        column.markdown(card, unsafe_allow_html=True)


# ==========================================================================
# แท็บ 1 — ภาพรวมตลาด
# ==========================================================================

def render_market_tab(analysis: Analysis) -> None:
    st.subheader("ภาพรวมตลาดเหรียญมีม")

    regime = market_regime(analysis)
    buy_count = sum(1 for a in analysis.advices.values() if a.is_buy)
    sell_count = sum(1 for a in analysis.advices.values() if a.is_sell)
    avg_beta = float(np.mean([p.beta for p in analysis.profiles.values()]))

    render_stat_row([
        stat_card("สภาพตลาดรวม", str(regime["regime"]),
                  f"30 วัน {float(regime['change_30d']) * 100:+.1f}%",
                  delta_color(float(regime["change_30d"]))),
        stat_card("ความผันผวนตลาด", f"{float(regime['volatility']) * 100:.0f}%",
                  "ต่อปี (30 วันล่าสุด)"),
        stat_card("β เฉลี่ยของเหรียญที่ติดตาม", f"{avg_beta:.2f}",
                  "เทียบดัชนีตลาดคริปโต"),
        stat_card("สัญญาณจาก AI", f"{buy_count} ซื้อ / {sell_count} ขาย",
                  f"จากทั้งหมด {len(analysis.symbols)} เหรียญ"),
    ])

    st.markdown("")
    left, right = st.columns([3, 2])
    with left:
        st.plotly_chart(charts.risk_return_scatter(analysis), use_container_width=True)
    with right:
        st.plotly_chart(charts.signal_distribution(analysis), use_container_width=True)
        st.markdown(
            '<div class="callout callout-info">จุดที่อยู่ <b>เหนือเส้นประ</b> คือเหรียญที่ '
            'ผลตอบแทนคาดหวังสูงกว่าที่ความเสี่ยง (β) เรียกร้องตามหลัก CAPM — '
            'เป็นกลุ่มที่คุ้มความเสี่ยงกว่าเมื่อเทียบกันที่ระดับ β เดียวกัน</div>',
            unsafe_allow_html=True,
        )

    st.markdown("#### ตารางสรุปทุกเหรียญ")
    table = analysis.market_table()
    st.dataframe(
        table,
        use_container_width=True,
        hide_index=True,
        column_config={
            "ราคา (USD)": st.column_config.NumberColumn(format="%.8f"),
            "24 ชม. (%)": st.column_config.NumberColumn(format="%.2f%%"),
            "7 วัน (%)": st.column_config.NumberColumn(format="%.2f%%"),
            "มาร์เก็ตแคป (USD)": st.column_config.NumberColumn(format="compact"),
            "Beta (β)": st.column_config.NumberColumn(format="%.2f"),
            "ผันผวน/ปี (%)": st.column_config.NumberColumn(format="%.0f%%"),
            "โอกาสขึ้น (%)": st.column_config.ProgressColumn(
                format="%.0f%%", min_value=0, max_value=100),
            "คาดการณ์ 30 วัน (%)": st.column_config.NumberColumn(format="%.1f%%"),
            "คะแนน AI": st.column_config.NumberColumn(format="%.2f"),
            "ความมั่นใจ (%)": st.column_config.NumberColumn(format="%.0f%%"),
        },
    )

    st.markdown(
        '<div class="callout callout-warn"><b>อ่านค่า β อย่างไร</b> — β = 2.0 หมายความว่า '
        'เวลาตลาดคริปโตขยับ 10% เหรียญนี้มีแนวโน้มขยับราว 20% ไปในทิศเดียวกัน '
        'ยิ่ง β สูง ยิ่งได้เยอะตอนตลาดขึ้น แต่ก็เจ็บหนักกว่าตอนตลาดลง</div>',
        unsafe_allow_html=True,
    )


# ==========================================================================
# แท็บ 2 — วิเคราะห์เชิงลึกรายเหรียญ
# ==========================================================================

def render_analysis_tab(analysis: Analysis) -> None:
    st.subheader("AI Financial Tools — วิเคราะห์รายเหรียญ")

    symbol = st.selectbox(
        "เลือกเหรียญที่ต้องการวิเคราะห์",
        analysis.symbols,
        format_func=lambda s: f"{s} — {analysis.quotes[s].name}",
    )

    quote = analysis.quotes[symbol]
    profile = analysis.profiles[symbol]
    forecast = analysis.forecasts[symbol]
    advice = analysis.advices[symbol]
    prices = analysis.market.prices[symbol]
    dates = analysis.market.dates

    render_stat_row([
        stat_card("ราคาปัจจุบัน", format_price(quote.price),
                  f"24 ชม. {quote.pct_change_24h:+.2f}%", delta_color(quote.pct_change_24h)),
        stat_card("Beta (β)", f"{profile.beta:.2f}",
                  f"ความเสี่ยงระดับ{profile.risk_grade} · R² {profile.r_squared:.2f}"),
        stat_card(f"โอกาสขึ้นใน {forecast.horizon_days} วัน", f"{forecast.prob_up * 100:.0f}%",
                  f"แนวโน้ม{forecast.direction}",
                  GOOD if forecast.prob_up >= 0.5 else CRITICAL),
        stat_card("คะแนน AI", f"{advice.score:+.2f}",
                  f"ความมั่นใจ {advice.confidence * 100:.0f}%"),
        stat_card("คำแนะนำ", f"{advice.emoji} {advice.signal}", advice.action_text,
                  POS if advice.is_buy else (CRITICAL if advice.is_sell else TEXT_PRIMARY)),
    ])

    # การ์ดเหตุผล
    card_class = "buy" if advice.is_buy else ("sell" if advice.is_sell else "")
    reasons = "<br>".join(advice.rationale)
    st.markdown(
        f'<div class="advice-card {card_class}">'
        f'<div class="signal">{advice.emoji} {advice.signal} — {advice.action_text}</div>'
        f'<div class="reason" style="margin-top:10px">{reasons}</div></div>',
        unsafe_allow_html=True,
    )

    left, right = st.columns(2)
    with left:
        st.plotly_chart(
            charts.price_chart(dates, prices, symbol, sma(prices, 30)),
            use_container_width=True,
        )
        st.plotly_chart(
            charts.beta_regression(analysis.market.returns(symbol),
                                   analysis.market.market_returns, profile.beta, symbol),
            use_container_width=True,
        )
    with right:
        st.plotly_chart(
            charts.indexed_comparison(dates, prices, analysis.market.market_index, symbol),
            use_container_width=True,
        )
        st.plotly_chart(charts.forecast_fan(forecast), use_container_width=True)

    st.plotly_chart(charts.factor_contribution_bar(advice.factors), use_container_width=True)

    st.markdown("#### สถานการณ์ราคาที่เป็นไปได้")
    scenarios = pd.DataFrame([
        {"สถานการณ์": "แย่มาก (5%)", "ราคา": forecast.p05,
         "เปลี่ยนแปลง (%)": (forecast.p05 / forecast.spot - 1) * 100},
        {"สถานการณ์": "ค่อนข้างแย่ (25%)", "ราคา": forecast.p25,
         "เปลี่ยนแปลง (%)": (forecast.p25 / forecast.spot - 1) * 100},
        {"สถานการณ์": "ค่ากลาง (50%)", "ราคา": forecast.median_price,
         "เปลี่ยนแปลง (%)": (forecast.median_price / forecast.spot - 1) * 100},
        {"สถานการณ์": "ค่อนข้างดี (75%)", "ราคา": forecast.p75,
         "เปลี่ยนแปลง (%)": (forecast.p75 / forecast.spot - 1) * 100},
        {"สถานการณ์": "ดีมาก (95%)", "ราคา": forecast.p95,
         "เปลี่ยนแปลง (%)": (forecast.p95 / forecast.spot - 1) * 100},
    ])
    left2, right2 = st.columns([2, 3])
    with left2:
        st.dataframe(
            scenarios, use_container_width=True, hide_index=True,
            column_config={
                "ราคา": st.column_config.NumberColumn(format="%.8f"),
                "เปลี่ยนแปลง (%)": st.column_config.NumberColumn(format="%.1f%%"),
            },
        )
    with right2:
        st.markdown(
            f'<div class="callout callout-info">'
            f'<b>สรุปเชิงตัวเลข</b><br>'
            f'• อัตราการเติบโตที่โมเดลใช้ (drift): <b>{forecast.drift_annual * 100:+.0f}%/ปี</b><br>'
            f'• ความผันผวนที่ใช้: <b>{forecast.volatility_annual * 100:.0f}%/ปี</b><br>'
            f'• อัปไซด์ต่อดาวน์ไซด์: <b>{forecast.reward_to_risk:.2f} เท่า</b> '
            f'(เกิน 1 เท่า = ฝั่งได้กว้างกว่าฝั่งเสีย)<br>'
            f'• เกณฑ์ CAPM ที่ β = {profile.beta:.2f} เรียกร้อง: '
            f'<b>{profile.required_return * 100:.0f}%/ปี</b>'
            f'</div>',
            unsafe_allow_html=True,
        )

    with st.expander("มาตรวัดความเสี่ยงแบบละเอียด"):
        risk_row = analysis.risk_table()
        selected = risk_row[risk_row["เหรียญ"] == symbol].drop(columns=["เหรียญ"])
        detail = selected.T.set_axis(["ค่า"], axis=1)
        st.dataframe(detail, use_container_width=True)
        st.caption(
            "VaR 95% = ในวันที่แย่ที่สุด 5% ของวันทั้งหมด ราคามักลดลงอย่างน้อยเท่านี้ · "
            "R² = สัดส่วนการเคลื่อนไหวที่อธิบายได้ด้วยตลาด (ต่ำ = β เชื่อถือได้น้อยลง)"
        )


# ==========================================================================
# แท็บ 3 — พอร์ตโฟลิโอและค่า β
# ==========================================================================

def _holdings_editor(analysis: Analysis, portfolio: Portfolio) -> None:
    """ตารางแก้ไขสถานะการถือครอง (กรอกเป็นมูลค่า USD เพื่อให้กรอกง่าย)"""
    spot = analysis.spot_prices()

    rows = []
    for symbol in analysis.symbols:
        position = portfolio.positions.get(symbol)
        value = position.market_value(spot[symbol]) if position else 0.0
        rows.append({"เหรียญ": symbol, "มูลค่าที่ถือ (USD)": round(value, 2)})

    edited = st.data_editor(
        pd.DataFrame(rows),
        use_container_width=True,
        hide_index=True,
        disabled=["เหรียญ"],
        column_config={
            "มูลค่าที่ถือ (USD)": st.column_config.NumberColumn(
                min_value=0.0, step=50.0, format="%.2f",
                help="กรอกมูลค่าที่ต้องการถือ ระบบจะแปลงเป็นจำนวนเหรียญให้อัตโนมัติ",
            ),
        },
        key="holdings_editor",
    )

    if st.button("บันทึกพอร์ตนี้", use_container_width=True):
        for _, row in edited.iterrows():
            symbol = row["เหรียญ"]
            target_value = float(row["มูลค่าที่ถือ (USD)"] or 0.0)
            price = spot[symbol]
            position = portfolio.position(symbol)
            current_value = position.market_value(price)
            delta = target_value - current_value

            if delta > 0.01:
                portfolio.buy(symbol, delta / price, price)
            elif delta < -0.01:
                portfolio.sell(symbol, min(abs(delta) / price, position.quantity), price)
        st.success("อัปเดตพอร์ตเรียบร้อย")
        st.rerun()


def render_portfolio_tab(analysis: Analysis, portfolio: Portfolio, target_beta: float) -> None:
    st.subheader("AI Portfolio Manager — บริหารความเสี่ยงด้วยค่า β")

    spot = analysis.spot_prices()
    weights = portfolio.weights(spot)
    equity = portfolio.equity(spot)
    betas = analysis.betas()
    summary = portfolio_risk_summary(analysis, weights)
    contributions = beta_contributions(weights, betas)

    render_stat_row([
        stat_card("มูลค่าพอร์ตรวม", format_usd(equity),
                  f"เงินสด {format_usd(portfolio.cash)} "
                  f"({portfolio.cash_weight(spot) * 100:.0f}%)"),
        stat_card("β ของพอร์ต", f"{summary['beta']:.2f}",
                  f"เป้าหมาย {target_beta:.2f}",
                  POS if abs(summary["beta"] - target_beta) <= 0.35 else WARNING),
        stat_card("ความผันผวนพอร์ต", f"{summary['volatility'] * 100:.0f}%", "ต่อปี"),
        stat_card("VaR 95% ราย 1 วัน", f"{summary['var_95'] * 100:.1f}%",
                  f"≈ {format_usd(abs(summary['var_95']) * equity)} ของพอร์ต", CRITICAL),
        stat_card("คะแนนกระจายความเสี่ยง", f"{summary['diversification']:.0f}/100",
                  "สูง = ไม่กระจุกตัว",
                  GOOD if summary["diversification"] >= 50 else WARNING),
    ])

    if not portfolio.open_positions():
        st.info("ยังไม่มีสถานะการถือครอง — กรอกมูลค่าที่ต้องการถือในตารางด้านล่าง "
                "หรือไปที่แท็บ **บอทยิงออเดอร์** เพื่อให้บอทเปิดสถานะให้อัตโนมัติ")

    st.markdown("")
    left, right = st.columns([2, 3])
    with left:
        st.plotly_chart(
            charts.portfolio_beta_gauge(summary["beta"], target_beta),
            use_container_width=True,
        )
    with right:
        if contributions:
            st.plotly_chart(
                charts.beta_contribution_bar(contributions, summary["beta"]),
                use_container_width=True,
            )
        else:
            st.markdown(
                '<div class="callout callout-info">พอร์ตยังไม่มีเหรียญ จึงยังไม่มีค่า β '
                'ให้วิเคราะห์ — เงินสดล้วนมี β เท่ากับ 0</div>',
                unsafe_allow_html=True,
            )

    # คำวินิจฉัยจาก AI
    advice = evaluate_portfolio(
        portfolio_beta_value=summary["beta"],
        target_beta=target_beta,
        weights=weights,
        contributions=contributions,
        advices=analysis.advices,
        diversification=summary["diversification"],
        portfolio_vol=summary["volatility"],
    )

    st.markdown(f"#### คำวินิจฉัยพอร์ต: {advice.verdict}")
    st.markdown(
        f'<div class="callout callout-info">{advice.headline}<br><br>'
        f'ที่ β = {summary["beta"]:.2f} หลักการ CAPM ประเมินว่าพอร์ตนี้ '
        f'<b>ควรได้ผลตอบแทน {summary["expected_return_capm"] * 100:.0f}%/ปี</b> '
        f'เพื่อให้คุ้มกับความเสี่ยงเชิงระบบที่แบกอยู่</div>',
        unsafe_allow_html=True,
    )

    for suggestion in advice.suggestions:
        st.markdown(f'<div class="callout callout-info">💡 {suggestion}</div>',
                    unsafe_allow_html=True)
    for warning in advice.warnings:
        st.markdown(f'<div class="callout callout-warn">⚠️ {warning}</div>',
                    unsafe_allow_html=True)

    st.markdown("---")
    st.markdown("#### ปรับสมดุลพอร์ตตามคำแนะนำของ AI")

    suggested = analysis.suggested_weights()
    col_left, col_right = st.columns([3, 2])
    with col_left:
        st.plotly_chart(charts.allocation_comparison(weights, suggested),
                        use_container_width=True)
    with col_right:
        orders = rebalance_plan(weights, suggested, equity)
        if orders:
            plan = pd.DataFrame([{
                "เหรียญ": o.symbol,
                "ฝั่ง": o.side,
                "มูลค่า (USD)": o.usd_amount,
                "น้ำหนักปัจจุบัน (%)": o.current_weight * 100,
                "น้ำหนักเป้าหมาย (%)": o.target_weight * 100,
            } for o in orders])
            st.dataframe(
                plan, use_container_width=True, hide_index=True,
                column_config={
                    "มูลค่า (USD)": st.column_config.NumberColumn(format="$%.0f"),
                    "น้ำหนักปัจจุบัน (%)": st.column_config.NumberColumn(format="%.1f%%"),
                    "น้ำหนักเป้าหมาย (%)": st.column_config.NumberColumn(format="%.1f%%"),
                },
            )
            st.caption("ข้ามรายการที่ห่างจากเป้าหมายน้อยกว่า 2% เพื่อไม่ให้เสียค่าธรรมเนียมโดยเปล่าประโยชน์")
        else:
            st.success("น้ำหนักพอร์ตใกล้เคียงกับที่ AI แนะนำแล้ว ไม่ต้องปรับ")

    st.plotly_chart(charts.correlation_heatmap(analysis.correlations()),
                    use_container_width=True)
    st.caption(
        "เหรียญมีมมักมีสหสัมพันธ์สูงระหว่างกัน การถือหลายตัวจึงลดความเสี่ยงได้น้อยกว่าที่คิด "
        "— ถ้าทุกช่องเป็นสีฟ้าเข้ม แปลว่าพอร์ตจะลงพร้อมกันทั้งหมดเวลาตลาดพัง"
    )

    st.markdown("---")
    st.markdown("#### ตั้งค่าสถานะการถือครอง")
    editor_col, table_col = st.columns([2, 3])
    with editor_col:
        _holdings_editor(analysis, portfolio)
    with table_col:
        rows = portfolio.snapshot(spot)
        if rows:
            st.dataframe(
                pd.DataFrame(rows), use_container_width=True, hide_index=True,
                column_config={
                    "จำนวน": st.column_config.NumberColumn(format="%.4f"),
                    "ต้นทุนเฉลี่ย": st.column_config.NumberColumn(format="%.8f"),
                    "ราคาปัจจุบัน": st.column_config.NumberColumn(format="%.8f"),
                    "มูลค่า (USD)": st.column_config.NumberColumn(format="$%.2f"),
                    "กำไร/ขาดทุน (USD)": st.column_config.NumberColumn(format="$%.2f"),
                    "กำไร/ขาดทุน (%)": st.column_config.NumberColumn(format="%.2f%%"),
                },
            )
        else:
            st.caption("ยังไม่มีสถานะการถือครอง")


# ==========================================================================
# แท็บ 4 — บอทยิงออเดอร์อัตโนมัติ
# ==========================================================================

def _bot_config_form() -> BotConfig:
    """ฟอร์มตั้งค่าบอท"""
    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("**ขนาดและจำนวนไม้**")
        order_size = st.number_input("มูลค่าต่อออเดอร์ (USD)", min_value=10.0, max_value=10_000.0,
                                     value=250.0, step=50.0)
        max_positions = st.slider("จำนวนเหรียญสูงสุดที่ถือพร้อมกัน", 1, 8, 5)
        max_weight = st.slider("น้ำหนักสูงสุดต่อเหรียญ (%)", 5, 60, 30) / 100.0

    with col2:
        st.markdown("**ด่านความเสี่ยง**")
        max_beta = st.slider("เพดาน β ของพอร์ต", 0.5, 3.0, 1.8, 0.1,
                             help="ถ้าซื้อแล้ว β พอร์ตจะเกินค่านี้ บอทจะไม่เข้าไม้")
        min_conf = st.slider("ความมั่นใจขั้นต่ำ (%)", 0, 95, 55) / 100.0
        daily_limit = st.slider("วงเงินขาดทุนต่อวัน (%)", 1, 30, 8) / 100.0

    with col3:
        st.markdown("**ต้นทุนและการปิดสถานะ**")
        fee_bps = st.number_input("ค่าธรรมเนียม (bps)", min_value=0.0, max_value=100.0,
                                  value=10.0, step=1.0, help="10 bps = 0.10%")
        slippage_bps = st.number_input("Slippage (bps)", min_value=0.0, max_value=300.0,
                                       value=25.0, step=5.0,
                                       help="เหรียญมีมสภาพคล่องบาง ราคาที่ได้จริงมักแย่กว่าที่เห็น")
        use_sl = st.checkbox("เปิดใช้ตัดขาดทุนอัตโนมัติ (stop-loss)", value=True)
        use_tp = st.checkbox("เปิดใช้ทำกำไรอัตโนมัติ (take-profit)", value=True)

    return BotConfig(
        order_size_usd=order_size,
        max_position_weight=max_weight,
        max_open_positions=max_positions,
        max_portfolio_beta=max_beta,
        min_confidence=min_conf,
        fee_bps=fee_bps,
        slippage_bps=slippage_bps,
        use_stop_loss=use_sl,
        use_take_profit=use_tp,
        daily_loss_limit_pct=daily_limit,
    )


def render_bot_tab(analysis: Analysis, portfolio: Portfolio) -> None:
    st.subheader("บอทยิงออเดอร์อัตโนมัติ (จำลอง)")
    st.markdown(
        '<div class="callout callout-danger">🔌 <b>โหมดจำลองเท่านั้น</b> — '
        'ออเดอร์ทั้งหมดถูกจับคู่ภายในระบบ ไม่มีการเชื่อมต่อกับกระดานเทรดหรือกระเป๋าเงินจริง '
        'ราคาที่จับคู่ได้รวมค่าธรรมเนียมและ slippage ไว้แล้วเพื่อให้ผลลัพธ์สมจริง</div>',
        unsafe_allow_html=True,
    )

    config = _bot_config_form()

    spot = analysis.spot_prices()
    betas = analysis.betas()

    st.markdown("")
    run_col, reset_col, _ = st.columns([2, 1, 3])
    run_clicked = run_col.button("▶️ รันบอทหนึ่งรอบ", type="primary", use_container_width=True)
    reset_clicked = reset_col.button("รีเซ็ตพอร์ต", use_container_width=True)

    if reset_clicked:
        st.session_state.portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
        st.session_state.trade_log = []
        st.session_state.pop("last_report", None)
        st.rerun()

    if run_clicked:
        with st.spinner("กำลังประมวลผลสัญญาณและส่งคำสั่งเข้าระบบจำลอง..."):
            bot = TradingBot(config)
            report = bot.run_cycle(portfolio, spot, analysis.advices, betas)
            st.session_state.trade_log = report.orders + st.session_state.get("trade_log", [])
            st.session_state.last_report = report

    report = st.session_state.get("last_report")
    if report is not None:
        if report.halted:
            st.error(f"⛔ {report.halt_reason}")

        render_stat_row([
            stat_card("ออเดอร์ที่จับคู่สำเร็จ", f"{len(report.filled)}",
                      f"จากที่พิจารณา {len(report.orders)} รายการ"),
            stat_card("มูลค่าการซื้อขาย", format_usd(report.turnover),
                      f"ค่าธรรมเนียมรวม {format_usd(report.total_fees)}"),
            stat_card("β พอร์ตหลังเทรด", f"{report.beta_after:.2f}",
                      f"ก่อนเทรด {report.beta_before:.2f}"),
            stat_card("มูลค่าพอร์ต", format_usd(report.equity_after),
                      f"เปลี่ยนแปลง {format_usd(report.equity_after - report.equity_before)}",
                      delta_color(report.equity_after - report.equity_before)),
        ])

    st.markdown("#### บันทึกการทำงานของบอท")
    log = st.session_state.get("trade_log", [])
    if not log:
        st.caption("ยังไม่มีการทำงาน — กดปุ่ม “รันบอทหนึ่งรอบ” เพื่อเริ่ม")
    else:
        for order in log[:40]:
            if order.is_filled:
                css = "filled-buy" if order.side == "BUY" else "filled-sell"
                body = (
                    f"{order.icon} [{order.timestamp}] <b>{order.side} {order.symbol}</b> "
                    f"{order.quantity:,.4f} @ {format_price(order.fill_price)} "
                    f"= {format_usd(order.notional)} "
                    f"(ค่าธรรมเนียม {format_usd(order.fee)}) — {order.reason}"
                )
            else:
                css = "rejected"
                body = (
                    f"{order.icon} [{order.timestamp}] <b>{order.side} {order.symbol}</b> "
                    f"ไม่ส่งคำสั่ง — {order.reason}"
                )
            st.markdown(f'<div class="log-line {css}">{body}</div>', unsafe_allow_html=True)

        with st.expander("ดูบันทึกทั้งหมดเป็นตาราง"):
            st.dataframe(
                pd.DataFrame([o.as_row() for o in log]),
                use_container_width=True, hide_index=True,
            )

    st.markdown("#### สถานะพอร์ตหลังการทำงานของบอท")
    render_stat_row([
        stat_card("เงินสดคงเหลือ", format_usd(portfolio.cash)),
        stat_card("มูลค่าเหรียญที่ถือ", format_usd(portfolio.positions_value(spot))),
        stat_card("กำไร/ขาดทุนที่รับรู้แล้ว", format_usd(portfolio.realized_pnl), "",
                  delta_color(portfolio.realized_pnl)),
        stat_card("กำไร/ขาดทุนรวม", format_usd(portfolio.total_pnl(spot)),
                  f"{portfolio.total_return(spot) * 100:+.2f}% จากเงินตั้งต้น",
                  delta_color(portfolio.total_pnl(spot))),
    ])

    rows = portfolio.snapshot(spot)
    if rows:
        st.dataframe(
            pd.DataFrame(rows), use_container_width=True, hide_index=True,
            column_config={
                "จำนวน": st.column_config.NumberColumn(format="%.4f"),
                "ต้นทุนเฉลี่ย": st.column_config.NumberColumn(format="%.8f"),
                "ราคาปัจจุบัน": st.column_config.NumberColumn(format="%.8f"),
                "มูลค่า (USD)": st.column_config.NumberColumn(format="$%.2f"),
                "กำไร/ขาดทุน (USD)": st.column_config.NumberColumn(format="$%.2f"),
                "กำไร/ขาดทุน (%)": st.column_config.NumberColumn(format="%.2f%%"),
            },
        )


# ==========================================================================
# แท็บ 5 — ทดสอบย้อนหลัง
# ==========================================================================

def render_backtest_tab(analysis: Analysis) -> None:
    st.subheader("ทดสอบย้อนหลัง — กลยุทธ์ AI เทียบกับซื้อแล้วถือ")
    st.markdown(
        '<div class="callout callout-info">ทดสอบบนข้อมูลย้อนหลังโดยใช้เฉพาะข้อมูลที่รู้ ณ วันนั้น '
        'ในการตัดสินใจ (ไม่มีการแอบดูอนาคต) และหักค่าธรรมเนียมกับ slippage ทุกครั้งที่ปรับพอร์ต '
        '<b>ผลในอดีตไม่รับประกันผลในอนาคต</b></div>',
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns(3)
    target = col1.selectbox("ทดสอบกับ", ["ทั้งพอร์ต (ตามน้ำหนักที่ AI แนะนำ)"] + analysis.symbols)
    fee_bps = col2.number_input("ค่าธรรมเนียม (bps)", 0.0, 100.0, 10.0, 1.0, key="bt_fee")
    slip_bps = col3.number_input("Slippage (bps)", 0.0, 300.0, 25.0, 5.0, key="bt_slip")

    if target.startswith("ทั้งพอร์ต"):
        result = portfolio_backtest(analysis.market.prices, analysis.suggested_weights(),
                                    fee_bps, slip_bps)
        title = "พอร์ตรวม"
    else:
        result = run_backtest(target, analysis.market.prices[target], fee_bps, slip_bps)
        title = target

    stats = annualized_stats(result)
    render_stat_row([
        stat_card(f"ผลตอบแทนกลยุทธ์ AI ({title})",
                  f"{result.strategy_total_return * 100:+.1f}%",
                  f"{stats['strategy_cagr'] * 100:+.0f}%/ปี",
                  delta_color(result.strategy_total_return)),
        stat_card("ผลตอบแทนซื้อแล้วถือ", f"{result.buy_hold_total_return * 100:+.1f}%",
                  f"{stats['buy_hold_cagr'] * 100:+.0f}%/ปี",
                  delta_color(result.buy_hold_total_return)),
        stat_card("ส่วนต่าง", f"{result.excess_return * 100:+.1f}%",
                  "AI ชนะ" if result.excess_return > 0 else "AI แพ้",
                  delta_color(result.excess_return)),
        stat_card("ย่อลึกสุด (AI)", f"{result.strategy_max_drawdown * 100:.1f}%",
                  f"ซื้อแล้วถือ {result.buy_hold_max_drawdown * 100:.1f}%"),
        stat_card("Sharpe (AI)", f"{result.strategy_sharpe:.2f}",
                  f"ซื้อแล้วถือ {result.buy_hold_sharpe:.2f}"),
    ])

    dates = analysis.market.dates
    st.plotly_chart(
        charts.equity_curve_chart(dates, result.strategy_equity, result.buy_hold_equity),
        use_container_width=True,
    )

    left, right = st.columns(2)
    strategy_dd, buy_hold_dd = drawdown_curves(result)
    with left:
        st.plotly_chart(charts.drawdown_chart(dates, strategy_dd, buy_hold_dd),
                        use_container_width=True)
    with right:
        st.plotly_chart(charts.exposure_chart(dates, result.exposure),
                        use_container_width=True)

    st.markdown("#### สรุปตัวเลข")
    summary = pd.DataFrame([
        {"ตัวชี้วัด": "ผลตอบแทนรวม",
         "กลยุทธ์ AI": f"{result.strategy_total_return * 100:+.2f}%",
         "ซื้อแล้วถือ": f"{result.buy_hold_total_return * 100:+.2f}%"},
        {"ตัวชี้วัด": "ผลตอบแทนต่อปี",
         "กลยุทธ์ AI": f"{stats['strategy_cagr'] * 100:+.1f}%",
         "ซื้อแล้วถือ": f"{stats['buy_hold_cagr'] * 100:+.1f}%"},
        {"ตัวชี้วัด": "ความผันผวนต่อปี",
         "กลยุทธ์ AI": f"{stats['strategy_vol'] * 100:.1f}%",
         "ซื้อแล้วถือ": f"{stats['buy_hold_vol'] * 100:.1f}%"},
        {"ตัวชี้วัด": "ย่อลึกสุด",
         "กลยุทธ์ AI": f"{result.strategy_max_drawdown * 100:.1f}%",
         "ซื้อแล้วถือ": f"{result.buy_hold_max_drawdown * 100:.1f}%"},
        {"ตัวชี้วัด": "Sharpe Ratio",
         "กลยุทธ์ AI": f"{result.strategy_sharpe:.2f}",
         "ซื้อแล้วถือ": f"{result.buy_hold_sharpe:.2f}"},
        {"ตัวชี้วัด": "สัดส่วนถือครองเฉลี่ย",
         "กลยุทธ์ AI": f"{result.avg_exposure * 100:.0f}%", "ซื้อแล้วถือ": "100%"},
        {"ตัวชี้วัด": "จำนวนครั้งที่ปรับพอร์ต",
         "กลยุทธ์ AI": f"{result.n_trades}", "ซื้อแล้วถือ": "0"},
        {"ตัวชี้วัด": "ค่าธรรมเนียมรวมที่จ่าย",
         "กลยุทธ์ AI": format_usd(result.fees_paid), "ซื้อแล้วถือ": "$0.00"},
    ])
    st.dataframe(summary, use_container_width=True, hide_index=True)
