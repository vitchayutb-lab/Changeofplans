/**
 * ชุดอัตราส่วนทางการเงินของ SME พร้อมเกณฑ์เทียบและคำอธิบาย
 *
 * เกณฑ์ (benchmark) เป็นค่ากลาง ๆ ที่ใช้กันทั่วไปสำหรับ SME ไม่ใช่กฎตายตัวของธนาคาร
 * ระบบจึงแสดงทั้งค่าที่คำนวณได้ สูตร และเกณฑ์ ให้ผู้ใช้ตัดสินใจเองได้
 */

import type {
  DerivedStatement,
  Ratio,
  RatioDefinitionGroup,
  RatioGroup,
  RatioVerdict,
} from '@sme/shared';

interface RatioSpec {
  key: string;
  label: string;
  labelTh: string;
  unit: Ratio['unit'];
  formula: string;
  explanationTh: string;
  benchmark: Ratio['benchmark'];
  compute(s: DerivedStatement, extra: RatioContext): number | null;
}

export interface RatioContext {
  /** ภาระชำระหนี้ทั้งปี (เงินต้น + ดอกเบี้ย) จากสินเชื่อที่มีอยู่จริง */
  annualDebtService: number;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? round(value) : null;
}

const LIQUIDITY: RatioSpec[] = [
  {
    key: 'current_ratio',
    label: 'Current Ratio',
    labelTh: 'อัตราส่วนสภาพคล่อง',
    unit: 'x',
    formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน',
    explanationTh: 'บอกว่าสินทรัพย์ที่เปลี่ยนเป็นเงินสดได้ใน 1 ปี ครอบคลุมหนี้ที่ต้องจ่ายใน 1 ปีกี่เท่า',
    benchmark: { good: 1.5, watch: 1.0, higherIsBetter: true },
    compute: (s) => safeDivide(s.currentAssets, s.currentLiabilities),
  },
  {
    key: 'quick_ratio',
    label: 'Quick Ratio',
    labelTh: 'อัตราส่วนสภาพคล่องหมุนเร็ว',
    unit: 'x',
    formula: '(สินทรัพย์หมุนเวียน − สินค้าคงเหลือ) ÷ หนี้สินหมุนเวียน',
    explanationTh: 'ตัดสินค้าคงเหลือออก เพราะขายเป็นเงินสดทันทีไม่ได้ เข้มกว่า Current Ratio',
    benchmark: { good: 1.0, watch: 0.7, higherIsBetter: true },
    compute: (s) => safeDivide(s.currentAssets - s.inventory, s.currentLiabilities),
  },
  {
    key: 'working_capital_ratio',
    label: 'Working Capital / Revenue',
    labelTh: 'เงินทุนหมุนเวียนต่อยอดขาย',
    unit: 'percent',
    formula: '(สินทรัพย์หมุนเวียน − หนี้สินหมุนเวียน) ÷ รายได้ × 100',
    explanationTh: 'ต้องกันเงินหมุนเวียนไว้กี่เปอร์เซ็นต์ของยอดขาย ยิ่งติดลบยิ่งเสี่ยงขาดสภาพคล่อง',
    benchmark: { good: 10, watch: 0, higherIsBetter: true },
    compute: (s) => {
      const value = safeDivide(s.workingCapital, s.revenue);
      return value === null ? null : round(value * 100);
    },
  },
];

const LEVERAGE: RatioSpec[] = [
  {
    key: 'debt_to_equity',
    label: 'Debt to Equity',
    labelTh: 'หนี้สินต่อทุน (D/E)',
    unit: 'x',
    formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น',
    explanationTh: 'ธนาคารไทยส่วนใหญ่ดูตัวนี้ก่อน เกิน 3 เท่ามักถูกมองว่าใช้หนี้มากเกินไป',
    benchmark: { good: 1.5, watch: 3.0, higherIsBetter: false },
    compute: (s) => safeDivide(s.totalLiabilities, s.equity),
  },
  {
    key: 'debt_to_assets',
    label: 'Debt to Assets',
    labelTh: 'หนี้สินต่อสินทรัพย์',
    unit: 'percent',
    formula: 'หนี้สินรวม ÷ สินทรัพย์รวม × 100',
    explanationTh: 'สินทรัพย์ของกิจการมาจากการก่อหนี้กี่เปอร์เซ็นต์',
    benchmark: { good: 50, watch: 70, higherIsBetter: false },
    compute: (s) => {
      const value = safeDivide(s.totalLiabilities, s.totalAssets);
      return value === null ? null : round(value * 100);
    },
  },
  {
    key: 'interest_bearing_debt_to_ebitda',
    label: 'Debt to EBITDA',
    labelTh: 'หนี้ที่มีดอกเบี้ยต่อ EBITDA',
    unit: 'x',
    formula: '(หนี้ระยะสั้น + หนี้ระยะยาว) ÷ EBITDA',
    explanationTh: 'ถ้ากำไรก่อนดอกเบี้ยภาษีค่าเสื่อมคงที่ ต้องใช้เวลากี่ปีจึงจะใช้หนี้หมด',
    benchmark: { good: 3.0, watch: 5.0, higherIsBetter: false },
    compute: (s) => safeDivide(s.totalDebt, s.ebitda),
  },
];

