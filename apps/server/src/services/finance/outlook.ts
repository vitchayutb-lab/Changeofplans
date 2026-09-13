/**
 * ภาระหนี้ในอนาคต — อีกกี่ปีถึงจะเริ่มผ่อนไม่ไหว
 *
 * สิ่งที่ทำให้ต่างจากการคูณอัตราการเติบโตเฉย ๆ คือฝั่งหนี้ไม่คงที่ สินเชื่อแต่ละก้อนมี
 * อายุคงเหลือของตัวเอง ก้อนที่ครบกำหนดจะหลุดออกและภาระรวมลดลงเป็นขั้น ๆ การสมมติว่า
 * ภาระหนี้เท่าเดิมทุกปีจึงให้คำตอบที่มืดกว่าความจริงเสมอ ที่นี่จึงกางตารางผ่อนจริง
 * ของทุกก้อนแล้วรวมเป็นรายปี
 *
 * ข้อจำกัดที่ต้องพูดให้ชัด: ระบบไม่มีชุดข้อมูล GDP จริง โหมดที่อิง GDP จึงเป็น
 * สมมติฐานที่ผู้ใช้กำหนด ไม่ใช่การพยากรณ์ที่มีแหล่งอ้างอิง ส่วนค่าตั้งต้นของหน้านี้
 * ใช้อัตราการเติบโตย้อนหลังของกิจการเองซึ่งคำนวณจากงบจริง
 */

import type {
  DebtOutlook,
  ExistingLoan,
  GrowthBasis,
  OutlookAssumptions,
  OutlookScenario,
  OutlookYear,
  RatioVerdict,
} from '@sme/shared';
import { listLoans } from '../../db/smeRepo.js';
import { loadStatements, statementHistory } from './analysis.js';
import { effectiveRate, loadReferenceRates } from './debt.js';
import { amortize, dscr } from './loan.js';
import { derive } from './statement.js';

const DEFAULT_YEARS = 5;

/** ระดับที่ผู้ให้กู้มักกำหนด และจุดที่กระแสเงินสดไม่พอจ่ายหนี้จริง */
const BANK_LEVEL = 1.2;
const BREAK_EVEN = 1.0;

const FLOATING: ExistingLoan['rateType'][] = ['mlr_spread', 'mor_spread', 'mrr_spread'];

const PRODUCT_LABEL_TH: Record<ExistingLoan['product'], string> = {
  term_loan: 'สินเชื่อระยะยาว',
  od: 'วงเงินเบิกเกินบัญชี',
  leasing: 'ลีสซิ่ง',
  trade_finance: 'สินเชื่อการค้า',
};

export interface OutlookOptions {
  smeId: string;
  years?: number;
  basis?: GrowthBasis;
  gdpGrowthPct?: number;
  revenueSensitivity?: number;
  revenueGrowthPct?: number;
  rateShockPct?: number;
  scenarioSpreadPct?: number;
  fiscalYear?: number;
}

/**
 * อัตราการเติบโตทบต้นของรายได้จากงบจริง
 *
 * ต้องมีอย่างน้อยสองปีถึงจะมีอัตราให้คิด และปีแรกต้องมีรายได้มากกว่าศูนย์
 * มิฉะนั้นคืน null แทนที่จะคืน 0 ซึ่งจะถูกอ่านว่า "ไม่โต" ทั้งที่แปลว่า "คำนวณไม่ได้"
 */
export function historicalCagrPct(revenues: number[]): number | null {
  if (revenues.length < 2) return null;
  const first = revenues[0]!;
  const last = revenues[revenues.length - 1]!;
  if (first <= 0 || last <= 0) return null;
  const periods = revenues.length - 1;
  return round2((Math.pow(last / first, 1 / periods) - 1) * 100);
}

interface LoanYear {
  debtService: number;
  interest: number;
  principal: number;
  maturingTh: string[];
}

/**
 * ภาระหนี้รายปีจากสินเชื่อที่มีอยู่จริง
 *
 * วงเงินเบิกเกินบัญชีคิดเฉพาะดอกเบี้ยและถือว่าต่ออายุไปเรื่อย ๆ ซึ่งตรงกับวิธีที่
 * getDebtOverview ใช้คิด DSCR ปัจจุบัน ถ้าที่นี่คิดต่างออกไป ตัวเลขปีฐานกับปีคาดการณ์
 * จะเทียบกันไม่ได้ และการสมมติว่า OD หายไปเองก็จะทำให้ภาระในอนาคตดูเบากว่าจริง
 */
