/**
 * DTOs ของ "ต้นทุนหนี้ที่รับไหว"
 *
 * หน้าจำลองสินเชื่อตอบว่า "ถ้ากู้เท่านี้ที่อัตรานี้ จะผ่อนเท่าไร" ซึ่งต้องรู้อัตราก่อน
 * ส่วนนี้กลับด้านคำถาม: จากกระแสเงินสดที่มีจริง อัตราดอกเบี้ยสูงสุดเท่าไรที่ยังผ่อนไหว
 * และวงเงินสูงสุดเท่าไรที่รับได้ที่อัตราตลาดจริงของ ธปท.
 *
 * ทุกระดับ DSCR ที่ใช้เป็นเป้าหมายมาจากเกณฑ์ชุดเดียวกับหน้าเกณฑ์การวัดธุรกิจ
 * (1.20 = เฝ้าระวัง, 1.50 = ดี) จึงไม่มีทางบอกคนละอย่างกับที่ระบบใช้ตัดสิน
 */

import type { Provenance } from './bot.js';
import type { RatioVerdict } from './finance.js';

/** เพดานอัตราดอกเบี้ยที่ยังรักษา DSCR เป้าหมายไว้ได้ ที่วงเงินและระยะเวลาที่ขอ */
export interface RateCeiling {
  targetDscr: number;
  labelTh: string;
  /**
   * อัตราดอกเบี้ยสูงสุดที่ยังผ่านเป้าหมายนี้
   *
   * null เมื่อรับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์ — กรณีนั้นเงินต้นอย่างเดียวก็เกินกำลังแล้ว
   * ซึ่งเป็นคนละเรื่องกับ "เพดานต่ำ" และต้องไม่แสดงเป็น 0%
   */
  maxRatePct: number | null;
  /**
   * true เมื่อกระแสเงินสดไม่ใช่ข้อจำกัด — รับไหวเกินอัตราสูงสุดที่มีใครเสนอจริง
   *
   * ต่างจาก maxRatePct = null ซึ่งแปลว่าตรงกันข้ามคือรับไม่ไหวเลย ทั้งสองกรณีต้อง
   * แยกกันให้ชัด เพราะการอ่านสลับกันคือการอ่านผลกลับด้าน
   */
  unbounded: boolean;
  /** ส่วนต่างจากอัตราตลาด เป็นจุดเปอร์เซ็นต์ — บวกคือยังมีที่ว่างให้ดอกเบี้ยขึ้นได้อีก */
  headroomPct: number | null;
  /** อัตราตลาดอยู่ใต้เพดานนี้หรือไม่ */
  withinReach: boolean;
}

/** วงเงินสูงสุดที่กู้เพิ่มได้ที่อัตราตลาด โดยยังรักษา DSCR เป้าหมาย */
export interface BorrowingCapacity {
  targetDscr: number;
  labelTh: string;
  maxAmount: number;
  monthlyPayment: number;
  /** วงเงินที่ขอมาเกินกำลังที่ระดับนี้หรือไม่ */
  coversRequest: boolean;
}

export interface DebtCapacity {
  smeId: string;
  fiscalYear: number;

  /** ฐานที่ใช้คำนวณทั้งหมด ดึงจากงบจริงและสินเชื่อจริงของกิจการ */
  basis: {
    operatingCashFlow: number;
    existingAnnualDebtService: number;
    existingOutstanding: number;
    /** ต้นทุนหนี้ปัจจุบันถ่วงน้ำหนักตามยอดคงค้าง — null เมื่อยังไม่มีหนี้ */
    existingWeightedRatePct: number | null;
    currentDscr: number | null;
  };

  request: { amount: number; years: number };

  /** อัตราตลาดจริงที่เอามาเทียบกับเพดาน */
  market: {
    referenceRateName: string | null;
    referenceRatePct: number | null;
    /** ส่วนต่างความเสี่ยงที่บวกเพิ่มจากอัตราอ้างอิง */
    spreadPct: number;
    estimatedRatePct: number | null;
    provenance: Provenance | null;
  };

  ceilings: RateCeiling[];
  capacities: BorrowingCapacity[];

  /**
   * ต้นทุนหนี้รวมหลังกู้ก้อนใหม่ที่อัตราตลาด ถ่วงน้ำหนักตามยอด
   * null เมื่อดึงอัตราตลาดไม่ได้ — ไม่เดาค่าแทน
   */
  blendedRateAfterPct: number | null;

  verdict: RatioVerdict;
  summaryTh: string;
  disclaimerTh: string;
}
