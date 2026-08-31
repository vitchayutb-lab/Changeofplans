/** DTOs ของโปรไฟล์ SME งบการเงิน อัตราส่วน และการจำลองสินเชื่อ */

import type { Provenance } from './bot.js';

export type Industry =
  | 'manufacturing'
  | 'retail'
  | 'food'
  | 'services'
  | 'logistics'
  | 'agriculture'
  | 'tech';

export interface Sme {
  id: string;
  nameTh: string;
  nameEn: string;
  registrationNo: string | null;
  industry: Industry;
  province: string;
  foundedYear: number;
  employees: number;
  currency: string;
  fxExposureCurrency: string | null;
  fxAnnualExposure: number;
  createdAt: string;
}

/** ข้อมูลย่อของกิจการสำหรับรายการค้นหา — เบากว่า Sme เต็ม ๆ เพราะต้องส่งทีละหลายรายการ */
export interface SmeSummary {
  id: string;
  nameTh: string;
  nameEn: string;
  industry: Industry;
  province: string;
  foundedYear: number;
  employees: number;
  /** รายได้ของงบปีล่าสุดที่บันทึกไว้ (null เมื่อยังไม่มีงบ) */
  latestRevenue: number | null;
  latestFiscalYear: number | null;
}

/**
 * ตัวเลือกการเรียงลำดับผลค้นหากิจการ
 *
 * เป็นชุดปิด ไม่ใช่ข้อความอิสระ เพราะค่านี้กลายเป็น ORDER BY ในฐานข้อมูล
 * การรับข้อความอิสระแล้วต่อเข้า SQL ตรง ๆ คือช่องโหว่ SQL injection
 */
export type SmeSortKey =
  | 'name'
  | 'revenue_desc'
  | 'revenue_asc'
  | 'employees_desc'
  | 'employees_asc'
  | 'founded_desc'
  | 'founded_asc';

export const SME_SORT_KEYS: SmeSortKey[] = [
  'name',
  'revenue_desc',
  'revenue_asc',
  'employees_desc',
  'employees_asc',
  'founded_desc',
  'founded_asc',
];

export interface SmeSearchResult {
  smes: SmeSummary[];
  /** จำนวนทั้งหมดที่ตรงเงื่อนไข (ไม่ใช่แค่หน้านี้) */
  total: number;
  limit: number;
  offset: number;
  /** ตัวเลือกสำหรับตัวกรอง คำนวณจากข้อมูลจริงในฐานข้อมูล */
  facets: { industries: string[]; provinces: string[] };
  /** ลำดับที่ใช้จริง — สะท้อนค่าที่เซิร์ฟเวอร์ยอมรับ ไม่ใช่ค่าที่ผู้ใช้ขอ */
  sort: SmeSortKey;
}

export type StatementPeriod = 'FY' | 'H1' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

/** ตัวเลขดิบที่กรอกเข้าระบบ — ค่าที่คำนวณต่อได้จะไม่เก็บลงฐานข้อมูล */
export interface FinancialStatementInput {
  fiscalYear: number;
  period: StatementPeriod;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  depreciation: number;
  interestExpense: number;
  tax: number;
  cash: number;
  accountsReceivable: number;
  inventory: number;
  otherCurrentAssets: number;
  fixedAssets: number;
  accountsPayable: number;
  shortTermDebt: number;
  otherCurrentLiabilities: number;
  longTermDebt: number;
  equityPaidUp: number;
  retainedEarnings: number;
}

export interface FinancialStatement extends FinancialStatementInput {
  id: string;
  smeId: string;
  source: string;
}

/** ค่าที่คำนวณจากงบ — คำนวณสด ไม่เก็บลงฐาน จึงไม่มีทางไม่ตรงกับข้อมูลดิบ */
export interface DerivedStatement {
  fiscalYear: number;
  period: StatementPeriod;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  depreciation: number;
  ebitda: number;
  ebit: number;
  interestExpense: number;
  ebt: number;
  tax: number;
  netProfit: number;
  cash: number;
  accountsReceivable: number;
  inventory: number;
  currentAssets: number;
  totalAssets: number;
  currentLiabilities: number;
  totalDebt: number;
  totalLiabilities: number;
  equity: number;
  workingCapital: number;
  /** กระแสเงินสดจากการดำเนินงานโดยประมาณ = EBITDA - ดอกเบี้ย - ภาษี */
  operatingCashFlow: number;
}