const PROFITABILITY: RatioSpec[] = [
  {
    key: 'gross_margin',
    label: 'Gross Margin',
    labelTh: 'อัตรากำไรขั้นต้น',
    unit: 'percent',
    formula: 'กำไรขั้นต้น ÷ รายได้ × 100',
    explanationTh: 'เหลือเงินกี่เปอร์เซ็นต์หลังหักต้นทุนขาย ก่อนค่าใช้จ่ายดำเนินงาน',
    benchmark: { good: 25, watch: 15, higherIsBetter: true },
    compute: (s) => percent(s.grossProfit, s.revenue),
  },
  {
    key: 'operating_margin',
    label: 'Operating Margin',
    labelTh: 'อัตรากำไรจากการดำเนินงาน',
    unit: 'percent',
    formula: 'EBIT ÷ รายได้ × 100',
    explanationTh: 'ความสามารถทำกำไรจากธุรกิจหลัก ก่อนภาระดอกเบี้ยและภาษี',
    benchmark: { good: 8, watch: 3, higherIsBetter: true },
    compute: (s) => percent(s.ebit, s.revenue),
  },
  {
    key: 'net_margin',
    label: 'Net Margin',
    labelTh: 'อัตรากำไรสุทธิ',
    unit: 'percent',
    formula: 'กำไรสุทธิ ÷ รายได้ × 100',
    explanationTh: 'กำไรที่เหลือถึงมือเจ้าของหลังหักทุกอย่างแล้ว',
    benchmark: { good: 5, watch: 2, higherIsBetter: true },
    compute: (s) => percent(s.netProfit, s.revenue),
  },
  {
    key: 'roe',
    label: 'Return on Equity',
    labelTh: 'ผลตอบแทนต่อส่วนของผู้ถือหุ้น',
    unit: 'percent',
    formula: 'กำไรสุทธิ ÷ ส่วนของผู้ถือหุ้น × 100',
    explanationTh: 'เงินที่เจ้าของลงไว้สร้างกำไรได้กี่เปอร์เซ็นต์ต่อปี',
    benchmark: { good: 12, watch: 6, higherIsBetter: true },
    compute: (s) => percent(s.netProfit, s.equity),
  },
];

const EFFICIENCY: RatioSpec[] = [
  {
    key: 'asset_turnover',
    label: 'Asset Turnover',
    labelTh: 'อัตราหมุนเวียนสินทรัพย์',
    unit: 'x',
    formula: 'รายได้ ÷ สินทรัพย์รวม',
    explanationTh: 'สินทรัพย์ 1 บาทสร้างยอดขายได้กี่บาทต่อปี',
    benchmark: { good: 1.2, watch: 0.7, higherIsBetter: true },
    compute: (s) => safeDivide(s.revenue, s.totalAssets),
  },
  {
    key: 'receivable_days',
    label: 'Receivable Days',
    labelTh: 'ระยะเวลาเก็บหนี้',
    unit: 'days',
    formula: 'ลูกหนี้การค้า ÷ รายได้ × 365',
    explanationTh: 'ขายแล้วกว่าจะเก็บเงินได้ใช้เวลาเฉลี่ยกี่วัน ยิ่งนานยิ่งต้องใช้เงินหมุนเวียนมาก',
    benchmark: { good: 45, watch: 75, higherIsBetter: false },
    compute: (s) => {
      const value = safeDivide(s.accountsReceivable, s.revenue);
      return value === null ? null : round(value * 365);
    },
  },
  {
    key: 'inventory_days',
    label: 'Inventory Days',
    labelTh: 'จำนวนวันสินค้าคงเหลือ',
    unit: 'days',
    formula: 'สินค้าคงเหลือ ÷ ต้นทุนขาย × 365',
    explanationTh: 'สินค้าค้างในคลังเฉลี่ยกี่วันก่อนขายออก ยิ่งนานยิ่งจมเงิน',
    benchmark: { good: 60, watch: 120, higherIsBetter: false },
    compute: (s) => {
      const value = safeDivide(s.inventory, s.cogs);
      return value === null ? null : round(value * 365);
    },
  },
];

