/**
 * แปลงผลลัพธ์ดิบจาก BOT API ให้เป็นรูปแบบมาตรฐานของระบบ
 *
 * ฟังก์ชันในไฟล์นี้เป็น pure function ทั้งหมด จึงเขียนเทสต์ครอบคลุมได้ง่าย
 * และเป็นที่เดียวที่ต้องแก้เมื่อรูปแบบผลลัพธ์ของ BOT เปลี่ยน
 */

import type { BotObservation } from '@sme/shared';
import type { BotSeriesDescriptor } from './botTypes.js';
import { BotApiError } from './botTypes.js';

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** เดินเข้าไปหา result.data.data_detail ในผลลัพธ์ของ BOT */
export function extractDetail(payload: unknown): Row[] {
  if (!isRecord(payload)) {
    throw new BotApiError('BOT response is not an object', 'response');
  }
  const result = isRecord(payload.result) ? payload.result : payload;
  const data = isRecord(result.data) ? result.data : result;

  const detail = (data as Row).data_detail ?? (data as Row).detail ?? (result as Row).data_detail;

  if (Array.isArray(detail)) return detail.filter(isRecord);
  if (isRecord(detail)) return [detail];

  // บาง endpoint ใส่แถวไว้ใน data ตรง ๆ โดยไม่มีชั้น data_detail คร่อม
  if (Array.isArray(result.data)) return result.data.filter(isRecord);

  // ที่เหลือคือรูปแบบที่ยังไม่รู้จัก — บอกคีย์ที่มีจริงไป ไม่งั้นต้องเดาต่ออีกรอบ
  // (ชื่อคีย์ไม่ใช่ความลับ และเป็นข้อมูลชิ้นเดียวที่ทำให้แก้ได้ในครั้งเดียว)
  throw new BotApiError(
    `BOT response has no data_detail array — ` +
      `คีย์ที่ได้มา: result{${keysOf(result)}}` +
      (isRecord(result.data) ? ` · result.data{${keysOf(result.data)}}` : ''),
    'response',
  );
}

/** ชื่อคีย์ของอ็อบเจ็กต์ จำกัดจำนวนไว้ไม่ให้ข้อความยาวเกินอ่าน */
function keysOf(value: Row): string {
  const keys = Object.keys(value);
  const shown = keys.slice(0, 12).join(', ');
  return keys.length > 12 ? `${shown}, …(+${keys.length - 12})` : shown;
}

/** เวลาที่ BOT ระบุว่าอัปเดตข้อมูลล่าสุด (อยู่ใน data_header หรือ result.timestamp) */
export function extractLastUpdated(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const result = isRecord(payload.result) ? payload.result : payload;
  const data = isRecord(result.data) ? result.data : {};
  const header = isRecord(data.data_header) ? data.data_header : {};

  const candidates = [
    header.last_updated,
    header.last_updated_date,
    header.report_period,
    result.timestamp,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const parsed = Date.parse(candidate.replace(' ', 'T'));
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
      return candidate;
    }
  }
  return null;
}

/** คลี่ array ซ้อนหนึ่งชั้น โดยยกค่าของแถวแม่ (เช่น period) ลงไปด้วย */
export function flattenRows(rows: Row[], nestedKeys: string[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const nestedKey = nestedKeys.find((key) => Array.isArray(row[key]));
    if (!nestedKey) {
      out.push(row);
      continue;
    }
    const parent: Row = { ...row };
    delete parent[nestedKey];
    for (const child of row[nestedKey] as unknown[]) {
      if (isRecord(child)) out.push({ ...parent, ...child });
    }
  }
  return out;
}

/** อ่านค่าตัวเลขจากคอลัมน์แรกที่มีอยู่จริงและแปลงเป็นตัวเลขได้ */
function readNumber(row: Row, candidates: string[], zeroIsMissing = false): number | null {
  const lowered = lowerKeys(row);

  for (const candidate of candidates) {
    const raw = lowered.get(candidate.toLowerCase());
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(parsed)) continue;
    if (zeroIsMissing && parsed === 0) continue;
    return parsed;
  }
  return null;
}

function lowerKeys(row: Row): Map<string, unknown> {
  const lowered = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) lowered.set(key.toLowerCase(), value);
  return lowered;
}

/** แถวนี้อยู่ในกลุ่มที่ชุดข้อมูลนี้สนใจหรือไม่ (เช่น เฉพาะธนาคารพาณิชย์ไทย) */
export function matchesRowFilter(row: Row, filter: BotSeriesDescriptor['rowFilter']): boolean {
  if (!filter) return true;
  const group = readString(row, filter.field);
  // ไม่มีคอลัมน์กลุ่มเลย = ผลลัพธ์ไม่ได้แยกกลุ่ม จึงรับไว้ทั้งหมดแทนที่จะทิ้งข้อมูลทิ้ง
  if (group === null) return true;
  return filter.accept.some((accepted) => accepted.toLowerCase() === group.toLowerCase());
}

function readString(row: Row, candidates: string[]): string | null {
  const lowered = lowerKeys(row);

  for (const candidate of candidates) {
    const raw = lowered.get(candidate.toLowerCase());
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  }
  return null;
}

