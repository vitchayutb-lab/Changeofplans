/** เปลือกของแอป: แถบข้าง แถบบน แบนเนอร์โหมดสาธิต และพื้นที่แสดงหน้า */

import { NavLink, Outlet } from 'react-router-dom';
import type { SourceMode } from '@sme/shared';
import { useApp } from './context';
import { SmePicker } from './components/SmePicker';

const NAV = [
  { to: '/', label: 'ภาพรวม', icon: '📊', end: true },
  { to: '/market', label: 'ข้อมูลตลาด ธปท.', icon: '🏦' },
  { to: '/financials', label: 'งบการเงิน', icon: '📒' },
  { to: '/benchmarks', label: 'เกณฑ์การวัดธุรกิจ', icon: '📐' },
  { to: '/loans', label: 'จำลองสินเชื่อ', icon: '🧮' },
  { to: '/startup', label: 'ธุรกิจเริ่มต้น', icon: '🚀' },
  { to: '/funding', label: 'แหล่งเงินทุน', icon: '🎯' },
  { to: '/advisor', label: 'ที่ปรึกษา AI', icon: '💬' },
  { to: '/developer', label: 'เครื่องมือ / MCP', icon: '🛠️' },
];

const MODE_LABEL: Record<SourceMode, string> = {
  live: 'เชื่อมต่อจริง',
  demo: 'ข้อมูลจำลอง',
  degraded: 'ขัดข้อง',
};

export function App() {
  const { totalSmes, selectedSme, selectSme, health, error } = useApp();

  const botMode = health?.modes.bot ?? 'demo';
  const llmMode = health?.modes.llm ?? 'demo';
  const showDemoBanner = botMode !== 'live';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">฿</div>
          <div>
            <div className="brand__name">SME Finance Copilot</div>
            <div className="brand__sub">ผู้ช่วยการเงิน SME</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              <span className="nav__icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="stack tiny" style={{ marginTop: 'auto' }}>
          <span className={`mode-dot mode-dot--${botMode}`}>ข้อมูล ธปท.: {MODE_LABEL[botMode]}</span>
          <span className={`mode-dot mode-dot--${llmMode}`}>ที่ปรึกษา AI: {MODE_LABEL[llmMode]}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <SmePicker selected={selectedSme} total={totalSmes} onSelect={selectSme} />
          <div className="topbar__spacer" />
          <span className="tiny muted">{totalSmes.toLocaleString('en-US')} กิจการในระบบ</span>
          {health && (
            <span className="tiny muted">
              เวอร์ชัน {health.version} · ฐานข้อมูล{' '}
              {health.modes.database === 'ok' ? 'ปกติ' : 'มีปัญหา'}
            </span>
          )}
        </header>

        <div className="page">
          {error && (
            <div className="banner banner--risk">
              <span>⚠️</span>
              <div className="banner__body">
                <div className="banner__title">ติดต่อ API ไม่ได้</div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {showDemoBanner && (
            <div className="banner banner--demo">
              <span>🧪</span>
              <div className="banner__body">
                <div className="banner__title">
                  {botMode === 'degraded'
                    ? 'BOT data temporarily unavailable — กำลังใช้ข้อมูลจำลอง'
                    : 'DEMO MODE — ข้อมูล ธปท. เป็นข้อมูลจำลอง'}
                </div>
                <div>
                  {botMode === 'degraded'
                    ? `เรียก BOT API ไม่สำเร็จ: ${health?.bot.lastError ?? 'ไม่ทราบสาเหตุ'}`
                    : 'ยังไม่ได้ตั้งค่า BOT_API_KEY ฝั่งเซิร์ฟเวอร์ ตัวเลขที่แสดงเป็นข้อมูลจำลองที่ติดป้าย Demo Data ทุกจุด'}
                </div>
              </div>
            </div>
          )}

          <Outlet />
        </div>
      </div>
    </div>
  );
}
