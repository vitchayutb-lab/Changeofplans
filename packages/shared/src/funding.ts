/** DTOs ของฐานข้อมูลแหล่งเงินทุนและการจับคู่กับ SME */

import type { Provenance } from './bot.js';

export type FundingType = 'loan' | 'grant' | 'guarantee' | 'equity' | 'subsidy';

export interface FundingProgram {
  id: string;
  nameTh: string;
  nameEn: string;
  provider: string;
  type: FundingType;
  minAmount: number;
  maxAmount: number;
  rateMin: number | null;
  rateMax: number | null;
  rateBasis: 'fixed' | 'mlr_spread' | 'mrr_spread' | null;
  maxTermMonths: number | null;
  eligibleIndustries: string[];
  eligibleProvinces: string[];
  minYearsOperating: number;
  maxEmployees: number | null;
  maxAnnualRevenue: number | null;
  requiresCollateral: boolean;
  minDscr: number | null;
  descriptionTh: string;
  descriptionEn: string;
  url: string | null;
  active: boolean;
}

/** ผลการตรวจเงื่อนไขหนึ่งข้อ พร้อมตัวเลขที่ใช้เทียบจริง */
export interface EligibilityCheck {
  rule: string;
  labelTh: string;
  passed: boolean;
  /** ค่าของ SME ที่นำไปเทียบ */
  actual: string;
  /** เกณฑ์ของโครงการ */
  required: string;
}

export interface FundingMatch {
  program: FundingProgram;
  /** 0-100 — ยิ่งสูงยิ่งเหมาะ */
  score: number;
  eligible: boolean;
  checks: EligibilityCheck[];
  /** ประมาณการต้นทุนเมื่อกู้ตามวงเงินที่ขอ (null สำหรับเงินให้เปล่า) */
  estimate: {
    amount: number;
    estimatedRatePct: number | null;
    referenceRateName: string | null;
    annualInterest: number | null;
    monthlyPayment: number | null;
    termMonths: number | null;
    provenance: Provenance | null;
  } | null;
  reasonTh: string;
}

export type ApplicationStatus =
  | 'interested'
  | 'preparing'
  | 'submitted'
  | 'approved'
  | 'rejected';

export interface FundingApplication {
  id: string;
  smeId: string;
  programId: string;
  amountRequested: number;
  status: ApplicationStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