export function debtServicePath(
  loans: { loan: ExistingLoan; ratePct: number }[],
  years: number,
): LoanYear[] {
  const path: LoanYear[] = Array.from({ length: years }, () => ({
    debtService: 0,
    interest: 0,
    principal: 0,
    maturingTh: [],
  }));

  for (const { loan, ratePct } of loans) {
    const label = `${PRODUCT_LABEL_TH[loan.product]} · ${loan.lender}`;

    if (loan.product === 'od') {
      const annualInterest = (loan.outstanding * ratePct) / 100;
      for (const slot of path) {
        slot.debtService += annualInterest;
        slot.interest += annualInterest;
      }
      continue;
    }

    const months = Math.max(1, loan.remainingMonths);
    const rows = amortize(loan.outstanding, ratePct, months / 12);
    for (const row of rows) {
      const yearIndex = Math.floor((row.month - 1) / 12);
      if (yearIndex >= years) break;
      const slot = path[yearIndex]!;
      slot.debtService += row.payment;
      slot.interest += row.interest;
      slot.principal += row.principal;
    }

    const maturesInYear = Math.ceil(months / 12);
    if (maturesInYear >= 1 && maturesInYear <= years) {
      path[maturesInYear - 1]!.maturingTh.push(label);
    }
  }

  return path.map((slot) => ({
    ...slot,
    debtService: round2(slot.debtService),
    interest: round2(slot.interest),
    principal: round2(slot.principal),
  }));
}

function verdictFor(value: number | null): RatioVerdict {
  if (value === null) return 'na';
  if (value >= 1.5) return 'good';
  if (value >= BANK_LEVEL) return 'watch';
  return 'risk';
}

function buildScenario(
  key: OutlookScenario['key'],
  labelTh: string,
  growthPct: number,
  base: { revenue: number; cashMargin: number; fiscalYear: number },
  path: LoanYear[],
): OutlookScenario {
  const years: OutlookYear[] = path.map((slot, index) => {
    const year = index + 1;
    const revenue = round2(base.revenue * Math.pow(1 + growthPct / 100, year));
    const operatingCashFlow = round2(revenue * base.cashMargin);
    const value = dscr(operatingCashFlow, slot.debtService);
    return {
      year,
      fiscalYear: base.fiscalYear + year,
      revenue,
      operatingCashFlow,
      debtService: slot.debtService,
      interest: slot.interest,
      principal: slot.principal,
      dscr: value,
      verdict: verdictFor(value),
      maturingTh: slot.maturingTh,
    };
  });

  const below = (threshold: number): number | null =>
    years.find((y) => y.dscr !== null && y.dscr < threshold)?.year ?? null;

  const measured = years.map((y) => y.dscr).filter((v): v is number => v !== null);
  const minDscr = measured.length ? Math.min(...measured) : null;

  const firstYearBelowBankLevel = below(BANK_LEVEL);
  const firstYearBelowBreakEven = below(BREAK_EVEN);

  return {
    key,
    labelTh,
    revenueGrowthPct: round2(growthPct),
    years,
    firstYearBelowBankLevel,
    firstYearBelowBreakEven,
    minDscr,
    verdict: verdictFor(minDscr),
    summaryTh: scenarioSummary(labelTh, growthPct, years, firstYearBelowBankLevel, firstYearBelowBreakEven),
  };
}

