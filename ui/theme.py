"""ชุดสี ธีม และ CSS ของหน้าเว็บ

หน้าเว็บนี้ตั้งใจใช้ธีมมืดอย่างเดียว ทุกค่าสีจึงถูกเลือกและตรวจสอบกับพื้นหลังมืด
(#1a1a19) โดยเฉพาะ

หลักการเลือกสีกราฟ
------------------
* **สีบอกตัวตน (categorical)** ใช้ลำดับสีคงที่ 3 สีแรก (ฟ้า / ส้ม / เขียวน้ำทะเล)
  ซึ่งผ่านเกณฑ์การแยกแยะสำหรับผู้ที่มีภาวะตาบอดสีทุกคู่
* **สีบอกขั้ว (diverging)** ฟ้า ↔ แดง โดยมีเทากลาง ใช้กับค่าที่มีทั้งบวกและลบ
  เช่น สหสัมพันธ์ และคะแนนปัจจัย
* **สีบอกระดับ (sequential)** ไล่เฉดฟ้าเฉดเดียว ใช้กับกราฟพัดพยากรณ์
* สัญญาณซื้อ/ถือ/ขาย ใช้ทั้งสีและ **รูปทรงหมุด** (สามเหลี่ยมขึ้น/วงกลม/สามเหลี่ยมลง)
  เพราะคู่สีแดง-เทาแยกยากสำหรับผู้ที่ตาบอดสีแบบ protan — รูปทรงจึงเป็นช่องทางสำรอง
"""

from __future__ import annotations

# --- พื้นผิวและตัวอักษร ---
SURFACE = "#1a1a19"
PAGE = "#0d0d0d"
TEXT_PRIMARY = "#ffffff"
TEXT_SECONDARY = "#c3c2b7"
TEXT_MUTED = "#898781"
GRID = "#2c2c2a"
AXIS = "#383835"
BORDER = "rgba(255,255,255,0.10)"

# --- สีบอกตัวตน (ใช้ตามลำดับ ห้ามวนซ้ำ) ---
SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]

# --- สีบอกขั้ว ---
POS = "#3987e5"  # ขั้วบวก (ฟ้า)
NEG = "#e66767"  # ขั้วลบ (แดง)
NEUTRAL = "#898781"  # กลาง (เทา)

# --- สีบอกสถานะ (มาพร้อมไอคอน + ป้ายกำกับเสมอ ไม่ใช้สีลอย ๆ) ---
GOOD = "#0ca30c"
WARNING = "#fab219"
SERIOUS = "#ec835a"
CRITICAL = "#d03b3b"

# --- ไล่เฉดฟ้าเฉดเดียว (อ่อน -> เข้ม) ---
BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]

# มาตราส่วนสีแบบ diverging สำหรับ heatmap (-1 -> 0 -> +1)
DIVERGING_SCALE = [
    [0.0, "#e66767"],
    [0.25, "#b45252"],
    [0.5, "#383835"],
    [0.75, "#2a6ab0"],
    [1.0, "#3987e5"],
]

# สี + รูปทรงของแต่ละสัญญาณ (รูปทรงคือช่องทางสำรองเมื่อแยกสีไม่ออก)
SIGNAL_STYLE: dict[str, dict[str, str]] = {
    "STRONG BUY": {"color": POS, "symbol": "triangle-up", "group": "ซื้อ"},
    "BUY": {"color": POS, "symbol": "triangle-up", "group": "ซื้อ"},
    "HOLD": {"color": NEUTRAL, "symbol": "circle", "group": "ถือ"},
    "REDUCE": {"color": NEG, "symbol": "triangle-down", "group": "ขาย/ลด"},
    "SELL": {"color": NEG, "symbol": "triangle-down", "group": "ขาย/ลด"},
}

FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif'


