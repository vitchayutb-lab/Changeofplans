"""แหล่งข้อมูลราคา: CoinMarketCap API (ถ้ามี API key) หรือข้อมูลจำลอง

โหมดการทำงาน
------------
1. **live**      – มี CMC_API_KEY -> ดึงราคาล่าสุดจริงจาก CoinMarketCap
2. **simulated** – ไม่มี key หรือเรียก API ไม่สำเร็จ -> สร้างข้อมูลจำลองแบบ deterministic

หมายเหตุสำคัญ: CoinMarketCap แผนฟรีให้เฉพาะ "ราคาล่าสุด" ไม่ให้ราคาย้อนหลัง
ระบบจึงสร้างราคาย้อนหลังแบบจำลองเสมอ โดยตรึงปลายทางไว้ที่ราคาจริงล่าสุด
(ถ้าอยู่ในโหมด live) เพื่อให้กราฟและค่าสถิติต่อเนื่องกับราคาปัจจุบัน
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from core.config import COIN_NAMES, Settings

# ราคา/มาร์เก็ตแคปตั้งต้นสำหรับโหมดจำลอง (ระดับใกล้เคียงความเป็นจริง)
_FALLBACK_QUOTES: dict[str, dict[str, float]] = {
    "DOGE": {"price": 0.1620, "market_cap": 23_600_000_000, "volume_24h": 1_450_000_000},
    "SHIB": {"price": 0.00002450, "market_cap": 14_400_000_000, "volume_24h": 480_000_000},
    "PEPE": {"price": 0.00001180, "market_cap": 4_960_000_000, "volume_24h": 1_120_000_000},
    "WIF": {"price": 2.3400, "market_cap": 2_330_000_000, "volume_24h": 620_000_000},
    "BONK": {"price": 0.00002740, "market_cap": 1_930_000_000, "volume_24h": 310_000_000},
    "FLOKI": {"price": 0.00018600, "market_cap": 1_780_000_000, "volume_24h": 240_000_000},
    "MEW": {"price": 0.00840, "market_cap": 745_000_000, "volume_24h": 88_000_000},
    "POPCAT": {"price": 1.1200, "market_cap": 1_100_000_000, "volume_24h": 190_000_000},
}

# ลักษณะเฉพาะของแต่ละเหรียญในโหมดจำลอง: (beta เป้าหมาย, ความผันผวนเฉพาะตัวต่อวัน, drift ต่อวัน)
_COIN_CHARACTER: dict[str, tuple[float, float, float]] = {
    "DOGE": (1.15, 0.030, 0.0012),
    "SHIB": (1.45, 0.038, -0.0004),
    "PEPE": (2.35, 0.062, 0.0038),
    "WIF": (2.05, 0.058, -0.0021),
    "BONK": (1.85, 0.050, 0.0026),
    "FLOKI": (1.62, 0.045, 0.0005),
    "MEW": (2.20, 0.066, 0.0011),
    "POPCAT": (2.60, 0.071, 0.0030),
}


@dataclass(frozen=True)
class Quote:
    """ราคาล่าสุดของเหรียญหนึ่งตัว"""

    symbol: str
    name: str
    price: float
    pct_change_1h: float
    pct_change_24h: float
    pct_change_7d: float
    market_cap: float
    volume_24h: float
    source: str  # "live" หรือ "simulated"

    @property
    def volume_to_mcap(self) -> float:
        """สภาพคล่องเทียบขนาด: สูง = มีการซื้อขายคึกคักเทียบมาร์เก็ตแคป"""
        return self.volume_24h / self.market_cap if self.market_cap else 0.0


@dataclass
class MarketData:
    """ชุดข้อมูลตลาดทั้งหมดที่หน้าเว็บใช้"""

    quotes: dict[str, Quote]
    prices: dict[str, np.ndarray]  # ราคาปิดรายวัน เก่า -> ใหม่
    market_index: np.ndarray  # ดัชนีตลาดคริปโตรวม (ใช้เป็น benchmark ของ β)
    dates: pd.DatetimeIndex
    source: str  # โหมดของ "ราคาล่าสุด"
    notes: list[str] = field(default_factory=list)

    @property
    def symbols(self) -> list[str]:
        return list(self.quotes.keys())

    def returns(self, symbol: str) -> np.ndarray:
        from core.indicators import simple_returns

        return simple_returns(self.prices[symbol])

    @property
    def market_returns(self) -> np.ndarray:
        from core.indicators import simple_returns

        return simple_returns(self.market_index)

    def returns_by_symbol(self) -> dict[str, np.ndarray]:
        return {s: self.returns(s) for s in self.symbols}

    def price_frame(self) -> pd.DataFrame:
        """ตารางราคาย้อนหลังทุกเหรียญ + ดัชนีตลาด"""
        data = {s: self.prices[s] for s in self.symbols}
        data["MARKET"] = self.market_index
        return pd.DataFrame(data, index=self.dates)


# --------------------------------------------------------------------------
# CoinMarketCap API
# --------------------------------------------------------------------------

class CoinMarketCapClient:
    """ตัวเรียก CoinMarketCap Pro API (ต้องมี API key)

    ไม่มี key = ไม่เรียก API เลย เพื่อไม่ให้เสียเวลารอ error 401/400
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    def fetch_quotes(self, symbols: tuple[str, ...]) -> tuple[dict[str, Quote], str | None]:
        """ดึงราคาล่าสุด คืน (quotes, error_message)"""
        if not self.settings.has_live_key:
            return {}, "ไม่ได้ตั้งค่า CMC_API_KEY จึงใช้ข้อมูลจำลอง"

        try:
            import requests
        except ImportError:  # pragma: no cover - requests อยู่ใน requirements อยู่แล้ว
            return {}, "ไม่พบไลบรารี requests"

        url = f"{self.settings.cmc_base_url}/v1/cryptocurrency/quotes/latest"
        try:
            response = requests.get(
                url,
                headers={
                    "X-CMC_PRO_API_KEY": self.settings.cmc_api_key,
                    "Accept": "application/json",
                },
                params={"symbol": ",".join(symbols), "convert": "USD"},
                timeout=self.settings.request_timeout,
            )
        except Exception as exc:  # network error, timeout, DNS ฯลฯ
            return {}, f"เชื่อมต่อ CoinMarketCap ไม่สำเร็จ: {exc}"

        if response.status_code != 200:
            return {}, f"CoinMarketCap ตอบกลับ HTTP {response.status_code}"

        try:
            payload = response.json().get("data", {})
        except ValueError:
            return {}, "อ่านข้อมูล JSON จาก CoinMarketCap ไม่สำเร็จ"

        quotes: dict[str, Quote] = {}
        for symbol in symbols:
            entry = payload.get(symbol)
            # v1 คืน object เดี่ยว แต่บางแผนคืนเป็น list ของเหรียญที่ symbol ซ้ำกัน
            if isinstance(entry, list):
                entry = entry[0] if entry else None
            if not entry:
                continue
            usd = entry.get("quote", {}).get("USD", {})
            if not usd.get("price"):
                continue
            quotes[symbol] = Quote(
                symbol=symbol,
                name=entry.get("name", COIN_NAMES.get(symbol, symbol)),
                price=float(usd["price"]),
                pct_change_1h=float(usd.get("percent_change_1h") or 0.0),
                pct_change_24h=float(usd.get("percent_change_24h") or 0.0),
                pct_change_7d=float(usd.get("percent_change_7d") or 0.0),
                market_cap=float(usd.get("market_cap") or 0.0),
                volume_24h=float(usd.get("volume_24h") or 0.0),
                source="live",
            )

        if not quotes:
            return {}, "CoinMarketCap ไม่ส่งข้อมูลเหรียญที่ร้องขอกลับมา"
        return quotes, None


