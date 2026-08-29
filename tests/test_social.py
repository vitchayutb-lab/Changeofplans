"""ทดสอบการวัดกระแสโซเชียล"""

from datetime import datetime, timedelta, timezone

import pytest

from core.config import Settings
from core.social import (
    CoinGeckoTrendingSource,
    RedditSource,
    SocialPost,
    SocialSignal,
    build_social_pulse,
    score_text,
    simulate_signal,
)


def make_post(title, hours_ago=1, engagement=10, source="test"):
    return SocialPost(
        source=source, title=title, url="",
        engagement=engagement,
        created_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
    )


def make_signal(mentions=100, prev=80, sentiment=0.0, engagement=500, rank=None):
    return SocialSignal(
        symbol="TEST", mentions_24h=mentions, mentions_prev_24h=prev,
        sentiment=sentiment, engagement=engagement, search_rank=rank,
    )


class TestSentimentLexicon:
    def test_bullish_slang_scores_positive(self):
        assert score_text("DOGE is mooning, this is a 100x gem") > 0.5

    def test_bearish_slang_scores_negative(self):
        assert score_text("this is a rug pull, total scam") < -0.5

    def test_neutral_text_scores_zero(self):
        assert score_text("I read the whitepaper yesterday") == 0.0

    def test_empty_text_is_safe(self):
        assert score_text("") == 0.0
        assert score_text(None) == 0.0

    def test_mixed_sentiment_lands_between(self):
        result = score_text("bullish long term but this dump is brutal")
        assert -0.6 < result < 0.6

    def test_two_word_phrases_are_matched(self):
        """'diamond hands' ต้องถูกจับเป็นวลี ไม่ใช่คำเดี่ยวที่ไม่รู้จัก"""
        assert score_text("diamond hands only") > 0.5
        assert score_text("we are exit liquidity here") < -0.5

    def test_stays_within_bounds(self):
        extreme = "moon moon moon 100x rocket parabolic lfg wagmi"
        assert -1.0 <= score_text(extreme) <= 1.0

    def test_case_insensitive(self):
        assert score_text("MOONING") == score_text("mooning")


class TestSocialSignal:
    def test_mention_change_computes_growth(self):
        assert make_signal(mentions=150, prev=100).mention_change == pytest.approx(0.5)

    def test_mention_change_handles_zero_baseline(self):
        assert make_signal(mentions=50, prev=0).mention_change == 1.0
        assert make_signal(mentions=0, prev=0).mention_change == 0.0

    def test_buzz_score_within_bounds(self):
        for mentions in (0, 10, 500, 5000):
            for prev in (0, 10, 500):
                score = make_signal(mentions=mentions, prev=prev).buzz_score
                assert 0.0 <= score <= 100.0

    def test_accelerating_coin_scores_higher(self):
        """ปริมาณเท่ากัน แต่ตัวที่กำลังเร่งต้องได้คะแนนสูงกว่า"""
        surging = make_signal(mentions=200, prev=50)
        flat = make_signal(mentions=200, prev=200)
        assert surging.buzz_score > flat.buzz_score

    def test_positive_sentiment_raises_score(self):
        happy = make_signal(sentiment=0.8)
        sad = make_signal(sentiment=-0.8)
        assert happy.buzz_score > sad.buzz_score

    def test_trend_labels_follow_change(self):
        assert make_signal(mentions=200, prev=100).trend == "กระแสพุ่ง"
        assert make_signal(mentions=100, prev=100).trend == "กระแสทรงตัว"
        assert make_signal(mentions=30, prev=100).trend == "กระแสหาย"

    def test_mood_labels_follow_sentiment(self):
        assert "บวก" in make_signal(sentiment=0.6).mood
        assert "ลบ" in make_signal(sentiment=-0.6).mood
        assert "ผสม" in make_signal(sentiment=0.0).mood

    def test_is_hot_matches_threshold(self):
        hot = make_signal(mentions=400, prev=40, sentiment=0.8)
        cold = make_signal(mentions=2, prev=50, sentiment=-0.5)
        assert hot.is_hot
        assert not cold.is_hot


