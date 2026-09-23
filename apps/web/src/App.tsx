/** เปลือกของแอป: แถบข้าง แถบบน แบนเนอร์โหมดสาธิต และพื้นที่แสดงหน้า */

import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { SourceMode } from '@sme/shared';
import { useApp } from './context';
import { SmePicker } from './components/SmePicker';
import { ThemeToggle } from './components/ThemeToggle';
import { CategoryBackground, type BackgroundVariant } from './components/CategoryBackground';
import { getStoredSidebarCollapsed, storeSidebarCollapsed } from './lib/sidebar';
import { NAV_ITEMS } from './nav';

const BACKGROUND_VARIANT: Record<string, BackgroundVariant> = {
  '/': 'overview',
  '/market': 'market',
  '/financials': 'financials',
  '/benchmarks': 'benchmarks',
  '/loans': 'loans',
  '/debt-capacity': 'debtCapacity',
  '/debt-outlook': 'debtOutlook',
  '/startup': 'startup',
  '/funding': 'funding',
  '/funding-strategy': 'fundingStrategy',
  '/lending-conditions': 'lendingConditions',
  '/advisor': 'advisor',
  '/developer': 'developer',
};

const MODE_LABEL: Record<SourceMode, string> = {
  live: 'เชื่อมต่อจริง',
  demo: 'ข้อมูลจำลอง',
  degraded: 'ขัดข้อง',
};

export function App() {
  const { totalSmes, selectedSme, selectSme, health, error } = useApp();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(getStoredSidebarCollapsed);

  const botMode = health?.modes.bot ?? 'demo';
  const llmMode = health?.modes.llm ?? 'demo';
  const showDemoBanner = botMode !== 'live';
  const backgroundVariant = BACKGROUND_VARIANT[pathname] ?? 'overview';

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    storeSidebarCollapsed(next);
  }

  return (
    <div className={`shell${collapsed ? ' shell--collapsed' : ''}`}>
      <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
        <div className="brand">
          <div className="brand__mark">฿</div>
          <div>
            <div className="brand__name">SME Finance Copilot</div>
            <div className="brand__sub">ผู้ช่วยการเงิน SME</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              <span className="nav__icon" aria-hidden>
                {item.icon}
              </span>
              <span className="nav__link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="stack tiny" style={{ marginTop: 'auto' }}>
          <NavLink to="/welcome" className="nav__guide" title={collapsed ? 'คู่มือการใช้งาน' : undefined}>
            <span aria-hidden>❔</span>
            <span className="nav__guide-label">คู่มือการใช้งาน</span>
          </NavLink>
          <span className={`mode-dot mode-dot--${botMode}`}>
            <span className="nav__guide-label">ข้อมูล ธปท.: </span>
            {MODE_LABEL[botMode]}
          </span>
          <span className={`mode-dot mode-dot--${llmMode}`}>
            <span className="nav__guide-label">ที่ปรึกษา AI: </span>
            {MODE_LABEL[llmMode]}
          </span>
        </div>

        <button
          type="button"
          className="sidebar__collapse"
          onClick={toggleCollapsed}
          title={collapsed ? 'ขยายแถบข้าง' : 'ย่อแถบข้าง'}
          aria-label={collapsed ? 'ขยายแถบข้าง' : 'ย่อแถบข้าง'}
        >
          {collapsed ? '»' : '« ย่อแถบข้าง'}
        </button>
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
          <ThemeToggle />
        </header>

        <div className="page">
          <CategoryBackground variant={backgroundVariant} key={backgroundVariant} />

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

          <div className="page__content" key={pathname}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