def plotly_layout(height: int = 340, show_legend: bool = False, **overrides) -> dict:
    """เลย์เอาต์มาตรฐานของกราฟทุกตัว — เส้นกริดจาง แกนบาง ตัวอักษรใช้สีข้อความ"""
    layout = {
        "height": height,
        "paper_bgcolor": SURFACE,
        "plot_bgcolor": SURFACE,
        "font": {"family": FONT_FAMILY, "color": TEXT_SECONDARY, "size": 12},
        # legend ลอยอยู่เหนือพื้นที่วาด จึงต้องเผื่อขอบบนเพิ่ม ไม่งั้นจะทับหัวข้อ
        "margin": {"l": 56, "r": 24, "t": 74 if show_legend else 44, "b": 44},
        "showlegend": show_legend,
        "legend": {
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.06,
            "xanchor": "left",
            "x": 0,
            "font": {"color": TEXT_SECONDARY, "size": 11},
            "bgcolor": "rgba(0,0,0,0)",
        },
        "xaxis": {
            "gridcolor": GRID,
            "linecolor": AXIS,
            "zerolinecolor": AXIS,
            "tickfont": {"color": TEXT_MUTED, "size": 11},
            "title": {"font": {"color": TEXT_MUTED, "size": 11}},
        },
        "yaxis": {
            "gridcolor": GRID,
            "linecolor": AXIS,
            "zerolinecolor": AXIS,
            "tickfont": {"color": TEXT_MUTED, "size": 11},
            "title": {"font": {"color": TEXT_MUTED, "size": 11}},
        },
        "hoverlabel": {
            "bgcolor": PAGE,
            "bordercolor": AXIS,
            "font": {"family": FONT_FAMILY, "color": TEXT_PRIMARY, "size": 12},
        },
        "title": {"font": {"color": TEXT_PRIMARY, "size": 14}, "x": 0, "xanchor": "left"},
    }
    layout.update(overrides)
    return layout


def signal_color(signal: str) -> str:
    return SIGNAL_STYLE.get(signal, {"color": NEUTRAL})["color"]


def delta_color(value: float) -> str:
    """สีของตัวเลขเปลี่ยนแปลง — เขียวขึ้น แดงลง"""
    if value > 0:
        return GOOD
    if value < 0:
        return CRITICAL
    return TEXT_MUTED


