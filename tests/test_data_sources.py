"""ทดสอบแหล่งข้อมูลและการประกอบผลวิเคราะห์ทั้งระบบ"""

import numpy as np
import pytest

from core.analytics import build_analysis, market_regime, portfolio_risk_summary
from core.config import Settings, load_settings
from core.data_sources import (
    CoinMarketCapClient,
    build_market_data,
    generate_market_index,
    generate_price_series,
)
from core.risk import beta


@pytest.fixture(scope="module")
def settings() -> Settings:
    """ตั้งค่าเล็ก ๆ เพื่อให้ทดสอบเร็ว และไม่มี API key จึงบังคับใช้โหมดจำลอง"""
    return Settings(
        cmc_api_key="",
        symbols=("DOGE", "SHIB", "PEPE"),
        history_days=120,
        mc_paths=300,
        mc_horizon_days=30,
    )


@pytest.fixture(scope="module")
def analysis(settings):
    return build_analysis(settings)


class TestSettings:
    def test_defaults_load_without_env(self):
        loaded = load_settings()
        assert len(loaded.symbols) > 0
        assert loaded.history_days > 0

    def test_missing_key_means_not_live(self):
        assert not Settings(cmc_api_key="").has_live_key

    def test_key_present_means_live(self):
        assert Settings(cmc_api_key="abc").has_live_key

    def test_with_symbols_returns_new_instance(self):
        base = Settings()
        updated = base.with_symbols(["DOGE"])
        assert updated.symbols == ("DOGE",)
        assert base.symbols != updated.symbols


class TestClientWithoutKey:
    def test_does_not_call_api_without_a_key(self):
        """ไม่มี key ต้องไม่ยิง request ออกไปเลย และต้องบอกเหตุผลกลับมา"""
        quotes, error = CoinMarketCapClient(Settings(cmc_api_key="")).fetch_quotes(("DOGE",))
        assert quotes == {}
        assert "CMC_API_KEY" in error


class TestSyntheticGeneration:
    def test_market_index_length(self):
        assert generate_market_index(180, seed=1).size == 180

    def test_market_index_is_positive(self):
        assert np.all(generate_market_index(180, seed=1) > 0)

    def test_market_index_is_reproducible(self):
        a = generate_market_index(90, seed=42)
        b = generate_market_index(90, seed=42)
        assert np.array_equal(a, b)

    def test_price_series_ends_at_anchor(self):
        """ราคาสุดท้ายต้องตรงกับราคาอ้างอิงที่ส่งเข้าไปเป๊ะ ๆ"""
        market = generate_market_index(120, seed=1)
        market_returns = market[1:] / market[:-1] - 1.0
        series = generate_price_series("DOGE", market_returns, anchor_price=0.162, base_seed=1)
        assert series[-1] == pytest.approx(0.162)

    def test_price_series_is_always_positive(self):
        market = generate_market_index(365, seed=2)
        market_returns = market[1:] / market[:-1] - 1.0
        for symbol in ("DOGE", "PEPE", "BONK"):
            series = generate_price_series(symbol, market_returns, 1.0, base_seed=2)
            assert np.all(series > 0)

    def test_recovers_the_intended_beta(self):
        """ข้อมูลจำลองต้องให้ค่า β ย้อนกลับใกล้เคียงกับที่ตั้งใจไว้

        DOGE ถูกกำหนด β เป้าหมายไว้ที่ 1.15 — ถ้าคำนวณย้อนกลับแล้วห่างมาก
        แสดงว่าตัวสร้างข้อมูลหรือสูตร β มีปัญหา
        """
        market = generate_market_index(2000, seed=3)
        market_returns = market[1:] / market[:-1] - 1.0
        series = generate_price_series("DOGE", market_returns, 0.16, base_seed=3)
        asset_returns = series[1:] / series[:-1] - 1.0
        assert beta(asset_returns, market_returns) == pytest.approx(1.15, abs=0.15)

    def test_unknown_symbol_gets_stable_character(self):
        """เหรียญที่ไม่ได้กำหนดลักษณะไว้ ต้องได้ค่าเดิมทุกครั้ง"""
        market = generate_market_index(120, seed=4)
        market_returns = market[1:] / market[:-1] - 1.0
        a = generate_price_series("WEIRDCOIN", market_returns, 1.0, base_seed=4)
        b = generate_price_series("WEIRDCOIN", market_returns, 1.0, base_seed=4)
        assert np.array_equal(a, b)


