/** เก็บสถานะว่าผู้ใช้เคยเห็นหน้า Welcome/Guidelines แล้วหรือยัง */

const WELCOME_SEEN_KEY = 'sme-welcome-seen';

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    // localStorage อ่านไม่ได้ (เช่น private mode บางเบราว์เซอร์) — ถือว่ายังไม่เคยเห็น
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // เขียนไม่ได้ก็ไม่เป็นไร แค่แปลว่าจะเจอหน้า Welcome อีกครั้งในครั้งหน้า
  }
}