class TestSimulatedSignal:
    def test_is_deterministic(self):
        a = simulate_signal("DOGE", 42, 1e9)
        b = simulate_signal("DOGE", 42, 1e9)
        assert a.mentions_24h == b.mentions_24h
        assert a.sentiment == b.sentiment

    def test_different_coins_differ(self):
        a = simulate_signal("DOGE", 42, 1e9)
        b = simulate_signal("PEPE", 42, 1e9)
        assert (a.mentions_24h, a.sentiment) != (b.mentions_24h, b.sentiment)

    def test_bigger_coins_get_more_mentions(self):
        """เหรียญมาร์เก็ตแคปใหญ่ควรถูกพูดถึงมากกว่าโดยเฉลี่ย"""
        big = [simulate_signal(f"BIG{i}", i, 2e10).mentions_24h for i in range(12)]
        small = [simulate_signal(f"SML{i}", i, 5e7).mentions_24h for i in range(12)]
        assert sum(big) / len(big) > sum(small) / len(small)

    def test_produces_sample_posts(self):
        signal = simulate_signal("DOGE", 7, 1e9)
        assert len(signal.posts) >= 3
        assert all(p.title for p in signal.posts)

    def test_marked_as_simulated(self):
        assert simulate_signal("DOGE", 7, 1e9).sources == ("simulated",)


class TestSocialPulse:
    @pytest.fixture
    def pulse(self):
        return build_social_pulse(
            Settings(symbols=("DOGE", "SHIB", "PEPE"), seed=99), use_live=False)

    def test_covers_every_symbol(self, pulse):
        assert set(pulse.signals) == {"DOGE", "SHIB", "PEPE"}

    def test_offline_mode_is_marked_simulated(self, pulse):
        assert pulse.source == "simulated"
        assert pulse.notes

    def test_ranked_is_sorted_by_buzz(self, pulse):
        scores = [s.buzz_score for s in pulse.ranked()]
        assert scores == sorted(scores, reverse=True)

    def test_hottest_is_the_top_of_ranked(self, pulse):
        assert pulse.hottest().symbol == pulse.ranked()[0].symbol

    def test_hype_index_within_bounds(self, pulse):
        assert 0.0 <= pulse.hype_index <= 100.0

    def test_market_mood_is_a_known_label(self, pulse):
        assert pulse.market_mood in ("กระแสมีมร้อนแรง", "กระแสมีมปานกลาง", "กระแสมีมเงียบ")

    def test_reproducible_across_runs(self):
        settings = Settings(symbols=("DOGE", "PEPE"), seed=5)
        a = build_social_pulse(settings, use_live=False)
        b = build_social_pulse(settings, use_live=False)
        assert a.hype_index == pytest.approx(b.hype_index)


class TestLiveSourcesDegradeGracefully:
    def test_reddit_failure_returns_error_not_exception(self):
        """เน็ตล่มต้องคืน error message ไม่ใช่โยน exception"""
        settings = Settings(request_timeout=0.001)
        posts, error = RedditSource(settings).fetch("DOGE")
        assert posts == [] or isinstance(posts, list)
        if not posts:
            assert error

    def test_coingecko_failure_returns_error_not_exception(self):
        settings = Settings(request_timeout=0.001)
        ranks, error = CoinGeckoTrendingSource(settings).fetch()
        if not ranks:
            assert error

    def test_live_mode_falls_back_without_crashing(self):
        """เปิดโหมด live แล้วแหล่งล่ม ต้องยังได้สัญญาณครบทุกเหรียญ"""
        settings = Settings(symbols=("DOGE", "SHIB"), request_timeout=0.001, seed=3)
        pulse = build_social_pulse(settings, use_live=True)

        assert set(pulse.signals) == {"DOGE", "SHIB"}
        assert pulse.source in ("simulated", "mixed", "live")
        assert pulse.notes  # ต้องบันทึกเหตุผลไว้เสมอ


class TestPostSentiment:
    def test_post_scores_its_own_title(self):
        assert make_post("this is mooning hard").sentiment > 0
        assert make_post("total rug pull").sentiment < 0
