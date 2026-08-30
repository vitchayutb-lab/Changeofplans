/**
 * ตรวจและแปลงข้อมูลที่ผู้ใช้กรอกให้เป็น StartupProfile
 *
 * แยกออกมาจาก route เพื่อให้ทั้ง REST API และเครื่องมือของ AI ใช้ตัวตรวจชุดเดียวกัน
 * กฎการตรวจจึงไม่มีทางไม่ตรงกันระหว่างสองทาง
 */

import type { CreditHistory, Industry, LoanPurpose, StartupProfile } from '@sme/shared';

export class ProfileValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

const INDUSTRIES: Industry[] = [
  'manufacturing',
  'retail',
  'food',
  'services',
  'logistics',
  'agriculture',
  'tech',
];

const CREDIT_HISTORIES: CreditHistory[] = ['clean', 'none', 'late', 'default'];

const PURPOSES: LoanPurpose[] = [
  'working_capital',
  'equipment',
  'expansion',
  'inventory',
  'refinance',
];

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
  if (value < min) {
    throw new ProfileValidationError(`"${field}" ต้องไม่น้อยกว่า ${min}`, field);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ProfileValidationError(`"${field}" ต้องไม่เกิน ${options.max}`, field);
  }
  return value;
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: T[],
  fallback?: T,
): T {
  const raw = source[field];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new ProfileValidationError(`ต้องระบุ "${field}"`, field);
  }
  const value = String(raw);
  const match = allowed.find((option) => option === value);
  if (!match) {
    throw new ProfileValidationError(
      `"${field}" ต้องเป็นหนึ่งใน: ${allowed.join(', ')} (ได้รับ "${value}")`,
      field,
    );
  }
  return match;
}

export function parseStartupProfile(input: unknown): StartupProfile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProfileValidationError('ข้อมูลกิจการต้องเป็นอ็อบเจ็กต์');
  }
  const source = input as Record<string, unknown>;

  const businessName = source.businessName ? String(source.businessName).slice(0, 200) : undefined;
  const province = source.province ? String(source.province).slice(0, 100) : 'กรุงเทพมหานคร';

  const profile: StartupProfile = {
    ...(businessName ? { businessName } : {}),
    industry: oneOf(source, 'industry', INDUSTRIES, 'services'),
    province,
    monthsOperating: num(source, 'monthsOperating', { max: 600 }),

    ownerCapital: num(source, 'ownerCapital'),
    cashOnHand: num(source, 'cashOnHand'),
    monthlyRevenue: num(source, 'monthlyRevenue'),
    monthlyExpenses: num(source, 'monthlyExpenses'),

    existingDebtOutstanding: num(source, 'existingDebtOutstanding'),
    existingDebtMonthlyPayment: num(source, 'existingDebtMonthlyPayment'),
    ownerMonthlyIncome: num(source, 'ownerMonthlyIncome'),

    collateralValue: num(source, 'collateralValue'),
    hasGuarantor:
      source.hasGuarantor === true ||
      source.hasGuarantor === 'true' ||
      source.hasGuarantor === 1 ||
      source.hasGuarantor === '1',
    creditHistory: oneOf(source, 'creditHistory', CREDIT_HISTORIES, 'none'),

    requestedAmount: num(source, 'requestedAmount', { required: true, min: 10_000 }),
    requestedYears: num(source, 'requestedYears', { fallback: 5, min: 0.5, max: 30 }),
    purpose: oneOf(source, 'purpose', PURPOSES, 'working_capital'),
  };

  return profile;
}

/** ตัวอย่างข้อมูลที่กรอกไว้ให้แล้ว เพื่อให้ผู้ใช้เห็นผลลัพธ์ได้ทันทีโดยไม่ต้องคิดตัวเลขเอง */
export const EXAMPLE_PROFILE: StartupProfile = {
  businessName: 'ร้านกาแฟและเบเกอรี่ (ตัวอย่าง)',
  industry: 'food',
  province: 'กรุงเทพมหานคร',
  monthsOperating: 8,
  ownerCapital: 600_000,
  cashOnHand: 180_000,
  monthlyRevenue: 320_000,
  monthlyExpenses: 265_000,
  existingDebtOutstanding: 150_000,
  existingDebtMonthlyPayment: 6_500,
  ownerMonthlyIncome: 20_000,
  collateralValue: 0,
  hasGuarantor: false,
  creditHistory: 'clean',
  requestedAmount: 800_000,
  requestedYears: 5,
  purpose: 'equipment',
};
