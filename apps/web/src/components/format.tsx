/** ตัวจัดรูปแบบตัวเลขและวันที่ตามธรรมเนียมไทย */

import type { BotUnit } from '@sme/shared';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function formatMoney(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `฿${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** ย่อจำนวนเงินให้อ่านง่ายบนการ์ด เช่น ฿185.0 ล้าน */
export function formatMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `฿${(value / 1_000_000_000).toFixed(2)} พันล้าน`;
  if (abs >= 1_000_000) return `฿${(value / 1_000_000).toFixed(2)} ล้าน`;
  if (abs >= 1_000) return `฿${(value / 1_000).toFixed(1)}k`;
  return formatMoney(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatTimes(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}×`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** จัดรูปแบบตามหน่วยของชุดข้อมูล BOT */
export function formatByUnit(value: number | null | undefined, unit: BotUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  switch (unit) {
    case 'percent_per_annum':
      return formatPercent(value);
    case 'thb_per_unit':
      return value >= 1 ? value.toFixed(4) : value.toFixed(6);
    case 'ratio':
      return formatTimes(value);
    default:
      return formatNumber(value);
  }
}

/** 2026-08-29 → 29 ส.ค. 2026 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCDate()} ${THAI_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(value)} ${time} น.`;
}

/** จัดรูปแบบค่าของอัตราส่วนตามหน่วยของมันเอง */
export function formatRatio(value: number | null, unit: 'x' | 'percent' | 'days'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === 'percent') return formatPercent(value, 1);
  if (unit === 'days') return `${Math.round(value)} วัน`;
  return formatTimes(value);
}
