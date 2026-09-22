/**
 * ระบบสลับ Light/Dark Mode
 *
 * ลำดับความสำคัญ: ค่าที่ผู้ใช้เคยเลือกไว้ (localStorage) > ค่าที่ระบบปฏิบัติการ/เบราว์เซอร์
 * ตั้งไว้ (prefers-color-scheme) > ค่าเริ่มต้น (light) — ใช้ทั้งใน index.html (สคริปต์กันจอ
 * กระพริบก่อนเพจวาดผล) และในโค้ด React นี้ ต้องคำนวณค่าตรงกันทั้งสองที่
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sme-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** ค่าที่ผู้ใช้เคยเลือกไว้เอง — undefined แปลว่ายังไม่เคยเลือก จะได้ตามระบบปฏิบัติการต่อไป */
export function getStoredTheme(): Theme | undefined {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function getPreferredTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // จำไม่ได้ก็ไม่เป็นไร แค่แปลว่ารอบหน้าจะกลับไปตามค่าระบบปฏิบัติการ
  }
}