CUSTOM_CSS = f"""
<style>
  .stApp {{
      background: {PAGE};
      font-family: {FONT_FAMILY};
  }}
  .block-container {{ padding-top: 2.2rem; max-width: 1400px; }}

  /* หัวเรื่องหลัก */
  .hero {{
      background: linear-gradient(135deg, #16213a 0%, {SURFACE} 55%);
      border: 1px solid {BORDER};
      border-radius: 14px;
      padding: 22px 26px;
      margin-bottom: 18px;
  }}
  .hero h1 {{ margin: 0 0 6px 0; font-size: 1.65rem; color: {TEXT_PRIMARY}; }}
  .hero p {{ margin: 0; color: {TEXT_SECONDARY}; font-size: 0.95rem; line-height: 1.6; }}

  /* ป้ายสถานะแหล่งข้อมูล */
  .badge {{
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 6px;
      border: 1px solid {BORDER};
  }}
  .badge-live {{ background: rgba(12,163,12,0.15); color: {GOOD}; }}
  .badge-sim {{ background: rgba(250,178,25,0.15); color: {WARNING}; }}

  /* การ์ดสถิติ */
  .stat-card {{
      background: {SURFACE};
      border: 1px solid {BORDER};
      border-radius: 12px;
      padding: 14px 16px;
      height: 100%;
  }}
  .stat-card .label {{
      color: {TEXT_MUTED};
      font-size: 0.78rem;
      letter-spacing: 0.02em;
      margin-bottom: 4px;
  }}
  .stat-card .value {{
      color: {TEXT_PRIMARY};
      font-size: 1.5rem;
      font-weight: 650;
      line-height: 1.2;
  }}
  .stat-card .sub {{ color: {TEXT_SECONDARY}; font-size: 0.78rem; margin-top: 4px; }}

  /* การ์ดคำแนะนำ */
  .advice-card {{
      background: {SURFACE};
      border: 1px solid {BORDER};
      border-left: 3px solid {NEUTRAL};
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 12px;
  }}
  .advice-card.buy {{ border-left-color: {POS}; }}
  .advice-card.sell {{ border-left-color: {NEG}; }}
  .advice-card .signal {{ font-size: 1.15rem; font-weight: 700; color: {TEXT_PRIMARY}; }}
  .advice-card .reason {{ color: {TEXT_SECONDARY}; font-size: 0.88rem; line-height: 1.7; }}

  /* กล่องเตือน */
  .callout {{
      border-radius: 10px;
      padding: 12px 16px;
      margin: 8px 0;
      font-size: 0.88rem;
      line-height: 1.6;
      border: 1px solid {BORDER};
      color: {TEXT_SECONDARY};
      background: {SURFACE};
  }}
  .callout-warn {{ border-left: 3px solid {WARNING}; }}
  .callout-info {{ border-left: 3px solid {POS}; }}
  .callout-danger {{ border-left: 3px solid {CRITICAL}; }}

  /* แถบข้อความปฏิเสธความรับผิด */
  .disclaimer {{
      background: rgba(208,59,59,0.10);
      border: 1px solid rgba(208,59,59,0.35);
      border-radius: 10px;
      padding: 10px 14px;
      color: {TEXT_SECONDARY};
      font-size: 0.82rem;
      line-height: 1.6;
      margin-top: 8px;
  }}

  /* แท็บ */
  .stTabs [data-baseweb="tab-list"] {{ gap: 4px; border-bottom: 1px solid {BORDER}; }}
  .stTabs [data-baseweb="tab"] {{
      background: transparent;
      color: {TEXT_MUTED};
      border-radius: 8px 8px 0 0;
      padding: 8px 16px;
  }}
  .stTabs [aria-selected="true"] {{ color: {TEXT_PRIMARY}; background: {SURFACE}; }}

  /* ตาราง: ตัวเลขเรียงหลักตรงกัน */
  .stDataFrame {{ font-variant-numeric: tabular-nums; }}

  /* บันทึกการเทรด */
  .log-line {{
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.82rem;
      padding: 7px 12px;
      border-radius: 8px;
      margin-bottom: 5px;
      background: {SURFACE};
      border-left: 3px solid {AXIS};
      color: {TEXT_SECONDARY};
  }}
  .log-line.filled-buy {{ border-left-color: {POS}; }}
  .log-line.filled-sell {{ border-left-color: {NEG}; }}
  .log-line.rejected {{ border-left-color: {WARNING}; opacity: 0.85; }}
</style>
"""


def stat_card(label: str, value: str, sub: str = "", value_color: str | None = None) -> str:
    """สร้าง HTML ของการ์ดตัวเลขหนึ่งใบ"""
    color_style = f' style="color:{value_color}"' if value_color else ""
    sub_html = f'<div class="sub">{sub}</div>' if sub else ""
    return (
        f'<div class="stat-card"><div class="label">{label}</div>'
        f'<div class="value"{color_style}>{value}</div>{sub_html}</div>'
    )


def format_price(price: float) -> str:
    """เหรียญมีมราคาต่ำมาก ต้องแสดงทศนิยมมากพอให้เห็นการเปลี่ยนแปลง"""
    if price >= 1000:
        return f"${price:,.0f}"
    if price >= 1:
        return f"${price:,.4f}"
    if price >= 0.0001:
        return f"${price:.6f}"
    return f"${price:.8f}"


def format_usd(value: float) -> str:
    if abs(value) >= 1e9:
        return f"${value / 1e9:.2f}B"
    if abs(value) >= 1e6:
        return f"${value / 1e6:.1f}M"
    if abs(value) >= 1e3:
        return f"${value / 1e3:.1f}K"
    return f"${value:,.2f}"
