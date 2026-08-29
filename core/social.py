"""วัดกระแสโซเชียลของเหรียญมีม

เหรียญมีมต่างจากสินทรัพย์อื่นตรงที่ราคาขับเคลื่อนด้วย **ความสนใจของคน** มากกว่า
ปัจจัยพื้นฐาน โมดูลนี้จึงวัด "กระแส" ออกมาเป็นตัวเลขที่เอาไปใช้ต่อได้

    buzz score = ปริมาณการพูดถึง × การเปลี่ยนแปลง × อารมณ์ของข้อความ

แหล่งข้อมูล (ต่อเพิ่มได้โดยไม่ต้องแก้โมดูลอื่น)
-----------------------------------------------
* **Reddit**      – endpoint สาธารณะ .json ไม่ต้องใช้ API key
* **CoinGecko**   – รายการเหรียญที่คนค้นหามากสุด ไม่ต้องใช้ API key
* **จำลอง**       – ใช้เมื่อออนไลน์ไม่ได้ ผลลัพธ์คงที่ทุกครั้งที่รัน

ข้อจำกัดที่ต้องรู้
------------------
X/Twitter และ TikTok ไม่มี API ฟรีที่ใช้ได้ตามข้อกำหนดอีกแล้ว ระบบนี้จึงครอบคลุม
เฉพาะ Reddit และสัญญาณการค้นหา ไม่ใช่ "โซเชียลทั่วโลก" ทั้งหมด หน้าเว็บติดป้าย
บอกเสมอว่าข้อมูลมาจากแหล่งใดและเป็นข้อมูลจริงหรือจำลอง
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from core.config import COIN_NAMES, Settings

# --------------------------------------------------------------------------
# พจนานุกรมอารมณ์ — คำแสลงที่คนคริปโตใช้จริง ไม่ใช่พจนานุกรมภาษาอังกฤษทั่วไป
# --------------------------------------------------------------------------

BULLISH_TERMS: dict[str, float] = {
    "moon": 1.0, "mooning": 1.0, "pump": 0.8, "pumping": 0.8, "bullish": 0.9,
    "ath": 0.8, "gem": 0.7, "based": 0.5, "lfg": 0.8, "wagmi": 0.8,
    "hodl": 0.5, "diamond hands": 0.9, "send it": 0.7, "breakout": 0.7,
    "accumulate": 0.5, "buying": 0.5, "loaded": 0.6, "rocket": 0.9,
    "undervalued": 0.7, "early": 0.5, "10x": 0.9, "100x": 1.0, "parabolic": 0.9,
}

BEARISH_TERMS: dict[str, float] = {
    "rug": -1.0, "rugpull": -1.0, "rug pull": -1.0, "dump": -0.8, "dumping": -0.8,
    "bearish": -0.9, "scam": -1.0, "dead": -0.8, "exit liquidity": -0.9,
    "ngmi": -0.7, "rekt": -0.8, "bagholder": -0.7, "bagholding": -0.7,
    "crash": -0.9, "honeypot": -1.0, "selling": -0.5, "sold": -0.4,
    "overvalued": -0.6, "top signal": -0.7, "ponzi": -1.0, "down bad": -0.7,
}

_WORD_RE = re.compile(r"[a-z0-9']+")


def score_text(text: str) -> float:
    """ให้คะแนนอารมณ์ของข้อความหนึ่งชิ้น คืนค่า -1 ถึง +1

    ใช้การจับคู่คำแสลงแบบถ่วงน้ำหนัก แล้วหารด้วยจำนวนคำที่จับได้
    ข้อความที่ไม่มีคำในพจนานุกรมเลยจะได้ 0.0 (เป็นกลาง)
    """
    if not text:
        return 0.0
    lowered = text.lower()

    hits: list[float] = []
    # วลีสองคำต้องตรวจก่อน ไม่งั้น "diamond hands" จะถูกนับเป็นคำเดี่ยวที่ไม่รู้จัก
    for phrase, weight in list(BULLISH_TERMS.items()) + list(BEARISH_TERMS.items()):
        if " " in phrase and phrase in lowered:
            hits.append(weight)
            lowered = lowered.replace(phrase, " ")

    for word in _WORD_RE.findall(lowered):
        if word in BULLISH_TERMS:
            hits.append(BULLISH_TERMS[word])
        elif word in BEARISH_TERMS:
            hits.append(BEARISH_TERMS[word])

    if not hits:
        return 0.0
    return float(np.clip(sum(hits) / len(hits), -1.0, 1.0))


# --------------------------------------------------------------------------
# โครงสร้างข้อมูล
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class SocialPost:
    """โพสต์หรือกระทู้หนึ่งชิ้นที่พูดถึงเหรียญ"""

    source: str          # reddit / coingecko / simulated
    title: str
    url: str
    engagement: int      # upvote, like หรือค่าเทียบเท่า
    created_at: datetime

    @property
    def sentiment(self) -> float:
        return score_text(self.title)


@dataclass(frozen=True)
class SocialSignal:
    """สรุปกระแสโซเชียลของเหรียญหนึ่งตัว"""

    symbol: str
    mentions_24h: int
    mentions_prev_24h: int
    sentiment: float          # -1 ถึง +1
    engagement: int           # ยอดปฏิสัมพันธ์รวม
    search_rank: int | None   # อันดับความนิยมในการค้นหา (None = ไม่ติดอันดับ)
    posts: list[SocialPost] = field(default_factory=list)
    sources: tuple[str, ...] = ()

    @property
    def mention_change(self) -> float:
        """การพูดถึงเปลี่ยนไปกี่ % เทียบ 24 ชม. ก่อนหน้า"""
        if self.mentions_prev_24h <= 0:
            return 1.0 if self.mentions_24h > 0 else 0.0
        return self.mentions_24h / self.mentions_prev_24h - 1.0

    @property
    def buzz_score(self) -> float:
        """คะแนนกระแสรวม 0-100

        ผสม 3 อย่าง: ปริมาณการพูดถึง (40%) · การเร่งตัว (40%) · อารมณ์ (20%)
        การเร่งตัวถ่วงหนักพอ ๆ กับปริมาณ เพราะเหรียญมีมมักวิ่งตอน "กำลังเป็นกระแส"
        ไม่ใช่ตอนที่ดังอยู่แล้ว
        """
        volume = float(np.tanh(self.mentions_24h / 120.0))
        acceleration = float(np.tanh(self.mention_change / 1.2))
        mood = (self.sentiment + 1.0) / 2.0

        raw = 0.40 * volume + 0.40 * max(acceleration, 0.0) + 0.20 * mood
        return float(np.clip(raw * 100.0, 0.0, 100.0))

    @property
    def trend(self) -> str:
        change = self.mention_change
        if change >= 0.60:
            return "กระแสพุ่ง"
        if change >= 0.15:
            return "กระแสขึ้น"
        if change > -0.15:
            return "กระแสทรงตัว"
        if change > -0.50:
            return "กระแสแผ่ว"
        return "กระแสหาย"

    @property
    def mood(self) -> str:
        if self.sentiment >= 0.35:
            return "คนพูดถึงในแง่บวก"
        if self.sentiment > -0.35:
            return "ความเห็นผสมกัน"
        return "คนพูดถึงในแง่ลบ"

    @property
    def is_hot(self) -> bool:
        return self.buzz_score >= 60.0


@dataclass
class SocialPulse:
    """ภาพรวมกระแสของทุกเหรียญที่ติดตาม"""

    signals: dict[str, SocialSignal]
    source: str                      # live / simulated / mixed
    fetched_at: datetime
    notes: list[str] = field(default_factory=list)

    def ranked(self) -> list[SocialSignal]:
        return sorted(self.signals.values(), key=lambda s: s.buzz_score, reverse=True)

    def hottest(self) -> SocialSignal | None:
        ranked = self.ranked()
        return ranked[0] if ranked else None

    @property
    def hype_index(self) -> float:
        """ดัชนีกระแสมีมรวมของตลาด 0-100"""
        if not self.signals:
            return 0.0
        return float(np.mean([s.buzz_score for s in self.signals.values()]))

    @property
    def market_mood(self) -> str:
        index = self.hype_index
        if index >= 65:
            return "กระแสมีมร้อนแรง"
        if index >= 40:
            return "กระแสมีมปานกลาง"
        return "กระแสมีมเงียบ"


# --------------------------------------------------------------------------
# แหล่งข้อมูลจริง
# --------------------------------------------------------------------------

class RedditSource:
    """ดึงกระทู้จาก Reddit ผ่าน endpoint สาธารณะ (ไม่ต้องใช้ API key)

    Reddit บังคับให้ส่ง User-Agent ที่ระบุตัวตนได้ ไม่งั้นจะโดน 429
    """

    SUBREDDITS = ("CryptoCurrency", "CryptoMoonShots", "SatoshiStreetBets", "memecoins")

    def __init__(self, settings: Settings):
        self.settings = settings

    def fetch(self, symbol: str) -> tuple[list[SocialPost], str | None]:
        try:
            import requests
        except ImportError:  # pragma: no cover
            return [], "ไม่พบไลบรารี requests"

        name = COIN_NAMES.get(symbol, symbol)
        query = f"{symbol} OR {name}"
        posts: list[SocialPost] = []

        for sub in self.SUBREDDITS[:2]:  # จำกัดไว้ 2 subreddit เพื่อไม่ให้ช้าเกินไป
            url = f"https://www.reddit.com/r/{sub}/search.json"
            try:
                response = requests.get(
                    url,
                    params={"q": query, "restrict_sr": 1, "sort": "new",
                            "t": "week", "limit": 25},
                    headers={"User-Agent": "memecoin-ai-demo/1.0 (educational project)"},
                    timeout=self.settings.request_timeout,
                )
            except Exception as exc:
                return posts, f"เชื่อมต่อ Reddit ไม่สำเร็จ: {exc}"

            if response.status_code != 200:
                return posts, f"Reddit ตอบกลับ HTTP {response.status_code}"

            try:
                children = response.json().get("data", {}).get("children", [])
            except ValueError:
                return posts, "อ่านข้อมูล JSON จาก Reddit ไม่สำเร็จ"

            for child in children:
                data = child.get("data", {})
                created = data.get("created_utc")
                if not created:
                    continue
                posts.append(SocialPost(
                    source="reddit",
                    title=data.get("title", ""),
                    url="https://reddit.com" + data.get("permalink", ""),
                    engagement=int(data.get("score", 0) or 0) + int(data.get("num_comments", 0) or 0),
                    created_at=datetime.fromtimestamp(float(created), tz=timezone.utc),
                ))

        return posts, None


class CoinGeckoTrendingSource:
    """อันดับเหรียญที่คนค้นหามากที่สุดบน CoinGecko (ไม่ต้องใช้ API key)"""

    URL = "https://api.coingecko.com/api/v3/search/trending"

    def __init__(self, settings: Settings):
        self.settings = settings

    def fetch(self) -> tuple[dict[str, int], str | None]:
        """คืน {symbol: อันดับ} — อันดับ 1 คือถูกค้นหามากสุด"""
        try:
            import requests
        except ImportError:  # pragma: no cover
            return {}, "ไม่พบไลบรารี requests"

        try:
            response = requests.get(self.URL, timeout=self.settings.request_timeout)
        except Exception as exc:
            return {}, f"เชื่อมต่อ CoinGecko ไม่สำเร็จ: {exc}"

        if response.status_code != 200:
            return {}, f"CoinGecko ตอบกลับ HTTP {response.status_code}"

        try:
            coins = response.json().get("coins", [])
        except ValueError:
            return {}, "อ่านข้อมูล JSON จาก CoinGecko ไม่สำเร็จ"

        ranks: dict[str, int] = {}
        for index, entry in enumerate(coins, start=1):
            item = entry.get("item", {})
            symbol = str(item.get("symbol", "")).upper()
            if symbol and symbol not in ranks:
                ranks[symbol] = index
        return ranks, None


# --------------------------------------------------------------------------
# แหล่งข้อมูลจำลอง
# --------------------------------------------------------------------------

_HEADLINE_TEMPLATES = [
    "{sym} is pumping again, anyone else loaded up?",
    "Why {name} might be the next 10x gem",
    "{sym} chart looks parabolic right now",
    "Careful with {sym}, this smells like exit liquidity",
    "{name} holders, are we still bullish?",
    "{sym} dumped hard today, bagholding since ATH",
    "New {name} listing rumour — LFG",
    "Is {sym} a rug or just a healthy pullback?",
    "Accumulating {sym} while everyone is bearish",
    "{name} community is the most based in crypto",
    "{sym} down bad but diamond hands only",
    "Sold my {sym} bag, ngmi with this one",
]


def _seed_for(symbol: str, base_seed: int) -> int:
    digest = hashlib.sha256(f"social:{symbol}:{base_seed}".encode()).hexdigest()
    return int(digest[:8], 16)


def simulate_signal(symbol: str, base_seed: int, market_cap: float = 1e9) -> SocialSignal:
    """สร้างสัญญาณโซเชียลจำลองแบบ deterministic

    เหรียญมาร์เก็ตแคปใหญ่ถูกพูดถึงมากกว่าตามธรรมชาติ
    """
    rng = np.random.default_rng(_seed_for(symbol, base_seed))

    scale = float(np.clip(np.log10(max(market_cap, 1e6)) - 5.0, 0.4, 4.5))
    mentions = int(rng.gamma(shape=2.2, scale=28.0 * scale))
    change = float(rng.normal(0.12, 0.65))
    previous = max(int(mentions / max(1.0 + change, 0.15)), 1)

    name = COIN_NAMES.get(symbol, symbol)
    count = int(rng.integers(3, 6))
    picks = rng.choice(len(_HEADLINE_TEMPLATES), size=count, replace=False)

    now = datetime.now(timezone.utc)
    posts = [
        SocialPost(
            source="simulated",
            title=_HEADLINE_TEMPLATES[int(i)].format(sym=symbol, name=name),
            url="",
            engagement=int(rng.integers(5, 900)),
            created_at=now,
        )
        for i in picks
    ]

    sentiment = float(np.mean([p.sentiment for p in posts])) if posts else 0.0
    rank = int(rng.integers(1, 15)) if rng.random() < 0.35 else None

    return SocialSignal(
        symbol=symbol,
        mentions_24h=mentions,
        mentions_prev_24h=previous,
        sentiment=sentiment,
        engagement=sum(p.engagement for p in posts),
        search_rank=rank,
        posts=posts,
        sources=("simulated",),
    )


# --------------------------------------------------------------------------
# ตัวประกอบ
# --------------------------------------------------------------------------

def _signal_from_posts(symbol: str, posts: list[SocialPost],
                       rank: int | None) -> SocialSignal:
    """แปลงกระทู้จริงเป็นสัญญาณ โดยแบ่งเป็นช่วง 24 ชม. ล่าสุดกับก่อนหน้า"""
    now = datetime.now(timezone.utc)
    recent, previous = [], []
    for post in posts:
        age_hours = (now - post.created_at).total_seconds() / 3600.0
        if age_hours <= 24:
            recent.append(post)
        elif age_hours <= 48:
            previous.append(post)

    scored = [p.sentiment for p in recent if p.sentiment != 0.0]
    top = sorted(recent, key=lambda p: p.engagement, reverse=True)[:5]

    return SocialSignal(
        symbol=symbol,
        mentions_24h=len(recent),
        mentions_prev_24h=len(previous),
        sentiment=float(np.mean(scored)) if scored else 0.0,
        engagement=sum(p.engagement for p in recent),
        search_rank=rank,
        posts=top,
        sources=("reddit",) + (("coingecko",) if rank else ()),
    )


def build_social_pulse(settings: Settings, use_live: bool = False) -> SocialPulse:
    """ประกอบภาพรวมกระแสโซเชียลของทุกเหรียญที่ติดตาม

    use_live = True จะพยายามดึงข้อมูลจริง ถ้าล้มเหลวจะถอยไปใช้ข้อมูลจำลอง
    พร้อมบันทึกเหตุผลไว้ใน notes เสมอ
    """
    from core.data_sources import _FALLBACK_QUOTES

    notes: list[str] = []
    ranks: dict[str, int] = {}
    live_signals: dict[str, SocialSignal] = {}

    if use_live:
        gecko_ranks, gecko_error = CoinGeckoTrendingSource(settings).fetch()
        if gecko_error:
            notes.append(gecko_error)
        else:
            ranks = gecko_ranks

        reddit = RedditSource(settings)
        for symbol in settings.symbols:
            posts, error = reddit.fetch(symbol)
            if error:
                notes.append(f"{symbol}: {error}")
                break  # แหล่งล่มแล้วไม่ต้องลองเหรียญที่เหลือให้เสียเวลา
            if posts:
                live_signals[symbol] = _signal_from_posts(symbol, posts, ranks.get(symbol))
    else:
        notes.append("โหมดข้อมูลจำลอง — เปิดสวิตช์ในแถบข้างเพื่อลองดึงข้อมูลจริง")

    signals: dict[str, SocialSignal] = {}
    for symbol in settings.symbols:
        if symbol in live_signals:
            signals[symbol] = live_signals[symbol]
        else:
            market_cap = _FALLBACK_QUOTES.get(symbol, {}).get("market_cap", 1e9)
            signals[symbol] = simulate_signal(symbol, settings.seed, market_cap)

    if live_signals and len(live_signals) == len(settings.symbols):
        source = "live"
    elif live_signals:
        source = "mixed"
        notes.append(f"ดึงข้อมูลจริงได้ {len(live_signals)} จาก {len(settings.symbols)} เหรียญ "
                     "ที่เหลือใช้ข้อมูลจำลอง")
    else:
        source = "simulated"

    return SocialPulse(
        signals=signals,
        source=source,
        fetched_at=datetime.now(timezone.utc),
        notes=notes,
    )
