import pandas as pd
import numpy as np

def fetch_cmc_meme_coins():
    # จำลองข้อมูลเหรียญ Meme จาก CMC
    data = {
        "Coin": ["DOGE", "SHIB", "PEPE", "WIF", "BONK"],
        "Price (USD)": [0.15, 0.000028, 0.000007, 2.50, 0.000022],
        "24h Change (%)": [5.2, -1.5, 12.4, -4.0, 8.1],
        "Market Cap": ["21B", "16B", "3B", "2.5B", "1.4B"]
    }
    return pd.DataFrame(data)

def generate_historical_returns():
    # จำลองอัตราผลตอบแทนย้อนหลัง 30 วันเพื่อใช้คำนวณ Beta
    np.random.seed(42)
    market_returns = np.random.normal(0.001, 0.02, 30) # ตลาดรวม
    return market_returns