/** ทำวันที่ให้เป็น YYYY-MM-DD (BOT ส่งมาได้หลายรูปแบบ) */
export function normalizePeriod(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;

  // 31/12/2025 หรือ 31-12-2025
  const dmy = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

/**
 * แปลงแถวดิบเป็นจุดข้อมูลมาตรฐาน
 *
 * เมื่อชุดข้อมูลหนึ่งมีหลายแถวในวันเดียวกัน (เช่น อัตราดอกเบี้ยรายธนาคาร)
 * จะเฉลี่ยค่าของทุกแถวในวันนั้นเป็นค่าเดียว ซึ่งคือ "อัตราเฉลี่ย" ที่หน้าเว็บแสดง
 */
export function normalizeSeries(
  descriptor: BotSeriesDescriptor,
  payload: unknown,
): { observations: BotObservation[]; lastUpdated: string | null } {
  const detail = extractDetail(payload);
  const flattened = flattenRows(detail, descriptor.nestedArrayKeys);
  const rows = flattened.filter((row) => matchesRowFilter(row, descriptor.rowFilter));

  // ผลลัพธ์มีแถวอยู่ แต่ตัวคัดกรองไม่รับสักแถว = ค่าในคอลัมน์กลุ่มเปลี่ยนไปจากที่ทะเบียนรู้จัก
  // ถ้าปล่อยผ่านจะกลายเป็น "ไม่มีข้อมูล" เงียบ ๆ ทั้งที่ ธปท. ส่งข้อมูลมาครบ
  if (flattened.length > 0 && rows.length === 0 && descriptor.rowFilter) {
    const seen = [
      ...new Set(
        flattened
          .map((row) => readString(row, descriptor.rowFilter!.field))
          .filter((value): value is string => value !== null),
      ),
    ].slice(0, 5);
    throw new BotApiError(
      `BOT response for "${descriptor.id}" had no rows in ${descriptor.rowFilter.label} ` +
        `(expected ${descriptor.rowFilter.accept.join(' / ')}; got: ${seen.join(' / ') || 'ไม่มีค่า'}) ` +
        '— ปรับ rowFilter ใน botSeries.ts ให้ตรงกับผลลัพธ์จริง',
      'response',
    );
  }

  // (period|dimension) -> ผลรวมและจำนวน เพื่อหาค่าเฉลี่ย
  const buckets = new Map<string, { period: string; dimension: string; sum: number; n: number }>();

  for (const row of rows) {
    const rawPeriod = readString(row, descriptor.periodFields);
    if (!rawPeriod) continue;
    const period = normalizePeriod(rawPeriod);
    if (!period) continue;

    if (descriptor.dimensionField) {
      // ชุดที่มิติมาจากคอลัมน์ เช่น currency_id
      const dimension = readString(row, [descriptor.dimensionField]);
      if (!dimension) continue;
      const value = readNumber(
        row,
        descriptor.valueFields.default ?? ['value'],
        descriptor.treatZeroAsMissing,
      );
      if (value === null) continue;
      addToBucket(buckets, period, dimension.toUpperCase(), value);
      continue;
    }

    for (const [dimension, candidates] of Object.entries(descriptor.valueFields)) {
      const value = readNumber(row, candidates, descriptor.treatZeroAsMissing);
      if (value === null) continue;
      addToBucket(buckets, period, dimension, value);
    }
  }

  if (buckets.size === 0) {
    // BOT ตอบ 200 พร้อม data_detail ว่าง เมื่อช่วงวันที่ที่ขอไม่มีวันทำการ
    // (เช่น ขอเฉพาะวันเสาร์อาทิตย์) — นั่นคือคำตอบที่ถูกต้อง ไม่ใช่ผลลัพธ์ที่อ่านไม่ออก
    if (detail.length === 0) {
      return { observations: [], lastUpdated: extractLastUpdated(payload) };
    }

    // มีแถวข้อมูลจริงแต่อ่านค่าไม่ได้ = ชื่อคอลัมน์ไม่ตรงกับที่ทะเบียนคาดไว้
    const seenColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 20);
    throw new BotApiError(
      `BOT response for "${descriptor.id}" contained no readable values ` +
        `(expected one of: ${Object.values(descriptor.valueFields).flat().join(', ')}; ` +
        `got columns: ${seenColumns.join(', ') || 'ไม่มีคอลัมน์'}) ` +
        '— ปรับ valueFields/nestedArrayKeys ใน botSeries.ts ให้ตรงกับผลลัพธ์จริง',
      'response',
    );
  }

  const observations = [...buckets.values()]
    .map((b) => ({ period: b.period, dimension: b.dimension, value: round(b.sum / b.n) }))
    .sort((a, b) =>
      a.period === b.period ? a.dimension.localeCompare(b.dimension) : a.period.localeCompare(b.period),
    );

  return { observations, lastUpdated: extractLastUpdated(payload) };
}

function addToBucket(
  buckets: Map<string, { period: string; dimension: string; sum: number; n: number }>,
  period: string,
  dimension: string,
  value: number,
): void {
  const key = `${period}|${dimension}`;
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.sum += value;
    bucket.n += 1;
  } else {
    buckets.set(key, { period, dimension, sum: value, n: 1 });
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
