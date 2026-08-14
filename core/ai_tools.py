import numpy as np

def calculate_beta_and_signal(coin_volatility_multiplier):
    """
    คำนวณค่า Beta แบบจำลอง และประเมินสัญญาณ Buy/Hold/Sell 
    โดยอิงจากความผันผวนสัมพัทธ์และผลตอบแทนคาดหวังในอนาคต (อิงตามหลักการของ CAPM)
    """
    # จำลอง Market Variance และ Covariance
    market_var = 0.0004
    coin_cov = market_var * coin_volatility_multiplier
    
    # สูตรคำนวณ Beta: Cov(Ri, Rm) / Var(Rm)
    beta = coin_cov / market_var 
    
    # จำลองการคาดการณ์แนวโน้มตลาด (AI Market Sentiment)
    expected_market_return = 0.05 # ตลาดคาดว่าจะบวก 5%
    risk_free_rate = 0.01
    
    # ประเมินผลตอบแทนคาดหวัง E(Ri) = Rf + Beta(E(Rm) - Rf)
    expected_return = risk_free_rate + beta * (expected_market_return - risk_free_rate)
    
    # AI Decision Logic
    if expected_return > 0.10 and beta < 3.0:
        signal = "BUY 🟢"
        action_text = "อัปไซด์สูงเมื่อเทียบกับความเสี่ยง แนะนำให้เข้าซื้อ"
    elif expected_return > 0.05:
        signal = "HOLD 🟡"
        action_text = "แนวโน้มทรงตัว ควรถือเพื่อรอดูสถานการณ์ (Beta สะท้อนความเสี่ยงระดับกลาง)"
    else:
        signal = "SELL 🔴"
        action_text = "ความเสี่ยง (Beta) สูงเกินกว่าผลตอบแทนที่คาดหวัง แนะนำให้ขายทำกำไร/ตัดขาดทุน"
        
    return round(beta, 2), round(expected_return * 100, 2), signal, action_text
