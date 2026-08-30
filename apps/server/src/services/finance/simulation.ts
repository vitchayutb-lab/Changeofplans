/**
 * จำลองการกู้เงินเพิ่ม โดยใช้อัตราอ้างอิงจริงจาก BOT
 *
 * ผลลัพธ์ทุกตัวติดป้ายว่าเป็น "ค่าประมาณ" เพราะอัตราจริงที่ธนาคารเสนอขึ้นกับ
 * การพิจารณาสินเชื่อรายกรณี ไม่ใช่ค่าที่คำนวณจากอัตราประกาศเพียงอย่างเดียว
 */

import type { LoanSimulation, RateBasis, RatioVerdict } from '@sme/shared';
import { getDebtOverview, loadReferenceRates } from './debt.js';
import { loadStatements } from './analysis.js';
import { annualDebtService, dscr, quote } from './loan.js';
import { derive } from './statement.js';

const DISCLAIMER_TH =
  'ตัวเลขทั้งหมดเป็นค่าประมาณจากอัตราดอกเบี้ยประกาศของ ธปท. และงบการเงินที่บันทึกไว้ ' +
  'ไม่ใช่ข้อเสนอสินเชื่อ อัตราจริงขึ้นกับการพิจารณาของสถาบันการเงินแต่ละแห่ง';
const DISCLAIMER_EN =
  'Figures are estimates derived from Bank of Thailand announced rates and the recorded ' +
  'financial statements. This is not a credit offer; actual pricing is set by each lender.';

export interface SimulationInput {
  smeId: string;
  amount: number;
  years: number;
  rateBasis: RateBasis;
  /** ส่วนต่างที่บวกจากอัตราอ้างอิง (ใช้เมื่อ rateBasis ไม่ใช่ fixed) */
  spreadPct?: number;
  /** อัตราคงที่ (ใช้เมื่อ rateBasis = fixed) */
  fixedRatePct?: number;
  fiscalYear?: number;
}

export async function simulateLoan(input: SimulationInput): Promise<LoanSimulation> {
  const { current } = loadStatements(input.smeId, input.fiscalYear);
  const statement = derive(current);
  const debt = await getDebtOverview(input.smeId);
  const rates = await loadReferenceRates();

  const spread = input.spreadPct ?? 0;
  let referenceName: string | null = null;
  let referencePct: number | null = null;
  let provenance = null as LoanSimulation['rate']['provenance'];
  let effectiveRatePct: number;

  if (input.rateBasis === 'fixed') {
    effectiveRatePct = input.fixedRatePct ?? 0;
  } else {
    const name = input.rateBasis === 'mlr_spread' ? 'MLR' : input.rateBasis === 'mor_spread' ? 'MOR' : 'MRR';
    const reference = rates[name];
    referenceName = name;
    referencePct = reference.value;
    provenance = reference.provenance;
    if (reference.value === null) {
      throw new Error('ไม่สามารถดึงอัตราดอกเบี้ยอ้างอิงจาก ธปท. ได้ในขณะนี้');
    }
    effectiveRatePct = round2(reference.value + spread);
  }

  const loanQuote = quote(input.amount, effectiveRatePct, input.years);
  const newAnnualService = annualDebtService(
    input.amount,
    effectiveRatePct,
    Math.round(input.years * 12),
  );

  const dscrBefore = dscr(statement.operatingCashFlow, debt.totalAnnualDebtService);
  const dscrAfter = dscr(
    statement.operatingCashFlow,
    debt.totalAnnualDebtService + newAnnualService,
  );

  const deBefore = statement.equity > 0 ? round4(statement.totalLiabilities / statement.equity) : null;
  const deAfter =
    statement.equity > 0 ? round4((statement.totalLiabilities + input.amount) / statement.equity) : null;

  const coverageBefore =
    statement.interestExpense > 0 ? round4(statement.ebit / statement.interestExpense) : null;
  const coverageAfter =
    statement.interestExpense + loanQuote.firstYearInterest > 0
      ? round4(statement.ebit / (statement.interestExpense + loanQuote.firstYearInterest))
      : null;

  const interestToEbit =
    statement.ebit > 0 ? round4(loanQuote.firstYearInterest / statement.ebit) : null;

  const { verdict, reasonTh } = judge(dscrAfter, coverageAfter, deAfter);

  return {
    smeId: input.smeId,
    quote: loanQuote,
    rate: {
      basis: input.rateBasis,
      referenceRateName: referenceName,
      referenceRatePct: referencePct,
      spreadPct: input.rateBasis === 'fixed' ? 0 : spread,
      effectiveRatePct,
      provenance,
    },
    impact: {
      dscrBefore,
      dscrAfter,
      debtToEquityBefore: deBefore,
      debtToEquityAfter: deAfter,
      interestCoverageBefore: coverageBefore,
      interestCoverageAfter: coverageAfter,
      interestToEbit,
      verdict,
      verdictReasonTh: reasonTh,
    },
    disclaimerTh: DISCLAIMER_TH,
    disclaimerEn: DISCLAIMER_EN,
  };
}

/** สรุปว่าโครงสร้างหลังกู้ยังรับไหวหรือไม่ จากเกณฑ์ที่ธนาคารไทยใช้กันทั่วไป */
export function judge(
  dscrAfter: number | null,
  coverageAfter: number | null,
  deAfter: number | null,
): { verdict: RatioVerdict; reasonTh: string } {
  const reasons: string[] = [];
  let worst: RatioVerdict = 'good';

  const worsen = (level: RatioVerdict): void => {
    const order: RatioVerdict[] = ['good', 'watch', 'risk'];
    if (order.indexOf(level) > order.indexOf(worst)) worst = level;
  };

  if (dscrAfter === null) {
    reasons.push('ยังไม่มีภาระหนี้เดิมให้เทียบ DSCR');
  } else if (dscrAfter < 1) {
    worsen('risk');
    reasons.push(`DSCR หลังกู้เหลือ ${dscrAfter.toFixed(2)} เท่า กระแสเงินสดไม่พอจ่ายหนี้`);
  } else if (dscrAfter < 1.2) {
    worsen('watch');
    reasons.push(`DSCR หลังกู้ ${dscrAfter.toFixed(2)} เท่า ต่ำกว่าเกณฑ์ 1.2 เท่าที่ธนาคารมักใช้`);
  } else {
    reasons.push(`DSCR หลังกู้ ${dscrAfter.toFixed(2)} เท่า ยังผ่านเกณฑ์ทั่วไป`);
  }

  if (coverageAfter !== null && coverageAfter < 2) {
    worsen(coverageAfter < 1.5 ? 'risk' : 'watch');
    reasons.push(`ความสามารถจ่ายดอกเบี้ยเหลือ ${coverageAfter.toFixed(2)} เท่า`);
  }

  if (deAfter !== null && deAfter > 3) {
    worsen('watch');
    reasons.push(`D/E หลังกู้ขึ้นเป็น ${deAfter.toFixed(2)} เท่า เกินเพดานที่ธนาคารมักรับได้`);
  }

  return { verdict: worst, reasonTh: reasons.join(' · ') };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