export type RatioVerdict = 'good' | 'watch' | 'risk' | 'na';

export interface Ratio {
  key: string;
  label: string;
  labelTh: string;
  value: number | null;
  unit: 'x' | 'percent' | 'days';
  /** ช่วงที่ถือว่าดีสำหรับ SME ไทยโดยทั่วไป (ใช้เป็นเกณฑ์เทียบ ไม่ใช่กฎตายตัว) */
  benchmark: { good: number; watch: number; higherIsBetter: boolean };
  verdict: RatioVerdict;
  formula: string;
  explanationTh: string;
}

export interface RatioGroup {
  key: 'liquidity' | 'leverage' | 'profitability' | 'efficiency' | 'coverage';
  label: string;
  labelTh: string;
  ratios: Ratio[];
}

export interface FinancialAnalysis {
  smeId: string;
  fiscalYear: number;
  current: DerivedStatement;
  previous: DerivedStatement | null;
  /** การเปลี่ยนแปลงเทียบปีก่อนหน้า เป็นสัดส่วน (0.12 = +12%) */
  yoy: Record<string, number | null>;
  groups: RatioGroup[];
  alerts: FinancialAlert[];
}

export interface FinancialAlert {
  level: 'info' | 'warn' | 'risk';
  titleTh: string;
  titleEn: string;
  detailTh: string;
}

export type RateBasis = 'fixed' | 'mlr_spread' | 'mor_spread' | 'mrr_spread';

export interface ExistingLoan {
  id: string;
  smeId: string;
  lender: string;
  product: 'term_loan' | 'od' | 'leasing' | 'trade_finance';
  principal: number;
  outstanding: number;
  rateType: RateBasis;
  rateValue: number;
  termMonths: number;
  remainingMonths: number;
  startDate: string;
}

/** สินเชื่อเดิมหลังคิดอัตราดอกเบี้ยใหม่ตามอัตราอ้างอิงล่าสุดของ BOT */
export interface RepricedLoan extends ExistingLoan {
  effectiveRatePct: number;
  /** ชื่ออัตราอ้างอิงที่ใช้ เช่น "MLR" — null เมื่อเป็นดอกเบี้ยคงที่ */
  referenceRateName: string | null;
  referenceRatePct: number | null;
  annualInterest: number;
  monthlyPayment: number;
  provenance: Provenance | null;
}

export interface DebtOverview {
  smeId: string;
  loans: RepricedLoan[];
  totalOutstanding: number;
  totalAnnualInterest: number;
  totalAnnualDebtService: number;
  weightedAverageRatePct: number | null;
  notice: string | null;
}

export interface AmortizationRow {
  month: number;
  openingBalance: number;
  payment: number;
  interest: number;
  principal: number;
  closingBalance: number;
}

export interface LoanQuote {
  principal: number;
  annualRatePct: number;
  years: number;
  paymentsPerYear: number;
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  firstYearInterest: number;
  /** true เมื่ออัตราดอกเบี้ยเป็นค่าประมาณที่ระบบคำนวณให้ ไม่ใช่ข้อเสนอจริงจากธนาคาร */
  isEstimate: true;
  schedule: AmortizationRow[];
}

export interface LoanSimulation {
  smeId: string;
  quote: LoanQuote;
  rate: {
    basis: RateBasis;
    referenceRateName: string | null;
    referenceRatePct: number | null;
    spreadPct: number;
    effectiveRatePct: number;
    provenance: Provenance | null;
  };
  impact: {
    dscrBefore: number | null;
    dscrAfter: number | null;
    debtToEquityBefore: number | null;
    debtToEquityAfter: number | null;
    interestCoverageBefore: number | null;
    interestCoverageAfter: number | null;
    /** ดอกเบี้ยปีแรกคิดเป็นสัดส่วนเท่าไรของ EBIT */
    interestToEbit: number | null;
    verdict: RatioVerdict;
    verdictReasonTh: string;
  };
  disclaimerTh: string;
  disclaimerEn: string;
}
