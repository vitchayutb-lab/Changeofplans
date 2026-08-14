import time

def execute_auto_trade(coin, signal, amount_usd):
    """
    จำลองการยิง API ออเดอร์ซื้อขาย
    """
    if "BUY" in signal:
        action = "Long / Market Buy"
    elif "SELL" in signal:
        action = "Short / Market Sell"
    else:
        return f"⏳ ข้ามการเทรดเหรียญ {coin} เนื่องจากสัญญาณเป็น HOLD"
    
    # จำลองความหน่วงของระบบ Network
    time.sleep(1)
    return f"✅ สำเร็จ! ส่งคำสั่ง {action} เหรียญ {coin} มูลค่า ${amount_usd} เข้าสู่ระบบแล้ว"
