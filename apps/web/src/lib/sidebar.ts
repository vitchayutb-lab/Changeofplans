/** จำสถานะย่อ/ขยายแถบข้างไว้ใน localStorage เพื่อให้กลับมาเปิดเว็บใหม่แล้วยังเป็นแบบเดิม */

const SIDEBAR_COLLAPSED_KEY = 'sme-sidebar-collapsed';

export function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // จำไม่ได้ก็ไม่เป็นไร แค่แปลว่าเปิดใหม่ครั้งหน้าจะเป็นแถบข้างแบบขยายตามค่าเริ่มต้น
  }
}
