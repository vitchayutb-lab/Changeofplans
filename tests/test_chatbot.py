"""ทดสอบแชตบอท

จุดที่สำคัญที่สุดคือ **บอทต้องไม่แต่งตัวเลขเอง** — ทุกคำตอบต้องมาจากข้อมูลจริง
ในระบบ และเส้นทางกฎต้องทำงานได้โดยไม่ต้องมี API key
"""

import pytest

from core.analytics import build_analysis
from core.chatbot import (
    ChatContext,
    ChatReply,
    answer,
    answer_with_rules,
    build_context_brief,
    detect_intent,
    detect_symbol,
    has_llm_credentials,
)
from core.config import Settings
from core.portfolio import Portfolio
from core.social import build_social_pulse
from core.valuation import build_all_plans


@pytest.fixture(scope="module")
def context():
    settings = Settings(symbols=("DOGE", "SHIB", "PEPE"), history_days=120, mc_paths=300)
    analysis = build_analysis(settings)
    pulse = build_social_pulse(settings, use_live=False)

    portfolio = Portfolio(cash=10_000.0, initial_equity=10_000.0)
    portfolio.buy("DOGE", 12_000, analysis.quotes["DOGE"].price)

    return ChatContext(
        analysis=analysis, pulse=pulse, portfolio=portfolio,
        plans=build_all_plans(analysis, portfolio),
    )


class TestSymbolDetection:
    def test_finds_ticker(self):
        assert detect_symbol("DOGE ควรซื้อไหม", ["DOGE", "SHIB"]) == "DOGE"

    def test_finds_full_name(self):
        assert detect_symbol("dogecoin น่าสนใจไหม", ["DOGE", "SHIB"]) == "DOGE"

    def test_returns_none_when_absent(self):
        assert detect_symbol("ตลาดเป็นยังไงบ้าง", ["DOGE", "SHIB"]) is None

    def test_does_not_match_substring(self):
        """DOGE ต้องไม่ถูกจับจากคำที่มีตัวอักษรเหล่านี้ปนอยู่"""
        assert detect_symbol("DOGECOINMAXI", ["DOGE"]) is None

    def test_case_insensitive(self):
        assert detect_symbol("doge ราคาเท่าไหร่", ["DOGE"]) == "DOGE"


class TestIntentDetection:
    @pytest.mark.parametrize("question,expected", [
        ("ตอนนี้เหรียญไหนกระแสแรงสุด", "buzz"),
        ("DOGE ควรซื้อไหม", "action"),
        ("PEPE เสี่ยงแค่ไหน", "risk"),
        ("พอร์ตฉันเป็นยังไง", "portfolio"),
        ("พอร์ตฉันเสี่ยงเกินไปไหม", "portfolio"),   # พอร์ตต้องชนะคำว่า "เสี่ยง"
        ("ที่ถืออยู่ควรขายไหม", "portfolio"),        # และชนะคำว่า "ขาย" ด้วย
        ("SHIB แพงไปหรือยัง", "valuation"),
        ("DOGE ราคาเท่าไหร่", "price"),
        ("เทียบ DOGE กับ PEPE ตัวไหนดีกว่า", "compare"),
        ("สวัสดี", "overview"),
    ])
    def test_maps_question_to_intent(self, question, expected):
        assert detect_intent(question) == expected

    def test_english_keywords_work_too(self):
        assert detect_intent("what is the buzz on DOGE") == "buzz"
        assert detect_intent("should I sell") == "action"