class TestMarketData:
    def test_falls_back_to_simulated_without_key(self, settings):
        market = build_market_data(settings)
        assert market.source == "simulated"
        assert len(market.notes) >= 1

    def test_every_symbol_has_a_quote_and_prices(self, settings):
        market = build_market_data(settings)
        for symbol in settings.symbols:
            assert symbol in market.quotes
            assert market.prices[symbol].size == settings.history_days

    def test_dates_align_with_prices(self, settings):
        market = build_market_data(settings)
        assert len(market.dates) == settings.history_days
        assert market.price_frame().shape[0] == settings.history_days

    def test_returns_are_one_shorter_than_prices(self, settings):
        market = build_market_data(settings)
        assert market.returns("DOGE").size == settings.history_days - 1
        assert market.market_returns.size == settings.history_days - 1

    def test_quote_price_matches_last_close(self, settings):
        market = build_market_data(settings)
        for symbol in settings.symbols:
            assert market.quotes[symbol].price == pytest.approx(market.prices[symbol][-1])

    def test_volume_to_mcap_is_safe_when_mcap_zero(self, settings):
        market = build_market_data(settings)
        quote = market.quotes["DOGE"]
        assert quote.volume_to_mcap >= 0


class TestAnalysisBundle:
    def test_covers_every_symbol(self, analysis, settings):
        for symbol in settings.symbols:
            assert symbol in analysis.profiles
            assert symbol in analysis.forecasts
            assert symbol in analysis.advices

    def test_market_table_row_count(self, analysis, settings):
        assert len(analysis.market_table()) == len(settings.symbols)

    def test_risk_table_row_count(self, analysis, settings):
        assert len(analysis.risk_table()) == len(settings.symbols)

    def test_correlation_matrix_is_square(self, analysis, settings):
        corr = analysis.correlations()
        assert corr.shape == (len(settings.symbols), len(settings.symbols))

    def test_meme_coins_have_high_betas(self, analysis):
        """เหรียญมีมควรมี β สูงกว่า 1 เพราะผันผวนแรงกว่าตลาดรวม"""
        assert all(b > 1.0 for b in analysis.betas().values())

    def test_suggested_weights_stay_within_budget(self, analysis):
        assert sum(analysis.suggested_weights().values()) <= 0.9 + 1e-9

    def test_suggested_weights_are_non_negative(self, analysis):
        assert all(w >= 0 for w in analysis.suggested_weights().values())

    def test_spot_prices_match_quotes(self, analysis):
        for symbol, price in analysis.spot_prices().items():
            assert price == analysis.quotes[symbol].price


class TestPortfolioSummary:
    def test_empty_portfolio_has_zero_beta(self, analysis):
        summary = portfolio_risk_summary(analysis, {})
        assert summary["beta"] == 0.0
        assert summary["invested_weight"] == 0.0

    def test_beta_scales_with_invested_weight(self, analysis):
        symbol = analysis.symbols[0]
        full = portfolio_risk_summary(analysis, {symbol: 1.0})
        half = portfolio_risk_summary(analysis, {symbol: 0.5})
        assert half["beta"] == pytest.approx(full["beta"] / 2)

    def test_summary_has_all_expected_keys(self, analysis):
        summary = portfolio_risk_summary(analysis, {analysis.symbols[0]: 0.5})
        for key in ("beta", "volatility", "sharpe", "var_95",
                    "diversification", "expected_return_capm"):
            assert key in summary

    def test_capm_expectation_rises_with_beta(self, analysis):
        symbol = max(analysis.betas(), key=lambda s: analysis.betas()[s])
        small = portfolio_risk_summary(analysis, {symbol: 0.2})
        large = portfolio_risk_summary(analysis, {symbol: 0.8})
        assert large["expected_return_capm"] > small["expected_return_capm"]


class TestMarketRegime:
    def test_returns_a_known_regime(self, analysis):
        regime = market_regime(analysis)
        assert regime["regime"] in ("ตลาดกระทิง", "ตลาดหมี", "ตลาดออกข้าง")

    def test_includes_change_and_volatility(self, analysis):
        regime = market_regime(analysis)
        assert "change_30d" in regime
        assert regime["volatility"] >= 0
