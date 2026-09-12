/**
 * ตรวจและแปลงข้อมูลที่ผู้ใช้กรอกให้เป็น LendingProfile
 *
 * แยกจาก route ด้วยเหตุผลเดียวกับ parseStartupProfile คือให้ REST API และเครื่องมือของ AI
 * ใช้ตัวตรวจชุดเดียวกัน กฎจึงไม่มีทางต่างกันระหว่างสองทาง
 */

import type { Industry, LendingProfile } from '@sme/shared';
import { ProfileValidationError } from '../startup/parseProfile.js';
import { INDUSTRIES } from './conditions.js';

function num(
  source: Record<string, unknown>,
  field: string,
  options: { required?: boolean; min?: number; max?: number; fallback?: number } = {},
): number {
  const raw = source[field];
  if (raw === undefined || raw === null || raw === '') {
    if (options.required) throw new ProfileValidationError(`ต้องระบุ "${field}"`, field);
    return options.fallback ?? 0;
  }
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
  if (!Number.isFinite(value)) {
    throw new ProfileValidationError(`"${field}" ต้องเป็นตัวเลข`, field);
  }
  const min = options.min ?? 0;
  if (value < min) throw new ProfileValidationError(`"${field}" ต้องไม่น้อยกว่า ${min}`, field);
  if (options.max !== undefined && value > options.max) {
    throw new ProfileValidationError(`"${field}" ต้องไม่เกิน ${options.max}`, field);
  }
  return value;
}

export function parseLendingProfile(input: unknown): LendingProfile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProfileValidationError('ข้อมูลธุรกิจต้องเป็นอ็อบเจ็กต์');
  }
  const source = input as Record<string, unknown>;

  const rawIndustry = source.industry === undefined ? 'services' : String(source.industry);
  const industry = INDUSTRIES.find((option) => option === rawIndustry);
  if (!industry) {
    throw new ProfileValidationError(
      `"industry" ต้องเป็นหนึ่งใน: ${INDUSTRIES.join(', ')} (ได้รับ "${rawIndustry}")`,
      'industry',
    );
  }

  // DSCR ที่ไม่ส่งมาแปลว่า "ยังไม่ระบุ" ไม่ใช่ 0 — ศูนย์แปลว่าหาเงินมาผ่อนไม่ได้เลย
  // ซึ่งเป็นคนละเรื่องกับยังไม่ได้คำนวณ และทำให้ผลที่แสดงผิดไปคนละทาง
  const rawDscr = source.dscr;
  const dscr =
    rawDscr === undefined || rawDscr === null || rawDscr === ''
      ? null
      : num(source, 'dscr', { min: 0, max: 100 });

  return {
    industry: industry as Industry,
    province: source.province ? String(source.province).slice(0, 100) : 'กรุงเทพมหานคร',
    yearsOperating: num(source, 'yearsOperating', { max: 200 }),
    employees: num(source, 'employees', { max: 1_000_000 }),
    annualRevenue: num(source, 'annualRevenue'),
    dscr,
    hasCollateral:
      source.hasCollateral === true ||
      source.hasCollateral === 'true' ||
      source.hasCollateral === 1 ||
      source.hasCollateral === '1',
    amountNeeded: num(source, 'amountNeeded', { required: true, min: 10_000 }),
  };
}

/**
 * ตัวอย่างที่กรอกไว้ให้แล้ว เพื่อให้เห็นผลทันทีโดยไม่ต้องคิดตัวเลขเอง
 *
 * เลือกกิจการบริการขนาดกลางที่ยังไม่มีหลักประกัน เพราะเป็นโปรไฟล์ที่เห็นความต่าง
 * ระหว่างประเภทธุรกิจได้ชัด — บริการเป็นกลุ่มที่มีโครงการเจาะจงรองรับน้อยที่สุด
 */
export const EXAMPLE_LENDING_PROFILE: LendingProfile = {
  industry: 'services',
  province: 'กรุงเทพมหานคร',
  yearsOperating: 3,
  employees: 30,
  annualRevenue: 50_000_000,
  dscr: 1.3,
  hasCollateral: false,
  amountNeeded: 3_000_000,
};
