"""ตัวสร้างกราฟทั้งหมด (Plotly) — ทุกฟังก์ชันคืนค่าเป็น go.Figure

กติกาที่ยึดทุกกราฟ
  * เส้นหนา 2px หมุดใหญ่อย่างน้อย 8px กริดจาง แกนบาง
  * มี tooltip ทุกกราฟ กราฟอนุกรมเวลาใช้เส้นเล็งร่วม (unified crosshair)
  * ตั้งแต่ 2 ชุดข้อมูลขึ้นไปต้องมีคำอธิบายสัญลักษณ์ (legend) เสมอ
  * ไม่ใช้แกน y สองแกนในกราฟเดียว — ถ้าหน่วยต่างกันให้แยกกราฟหรือปรับเป็นฐานเดียวกัน
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from ui.theme import (
    AXIS,
    BLUE_RAMP,
    DIVERGING_SCALE,
    NEG,
    NEUTRAL,
    POS,
    SERIES,
    SIGNAL_STYLE,
    SURFACE,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    plotly_layout,
)


def price_chart(dates, prices, symbol: str, sma_values=None, height: int = 320) -> go.Figure:
    """กราฟราคาย้อนหลัง พร้อมเส้นค่าเฉลี่ย 30 วัน"""
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=dates, y=prices, name=symbol, mode="lines",
        line={"color": SERIES[0], "width": 2},
        hovertemplate="%{x|%d %b %Y}<br><b>" + symbol + "</b>: $%{y:.8f}<extra></extra>",
    ))

    if sma_values is not None:
        fig.add_trace(go.Scatter(
            x=dates, y=sma_values, name="SMA 30 วัน", mode="lines",
            line={"color": SERIES[1], "width": 2, "dash": "dot"},
            hovertemplate="SMA30: $%{y:.8f}<extra></extra>",
        ))

    fig.update_layout(**plotly_layout(
        height=height,
        show_legend=sma_values is not None,
        title=f"ราคา {symbol} ย้อนหลัง",
        hovermode="x unified",
    ))
    fig.update_yaxes(title_text="ราคา (USD)")
    return fig


def indexed_comparison(dates, coin_prices, market_index, symbol: str,
                       height: int = 320) -> go.Figure:
    """เทียบเหรียญกับดัชนีตลาด โดยปรับให้เริ่มที่ 100 เท่ากัน

    ปรับฐานเดียวกันแทนการใช้สองแกน y เพราะสองแกนทำให้เปรียบเทียบผิดได้ง่าย
    """
    coin = np.asarray(coin_prices, dtype=float)
    market = np.asarray(market_index, dtype=float)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dates, y=coin / coin[0] * 100.0, name=symbol, mode="lines",
        line={"color": SERIES[0], "width": 2},
        hovertemplate="<b>" + symbol + "</b>: %{y:.1f}<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=dates, y=market / market[0] * 100.0, name="ดัชนีตลาดคริปโต", mode="lines",
        line={"color": SERIES[1], "width": 2},
        hovertemplate="<b>ดัชนีตลาด</b>: %{y:.1f}<extra></extra>",
    ))

    fig.add_hline(y=100, line_width=1, line_dash="dot", line_color=AXIS)
    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title=f"{symbol} เทียบดัชนีตลาด (เริ่มต้น = 100)",
        hovermode="x unified",
    ))
    fig.update_yaxes(title_text="ดัชนี (ฐาน 100)")
    return fig


def beta_regression(asset_returns, market_returns, beta_value: float, symbol: str,
                    height: int = 340) -> go.Figure:
    """กราฟกระจายผลตอบแทนเหรียญเทียบตลาด — ความชันของเส้นคือค่า β

    เป็นภาพที่อธิบาย β ได้ตรงที่สุด: จุดเรียงชันแค่ไหนเทียบเส้น 45 องศา
    """
    a = np.asarray(asset_returns, dtype=float)
    m = np.asarray(market_returns, dtype=float)
    n = min(a.size, m.size)
    a, m = a[-n:] * 100.0, m[-n:] * 100.0

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=m, y=a, mode="markers", name="ผลตอบแทนรายวัน",
        marker={"color": SERIES[0], "size": 8, "opacity": 0.55,
                "line": {"width": 1, "color": SURFACE}},
        hovertemplate="ตลาด %{x:.2f}%<br>" + symbol + " %{y:.2f}%<extra></extra>",
    ))

    # เส้นถดถอย: ความชัน = β
    x_line = np.linspace(m.min(), m.max(), 50)
    intercept = float(np.mean(a) - beta_value * np.mean(m))
    fig.add_trace(go.Scatter(
        x=x_line, y=beta_value * x_line + intercept, mode="lines",
        name=f"เส้นถดถอย (β = {beta_value:.2f})",
        line={"color": SERIES[1], "width": 2},
        hovertemplate="เส้นถดถอย<extra></extra>",
    ))

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title=f"ความสัมพันธ์ผลตอบแทน {symbol} กับตลาด — ความชัน = β",
    ))
    fig.update_xaxes(title_text="ผลตอบแทนตลาดรายวัน (%)", zeroline=True, zerolinewidth=1)
    fig.update_yaxes(title_text=f"ผลตอบแทน {symbol} รายวัน (%)", zeroline=True, zerolinewidth=1)
    return fig


def forecast_fan(forecast, height: int = 360) -> go.Figure:
    """กราฟพัดพยากรณ์ — แถบสีไล่เฉดเดียวแสดงช่วงความน่าจะเป็นของราคา"""
    paths = forecast.percentile_paths
    days = np.arange(1, forecast.horizon_days + 1)

    fig = go.Figure()

    # แถบ 5-95% (ช่วงกว้าง สีอ่อน)
    fig.add_trace(go.Scatter(
        x=np.concatenate([days, days[::-1]]),
        y=np.concatenate([paths["p95"], paths["p05"][::-1]]),
        fill="toself", fillcolor="rgba(57,135,229,0.14)",
        line={"width": 0}, name="ช่วง 90% ของผลลัพธ์", hoverinfo="skip",
    ))
    # แถบ 25-75% (ช่วงแคบ สีเข้มขึ้น)
    fig.add_trace(go.Scatter(
        x=np.concatenate([days, days[::-1]]),
        y=np.concatenate([paths["p75"], paths["p25"][::-1]]),
        fill="toself", fillcolor="rgba(57,135,229,0.30)",
        line={"width": 0}, name="ช่วง 50% ของผลลัพธ์", hoverinfo="skip",
    ))
    # เส้นกลาง
    fig.add_trace(go.Scatter(
        x=days, y=paths["p50"], mode="lines", name="ค่ากลาง (median)",
        line={"color": BLUE_RAMP[3], "width": 2},
        hovertemplate="วันที่ %{x}<br>ราคากลาง $%{y:.8f}<extra></extra>",
    ))
    # ราคาปัจจุบันเป็นเส้นอ้างอิง
    fig.add_hline(
        y=forecast.spot, line_width=1, line_dash="dash", line_color=NEUTRAL,
        annotation_text="ราคาปัจจุบัน", annotation_position="top left",
        annotation_font_color=TEXT_MUTED, annotation_font_size=11,
    )

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title=f"พยากรณ์ราคา {forecast.symbol} ล่วงหน้า {forecast.horizon_days} วัน "
              f"(จำลอง Monte Carlo)",
        hovermode="x unified",
    ))
    fig.update_xaxes(title_text="จำนวนวันข้างหน้า")
    fig.update_yaxes(title_text="ราคา (USD)")
    return fig


def correlation_heatmap(corr: pd.DataFrame, height: int = 380) -> go.Figure:
    """เมทริกซ์สหสัมพันธ์ — สีขั้วคู่ ฟ้า(บวก) ↔ เทา(ศูนย์) ↔ แดง(ลบ)"""
    if corr.empty:
        return go.Figure(layout=plotly_layout(height=height))

    fig = go.Figure(go.Heatmap(
        z=corr.values,
        x=list(corr.columns),
        y=list(corr.index),
        colorscale=DIVERGING_SCALE,
        zmid=0.0, zmin=-1.0, zmax=1.0,
        text=np.round(corr.values, 2),
        texttemplate="%{text}",
        textfont={"size": 11, "color": TEXT_PRIMARY},
        xgap=2, ygap=2,  # ช่องว่างสีพื้นระหว่างช่อง
        hovertemplate="%{y} ↔ %{x}<br>สหสัมพันธ์ %{z:.2f}<extra></extra>",
        colorbar={
            "title": {"text": "ค่าสหสัมพันธ์", "font": {"color": TEXT_MUTED, "size": 11}},
            "tickfont": {"color": TEXT_MUTED, "size": 10},
            "outlinewidth": 0, "thickness": 12, "len": 0.85,
        },
    ))

    fig.update_layout(**plotly_layout(
        height=height,
        title="สหสัมพันธ์ระหว่างเหรียญ (ยิ่งฟ้าเข้ม ยิ่งขึ้นลงพร้อมกัน)",
    ))
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(showgrid=False, autorange="reversed")
    return fig


def factor_contribution_bar(factors, height: int = 320) -> go.Figure:
    """แท่งแนวนอนแสดงว่าปัจจัยไหนดันคะแนน AI ขึ้นหรือลงเท่าไหร่"""
    ordered = sorted(factors, key=lambda f: f.contribution)
    labels = [f.label for f in ordered]
    values = [f.contribution for f in ordered]
    colors = [POS if v >= 0 else NEG for v in values]
    details = [f.detail for f in ordered]

    fig = go.Figure(go.Bar(
        x=values, y=labels, orientation="h",
        marker={"color": colors, "line": {"width": 2, "color": SURFACE}},
        customdata=details,
        hovertemplate="<b>%{y}</b><br>ผลต่อคะแนน %{x:+.3f}<br>%{customdata}<extra></extra>",
        text=[f"{v:+.3f}" for v in values],
        textposition="outside",
        textfont={"color": TEXT_SECONDARY, "size": 11},
        showlegend=False,
    ))

    fig.add_vline(x=0, line_width=1, line_color=AXIS)
    span = max(abs(min(values)), abs(max(values)), 0.01) * 1.45
    fig.update_layout(**plotly_layout(
        height=height,
        title="ปัจจัยที่ทำให้ AI ตัดสินใจแบบนี้ (ผลต่อคะแนนรวม)",
        margin={"l": 190, "r": 40, "t": 44, "b": 36},
    ))
    fig.update_xaxes(title_text="ผลต่อคะแนนรวม", range=[-span, span])
    fig.update_yaxes(showgrid=False)
    return fig


def risk_return_scatter(analysis, height: int = 400) -> go.Figure:
    """แผนที่ความเสี่ยง–ผลตอบแทน: แกน x คือ β แกน y คือผลตอบแทนคาดหวัง

    เส้นทแยงคือ Security Market Line ตาม CAPM — จุดที่อยู่ **เหนือเส้น** คือ
    เหรียญที่ให้ผลตอบแทนมากกว่าที่ความเสี่ยงเรียกร้อง
    สัญญาณแยกด้วยทั้งสีและรูปทรงหมุด เพื่อให้อ่านได้แม้แยกสีไม่ออก
    """
    settings = analysis.settings
    fig = go.Figure()

    # เส้น CAPM
    betas = [analysis.profiles[s].beta for s in analysis.symbols]
    beta_min, beta_max = min(betas + [0.0]), max(betas + [1.0])
    x_line = np.linspace(beta_min - 0.3, beta_max + 0.3, 40)
    y_line = (settings.risk_free_rate
              + x_line * (settings.market_expected_return - settings.risk_free_rate)) * 100.0
    fig.add_trace(go.Scatter(
        x=x_line, y=y_line, mode="lines", name="เส้นเกณฑ์ CAPM",
        line={"color": NEUTRAL, "width": 2, "dash": "dash"},
        hovertemplate="เกณฑ์ CAPM ที่ β=%{x:.2f}: %{y:.0f}%/ปี<extra></extra>",
    ))

    # จัดกลุ่มตามสัญญาณเพื่อให้ legend อ่านง่าย
    groups: dict[str, list[str]] = {}
    for symbol in analysis.symbols:
        group = SIGNAL_STYLE[analysis.advices[symbol].signal]["group"]
        groups.setdefault(group, []).append(symbol)

    for group, symbols in groups.items():
        style = next(v for v in SIGNAL_STYLE.values() if v["group"] == group)
        x, y, sizes, labels, hover = [], [], [], [], []
        for symbol in symbols:
            profile = analysis.profiles[symbol]
            forecast = analysis.forecasts[symbol]
            advice = analysis.advices[symbol]
            annual = forecast.expected_return * (365.0 / forecast.horizon_days) * 100.0
            x.append(profile.beta)
            y.append(annual)
            mcap = analysis.quotes[symbol].market_cap
            sizes.append(float(np.clip(np.sqrt(max(mcap, 1)) / 1800.0, 12, 42)))
            labels.append(symbol)
            hover.append(
                f"<b>{symbol}</b><br>β = {profile.beta:.2f}<br>"
                f"ผลตอบแทนคาดหวัง {annual:+.0f}%/ปี<br>"
                f"เกณฑ์ CAPM {profile.required_return * 100:.0f}%/ปี<br>"
                f"สัญญาณ {advice.signal} (มั่นใจ {advice.confidence * 100:.0f}%)"
            )

        fig.add_trace(go.Scatter(
            x=x, y=y, mode="markers+text", name=group,
            marker={
                "color": style["color"], "size": sizes, "symbol": style["symbol"],
                "line": {"width": 2, "color": SURFACE}, "opacity": 0.9,
            },
            text=labels, textposition="top center",
            textfont={"color": TEXT_SECONDARY, "size": 11},
            customdata=hover,
            hovertemplate="%{customdata}<extra></extra>",
        ))

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title="แผนที่ความเสี่ยง–ผลตอบแทน (ขนาดหมุด = มาร์เก็ตแคป)",
    ))
    fig.update_xaxes(title_text="Beta (β) — ความเสี่ยงเทียบตลาด")
    fig.update_yaxes(title_text="ผลตอบแทนคาดหวัง (%/ปี)")
    return fig


def allocation_comparison(current: dict[str, float], target: dict[str, float],
                          height: int = 340) -> go.Figure:
    """เทียบน้ำหนักพอร์ตปัจจุบันกับที่ AI แนะนำ"""
    symbols = sorted(set(current) | set(target))
    fig = go.Figure()

    fig.add_trace(go.Bar(
        y=symbols, x=[current.get(s, 0.0) * 100 for s in symbols], orientation="h",
        name="น้ำหนักปัจจุบัน", marker={"color": SERIES[0], "line": {"width": 2, "color": SURFACE}},
        hovertemplate="<b>%{y}</b><br>ปัจจุบัน %{x:.1f}%<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        y=symbols, x=[target.get(s, 0.0) * 100 for s in symbols], orientation="h",
        name="AI แนะนำ", marker={"color": SERIES[1], "line": {"width": 2, "color": SURFACE}},
        hovertemplate="<b>%{y}</b><br>แนะนำ %{x:.1f}%<extra></extra>",
    ))

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title="น้ำหนักพอร์ต: ปัจจุบัน เทียบ ที่ AI แนะนำ",
        barmode="group", bargap=0.3, bargroupgap=0.08,
    ))
    fig.update_xaxes(title_text="สัดส่วนของพอร์ต (%)")
    fig.update_yaxes(showgrid=False)
    return fig


def beta_contribution_bar(contributions: dict[str, float], portfolio_beta_value: float,
                          height: int = 300) -> go.Figure:
    """เหรียญไหนดัน β ของพอร์ตมากที่สุด"""
    items = sorted(contributions.items(), key=lambda kv: kv[1])
    labels = [k for k, _ in items]
    values = [v for _, v in items]

    fig = go.Figure(go.Bar(
        x=values, y=labels, orientation="h",
        marker={"color": [POS if v >= 0 else NEG for v in values],
                "line": {"width": 2, "color": SURFACE}},
        text=[f"{v:+.2f}" for v in values], textposition="outside",
        textfont={"color": TEXT_SECONDARY, "size": 11},
        hovertemplate="<b>%{y}</b><br>ดัน β ของพอร์ต %{x:+.3f}<extra></extra>",
        showlegend=False,
    ))

    fig.add_vline(x=0, line_width=1, line_color=AXIS)
    fig.update_layout(**plotly_layout(
        height=height,
        title=f"ที่มาของ β พอร์ต (รวม = {portfolio_beta_value:.2f})",
    ))
    fig.update_xaxes(title_text="ส่วนที่ดัน β ของพอร์ต (น้ำหนัก × β)")
    fig.update_yaxes(showgrid=False)
    return fig


def equity_curve_chart(dates, strategy, buy_hold, height: int = 340) -> go.Figure:
    """เส้นมูลค่าพอร์ต: กลยุทธ์ AI เทียบซื้อแล้วถือ"""
    n = min(len(dates), len(strategy), len(buy_hold))
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=dates[-n:], y=strategy[-n:], mode="lines", name="กลยุทธ์ AI",
        line={"color": SERIES[0], "width": 2},
        hovertemplate="<b>กลยุทธ์ AI</b>: $%{y:,.0f}<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=dates[-n:], y=buy_hold[-n:], mode="lines", name="ซื้อแล้วถือ",
        line={"color": SERIES[1], "width": 2},
        hovertemplate="<b>ซื้อแล้วถือ</b>: $%{y:,.0f}<extra></extra>",
    ))

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title="มูลค่าพอร์ตย้อนหลัง (เริ่มต้น $10,000)",
        hovermode="x unified",
    ))
    fig.update_yaxes(title_text="มูลค่าพอร์ต (USD)")
    return fig


def drawdown_chart(dates, strategy_dd, buy_hold_dd, height: int = 260) -> go.Figure:
    """เส้นการขาดทุนจากจุดสูงสุด — ยิ่งลึกยิ่งเจ็บ"""
    n = min(len(dates), len(strategy_dd), len(buy_hold_dd))
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=dates[-n:], y=np.asarray(strategy_dd[-n:]) * 100, mode="lines", name="กลยุทธ์ AI",
        line={"color": SERIES[0], "width": 2}, fill="tozeroy",
        fillcolor="rgba(57,135,229,0.18)",
        hovertemplate="<b>กลยุทธ์ AI</b>: %{y:.1f}%<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=dates[-n:], y=np.asarray(buy_hold_dd[-n:]) * 100, mode="lines", name="ซื้อแล้วถือ",
        line={"color": SERIES[1], "width": 2},
        hovertemplate="<b>ซื้อแล้วถือ</b>: %{y:.1f}%<extra></extra>",
    ))

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True,
        title="การขาดทุนจากจุดสูงสุด (drawdown)",
        hovermode="x unified",
    ))
    fig.update_yaxes(title_text="ต่ำกว่าจุดสูงสุด (%)")
    return fig


def exposure_chart(dates, exposure, height: int = 220) -> go.Figure:
    """สัดส่วนการถือครองของบอทในแต่ละวัน (0% = ถือเงินสดล้วน)"""
    n = min(len(dates), len(exposure))
    fig = go.Figure(go.Scatter(
        x=dates[-n:], y=np.asarray(exposure[-n:]) * 100, mode="lines",
        line={"color": SERIES[2], "width": 2, "shape": "hv"},
        fill="tozeroy", fillcolor="rgba(25,158,112,0.20)",
        name="สัดส่วนการถือครอง",
        hovertemplate="%{x|%d %b}<br>ถือครอง %{y:.0f}%<extra></extra>",
        showlegend=False,
    ))

    fig.update_layout(**plotly_layout(
        height=height,
        title="สัดส่วนการถือครองของบอท (ส่วนที่เหลือคือเงินสด)",
        hovermode="x unified",
    ))
    fig.update_yaxes(title_text="ถือครอง (%)", range=[0, 105])
    return fig


def portfolio_beta_gauge(beta_value: float, target: float, height: int = 200) -> go.Figure:
    """มาตรวัด β ของพอร์ตเทียบเป้าหมายที่ผู้ใช้ตั้งไว้"""
    if beta_value <= target * 0.85:
        bar_color = POS
    elif beta_value <= target * 1.15:
        bar_color = SERIES[3]
    else:
        bar_color = NEG

    fig = go.Figure(go.Indicator(
        mode="gauge+number+delta",
        value=beta_value,
        number={"font": {"color": TEXT_PRIMARY, "size": 30}, "valueformat": ".2f"},
        delta={"reference": target, "valueformat": "+.2f",
               "increasing": {"color": NEG}, "decreasing": {"color": POS},
               "font": {"size": 13}},
        gauge={
            "axis": {"range": [0, 3.0], "tickcolor": TEXT_MUTED,
                     "tickfont": {"color": TEXT_MUTED, "size": 10}},
            "bar": {"color": bar_color, "thickness": 0.7},
            "bgcolor": SURFACE,
            "borderwidth": 0,
            "steps": [
                {"range": [0, 1.0], "color": "rgba(255,255,255,0.04)"},
                {"range": [1.0, 2.0], "color": "rgba(255,255,255,0.07)"},
                {"range": [2.0, 3.0], "color": "rgba(255,255,255,0.10)"},
            ],
            "threshold": {"line": {"color": TEXT_PRIMARY, "width": 2},
                          "thickness": 0.85, "value": target},
        },
    ))

    fig.update_layout(**plotly_layout(
        height=height, title="β ของพอร์ต (เส้นขาว = เป้าหมาย)",
        margin={"l": 24, "r": 24, "t": 44, "b": 16},
    ))
    return fig


def signal_distribution(analysis, height: int = 220) -> go.Figure:
    """สรุปว่ามีกี่เหรียญในแต่ละกลุ่มสัญญาณ"""
    counts: dict[str, int] = {}
    for symbol in analysis.symbols:
        group = SIGNAL_STYLE[analysis.advices[symbol].signal]["group"]
        counts[group] = counts.get(group, 0) + 1

    order = ["ซื้อ", "ถือ", "ขาย/ลด"]
    labels = [g for g in order if g in counts]
    values = [counts[g] for g in labels]
    colors = [next(v["color"] for v in SIGNAL_STYLE.values() if v["group"] == g) for g in labels]

    fig = go.Figure(go.Bar(
        x=labels, y=values,
        marker={"color": colors, "line": {"width": 2, "color": SURFACE}},
        text=values, textposition="outside",
        textfont={"color": TEXT_SECONDARY, "size": 12},
        hovertemplate="<b>%{x}</b>: %{y} เหรียญ<extra></extra>",
        showlegend=False,
    ))

    fig.update_layout(**plotly_layout(height=height, title="สรุปสัญญาณทั้งพอร์ต"))
    fig.update_yaxes(title_text="จำนวนเหรียญ", dtick=1)
    fig.update_xaxes(showgrid=False)
    return fig


# ==========================================================================
# กราฟของระบบประเมินมูลค่า
# ==========================================================================

# สีของบันไดราคา — เป็นมาตราแบบขั้วคู่ (ฝั่งซื้อ=ฟ้า, กลาง=เทา, ฝั่งขาย=แดง)
# ไล่เข้มออกจากกึ่งกลางทั้งสองข้าง ตำแหน่งบนแกนจึงเป็นตัวสื่อความหมายหลัก
# ไม่ใช่สีเพียงอย่างเดียว และทุกแถบมีป้ายชื่อโซนกำกับไว้เสมอ
ZONE_COLORS: dict[str, str] = {
    "ซื้อเพิ่มหนัก": "#2a78d6",
    "ทยอยซื้อ": "#86b6ef",
    "ถือ": "#6b6f76",
    "ทยอยขาย": "#e8918c",
    "ขายออก": "#d03b3b",
}


def price_zone_ladder(zones, height: int = 210) -> go.Figure:
    """บันไดราคา — ที่ระดับราคาไหนควรซื้อ ถือ หรือขาย

    แถบเรียงตามแกนราคาจากถูกไปแพง พร้อมหมุดบอกราคาปัจจุบันและมูลค่าเหมาะสม
    """
    # ขอบซ้าย/ขวาของกราฟ เผื่อให้เห็นโซนปลายทั้งสองข้าง
    span = max(zones.exit_above - zones.strong_buy_below, zones.fair_price * 0.1)
    left = max(zones.strong_buy_below - span * 0.35, 0.0)
    right = zones.exit_above + span * 0.35

    segments = [
        ("ซื้อเพิ่มหนัก", left, zones.strong_buy_below),
        ("ทยอยซื้อ", zones.strong_buy_below, zones.accumulate_below),
        ("ถือ", zones.accumulate_below, zones.trim_above),
        ("ทยอยขาย", zones.trim_above, zones.exit_above),
        ("ขายออก", zones.exit_above, right),
    ]

    fig = go.Figure()
    for name, start, end in segments:
        fig.add_trace(go.Bar(
            y=["ราคา"], x=[end - start], base=[start], orientation="h",
            name=name, marker={"color": ZONE_COLORS[name],
                               "line": {"width": 2, "color": SURFACE}},
            hovertemplate=f"<b>{name}</b><br>{start:.8g} – {end:.8g}<extra></extra>",
        ))

    # มูลค่าเหมาะสม
    fig.add_vline(
        x=zones.fair_price, line_width=2, line_dash="dot", line_color=TEXT_SECONDARY,
        annotation_text=f"มูลค่าเหมาะสม {zones.fair_price:.8g}",
        annotation_position="top left",
        annotation_font_color=TEXT_SECONDARY, annotation_font_size=11,
    )
    # ราคาปัจจุบัน
    fig.add_vline(
        x=zones.spot, line_width=3, line_color=TEXT_PRIMARY,
        annotation_text=f"ราคาตอนนี้ {zones.spot:.8g}",
        annotation_position="bottom right",
        annotation_font_color=TEXT_PRIMARY, annotation_font_size=12,
    )

    fig.update_layout(**plotly_layout(
        height=height, show_legend=True, barmode="stack",
        title=f"บันไดราคา {zones.symbol} — ตอนนี้อยู่โซน “{zones.current_zone}”",
        margin={"l": 24, "r": 24, "t": 62, "b": 44},
    ))
    fig.update_xaxes(title_text="ราคา (USD)", range=[left, right])
    fig.update_yaxes(showgrid=False, showticklabels=False)
    return fig


def valuation_gap_bar(plans, height: int = 340) -> go.Figure:
    """ส่วนต่างระหว่างราคาตลาดกับมูลค่าเหมาะสมของทุกเหรียญ

    แท่งขวา (ฟ้า) = ถูกกว่ามูลค่า · แท่งซ้าย (แดง) = แพงกว่ามูลค่า
    """
    ordered = sorted(plans, key=lambda p: p.fair.gap)
    labels = [p.symbol for p in ordered]
    values = [p.fair.gap * 100 for p in ordered]
    detail = [f"ราคาตลาด {p.spot:.8g} · มูลค่าเหมาะสม {p.fair.fair_price:.8g}"
              for p in ordered]

    fig = go.Figure(go.Bar(
        x=values, y=labels, orientation="h",
        marker={"color": [POS if v >= 0 else NEG for v in values],
                "line": {"width": 2, "color": SURFACE}},
        customdata=detail,
        text=[f"{v:+.0f}%" for v in values], textposition="outside",
        textfont={"color": TEXT_SECONDARY, "size": 11},
        hovertemplate="<b>%{y}</b><br>ส่วนต่างจากมูลค่า %{x:+.1f}%<br>"
                      "%{customdata}<extra></extra>",
        showlegend=False,
    ))

    fig.add_vline(x=0, line_width=1, line_color=AXIS)
    span = max(abs(min(values, default=0)), abs(max(values, default=0)), 5) * 1.35
    fig.update_layout(**plotly_layout(
        height=height,
        title="ราคาตลาดถูกหรือแพงกว่ามูลค่าเหมาะสมกี่ %",
    ))
    fig.update_xaxes(title_text="ถูกกว่ามูลค่า (+) / แพงกว่ามูลค่า (−)  %",
                     range=[-span, span])
    fig.update_yaxes(showgrid=False)
    return fig


def plan_delta_bar(plans, height: int = 340) -> go.Figure:
    """ต้องซื้อเพิ่มหรือขายออกกี่ดอลลาร์ต่อเหรียญ"""
    actionable = [p for p in plans if p.action != "ถือ"]
    if not actionable:
        return go.Figure(layout=plotly_layout(height=height,
                                              title="พอร์ตอยู่ในระดับที่เหมาะสมแล้ว"))

    ordered = sorted(actionable, key=lambda p: p.delta_value)
    labels = [p.symbol for p in ordered]
    values = [p.delta_value for p in ordered]
    detail = [f"{p.action} · จาก {p.current_weight * 100:.1f}% "
              f"ไปที่ {p.target_weight * 100:.1f}%" for p in ordered]

    fig = go.Figure(go.Bar(
        x=values, y=labels, orientation="h",
        marker={"color": [POS if v >= 0 else NEG for v in values],
                "line": {"width": 2, "color": SURFACE}},
        customdata=detail,
        text=[f"{v:+,.0f}" for v in values], textposition="outside",
        textfont={"color": TEXT_SECONDARY, "size": 11},
        hovertemplate="<b>%{y}</b><br>%{customdata}<br>"
                      "ปรับ %{x:+,.0f} USD<extra></extra>",
        showlegend=False,
    ))

    fig.add_vline(x=0, line_width=1, line_color=AXIS)
    span = max(abs(min(values)), abs(max(values)), 1) * 1.4
    fig.update_layout(**plotly_layout(
        height=height, title="ต้องซื้อเพิ่ม (+) หรือขายออก (−) เท่าไหร่",
    ))
    fig.update_xaxes(title_text="มูลค่าที่ต้องปรับ (USD)", range=[-span, span])
    fig.update_yaxes(showgrid=False)
    return fig
