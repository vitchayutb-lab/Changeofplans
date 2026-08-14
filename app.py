import streamlit as st
import pandas as pd
from core.mock_data import fetch_cmc_meme_coins
from core.ai_tools import calculate_beta_and_signal
from core.bot_engine import execute_auto_trade

st.set_page_config(page_title="MemeCoin AI Bot", layout="wide")

st.title("🤖 MemeCoin Auto-Bot & AI Portfolio Manager")
st.markdown("ระบบจำลองการดึงข้อมูลจาก **CoinMarketCap** วิเคราะห์ด้วย **AI & Portfolio Beta** และยิงออเดอร์อัตโนมัติ")

# สร้าง Tabs สำหรับแยกหน้าจอ
tab1, tab2 = st.tabs(["📊 AI Portfolio & Beta Analysis", "⚡ Auto-Trade Execution"])

# ดึงข้อมูลจำลอง
df_coins = fetch_cmc_meme_coins()

with tab1:
    st.header("AI Financial Tools: วิเคราะห์แนวโน้มเหรียญ")
    
    cols = st.columns(len(df_coins))
    
    analysis_results = []
    
    for i, row in df_coins.iterrows():
        # จำลองค่า Multiplier ให้เหรียญ Meme มีความผันผวนต่างกัน
        vol_multiplier = 1.5 + (i * 0.5) 
        beta, exp_return, signal, action = calculate_beta_and_signal(vol_multiplier)
        
        analysis_results.append({
            "Coin": row['Coin'],
            "Price": f"${row['Price (USD)']}",
            "Beta (β)": beta,
            "Expected Return": f"{exp_return}%",
            "AI Signal": signal,
            "Recommendation": action
        })
        
        with cols[i]:
            st.metric(label=row['Coin'], value=f"${row['Price (USD)']}", delta=f"{row['24h Change (%)']}%")
            st.write(f"**Beta:** {beta}")
            st.markdown(f"**Signal:** {signal}")

    st.subheader("คำแนะนำจาก AI ในการจัดพอร์ต")
    df_analysis = pd.DataFrame(analysis_results)
    st.dataframe(df_analysis, use_container_width=True)

with tab2:
    st.header("🚀 Auto-Trade Bot (Meme Coins)")
    st.write("ตั้งค่าบอทเพื่อทำการยิงออเดอร์อัตโนมัติตามสัญญาณ AI")
    
    trade_amount = st.number_input("จำนวนเงินลงทุนต่อออเดอร์ (USD)", min_value=10, value=100, step=10)
    
    if st.button("▶️ รันบอท Auto-Trade ตอนนี้"):
        with st.spinner("กำลังเชื่อมต่อ API และประมวลผลสัญญาณ..."):
            for result in analysis_results:
                coin = result["Coin"]
                signal = result["AI Signal"]
                
                log_msg = execute_auto_trade(coin, signal, trade_amount)
                if "สำเร็จ" in log_msg:
                    st.success(log_msg)
                else:
                    st.info(log_msg)