# --------------------------------------------------------------------------
# ตัวสร้างข้อมูลจำลอง
# --------------------------------------------------------------------------

def _symbol_seed(symbol: str, base_seed: int) -> int:
    """seed ที่คงที่ต่อเหรียญ เพื่อให้ผลลัพธ์ทำซ้ำได้ทุกครั้งที่รัน"""
    digest = hashlib.sha256(f"{symbol}:{base_seed}".encode()).hexdigest()
    return int(digest[:8], 16)


def _character(symbol: str, base_seed: int) -> tuple[float, float, float]:
    """ดึงลักษณะของเหรียญ ถ้าไม่ได้กำหนดไว้ให้สุ่มแบบคงที่จาก symbol"""
    if symbol in _COIN_CHARACTER:
        return _COIN_CHARACTER[symbol]
    rng = np.random.default_rng(_symbol_seed(symbol, base_seed))
    return (
        float(rng.uniform(1.0, 2.6)),  # beta
        float(rng.uniform(0.030, 0.070)),  # idiosyncratic vol
        float(rng.uniform(-0.003, 0.004)),  # drift
    )


def _fallback_quote(symbol: str, base_seed: int) -> dict[str, float]:
    if symbol in _FALLBACK_QUOTES:
        return _FALLBACK_QUOTES[symbol]
    rng = np.random.default_rng(_symbol_seed(symbol, base_seed) + 7)
    price = float(10 ** rng.uniform(-5, 0.5))
    mcap = float(rng.uniform(2e8, 5e9))
    return {"price": price, "market_cap": mcap, "volume_24h": mcap * float(rng.uniform(0.03, 0.4))}


