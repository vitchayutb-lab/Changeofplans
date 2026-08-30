/** ตัวช่วยเรื่องวันที่ — BOT API รับ/ส่งวันที่ในรูปแบบ YYYY-MM-DD */

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** ช่วงวันที่เริ่มต้นเมื่อผู้เรียกไม่ระบุ */
export function defaultWindow(days = 90): { start: string; end: string } {
  const end = new Date();
  return { start: toIsoDate(daysAgo(days, end)), end: toIsoDate(end) };
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** จำนวนวินาทีระหว่างสองเวลา (ค่าไม่ติดลบ) */
export function secondsBetween(a: string, b: string): number {
  const diff = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0;
}
