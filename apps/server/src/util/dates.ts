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

/**
 * หดช่วงวันที่ให้ไม่เกินเพดานที่ endpoint รับได้ โดยยึดวันสิ้นสุดไว้
 *
 * เก็บวันล่าสุดไว้เสมอเพราะหน้าเว็บแสดง "ค่าปัจจุบันกับค่าก่อนหน้า" การตัดหัวออก
 * จึงเสียแค่ประวัติที่เก่าที่สุด ไม่ใช่ตัวเลขที่ผู้ใช้กำลังดู
 */
export function clampRange(
  range: { start: string; end: string },
  maxDays?: number,
): { start: string; end: string } {
  if (maxDays === undefined || !isIsoDate(range.start) || !isIsoDate(range.end)) return range;

  const spanDays = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays <= maxDays) return range;

  return { start: toIsoDate(daysAgo(maxDays, new Date(Date.parse(range.end)))), end: range.end };
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** จำนวนวินาทีระหว่างสองเวลา (ค่าไม่ติดลบ) */
export function secondsBetween(a: string, b: string): number {
  const diff = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0;
}