const COVERAGE: RatioSpec[] = [
  {
    key: 'interest_coverage',
    label: 'Interest Coverage',
    labelTh: 'ความสามารถจ่ายดอกเบี้ย',
    unit: 'x',
    formula: 'EBIT ÷ ดอกเบี้ยจ่าย',
    explanationTh: 'กำไรจากการดำเนินงานจ่ายดอกเบี้ยได้กี่เท่า ต่ำกว่า 2 เท่าถือว่าตึง',
    benchmark: { good: 3.0, watch: 2.0, higherIsBetter: true },
    compute: (s) => safeDivide(s.ebit, s.interestExpense),
  },
  {
    key: 'dscr',
    label: 'Debt Service Coverage',
    labelTh: 'ความสามารถชำระหนี้ (DSCR)',
    unit: 'x',
    formula: 'กระแสเงินสดจากการดำเนินงาน ÷ ภาระชำระหนี้ต่อปี',
    explanationTh: 'ตัวเลขที่ธนาคารใช้ตัดสินว่ากู้เพิ่มได้ไหม ต่ำกว่า 1.2 เท่ามักไม่ผ่านเกณฑ์',
    benchmark: { good: 1.5, watch: 1.2, higherIsBetter: true },
    compute: (s, extra) => safeDivide(s.operatingCashFlow, extra.annualDebtService),
  },
  {
    key: 'cash_to_monthly_opex',
    label: 'Cash Runway',
    labelTh: 'เงินสดพอใช้กี่เดือน',
    unit: 'x',
    formula: 'เงินสด ÷ (ค่าใช้จ่ายดำเนินงานเฉลี่ยต่อเดือน)',
    explanationTh: 'ถ้ารายได้หยุดกะทันหัน เงินสดที่มีประคองธุรกิจได้กี่เดือน',
    benchmark: { good: 3, watch: 1.5, higherIsBetter: true },
    compute: (s) => safeDivide(s.cash, s.operatingExpenses / 12),
  },
];

function percent(numerator: number, denominator: number): number | null {
  const value = safeDivide(numerator, denominator);
  return value === null ? null : round(value * 100);
}

export function verdictFor(value: number | null, benchmark: Ratio['benchmark']): RatioVerdict {
  if (value === null || !Number.isFinite(value)) return 'na';
  if (benchmark.higherIsBetter) {
    if (value >= benchmark.good) return 'good';
    if (value >= benchmark.watch) return 'watch';
    return 'risk';
  }
  if (value <= benchmark.good) return 'good';
  if (value <= benchmark.watch) return 'watch';
  return 'risk';
}

function build(specs: RatioSpec[], s: DerivedStatement, ctx: RatioContext): Ratio[] {
  return specs.map((spec) => {
    const value = spec.compute(s, ctx);
    return {
      key: spec.key,
      label: spec.label,
      labelTh: spec.labelTh,
      value,
      unit: spec.unit,
      benchmark: spec.benchmark,
      verdict: verdictFor(value, spec.benchmark),
      formula: spec.formula,
      explanationTh: spec.explanationTh,
    };
  });
}

/**
 * กลุ่มอัตราส่วนทั้งหมด — แหล่งเดียวของทั้งการคำนวณและหน้าอธิบายเกณฑ์
 *
 * ถ้าแยกรายการไว้สองที่ วันหนึ่งหน้าอธิบายจะบอกเกณฑ์คนละค่ากับที่ระบบใช้ตัดสินจริง
 * ซึ่งแย่กว่าไม่มีหน้าอธิบายเลย
 */
const GROUPS: { key: RatioGroup['key']; label: string; labelTh: string; specs: RatioSpec[] }[] = [
  { key: 'liquidity', label: 'Liquidity', labelTh: 'สภาพคล่อง', specs: LIQUIDITY },
  { key: 'leverage', label: 'Leverage', labelTh: 'โครงสร้างหนี้', specs: LEVERAGE },
  { key: 'profitability', label: 'Profitability', labelTh: 'ความสามารถทำกำไร', specs: PROFITABILITY },
  { key: 'efficiency', label: 'Efficiency', labelTh: 'ประสิทธิภาพการใช้สินทรัพย์', specs: EFFICIENCY },
  { key: 'coverage', label: 'Coverage', labelTh: 'ความสามารถชำระหนี้', specs: COVERAGE },
];

export function calculateRatios(s: DerivedStatement, ctx: RatioContext): RatioGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    labelTh: group.labelTh,
    ratios: build(group.specs, s, ctx),
  }));
}

/**
 * รายการอัตราส่วนพร้อมสูตรและเกณฑ์ โดยไม่ต้องมีงบการเงิน
 *
 * ใช้กับหน้าอธิบายเกณฑ์ ซึ่งต้องอ่านได้แม้ยังไม่ได้เลือกกิจการ
 */
export function ratioCatalog(): RatioDefinitionGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    labelTh: group.labelTh,
    ratios: group.specs.map((spec) => ({
      key: spec.key,
      label: spec.label,
      labelTh: spec.labelTh,
      unit: spec.unit,
      formula: spec.formula,
      explanationTh: spec.explanationTh,
      benchmark: spec.benchmark,
    })),
  }));
}

/** ค้นหาอัตราส่วนตามคีย์จากผลลัพธ์ที่จัดกลุ่มแล้ว */
export function findRatio(groups: RatioGroup[], key: string): Ratio | null {
  for (const group of groups) {
    const found = group.ratios.find((r) => r.key === key);
    if (found) return found;
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
