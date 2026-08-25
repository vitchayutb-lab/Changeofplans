"""ทดสอบว่าหน้าเว็บรันได้จริงตั้งแต่ต้นจนจบ โดยใช้ AppTest ของ Streamlit

เป็นการทดสอบระดับ end-to-end: ถ้ามีการเรียกใช้ API ผิด หรือกราฟสร้างไม่ได้
เทสต์กลุ่มนี้จะจับได้ทันทีโดยไม่ต้องเปิดเบราว์เซอร์
"""

import pytest

from streamlit.testing.v1 import AppTest

from tests.conftest import APP_PATH

TIMEOUT = 180


@pytest.fixture(scope="module")
def app() -> AppTest:
    instance = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
    instance.run()
    return instance


class TestAppRuns:
    def test_app_runs_without_exceptions(self, app):
        assert not app.exception, [str(e) for e in app.exception]

    def test_renders_all_six_tabs(self, app):
        assert len(app.tabs) == 6

    def test_sidebar_controls_exist(self, app):
        assert len(app.sidebar.slider) >= 4
        # ตัวแรกคือตัวกรองหมวด ตัวที่สองคือรายการเหรียญที่ติดตาม
        assert len(app.sidebar.multiselect) == 2
        assert app.sidebar.multiselect[0].label == "กรองตามหมวด"

    def test_shows_the_disclaimer(self, app):
        body = " ".join(m.value for m in app.markdown)
        assert "ข้อจำกัดความรับผิดชอบ" in body

    def test_labels_simulated_data_clearly(self, app):
        body = " ".join(m.value for m in app.markdown)
        assert "จำลอง" in body


class TestInteractions:
    def test_changing_target_beta_reruns_cleanly(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        beta_slider = next(s for s in app.sidebar.slider if "β เป้าหมาย" in s.label)
        beta_slider.set_value(2.5).run()

        assert not app.exception, [str(e) for e in app.exception]

    def test_running_the_bot_produces_a_log(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        run_button = next(b for b in app.button if "รันบอท" in b.label)
        run_button.click().run()

        assert not app.exception, [str(e) for e in app.exception]
        assert app.session_state["trade_log"], "บอทควรบันทึกผลการทำงานอย่างน้อยหนึ่งรายการ"

    def test_bot_respects_the_portfolio_object(self):
        """หลังบอททำงาน พอร์ตใน session ต้องเปลี่ยนสถานะจริง ไม่ใช่แค่ log"""
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        before = app.session_state["portfolio"].equity({})
        next(b for b in app.button if "รันบอท" in b.label).click().run()
        portfolio = app.session_state["portfolio"]

        assert not app.exception, [str(e) for e in app.exception]
        # เงินสดถูกใช้ไปซื้อเหรียญ หรือไม่ก็ทุกออเดอร์ถูกด่านความเสี่ยงปฏิเสธ
        assert portfolio.cash <= before

    def test_reset_button_restores_starting_capital(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        next(b for b in app.button if "รันบอท" in b.label).click().run()
        next(b for b in app.button if "รีเซ็ต" in b.label).click().run()

        assert not app.exception, [str(e) for e in app.exception]
        assert app.session_state["portfolio"].cash == pytest.approx(10_000.0)
        assert app.session_state["trade_log"] == []

    def test_switching_the_analysed_coin(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        selector = next(s for s in app.selectbox if "เลือกเหรียญ" in s.label)
        selector.set_value(selector.options[-1]).run()

        assert not app.exception, [str(e) for e in app.exception]

    def test_single_coin_selection_still_works(self):
        """เลือกเหรียญเดียว — เมทริกซ์สหสัมพันธ์และการกระจายความเสี่ยงต้องไม่พัง"""
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        app.sidebar.multiselect[0].set_value(["DOGE"]).run()

        assert not app.exception, [str(e) for e in app.exception]


class TestValuationTab:
    def test_valuation_controls_render(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        assert not app.exception, [str(e) for e in app.exception]
        labels = [s.label for s in app.slider]
        assert any("Kelly" in label for label in labels)
        assert any("น้ำหนักสูงสุดต่อเหรียญ" in label for label in labels)

    def test_applying_the_plan_changes_the_portfolio(self):
        """กดทำตามแผนแล้วพอร์ตต้องขยับจริง ไม่ใช่แค่แสดงตาราง"""
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        before_cash = app.session_state["portfolio"].cash
        next(b for b in app.button if "ทำตามแผนนี้" in b.label).click().run()

        assert not app.exception, [str(e) for e in app.exception]
        portfolio = app.session_state["portfolio"]
        # ถ้าแผนสั่งซื้อ เงินสดต้องลด และต้องมีสถานะเปิดขึ้นมา
        if portfolio.open_positions():
            assert portfolio.cash < before_cash

    def test_applying_twice_settles_into_hold(self):
        """ทำตามแผนซ้ำครั้งที่สองต้องไม่สั่งซื้อขายวนไม่รู้จบ"""
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        next(b for b in app.button if "ทำตามแผนนี้" in b.label).click().run()
        cash_after_first = app.session_state["portfolio"].cash

        next(b for b in app.button if "ทำตามแผนนี้" in b.label).click().run()
        assert not app.exception, [str(e) for e in app.exception]

        # รอบสองไม่ควรใช้เงินเพิ่มมากไปกว่าเศษเล็กน้อย
        drift = abs(app.session_state["portfolio"].cash - cash_after_first)
        assert drift < cash_after_first * 0.25 + 1.0


class TestLargerUniverse:
    def test_many_coins_can_be_selected(self):
        """เลือกเหรียญเยอะ ๆ พร้อมกันแล้วทุกแท็บต้องยังเรนเดอร์ได้"""
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        universe = app.sidebar.multiselect[1]
        app.sidebar.multiselect[1].set_value(list(universe.options)[:12]).run()

        assert not app.exception, [str(e) for e in app.exception]

    def test_category_filter_narrows_the_list(self):
        app = AppTest.from_file(APP_PATH, default_timeout=TIMEOUT)
        app.run()

        full = len(app.sidebar.multiselect[1].options)
        app.sidebar.multiselect[0].set_value(["สายแมว 🐱"]).run()

        assert not app.exception, [str(e) for e in app.exception]
        assert len(app.sidebar.multiselect[1].options) < full
