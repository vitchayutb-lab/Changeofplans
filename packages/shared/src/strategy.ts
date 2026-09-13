/**
 * DTOs ของ "จัดหาแหล่งเงินทุน" — ควรหาเงินจากไหน ตามลำดับไหน
 *
 * หน้าแหล่งเงินทุนตอบว่ามีโครงการอะไรที่สมัครได้ ส่วนนี้ตอบคำถามที่กว้างกว่า คือ
 * ถ้าต้องการเงินก้อนหนึ่ง ควรหามาจากไหนก่อน-หลัง โดยเรียงตามต้นทุนจริง
 *
 * ประเด็นสำคัญที่มักถูกมองข้าม: เงินที่ถูกที่สุดไม่ใช่เงินที่กู้มา แต่เป็นเงินของกิจการเอง
 * ที่จมอยู่ในลูกหนี้และสินค้าคงเหลือ ซึ่งคำนวณออกมาเป็นบาทได้จากงบจริง และไม่มีดอกเบี้ย
 */

import type { RatioVerdict } from './finance.js';

export type FundingSourceKind =
  /** เงินของกิจการเองที่จมอยู่ในเงินทุนหมุนเวียน — ไม่มีดอกเบี้ย */
  | 'working_capital'
  /** เงินให้เปล่า ไม่ต้องคืนเงินต้น */
  | 'grant'
  | 'subsidy'
  /** ไม่ใช่เงิน แต่ปลดเงื่อนไขหลักประกัน จึงไม่นับรวมในแผนจัดสรร */
  | 'guarantee'
  | 'debt'
  /** ไม่มีดอกเบี้ย แต่ผู้ถือหุ้นเดิมถูกลดสัดส่วน */
  | 'equity';

/** เงินที่ปลดล็อกได้จากเงินทุนหมุนเวียนหนึ่งรายการ */
export interface WorkingCapitalRelease {
  key: 'receivables' | 'inventory';
  labelTh: string;
  /** จำนวนวันปัจจุบันจากงบจริง — null เมื่อคำนวณไม่ได้ */
  currentDays: number | null;
  /** เป้าหมายจากทะเบียนเกณฑ์ของระบบเอง ไม่ใช่ค่าที่ตั้งขึ้นเฉพาะหน้านี้ */
  targetDays: number;
  /** เงินที่จะได้คืนถ้าทำถึงเป้า — 0 เมื่อดีกว่าเกณฑ์อยู่แล้ว */
  releasableAmount: number;
  formulaTh: string;
  actionTh: string;
  verdict: RatioVerdict;
}

export interface FundingSource {
  kind: FundingSourceKind;
  labelTh: string;
  /** จำนวนเงินที่แหล่งนี้ให้ได้จริง */
  availableAmount: number;
  /** ต้นทุนดอกเบี้ยต่อปี — null เมื่อแหล่งนี้ไม่มีต้นทุนดอกเบี้ย */
  annualCostPct: number | null;
  /** ต้นทุนที่ไม่ใช่ดอกเบี้ย เช่น การเสียสัดส่วนผู้ถือหุ้น — null เมื่อไม่มี */
  nonCashCostTh: string | null;
  /**
   * false สำหรับการค้ำประกัน ซึ่งไม่ใช่เงินแต่เป็นตัวปลดเงื่อนไข
   * ถ้านับรวมในแผนจะกลายเป็นการนับเงินซ้ำ
   */
  countsTowardPlan: boolean;
  whyTh: string;
  howToTh: string;
  /** ตัวเลขนี้มาจากไหน — งบการเงิน หรือทะเบียนโครงการ */
  basisTh: string;
  programsTh: string[];
}

/** หนึ่งขั้นของแผนจัดสรร เรียงจากแหล่งที่ถูกที่สุด */
export interface FundingPlanStep {
  kind: FundingSourceKind;
  labelTh: string;
  amount: number;
  cumulativeAmount: number;
  annualCostPct: number | null;
  /** ต้นทุนดอกเบี้ยต่อปีของก้อนนี้ */
  annualCost: number;
}

export interface FundingStrategy {
  smeId: string;
  fiscalYear: number;
  needAmount: number;

  workingCapital: {
    releases: WorkingCapitalRelease[];
    totalReleasable: number;
    /** วันจ่ายเจ้าหนี้ — แสดงเป็นบริบทเท่านั้น ระบบไม่เสนอให้ยืดหนี้การค้า */
    payableDays: number | null;
    /** วงจรเงินสด = วันเก็บหนี้ + วันสินค้าคงเหลือ − วันจ่ายเจ้าหนี้ */
    cashCycleDays: number | null;
  };

  sources: FundingSource[];
  plan: FundingPlanStep[];

  coveredAmount: number;
  /** ส่วนที่ยังหาไม่ได้จากแหล่งทั้งหมดรวมกัน */
  gapAmount: number;
  planAnnualCost: number;
  /** ต้นทุนถัวเฉลี่ยของแผน — null เมื่อแผนไม่มีก้อนที่มีดอกเบี้ย */
  blendedCostPct: number | null;

  summaryTh: string;
  disclaimerTh: string;
}