function scenarioSummary(
  labelTh: string,
  growthPct: number,
  years: OutlookYear[],
  belowBank: number | null,
  belowBreakEven: number | null,
): string {
  const head = `${labelTh} (รายได้โต ${growthPct.toFixed(2)}% ต่อปี)`;
  if (belowBreakEven !== null) {
    const at = years.find((y) => y.year === belowBreakEven)!;
    return `${head}: กระแสเงินสดไม่พอจ่ายหนี้ตั้งแต่ปี ${at.fiscalYear} (อีก ${belowBreakEven} ปี)`;
  }
  if (belowBank !== null) {
    const at = years.find((y) => y.year === belowBank)!;
    return `${head}: ยังจ่ายไหวตลอดช่วง แต่ DSCR ตกต่ำกว่า 1.20 ในปี ${at.fiscalYear} ซึ่งเป็นระดับที่ผู้ให้กู้มักกำหนด`;
  }
  return `${head}: DSCR อยู่เหนือ 1.20 ตลอดช่วงคาดการณ์`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** อัตราที่ใช้จริงตามฐานที่เลือก พร้อมคำอธิบายที่มา และธงว่าเป็นสมมติฐานหรือไม่ */
function resolveGrowth(
  basis: GrowthBasis,
  assumptions: OutlookAssumptions,
  historicalCagr: number | null,
  historicalYears: number,
): { basis: GrowthBasis; growthPct: number; sourceTh: string; isAssumption: boolean } {
  if (basis === 'history') {
    if (historicalCagr === null) {
      // ไม่มีงบพอให้คิดอัตราจริง ตกไปใช้สมมติฐานแทน แต่ต้องบอกว่าเปลี่ยนฐานเพราะอะไร
      const fallback = resolveGrowth('gdp', assumptions, null, historicalYears);
      return {
        ...fallback,
        sourceTh: `มีงบไม่พอคำนวณอัตราย้อนหลัง (${historicalYears} ปี) จึงใช้ ${fallback.sourceTh}`,
      };
    }
    return {
      basis: 'history',
      growthPct: historicalCagr,
      sourceTh: `อัตราการเติบโตย้อนหลัง ${historicalYears} ปีของกิจการเอง ${historicalCagr.toFixed(2)}% ต่อปี คำนวณจากงบจริง`,
      isAssumption: false,
    };
  }

  if (basis === 'gdp') {
    const growthPct = round2(assumptions.gdpGrowthPct * assumptions.revenueSensitivity);
    return {
      basis: 'gdp',
      growthPct,
      sourceTh: `GDP ${assumptions.gdpGrowthPct.toFixed(2)}% × ความอ่อนไหวของรายได้ ${assumptions.revenueSensitivity.toFixed(2)} เท่า = ${growthPct.toFixed(2)}% ต่อปี`,
      isAssumption: true,
    };
  }

  return {
    basis: 'manual',
    growthPct: round2(assumptions.revenueGrowthPct),
    sourceTh: `อัตราที่ระบุเอง ${assumptions.revenueGrowthPct.toFixed(2)}% ต่อปี`,
    isAssumption: true,
  };
}

const GDP_DATA_NOTICE =
  'ระบบไม่มีชุดข้อมูล GDP จริง — ธปท. ให้สิทธิ์ API เป็นราย product และบัญชีประชาชาติ ' +
  'เป็นข้อมูลของ สศช. ไม่ใช่ของ ธปท. ตัวเลข GDP ที่ใช้ตรงนี้จึงเป็นสมมติฐานที่คุณกำหนดเอง ' +
  'ไม่ใช่การพยากรณ์ที่มีแหล่งอ้างอิง ส่วนการคำนวณที่เหลือใช้งบและสินเชื่อจริงทั้งหมด';

export async function debtOutlook(options: OutlookOptions): Promise<DebtOutlook> {
  const { current } = loadStatements(options.smeId, options.fiscalYear);
  const statement = derive(current);
  const history = statementHistory(options.smeId).sort((a, b) => a.fiscalYear - b.fiscalYear);
  const rates = await loadReferenceRates();

  const assumptions: OutlookAssumptions = {
    years: options.years ?? DEFAULT_YEARS,
    basis: options.basis ?? 'history',
    gdpGrowthPct: options.gdpGrowthPct ?? 3,
    revenueSensitivity: options.revenueSensitivity ?? 1,
    revenueGrowthPct: options.revenueGrowthPct ?? 0,
    rateShockPct: options.rateShockPct ?? 0,
    scenarioSpreadPct: options.scenarioSpreadPct ?? 2,
  };

  const historicalRevenueCagrPct = historicalCagrPct(history.map((s) => s.revenue));
  const growth = resolveGrowth(
    assumptions.basis,
    assumptions,
    historicalRevenueCagrPct,
    history.length,
  );
  assumptions.basis = growth.basis;

  // ดอกเบี้ยที่ขยับใช้กับสินเชื่อลอยตัวเท่านั้น สินเชื่อคงที่ผูกอัตราไว้แล้วตามสัญญา
  const priced = listLoans(options.smeId).map((loan) => {
    const rate = effectiveRate(loan, rates);
    const shock = FLOATING.includes(loan.rateType) ? assumptions.rateShockPct : 0;
    return { loan, ratePct: (rate.ratePct ?? 0) + shock };
  });

  const path = debtServicePath(priced, assumptions.years);

  const cashMargin = statement.revenue > 0 ? statement.operatingCashFlow / statement.revenue : 0;
  const base = {
    revenue: statement.revenue,
    cashMargin,
    fiscalYear: statement.fiscalYear,
  };

  const spread = assumptions.scenarioSpreadPct;
  const scenarios: OutlookScenario[] = [
    buildScenario('low', 'เศรษฐกิจชะลอ', growth.growthPct - spread, base, path),
    buildScenario('base', 'ฐาน', growth.growthPct, base, path),
    buildScenario('high', 'เศรษฐกิจขยายตัว', growth.growthPct + spread, base, path),
  ];

  const baseDebtService = path[0]?.debtService ?? 0;

  return {
    smeId: options.smeId,
    baseFiscalYear: statement.fiscalYear,
    assumptions,
    base: {
      revenue: round2(statement.revenue),
      operatingCashFlow: round2(statement.operatingCashFlow),
      cashMarginPct: round2(cashMargin * 100),
      debtService: baseDebtService,
      dscr: dscr(statement.operatingCashFlow, baseDebtService),
    },
    historicalRevenueCagrPct,
    historicalYears: history.length,
    growthSourceTh: growth.sourceTh,
    growthIsAssumption: growth.isAssumption,
    scenarios,
    summaryTh: summarize(scenarios, assumptions, path),
    dataNoticeTh: growth.isAssumption && growth.basis === 'gdp' ? GDP_DATA_NOTICE : null,
    disclaimerTh:
      'การคาดการณ์นี้ถือว่าอัตรากำไรเงินสดคงเดิมและไม่มีการกู้เพิ่ม ภาระหนี้รายปีมาจากตารางผ่อนจริง ' +
      'ของสินเชื่อที่บันทึกไว้ วงเงินเบิกเกินบัญชีคิดเฉพาะดอกเบี้ยและถือว่าต่ออายุไปตลอดช่วง ' +
      'ผลจริงขึ้นกับปัจจัยที่แผนนี้ไม่ได้ครอบคลุม เช่น การลงทุนใหม่ การเปลี่ยนแปลงของต้นทุน และการรีไฟแนนซ์',
  };
}

function summarize(
  scenarios: OutlookScenario[],
  assumptions: OutlookAssumptions,
  path: LoanYear[],
): string {
  const baseScenario = scenarios.find((s) => s.key === 'base')!;
  const low = scenarios.find((s) => s.key === 'low')!;
  const parts: string[] = [];

  if (path.every((slot) => slot.debtService === 0)) {
    return 'ไม่มีภาระหนี้ที่ต้องผ่อนในช่วงคาดการณ์ จึงยังไม่มีความเสี่ยงด้านการชำระหนี้ให้ประเมิน';
  }

  parts.push(baseScenario.summaryTh);

  if (low.firstYearBelowBreakEven !== null && baseScenario.firstYearBelowBreakEven === null) {
    const at = low.years.find((y) => y.year === low.firstYearBelowBreakEven)!;
    parts.push(
      `ถ้าเศรษฐกิจชะลอจนรายได้โตช้าลง ${assumptions.scenarioSpreadPct.toFixed(2)} จุด จะเริ่มจ่ายไม่ไหวในปี ${at.fiscalYear}`,
    );
  }

  /*
   * ภาระหนี้ลดลงเป็นขั้นเมื่อสินเชื่อครบกำหนด ซึ่งเป็นเหตุผลหลักที่ DSCR ดีขึ้นเองตามเวลา
   * แต่ถ้าครบกำหนดในปีสุดท้ายของช่วง การบอกว่า "หลังจากนั้นจะลดลง" ชี้ไปนอกกรอบที่คาดการณ์
   * และผู้อ่านจะไม่มีทางเห็นผลนั้นในตาราง จึงต้องบอกให้ตรงว่าอยู่นอกช่วง
   */
  const firstMaturity = path.findIndex((slot) => slot.maturingTh.length > 0);
  if (firstMaturity >= 0) {
    const names = path[firstMaturity]!.maturingTh.join(', ');
    const inYears = firstMaturity + 1;
    parts.push(
      inYears < path.length
        ? `${names} ครบกำหนดในอีก ${inYears} ปี ภาระผ่อนหลังจากนั้นจะลดลง`
        : `${names} ครบกำหนดในปีสุดท้ายของช่วงคาดการณ์ (อีก ${inYears} ปี) ผลที่ภาระผ่อนลดลงจึงอยู่นอกช่วงที่แสดง`,
    );
  }

  if (assumptions.rateShockPct > 0) {
    parts.push(`คิดบนสมมติฐานว่าดอกเบี้ยลอยตัวขยับขึ้น ${assumptions.rateShockPct.toFixed(2)} จุด`);
  }

  return parts.join(' · ');
}
