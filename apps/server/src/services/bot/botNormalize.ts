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

  // PolicyRate/v3 คืนค่าปัจจุบันค่าเดียวไว้ที่ result.data โดยตรง ไม่ใช่ชุดอนุกรมเวลา
  // วันที่มีผลอยู่ในฟิลด์พี่น้อง (effective_datetime) จึงยกทั้ง result ขึ้นมาเป็นแถวเดียว
  if (typeof result.data === 'string' || typeof result.data === 'number') {
    return [{ ...result, value: result.data }];
  }

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

/** อ่านทุกคอลัมน์ที่มีอยู่จริงในแถว (ใช้กับค่าที่ประกาศเป็นช่วง min/max) */
function readNumbers(row: Row, candidates: string[], zeroIsMissing = false): number[] {
  const lowered = lowerKeys(row);
  const values: number[] = [];

  for (const candidate of candidates) {
    const raw = lowered.get(candidate.toLowerCase());
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(parsed)) continue;
    if (zeroIsMissing && parsed === 0) continue;
    values.push(parsed);
  }
  return values;
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

  // แถวหายได้สามทาง การรู้ว่าหายทางไหนคือความต่างระหว่างแก้ถูกจุดกับเดาใหม่อีกรอบ
  let noPeriodField = 0;
  let unparsablePeriod = 0;

  for (const row of rows) {
    const rawPeriod = readString(row, descriptor.periodFields);
    if (!rawPeriod) {
      noPeriodField += 1;
      continue;
    }
    const period = normalizePeriod(rawPeriod);
    if (!period) {
      unparsablePeriod += 1;
      continue;
    }

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
      if (descriptor.averageValueFields) {
        // ค่าที่ประกาศเป็นช่วง: ใส่ทั้งขอบล่างและขอบบนลงถังเดียวกัน ค่าเฉลี่ยของถัง
        // จึงเป็นจุดกึ่งกลางของช่วง เฉลี่ยข้ามธนาคารไปพร้อมกันในขั้นตอนเดียว
        for (const value of readNumbers(row, candidates, descriptor.treatZeroAsMissing)) {
          addToBucket(buckets, period, dimension, value);
        }
        continue;
      }
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

    // บาง endpoint บอก "ไม่มีข้อมูล" ด้วยแถวเปล่าหนึ่งแถวแทนที่จะส่ง array ว่าง
    // ความหมายเหมือนกัน จึงไม่ควรรายงานเป็นข้อผิดพลาด
    // (ต่างจากกรณีที่แถวมีค่าอยู่จริงแต่เราอ่านไม่ได้ ซึ่งยังต้องดังเหมือนเดิม)
    if (rows.every(isBlankRow)) {
      return { observations: [], lastUpdated: extractLastUpdated(payload) };
    }

    // โครงรายงานที่ไม่มีตัวเลข — ธปท. ส่งรายชื่อประเภทอัตรามาครบ แต่ทั้งวันที่และค่าเป็นค่าว่าง
    // เมื่อช่วงที่ขอไม่มีข้อมูล (เจอกับ Stat-ThaiBahtImpliedInterestRate และ
    // Stat-ExternalInterestRate ที่ส่วนหัวบอกว่าอัปเดตล่าสุดปี 2024)
    //
    // ต่างจาก "ชื่อคอลัมน์ผิด" ตรงที่คอลัมน์มีอยู่จริงในแถว เพียงแต่ว่าง — ถ้าชื่อผิด
    // คอลัมน์จะไม่มีอยู่เลย ซึ่งต้องดังเหมือนเดิม เพราะเป็นคนละปัญหาและแก้คนละที่
    if (rows.every((row) => hasEmptyMeasuredColumns(row, descriptor))) {
      return { observations: [], lastUpdated: extractLastUpdated(payload) };
    }

    // มีแถวข้อมูลจริงแต่ไม่เหลือค่าเลย — บอกให้ชัดว่าตกตรงไหน และแนบแถวจริงหนึ่งแถว
    // ชื่อคอลัมน์อย่างเดียวไม่พอเมื่อคอลัมน์ตรงแล้วแต่ค่ายังอ่านไม่ได้
    const seenColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 20);
    const droppedByPeriod = noPeriodField + unparsablePeriod;
    const stage =
      droppedByPeriod === rows.length
        ? `อ่านวันที่ไม่ได้ทั้ง ${rows.length} แถว ` +
          `(ไม่มีคอลัมน์วันที่ ${noPeriodField} · แปลงวันที่ไม่ได้ ${unparsablePeriod}) ` +
          `— คอลัมน์วันที่ที่รองรับ: ${descriptor.periodFields.join(', ')}`
        : `อ่านค่าไม่ได้จาก ${rows.length - droppedByPeriod} แถวที่วันที่ใช้ได้ ` +
          `— คอลัมน์ค่าที่รองรับ: ${Object.values(descriptor.valueFields).flat().join(', ')}` +
          (descriptor.treatZeroAsMissing ? ' (ค่า 0 ถือว่าไม่มีข้อมูล)' : '');

    const blanks = rows.filter(isBlankRow).length;

    throw new BotApiError(
      `BOT response for "${descriptor.id}": ${stage} · ` +
        `คอลัมน์ที่ได้มา: ${seenColumns.join(', ') || 'ไม่มีคอลัมน์'} · ` +
        `ตัวอย่างแถวที่มีค่ามากที่สุด: {${sampleRow(mostPopulated(rows))}}` +
        (blanks > 0 ? ` · แถวที่ทุกคอลัมน์ว่าง ${blanks}/${rows.length} แถว` : '') +
        // วันที่อ่านไม่ได้ทุกแถวแปลว่ามันไม่ได้อยู่ในแถว คำถามถัดไปคือ "แล้วอยู่ไหน"
        // ส่วนหัวคือที่แรกที่ต้องดู จึงแนบไปด้วยเลย ไม่ต้องรอถามอีกรอบ
        (droppedByPeriod === rows.length ? ` · ส่วนหัว: {${headerFields(payload)}}` : '') +
        ' — ปรับ periodFields/valueFields ใน botSeries.ts ให้ตรงกับผลลัพธ์จริง',
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

/**
 * คอลัมน์ที่ทะเบียนอ่านจริง "มีอยู่แต่ว่าง" ทุกช่องหรือไม่
 *
 * แยกสองอาการที่หน้าตาเหมือนกันเมื่อดูจากผลลัพธ์สุดท้าย:
 *   มีคอลัมน์แต่ค่าว่าง = ธปท. ไม่มีข้อมูลของช่วงนี้ — เป็นคำตอบที่ถูกต้อง
 *   ไม่มีคอลัมน์เลย     = ชื่อคอลัมน์ในทะเบียนไม่ตรง — เป็นบั๊กที่ต้องดัง
 */
function hasEmptyMeasuredColumns(row: Row, descriptor: BotSeriesDescriptor): boolean {
  const lowered = lowerKeys(row);

  // ว่างแปลว่า "ไม่มีข้อมูล" ได้ก็ต่อเมื่อคอลัมน์นั้นมีอยู่จริงในแถว
  // ไม่มีคอลัมน์เลยคือชื่อในทะเบียนไม่ตรง ซึ่งเป็นบั๊กคนละเรื่อง
  function emptyPresent(names: string[]): { present: boolean; allEmpty: boolean } {
    let present = false;
    for (const name of names) {
      const value = lowered.get(name.toLowerCase());
      if (value === undefined) continue;
      present = true;
      if (value !== null && String(value).trim() !== '') return { present, allEmpty: false };
    }
    return { present, allEmpty: true };
  }

  // ไม่รวมคอลัมน์มิติ เพราะโครงรายงานเปล่ายังมีชื่อประเภทอัตราครบ มีแต่ตัวเลขที่หายไป
  const period = emptyPresent(descriptor.periodFields);
  const value = emptyPresent(Object.values(descriptor.valueFields).flat());

  // ต้องว่างทั้งฝั่งวันที่และฝั่งค่า และทั้งสองฝั่งต้องมีคอลัมน์อยู่จริง
  //
  // ถ้าเช็คแค่ "มีคอลัมน์สักช่องแล้วว่าง" ชุดที่ periodFields บังเอิญตรงแต่ valueFields
  // ผิดทั้งหมดจะถูกนับเป็นไม่มีข้อมูล แล้วบั๊กชื่อคอลัมน์จะเงียบหายไป
  return period.present && period.allEmpty && value.present && value.allEmpty;
}

/** ทุกคอลัมน์ว่างหมด — เป็นแถวที่ ธปท. ใส่มาแทนคำตอบว่าไม่มีข้อมูล ไม่ใช่ข้อมูลที่อ่านไม่ออก */
function isBlankRow(row: Row): boolean {
  return Object.values(row).every(
    (value) => value === null || value === undefined || String(value).trim() === '',
  );
}

/**
 * แถวที่มีค่าไม่ว่างมากที่สุด
 *
 * เดิมหยิบแถวแรกมาโชว์เสมอ ซึ่งพังตอน ธปท. ขึ้นต้นด้วยแถวที่คอลัมน์ค่าว่างหมด —
 * ตัวอย่างที่ได้ไม่บอกอะไรเลย และเสียเวลาไปหนึ่งรอบเต็มกว่าจะรู้ว่าข้อมูลจริงหน้าตาอย่างไร
 */
function mostPopulated(rows: Row[]): Row | undefined {
  let best: Row | undefined;
  let bestScore = -1;
  for (const row of rows) {
    const score = Object.values(row).filter(
      (value) => value !== null && value !== undefined && String(value).trim() !== '',
    ).length;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/** ส่วนหัวของผลลัพธ์แบบย่อ — ที่ที่วันที่ไปอยู่เมื่อไม่ได้อยู่ในแถว */
function headerFields(payload: unknown): string {
  if (!isRecord(payload)) return 'ไม่มี';
  const result = isRecord(payload.result) ? payload.result : payload;
  const data = isRecord(result.data) ? result.data : {};
  const header = isRecord(data.data_header) ? data.data_header : null;
  if (!header) return `ไม่มี data_header · result{${keysOf(result)}}`;
  return sampleRow(header);
}

/** ตัวอย่างแถวหนึ่งแถวแบบย่อ ใช้ดูว่าค่าที่ ธปท. ส่งมาหน้าตาเป็นอย่างไรจริง ๆ */
function sampleRow(row: Row | undefined): string {
  if (!row) return 'ไม่มีแถว';
  return Object.entries(row)
    .slice(0, 10)
    .map(([key, value]) => {
      const text = JSON.stringify(value) ?? 'null';
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    })
    .join(', ');
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
