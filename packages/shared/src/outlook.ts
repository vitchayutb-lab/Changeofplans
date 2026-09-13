/**
 * DTOs ของ "ภาระหนี้ในอนาคต" — อีกกี่ปีถึงจะเริ่มผ่อนไม่ไหว
 *
 * ต่างจาก capacity.ts ที่ตอบ ณ วันนี้ ส่วนนี้เดินเวลาไปข้างหน้าแล้วตรวจ DSCR ทุกปี
 * สิ่งที่ทำให้ต่างจากการคูณอัตราเติบโตเฉย ๆ คือภาระหนี้ไม่คงที่: สินเชื่อแต่ละก้อน
 * มีอายุคงเหลือของตัวเอง ก้อนที่ครบกำหนดจะหลุดออกไปและภาระรวมลดลงเป็นขั้น
 *
 * ข้อควรระวังเรื่องข้อมูล: ระบบไม่มีชุดข้อมูล GDP จริง (ธปท. ให้สิทธิ์เป็น product
 * และคีย์นี้ไม่ครอบคลุมบัญชีประชาชาติ ซึ่งเป็นของ สศช. อยู่แล้ว) อัตราการเติบโตที่
 * อิง GDP จึงเป็น "สมมติฐานที่ผู้ใช้กำหนด" เสมอ และต้องติดป้ายให้ชัดทุกจุดที่แสดง
 * ส่วนคณิตศาสตร์ที่เหลือทั้งหมดคำนวณจากงบและสินเชื่อจริง
 */

import type { RatioVerdict } from './finance.js';

/** ที่มาของอัตราการเติบโตของรายได้ที่ใช้ในการคาดการณ์ */
export type GrowthBasis =
  /** คิดจากงบจริงย้อนหลังของกิจการเอง — เป็นข้อมูลที่วัดได้ ไม่ใช่สมมติฐาน */
  | 'history'
  /** อิงแนวโน้ม GDP ที่ผู้ใช้กำหนด คูณความอ่อนไหวของรายได้ต่อ GDP */
  | 'gdp'
  /** ผู้ใช้ระบุอัตราเองโดยตรง */
  | 'manual';

export interface OutlookAssumptions {
  /** จำนวนปีที่มองไปข้างหน้า */
  years: number;
  basis: GrowthBasis;
  /** อัตราการเติบโตของ GDP ที่สมมติไว้ — ใช้เมื่อ basis = 'gdp' */
  gdpGrowthPct: number;
  /** รายได้เปลี่ยนกี่เท่าของ GDP ที่เปลี่ยน — 1.0 คือไปด้วยกันหนึ่งต่อหนึ่ง */
  revenueSensitivity: number;
  /** อัตราที่ระบุเอง — ใช้เมื่อ basis = 'manual' */
  revenueGrowthPct: number;
  /** จุดที่บวกเข้ากับดอกเบี้ยของสินเชื่อ "ลอยตัว" เท่านั้น สินเชื่อคงที่ไม่ขยับ */
  rateShockPct: number;
  /** ระยะห่างของฉากทัศน์สูง/ต่ำจากฉากทัศน์ฐาน เป็นจุดเปอร์เซ็นต์ */
  scenarioSpreadPct: number;
}

export interface OutlookYear {
  /** ปีที่เท่าไรนับจากงบล่าสุด (1 = ปีหน้า) */
  year: number;
  fiscalYear: number;
  revenue: number;
  /** คิดจากอัตรากำไรเงินสดของปีฐาน โดยถือว่าอัตราคงเดิม */
  operatingCashFlow: number;
  debtService: number;
  interest: number;
  principal: number;
  dscr: number | null;
  verdict: RatioVerdict;
  /** สินเชื่อที่ครบกำหนดในปีนี้ ทำให้ภาระปีถัดไปลดลง */
  maturingTh: string[];
}

export interface OutlookScenario {
  key: 'low' | 'base' | 'high';
  labelTh: string;
  revenueGrowthPct: number;
  years: OutlookYear[];
  /** ปีแรกที่ DSCR ต่ำกว่า 1.20 ซึ่งเป็นระดับที่ผู้ให้กู้มักกำหนด — null คือไม่เคยต่ำกว่า */
  firstYearBelowBankLevel: number | null;
  /** ปีแรกที่ DSCR ต่ำกว่า 1.00 คือกระแสเงินสดไม่พอจ่ายหนี้จริง */
  firstYearBelowBreakEven: number | null;
  minDscr: number | null;
  verdict: RatioVerdict;
  summaryTh: string;
}

export interface DebtOutlook {
  smeId: string;
  baseFiscalYear: number;
  assumptions: OutlookAssumptions;

  /** ฐานปีล่าสุดที่ใช้ตั้งต้น ทั้งหมดมาจากงบจริง */
  base: {
    revenue: number;
    operatingCashFlow: number;
    /** อัตรากำไรเงินสดที่ใช้คงที่ตลอดช่วงคาดการณ์ */
    cashMarginPct: number;
    debtService: number;
    dscr: number | null;
  };

  /** อัตราการเติบโตย้อนหลังของกิจการเอง — null เมื่อมีงบไม่ถึงสองปี */
  historicalRevenueCagrPct: number | null;
  historicalYears: number;

  /** อัตราที่ใช้จริงในฉากทัศน์ฐาน และที่มาของมันเป็นคำ */
  growthSourceTh: string;
  /**
   * true เมื่ออัตราที่ใช้เป็นสมมติฐาน ไม่ใช่ค่าที่วัดได้จากงบ
   *
   * หน้าเว็บต้องติดป้ายตามค่านี้ ไม่ใช่เดาเอาจากชื่อ basis เพราะ 'gdp' กับ 'manual'
   * เป็นสมมติฐานทั้งคู่ ส่วน 'history' คำนวณจากข้อมูลจริง
   */
  growthIsAssumption: boolean;

  scenarios: OutlookScenario[];

  summaryTh: string;
  /** ข้อความบอกข้อจำกัดของข้อมูล เช่น ไม่มีชุด GDP จริงในระบบ */
  dataNoticeTh: string | null;
  disclaimerTh: string;
}