class TestRuleAnswers:
    def test_buzz_question_names_a_coin(self, context):
        reply = answer_with_rules("ตอนนี้เหรียญไหนกระแสแรงสุด", context)
        assert any(s in reply for s in context.symbols)
        assert "ดัชนีกระแสมีม" in reply

    def test_buzz_for_specific_coin(self, context):
        reply = answer_with_rules("DOGE กระแสเป็นยังไง", context)
        assert "DOGE" in reply
        assert "คะแนนกระแส" in reply

    def test_simulated_data_is_disclosed(self, context):
        """ข้อมูลจำลองต้องบอกผู้ใช้ ไม่ใช่พูดเหมือนเป็นของจริง"""
        reply = answer_with_rules("เหรียญไหนกระแสแรง", context)
        assert "จำลอง" in reply

    def test_action_question_carries_disclaimer(self, context):
        reply = answer_with_rules("DOGE ควรซื้อไหม", context)
        assert "ไม่ใช่คำแนะนำการลงทุน" in reply

    def test_action_answer_uses_real_signal(self, context):
        reply = answer_with_rules("DOGE ควรซื้อไหม", context)
        assert context.analysis.advices["DOGE"].signal in reply

    def test_risk_answer_quotes_real_beta(self, context):
        reply = answer_with_rules("DOGE เสี่ยงแค่ไหน", context)
        beta = context.analysis.profiles["DOGE"].beta
        assert f"{beta:.2f}" in reply

    def test_price_answer_quotes_real_price(self, context):
        reply = answer_with_rules("DOGE ราคาเท่าไหร่", context)
        price = context.analysis.quotes["DOGE"].price
        assert f"{price:.8g}" in reply

    def test_portfolio_answer_reflects_holdings(self, context):
        reply = answer_with_rules("พอร์ตฉันเป็นยังไง", context)
        assert "DOGE" in reply
        assert "β พอร์ต" in reply

    def test_portfolio_without_data_says_so(self, context):
        empty = ChatContext(analysis=context.analysis, pulse=context.pulse,
                            portfolio=None, plans=[])
        assert "ยังไม่มีข้อมูลพอร์ต" in answer_with_rules("พอร์ตฉันเป็นยังไง", empty)

    def test_valuation_answer_quotes_fair_value(self, context):
        reply = answer_with_rules("DOGE แพงไปหรือยัง", context)
        assert "มูลค่าเหมาะสม" in reply

    def test_compare_lists_every_coin(self, context):
        reply = answer_with_rules("เทียบตัวไหนดีกว่ากัน", context)
        for symbol in context.symbols:
            assert symbol in reply

    def test_overview_suggests_next_questions(self, context):
        reply = answer_with_rules("สวัสดี", context)
        assert "ลองถามได้" in reply

    def test_every_intent_returns_non_empty(self, context):
        questions = ["กระแส", "ควรซื้อ", "เสี่ยงไหม", "พอร์ต", "มูลค่า",
                     "ราคา", "เทียบ", "อะไรก็ได้"]
        for q in questions:
            assert answer_with_rules(q, context).strip()

    def test_unknown_coin_does_not_crash(self, context):
        assert answer_with_rules("BITCOIN ราคาเท่าไหร่", context).strip()


class TestContextBrief:
    def test_includes_real_numbers(self, context):
        brief = build_context_brief(context, "DOGE")
        beta = context.analysis.profiles["DOGE"].beta
        assert f"{beta:.2f}" in brief

    def test_states_the_data_source(self, context):
        brief = build_context_brief(context)
        assert "แหล่งราคา" in brief and "แหล่งกระแสโซเชียล" in brief

    def test_focus_narrows_the_brief(self, context):
        focused = build_context_brief(context, "DOGE")
        full = build_context_brief(context)
        assert len(focused) < len(full)

    def test_covers_all_coins_without_focus(self, context):
        brief = build_context_brief(context)
        for symbol in context.symbols:
            assert f"[{symbol}" in brief

    def test_includes_portfolio_when_present(self, context):
        assert "พอร์ตผู้ใช้" in build_context_brief(context)


class TestAnswerEntryPoint:
    def test_falls_back_to_rules_without_credentials(self, context, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        reply = answer("DOGE กระแสเป็นยังไง", context)

        assert isinstance(reply, ChatReply)
        assert reply.used_llm is False
        assert "DOGE" in reply.text

    def test_use_llm_false_never_calls_the_api(self, context, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-should-not-be-used")
        reply = answer("DOGE กระแสเป็นยังไง", context, use_llm=False)
        assert reply.used_llm is False

    def test_engine_label_is_honest(self, context, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        reply = answer("สวัสดี", context)
        assert "ไม่ได้ใช้ LLM" in reply.engine_label

    def test_credential_check_reads_env(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert has_llm_credentials() is False
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        assert has_llm_credentials() is True

    def test_bad_credentials_degrade_to_rules(self, context, monkeypatch):
        """key ผิดต้องไม่ทำให้แชตพัง — ต้องถอยไปใช้กฎพร้อมบอกเหตุผล"""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-invalid-key-for-testing")
        reply = answer("DOGE กระแสเป็นยังไง", context)

        assert reply.text.strip()
        if not reply.used_llm:
            assert reply.error
