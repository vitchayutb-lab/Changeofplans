/**
 * DTOs ของโหมด Startup — ประเมินความพร้อมกู้ของกิจการที่ยังไม่มีงบการเงินย้อนหลัง
 *
 * ต่างจากส่วนอื่นของระบบตรงที่ไม่มีงบให้อ่าน จึงต้องรับตัวเลขที่เจ้าของรู้เองเข้ามา
 * แล้วคำนวณตัวชี้วัดที่ธนาคารใช้จริงจากตัวเลขเหล่านั้น
 */

import type { Provenance } from './bot.js';
import type { FundingProgram, FundingType } from './funding.js';
import type { Industry, LoanDownside } from './finance.js';

export type CreditHistory = 'clean' | 'none' | 'late' | 'default';

export type LoanPurpose =
  | 'working_capital'
  | 'equipment'
  | 'expansion'
  | 'inventory'
  | 'refinance';

/** ข้อมูลที่เจ้าของกิจการกรอกเอง */
export interface StartupProfile {
  businessName?: string;
  industry: Industry;
  province: string;
  /** จำนวนเดือนที่เปิดดำเนินการแล้ว (0 = ยังไม่เริ่มขาย) */
  monthsOperating: number;

  /** เงินทุนของเจ้าของที่ใส่เข้าธุรกิจแล้ว */
  ownerCapital: number;
  cashOnHand: number;
  /** ประมาณการรายได้ต่อเดือน */
  monthlyRevenue: number;
  /** ค่าใช้จ่ายรวมต่อเดือน (ต้นทุนขาย + ค่าใช้จ่ายดำเนินงาน) */
  monthlyExpenses: number;

  /** หนี้เดิมทั้งหมด รวมหนี้ส่วนตัวที่ต้องผ่อน */
  existingDebtOutstanding: number;
  existingDebtMonthlyPayment: number;
  /** รายได้อื่นของเจ้าของที่นำมาชำระหนี้ได้ */
  ownerMonthlyIncome: number;

  collateralValue: number;
  hasGuarantor: boolean;
  creditHistory: CreditHistory;

  requestedAmount: number;
  requestedYears: number;
  purpose: LoanPurpose;
}

export type FactorStatus = 'good' | 'warn' | 'fail';

/** ผลการตรวจปัจจัยหนึ่งข้อ พร้อมตัวเลขจริงที่ใช้เทียบ */
export interface AssessmentFactor {
  key: string;
  labelTh: string;
  labelEn: string;
  status: FactorStatus;
  /** น้ำหนักของปัจจัยนี้ในคะแนนรวม (รวมทุกปัจจัย = 100) */
  weight: number;
  /** ค่าที่คำนวณได้จากข้อมูลที่กรอก */
  actual: string;
  /** เกณฑ์ที่ใช้ตัดสิน */
  benchmark: string;
  explanationTh: string;
}

export type ApprovalLikelihood = 'likely' | 'possible' | 'difficult' | 'unlikely';

/** ตัวชี้วัดที่ธนาคารใช้ คำนวณจากข้อมูลที่กรอก */
export interface StartupMetrics {
  monthlyProfit: number;
  annualRevenue: number;
  /** อัตราดอกเบี้ยที่ประมาณว่าจะถูกคิด = อัตราอ้างอิง ธปท. + ส่วนต่างตามความเสี่ยง */
  estimatedRatePct: number;
  referenceRateName: string | null;
  referenceRatePct: number | null;
  riskSpreadPct: number;
  newMonthlyPayment: number;
  totalMonthlyDebtService: number;
  firstYearInterest: number;
  /** ความสามารถชำระหนี้: (กำไรต่อเดือน + รายได้เจ้าของ) ÷ ภาระผ่อนต่อเดือน */
  dscr: number | null;
  /** สัดส่วนภาระหนี้ต่อรายได้ */
  dsrPercent: number | null;
  /** ส่วนร่วมของเจ้าของต่อเงินลงทุนทั้งหมด */
  ownerEquitySharePercent: number;
  collateralCoverage: number | null;
  cashRunwayMonths: number | null;
  loanToAnnualRevenue: number | null;
}

/** สิ่งที่ทำได้เพื่อเพิ่มโอกาสอนุมัติ พร้อมตัวเลขที่คำนวณให้แล้ว */
export interface ImprovementAction {
  key: string;
  titleTh: string;
  detailTh: string;
  /** ผลที่คาดว่าจะได้ถ้าทำตาม */
  impactTh: string;
}

export interface LenderRecommendation {
  program: FundingProgram;
  /** 0-100 */
  score: number;
  eligible: boolean;
  reasonTh: string;
  blockedByTh: string[];
  estimate: {
    amount: number;
    estimatedRatePct: number | null;
    referenceRateName: string | null;
    monthlyPayment: number | null;
    annualInterest: number | null;
    termMonths: number | null;
  } | null;
}

export interface StartupAssessment {
  profile: StartupProfile;
  metrics: StartupMetrics;
  factors: AssessmentFactor[];
  /** คะแนนรวม 0-100 จากปัจจัยที่ถ่วงน้ำหนักแล้ว */
  score: number;
  likelihood: ApprovalLikelihood;
  likelihoodLabelTh: string;
  summaryTh: string;
  /** เหตุผลที่ตัดสินว่าไม่ผ่านทันทีโดยไม่ต้องดูคะแนน (ถ้ามี) */
  blockersTh: string[];
  /** ประเภทสินเชื่อที่เหมาะกับวัตถุประสงค์และสถานะปัจจุบัน */
  suggestedProductsTh: { type: FundingType; titleTh: string; whyTh: string }[];
  recommendations: LenderRecommendation[];
  actions: ImprovementAction[];
  /** วงเงินสูงสุดที่ตัวเลขปัจจุบันรองรับได้ที่ DSCR 1.2 เท่า */
  affordableAmount: number;
  /**
   * ต้นทุนถ้าผิดนัดชำระที่วงเงินที่ขอ
   *
   * หน้าประเมินตอบว่า "น่าจะกู้ผ่านไหม" และ "ผ่อนไหวไหม" ทั้งสองข้อคิดบนสมมติฐาน
   * ว่าทุกอย่างเป็นไปตามแผน ตัวเลขนี้คือกรณีที่ไม่เป็นไปตามแผน
   */
  downside: LoanDownside | null;
  provenance: Provenance | null;
  disclaimerTh: string;
}
