"""MemeCoin Auto-Bot & AI Portfolio Manager — จุดเริ่มต้นของเว็บไซต์ (Streamlit)

รันด้วย:  streamlit run app.py
"""

from __future__ import annotations

import streamlit as st

from core.analytics import build_analysis
from core.config import COIN_NAMES, DEFAULT_SYMBOLS, Settings, load_settings
from core.portfolio import Portfolio
from ui import sections
from ui.theme import CUSTOM_CSS

st.set_page_config(
    page_title="MemeCoin AI Bot",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded",
)


@st.cache_data(ttl=300, show_spinner="กำลังดึงข้อมูลตลาดและวิเคราะห์...")
def load_analysis(settings: Settings):
    """วิเคราะห์ทั้งระบบ แล้วแคชไว้ 5 นาทีเพื่อไม่ให้เรียก API ซ้ำทุกครั้งที่กดปุ่ม"""
    return build_analysis(settings)


def init_session_state() -> None:
    if "portfolio" not in st.session_state:
        st.session_state.portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
    if "trade_log" not in st.session_state:
        st.session_state.trade_log = []


def render_sidebar(base: Settings) -> tuple[Settings, float]:
    """แถบด้านข้าง: เลือกเหรียญและตั้งสมมติฐานทางการเงิน"""
    with st.sidebar:
        st.markdown("### ⚙️ ตั้งค่าระบบ")

        symbols = st.multiselect(
            "เหรียญมีมที่ติดตาม",
            options=list(COIN_NAMES.keys()),
            default=list(base.symbols) or list(DEFAULT_SYMBOLS),
            format_func=lambda s: f"{s} — {COIN_NAMES.get(s, s)}",
        )
        if not symbols:
            symbols = list(DEFAULT_SYMBOLS)
            st.warning("ต้องเลือกอย่างน้อย 1 เหรียญ — ใช้ค่าเริ่มต้นแทน")

        st.markdown("---")
        st.markdown("#### สมมติฐานทางการเงิน")

        risk_free = st.slider(
            "อัตราผลตอบแทนปราศจากความเสี่ยง (%/ปี)", 0.0, 10.0, base.risk_free_rate * 100, 0.5,
            help="ใช้เป็นฐานในสูตร CAPM ปกติอ้างอิงพันธบัตรรัฐบาลระยะสั้น",
        ) / 100.0

        market_return = st.slider(
            "ผลตอบแทนคาดหวังของตลาดคริปโต (%/ปี)", -50.0, 150.0,
            base.market_expected_return * 100, 5.0,
            help="มุมมองของคุณต่อตลาดรวม — ค่านี้ส่งผลโดยตรงต่อเกณฑ์ CAPM ของทุกเหรียญ",
        ) / 100.0

        horizon = st.slider("กรอบเวลาพยากรณ์ (วัน)", 7, 90, base.mc_horizon_days, 1)

        history_days = st.select_slider(
            "ช่วงข้อมูลย้อนหลังที่ใช้คำนวณ β (วัน)",
            options=[90, 120, 180, 270, 365],
            value=base.history_days if base.history_days in (90, 120, 180, 270, 365) else 180,
        )

        st.markdown("---")
        st.markdown("#### เป้าหมายความเสี่ยงพอร์ต")
        target_beta = st.slider(
            "β เป้าหมายของพอร์ต", 0.0, 3.0, 1.20, 0.05,
            help="β = 1 คือรับความเสี่ยงเท่าตลาด · ต่ำกว่า 1 คืออนุรักษ์นิยม · สูงกว่า 1 คือเร่งความเสี่ยง",
        )

        st.markdown("---")
        if st.button("🔄 ดึงข้อมูลใหม่", use_container_width=True):
            st.cache_data.clear()
            st.rerun()

        st.caption(
            "ตั้งค่า `CMC_API_KEY` เป็น environment variable เพื่อดึงราคาจริงจาก CoinMarketCap "
            "หากไม่ตั้งค่า ระบบจะใช้ข้อมูลจำลองที่ทำซ้ำได้"
        )

    settings = Settings(
        cmc_api_key=base.cmc_api_key,
        cmc_base_url=base.cmc_base_url,
        request_timeout=base.request_timeout,
        symbols=tuple(symbols),
        history_days=int(history_days),
        seed=base.seed,
        risk_free_rate=risk_free,
        market_expected_return=market_return,
        mc_paths=base.mc_paths,
        mc_horizon_days=int(horizon),
    )
    return settings, target_beta


def render_header(analysis) -> None:
    is_live = analysis.market.source == "live"
    badge = (
        '<span class="badge badge-live">● ราคาจริงจาก CoinMarketCap</span>'
        if is_live else
        '<span class="badge badge-sim">● โหมดข้อมูลจำลอง</span>'
    )

    st.markdown(
        f'<div class="hero">'
        f'<h1>🤖 MemeCoin Auto-Bot & AI Portfolio Manager</h1>'
        f'<p>ระบบสาธิตบอทยิงออเดอร์เหรียญมีมอัตโนมัติ พร้อมเครื่องมือ AI '
        f'วิเคราะห์ความเสี่ยงพอร์ตด้วยค่า <b>Beta (β)</b> พยากรณ์ทิศทางราคาด้วยการจำลอง '
        f'<b>Monte Carlo</b> และแนะนำว่าควร <b>ถือหรือขาย</b> เหรียญไหน</p>'
        f'<div style="margin-top:12px">{badge}'
        f'<span class="badge badge-sim">● ราคาย้อนหลังเป็นข้อมูลจำลอง</span>'
        f'<span class="badge badge-sim">● ออเดอร์ทั้งหมดเป็นการจำลอง</span></div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    for note in analysis.market.notes:
        st.caption(f"ℹ️ {note}")


def main() -> None:
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
    init_session_state()

    base_settings = load_settings()
    settings, target_beta = render_sidebar(base_settings)

    analysis = load_analysis(settings)
    render_header(analysis)

    tab_market, tab_ai, tab_portfolio, tab_bot, tab_backtest = st.tabs([
        "📊 ภาพรวมตลาด",
        "🧠 วิเคราะห์ด้วย AI",
        "💼 พอร์ต & ค่า β",
        "⚡ บอทยิงออเดอร์",
        "🔬 ทดสอบย้อนหลัง",
    ])

    with tab_market:
        sections.render_market_tab(analysis)
    with tab_ai:
        sections.render_analysis_tab(analysis)
    with tab_portfolio:
        sections.render_portfolio_tab(analysis, st.session_state.portfolio, target_beta)
    with tab_bot:
        sections.render_bot_tab(analysis, st.session_state.portfolio)
    with tab_backtest:
        sections.render_backtest_tab(analysis)

    st.markdown(f'<div class="disclaimer">{sections.DISCLAIMER}</div>', unsafe_allow_html=True)


if __name__ == "__main__":
    main()
