/** ปุ่มสลับ Light/Dark Mode — บันทึกค่าที่เลือกไว้ใน localStorage เพื่อจำไว้ใช้ครั้งหน้า */

import { useEffect, useState } from 'react';
import { applyTheme, getPreferredTheme, storeTheme, type Theme } from '../lib/theme';

export function ThemeToggle() {
  // เรียก getPreferredTheme() ตรงนี้ได้ทันที ไม่ต้องรอ useEffect — สคริปต์กันจอกระพริบ
  // ใน index.html ตั้ง data-theme ให้ตรงกับค่านี้ไว้ก่อนแอปวาดผลอยู่แล้ว
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
  }

  const label = theme === 'dark' ? 'สลับไปโหมดสว่าง' : 'สลับไปโหมดมืด';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === 'dark'}
    >
      <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden>
        ☀️
      </span>
      <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden>
        🌙
      </span>
    </button>
  );
}