def generate_market_index(days: int, seed: int) -> np.ndarray:
    """ดัชนีตลาดคริปโตรวมแบบจำลอง ใช้เป็น benchmark ในการหาค่า β

    สร้างด้วย GBM บวก regime ขาขึ้น/ขาลงสลับกัน เพื่อให้มีทั้งช่วงตลาดกระทิงและหมี
    """
    rng = np.random.default_rng(seed)
    daily_vol = 0.022
    # regime: สลับ drift ทุก ~30 วันเพื่อจำลองรอบตลาด
    n_regimes = max(1, days // 30)
    regime_drifts = rng.normal(0.0015, 0.0030, n_regimes)
    drift = np.repeat(regime_drifts, int(np.ceil(days / n_regimes)))[:days]

    shocks = rng.normal(0.0, daily_vol, days)
    returns = drift + shocks
    index = 1000.0 * np.cumprod(1.0 + returns)
    return index


def generate_price_series(symbol: str, market_returns: np.ndarray, anchor_price: float,
                          base_seed: int) -> np.ndarray:
    """สร้างราคาย้อนหลังของเหรียญจากโมเดลตลาดเดียว (single-factor model)

        r_coin = drift + β * r_market + ε

    ทำให้ค่า β ที่คำนวณย้อนกลับได้จากข้อมูลใกล้เคียงกับ β เป้าหมายที่ตั้งไว้
    ราคาสุดท้ายของซีรีส์จะถูกตรึงไว้ที่ anchor_price (ราคาล่าสุดจริงหรือค่าตั้งต้น)
    """
    target_beta, idio_vol, drift = _character(symbol, base_seed)
    rng = np.random.default_rng(_symbol_seed(symbol, base_seed))

    idio = rng.normal(0.0, idio_vol, market_returns.size)
    returns = drift + target_beta * market_returns + idio
    # กันราคาติดลบจากผลตอบแทนที่รุนแรงเกินไป
    returns = np.clip(returns, -0.45, 0.60)

    path = np.concatenate([[1.0], np.cumprod(1.0 + returns)])
    return path / path[-1] * anchor_price


def build_market_data(settings: Settings) -> MarketData:
    """ประกอบชุดข้อมูลตลาดทั้งหมด (ราคาล่าสุด + ราคาย้อนหลัง + ดัชนีตลาด)"""
    symbols = settings.symbols
    notes: list[str] = []

    live_quotes, error = CoinMarketCapClient(settings).fetch_quotes(symbols)
    if error:
        notes.append(error)

    days = settings.history_days
    market_index = generate_market_index(days, settings.seed)
    market_returns = market_index[1:] / market_index[:-1] - 1.0

    prices: dict[str, np.ndarray] = {}
    quotes: dict[str, Quote] = {}

    for symbol in symbols:
        live = live_quotes.get(symbol)
        anchor = live.price if live else _fallback_quote(symbol, settings.seed)["price"]
        series = generate_price_series(symbol, market_returns, anchor, settings.seed)
        prices[symbol] = series

        if live:
            quotes[symbol] = live
        else:
            fallback = _fallback_quote(symbol, settings.seed)
            pct_24h = (series[-1] / series[-2] - 1.0) * 100.0 if series.size > 1 else 0.0
            pct_7d = (series[-1] / series[-8] - 1.0) * 100.0 if series.size > 7 else 0.0
            pct_1h = pct_24h / 24.0
            quotes[symbol] = Quote(
                symbol=symbol,
                name=COIN_NAMES.get(symbol, symbol),
                price=float(series[-1]),
                pct_change_1h=float(pct_1h),
                pct_change_24h=float(pct_24h),
                pct_change_7d=float(pct_7d),
                market_cap=float(fallback["market_cap"]),
                volume_24h=float(fallback["volume_24h"]),
                source="simulated",
            )

    source = "live" if live_quotes else "simulated"
    if source == "live":
        notes.append("ราคาล่าสุดดึงจาก CoinMarketCap จริง ส่วนราคาย้อนหลังเป็นข้อมูลจำลอง")
    end = datetime.now(timezone.utc).date()
    dates = pd.DatetimeIndex([end - timedelta(days=days - 1 - i) for i in range(days)])

    return MarketData(
        quotes=quotes,
        prices=prices,
        market_index=market_index,
        dates=dates,
        source=source,
        notes=notes,
    )
