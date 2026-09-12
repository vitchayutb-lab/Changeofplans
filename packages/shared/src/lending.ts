/**
 * DTOs ของ "เงื่อนไขการกู้" — ตอบว่าธุรกิจแบบไหนหาแหล่งเงินได้ง่ายกว่า และติดอะไรอยู่
 *
 * ต่างจากการจับคู่แหล่งเงินทุน (funding.ts) ที่ตอบว่า "กิจการนี้สมัครโครงการไหนได้"
 * ส่วนนี้ตอบคำถามก่อนหน้านั้นหนึ่งขั้น คือ "ถ้าธุรกิจเป็นแบบนี้ จะกู้ง่ายขึ้นไหม"
 * จึงไม่ผูกกับกิจการที่จดไว้ในระบบ และรับเฉพาะข้อมูลเท่าที่เงื่อนไขจริงต้องใช้
 *
 * ทุกตัวเลขในไฟล์นี้คำนวณจากทะเบียนโครงการจริงในฐานข้อมูล ไม่มีค่าที่ตั้งขึ้นเอง
 */

import type { Industry } from './finance.js';
import type { FundingType } from './funding.js';

/** เงื่อนไขที่โครงการใช้คัดกรอง — ชุดเดียวกับที่ทะเบียนโครงการเก็บจริง */
export type LendingRule =
  | 'industry'
  | 'province'
  | 'years_operating'
  | 'employees'
  | 'revenue'
  | 'dscr'
  | 'collateral'
  | 'amount';

/** ข้อมูลเท่าที่ต้องใช้ตรวจเงื่อนไข — ไม่ต้องมีงบการเงินย้อนหลัง */
export interface LendingProfile {
  industry: Industry;
  province: string;
  yearsOperating: number;
  employees: number;
  annualRevenue: number;
  /** ความสามารถชำระหนี้ปัจจุบัน — null เมื่อยังไม่มีภาระหนี้ให้คำนวณ */
  dscr: number | null;
  hasCollateral: boolean;
  amountNeeded: number;
}

/** ผลตรวจเงื่อนไขหนึ่งข้อ พร้อมตัวเลขสองฝั่งที่ใช้เทียบ */
export interface LendingCondition {
  rule: LendingRule;
  labelTh: string;
  passed: boolean;
  /** ค่าของโปรไฟล์ที่นำไปเทียบ */
  actual: string;
  /** เกณฑ์ของโครงการ */
  required: string;
}

/** ผลของโปรไฟล์กับโครงการหนึ่ง */
export interface ProgramOutcome {
  programId: string;
  nameTh: string;
  provider: string;
  type: FundingType;
  eligible: boolean;
  conditions: LendingCondition[];
  /** เงื่อนไขที่ยังไม่ผ่าน — ว่างเมื่อผ่านครบ */
  failedRules: LendingRule[];
  descriptionTh: string;
  url: string | null;
}

/**
 * เงื่อนไขหนึ่งข้อในมุม "แก้แล้วได้อะไร"
 *
 * unlocks นับเฉพาะโครงการที่ติดข้อนี้ข้อเดียว จึงเป็นจำนวนที่จะผ่านทันทีถ้าแก้ข้อนี้
 * โดยไม่ต้องแก้อย่างอื่นด้วย — ต่างจาก blocking ที่นับทุกโครงการที่ข้อนี้ขวางอยู่
 */
export interface LendingLever {
  rule: LendingRule;
  labelTh: string;
  blocking: number;
  unlocks: number;
  currentTh: string;
  /** เกณฑ์ที่ผ่อนปรนที่สุดในบรรดาโครงการที่ปลดล็อกได้ */
  targetTh: string;
  actionTh: string;
  /** ชื่อโครงการที่จะผ่านทันทีถ้าแก้ข้อนี้ */
  unlockedProgramsTh: string[];
}

/**
 * ความเปิดกว้างของอุตสาหกรรมหนึ่ง คำนวณจากทะเบียนโครงการทั้งหมด
 *
 * ไม่ขึ้นกับโปรไฟล์ของผู้ใช้ จึงอ่านได้ก่อนกรอกอะไร และใช้เทียบข้ามอุตสาหกรรมได้ตรง ๆ
 */
export interface IndustryOpenness {
  industry: Industry;
  labelTh: string;
  /** โครงการที่รับอุตสาหกรรมนี้ (รวมโครงการที่รับทุกประเภทธุรกิจ) */
  programs: number;
  totalPrograms: number;
  /** โครงการที่รับเฉพาะบางอุตสาหกรรมและอุตสาหกรรมนี้อยู่ในนั้น */
  targeted: number;
  byType: Record<FundingType, number>;
  /** รับโดยไม่ต้องมีหลักประกัน */
  noCollateral: number;
  /** อายุกิจการขั้นต่ำ 0 ปี — เปิดวันแรกก็ยื่นได้ */
  dayOne: number;
  /** ไม่กำหนด DSCR ขั้นต่ำ */
  noDscr: number;
  rateMinPct: number | null;
  rateMaxPct: number | null;
  maxAmount: number;
  /** 0-100 ตามสูตรใน LendingOverview.opennessFormulaTh — ยิ่งสูงยิ่งหาแหล่งเงินได้ง่าย */
  opennessScore: number;
  /** โครงการที่เจาะจงอุตสาหกรรมนี้ ไม่ใช่โครงการที่เปิดให้ทุกคน */
  targetedProgramsTh: string[];
}

/** ภาพรวมของเงื่อนไขหนึ่งข้อในทะเบียนทั้งหมด — ส่วน "เงื่อนไขมาตรฐาน" ของหน้า */
export interface LendingRuleSummary {
  rule: LendingRule;
  labelTh: string;
  explanationTh: string;
  /** โครงการที่กำหนดเงื่อนไขข้อนี้จริง (ที่เหลือปล่อยว่าง = ไม่กำหนด) */
  programsWithRule: number;
  totalPrograms: number;
  /** เกณฑ์ที่พบจริงในทะเบียน เรียงจากผ่อนปรนไปเข้ม */
  thresholdsTh: string[];
}

/** ข้อมูลที่อ่านได้โดยยังไม่ต้องกรอกโปรไฟล์ */
export interface LendingOverview {
  totalPrograms: number;
  industries: IndustryOpenness[];
  rules: LendingRuleSummary[];
  /** สูตรของ opennessScore เขียนเป็นข้อความ เพื่อให้คะแนนไม่เป็นกล่องดำ */
  opennessFormulaTh: string;
}

/** อุตสาหกรรมหนึ่งเมื่อใช้โปรไฟล์เดิมทุกอย่าง เปลี่ยนแค่ประเภทธุรกิจ */
export interface IndustrySwitch {
  industry: Industry;
  labelTh: string;
  eligiblePrograms: number;
  /** ส่วนต่างจากอุตสาหกรรมที่เลือกอยู่ — บวกคือกู้ได้มากกว่า */
  delta: number;
  current: boolean;
}

export interface LendingConditionsReport {
  profile: LendingProfile;
  totalPrograms: number;
  eligiblePrograms: number;
  outcomes: ProgramOutcome[];
  levers: LendingLever[];
  industry: IndustryOpenness;
  /**
   * เทียบทุกอุตสาหกรรมด้วยโปรไฟล์เดียวกัน
   *
   * ตอบตรง ๆ ว่า "ถ้าทำธุรกิจประเภทอื่นจะกู้ง่ายขึ้นไหม" โดยคุมตัวแปรอื่นให้เท่ากันหมด
   */
  industrySwitches: IndustrySwitch[];
  summaryTh: string;
  disclaimerTh: string;
}
