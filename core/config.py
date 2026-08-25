"""ค่าคอนฟิกกลางของแอป (โหลดจาก environment variables ได้)

ทุกค่ามี default ที่ใช้งานได้ทันทีโดยไม่ต้องตั้ง .env
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace

# เหรียญมีมที่ระบบติดตามเป็นค่าเริ่มต้น (symbol ตามที่ใช้บน CoinMarketCap)
DEFAULT_SYMBOLS: tuple[str, ...] = ("DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI")

# ชื่อเต็มของเหรียญ ใช้แสดงผลบน UI
COIN_NAMES: dict[str, str] = {
    # --- สายหมา ---
    "DOGE": "Dogecoin",
    "SHIB": "Shiba Inu",
    "FLOKI": "Floki",
    "BONK": "Bonk",
    "WIF": "dogwifhat",
    "MYRO": "Myro",
    "PONKE": "Ponke",
    "NEIRO": "Neiro",
    # --- สายแมว ---
    "POPCAT": "Popcat",
    "MEW": "cat in a dogs world",
    "MICHI": "Michi",
    # --- สายกบ ---
    "PEPE": "Pepe",
    "BRETT": "Brett",
    "TURBO": "Turbo",
    # --- สัตว์อื่น ---
    "PNUT": "Peanut the Squirrel",
    "MOODENG": "Moo Deng",
    "GOAT": "Goatseus Maximus",
    # --- สายคลาสสิก / อื่น ๆ ---
    "MOG": "Mog Coin",
    "SPX": "SPX6900",
    "BOME": "Book of Meme",
    "TOSHI": "Toshi",
    "DEGEN": "Degen",
    "SLERF": "Slerf",
    "WEN": "Wen",
    "LADYS": "Milady Meme Coin",
    "BILLY": "Billy",
}

# หมวดหมู่ของเหรียญ ใช้กรองรายการบนหน้าเว็บเมื่อมีเหรียญให้เลือกเยอะ
COIN_CATEGORIES: dict[str, tuple[str, ...]] = {
    "สายหมา 🐕": ("DOGE", "SHIB", "FLOKI", "BONK", "WIF", "MYRO", "PONKE", "NEIRO"),
    "สายแมว 🐱": ("POPCAT", "MEW", "MICHI"),
    "สายกบ 🐸": ("PEPE", "BRETT", "TURBO"),
    "สัตว์อื่น 🐿️": ("PNUT", "MOODENG", "GOAT"),
    "คลาสสิก / อื่น ๆ ✨": ("MOG", "SPX", "BOME", "TOSHI", "DEGEN", "SLERF", "WEN",
                            "LADYS", "BILLY"),
}


def category_of(symbol: str) -> str:
    """หมวดหมู่ของเหรียญ (คืน 'อื่น ๆ' ถ้าไม่ได้จัดหมวดไว้)"""
    for name, members in COIN_CATEGORIES.items():
        if symbol in members:
            return name
    return "อื่น ๆ"

# จำนวนวันต่อปีที่ใช้ annualize ค่าสถิติ (คริปโตเทรด 365 วัน/ปี)
PERIODS_PER_YEAR = 365


def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """พารามิเตอร์ที่ใช้ทั้งระบบ"""

    # --- แหล่งข้อมูล ---
    cmc_api_key: str = ""
    cmc_base_url: str = "https://pro-api.coinmarketcap.com"
    request_timeout: float = 8.0
    symbols: tuple[str, ...] = DEFAULT_SYMBOLS

    # --- ข้อมูลราคาย้อนหลัง ---
    history_days: int = 180
    seed: int = 20240614

    # --- สมมติฐานเชิงการเงิน ---
    risk_free_rate: float = 0.04  # อัตราผลตอบแทนปราศจากความเสี่ยงต่อปี
    market_expected_return: float = 0.35  # ผลตอบแทนคาดหวังของตลาดคริปโตต่อปี

    # --- Monte Carlo ---
    mc_paths: int = 2000
    mc_horizon_days: int = 30

    @property
    def has_live_key(self) -> bool:
        return bool(self.cmc_api_key.strip())

    def with_symbols(self, symbols: list[str] | tuple[str, ...]) -> "Settings":
        return replace(self, symbols=tuple(symbols))


def load_settings() -> Settings:
    """อ่านค่าจาก environment variables ทับค่า default"""
    raw_symbols = os.getenv("MEME_SYMBOLS", "")
    symbols = tuple(s.strip().upper() for s in raw_symbols.split(",") if s.strip())

    return Settings(
        cmc_api_key=os.getenv("CMC_API_KEY", "").strip(),
        cmc_base_url=os.getenv("CMC_BASE_URL", "https://pro-api.coinmarketcap.com").rstrip("/"),
        request_timeout=_env_float("CMC_TIMEOUT", 8.0),
        symbols=symbols or DEFAULT_SYMBOLS,
        history_days=_env_int("HISTORY_DAYS", 180),
        seed=_env_int("RANDOM_SEED", 20240614),
        risk_free_rate=_env_float("RISK_FREE_RATE", 0.04),
        market_expected_return=_env_float("MARKET_EXPECTED_RETURN", 0.35),
        mc_paths=_env_int("MC_PATHS", 2000),
        mc_horizon_days=_env_int("MC_HORIZON_DAYS", 30),
    )
