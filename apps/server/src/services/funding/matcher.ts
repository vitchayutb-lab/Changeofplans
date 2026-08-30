/**
 * จับคู่ SME กับโครงการสนับสนุนเงินทุน
 *
 * ตรวจเงื่อนไขทีละข้อและเก็บผลไว้ทั้งข้อที่ผ่านและไม่ผ่าน พร้อมตัวเลขที่ใช้เทียบจริง
 * เพื่อให้ผู้ใช้เห็นว่า "ไม่ผ่านเพราะอะไร" ไม่ใช่แค่คะแนนลอย ๆ
 */

import type {
  EligibilityCheck,
  FundingMatch,
  FundingProgram,
  Provenance,
  Sme,
} from '@sme/shared';
import { listPrograms } from '../../db/fundingRepo.js';
import { getSme } from '../../db/smeRepo.js';
import { loadStatements, NotFoundError } from '../finance/analysis.js';
import { getDebtOverview, loadReferenceRates, type ReferenceRates } from '../finance/debt.js';
import { annualInterest, dscr, payment } from '../finance/loan.js';
import { derive } from '../finance/statement.js';

const THB = (value: number): string =>
  `฿${Math.round(value).toLocaleString('en-US')}`;

export interface MatchOptions {
  smeId: string;
  /** วงเงินที่ต้องการ — ถ้าไม่ระบุจะใช้จุดกึ่งกลางของช่วงวงเงินแต่ละโครงการ */
  amountNeeded?: number;
  fiscalYear?: number;
}

export async function matchFundingPrograms(options: MatchOptions): Promise<FundingMatch[]> {
  const sme = getSme(options.smeId);
  if (!sme) throw new NotFoundError(`ไม่พบข้อมูลกิจการ ${options.smeId}`);

  const { current } = loadStatements(options.smeId, options.fiscalYear);
  const statement = derive(current);
  const debt = await getDebtOverview(options.smeId);
  const rates = await loadReferenceRates();

  const currentYear = new Date().getFullYear();
  const yearsOperating = currentYear - sme.foundedYear;
  const currentDscr = dscr(statement.operatingCashFlow, debt.totalAnnualDebtService);

  const matches = listPrograms().map((program) =>
    evaluate({
      program,
      sme,
      yearsOperating,
      annualRevenue: statement.revenue,
      currentDscr,
      amountNeeded: options.amountNeeded,
      rates,
    }),
  );

  return matches.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });
}

interface EvaluateInput {
  program: FundingProgram;
  sme: Sme;
  yearsOperating: number;
  annualRevenue: number;
  currentDscr: number | null;
  amountNeeded?: number;
  rates: ReferenceRates;
}

export function evaluate(input: EvaluateInput): FundingMatch {
  const { program, sme, yearsOperating, annualRevenue, currentDscr } = input;
  const checks: EligibilityCheck[] = [];

  const industryOk =
    program.eligibleIndustries.includes('*') || program.eligibleIndustries.includes(sme.industry);
  checks.push({
    rule: 'industry',
    labelTh: 'ประเภทธุรกิจ',
    passed: industryOk,
    actual: sme.industry,
    required: program.eligibleIndustries.includes('*')
      ? 'ทุกประเภทธุรกิจ'
      : program.eligibleIndustries.join(', '),
  });

  const provinceOk =
    program.eligibleProvinces.includes('*') || program.eligibleProvinces.includes(sme.province);
  checks.push({
    rule: 'province',
    labelTh: 'พื้นที่',
    passed: provinceOk,
    actual: sme.province,
    required: program.eligibleProvinces.includes('*')
      ? 'ทั่วประเทศ'
      : program.eligibleProvinces.join(', '),
  });

  const yearsOk = yearsOperating >= program.minYearsOperating;
  checks.push({
    rule: 'years_operating',
    labelTh: 'อายุกิจการ',
    passed: yearsOk,
    actual: `${yearsOperating} ปี`,
    required: `อย่างน้อย ${program.minYearsOperating} ปี`,
  });

  const employeesOk = program.maxEmployees === null || sme.employees <= program.maxEmployees;
  checks.push({
    rule: 'employees',
    labelTh: 'จำนวนพนักงาน',
    passed: employeesOk,
    actual: `${sme.employees} คน`,
    required: program.maxEmployees === null ? 'ไม่จำกัด' : `ไม่เกิน ${program.maxEmployees} คน`,
  });

  const revenueOk =
    program.maxAnnualRevenue === null || annualRevenue <= program.maxAnnualRevenue;
  checks.push({
    rule: 'revenue',
    labelTh: 'รายได้ต่อปี',
    passed: revenueOk,
    actual: THB(annualRevenue),
    required: program.maxAnnualRevenue === null ? 'ไม่จำกัด' : `ไม่เกิน ${THB(program.maxAnnualRevenue)}`,
  });

  const dscrOk = program.minDscr === null || (currentDscr !== null && currentDscr >= program.minDscr);
  checks.push({
    rule: 'dscr',
    labelTh: 'ความสามารถชำระหนี้ (DSCR)',
    passed: dscrOk,
    actual: currentDscr === null ? 'คำนวณไม่ได้ (ยังไม่มีภาระหนี้)' : `${currentDscr.toFixed(2)} เท่า`,
    required: program.minDscr === null ? 'ไม่กำหนด' : `อย่างน้อย ${program.minDscr.toFixed(2)} เท่า`,
  });

  const requestedAmount =
    input.amountNeeded ?? Math.round((program.minAmount + program.maxAmount) / 2);
  const amountOk = requestedAmount >= program.minAmount && requestedAmount <= program.maxAmount;
  checks.push({
    rule: 'amount',
    labelTh: 'วงเงิน',
    passed: amountOk,
    actual: THB(requestedAmount),
    required: `${THB(program.minAmount)} – ${THB(program.maxAmount)}`,
  });

  const eligible = checks.every((check) => check.passed);
  const passedCount = checks.filter((check) => check.passed).length;

  return {
    program,
    score: scoreOf(checks.length, passedCount, eligible, program, input),
    eligible,
    checks,
    estimate: buildEstimate(program, requestedAmount, input.rates),
    reasonTh: reason(checks, eligible, program),
  };
}

/**
 * คะแนน 0-100: ฐานมาจากสัดส่วนเงื่อนไขที่ผ่าน แล้วบวกแต้มให้โครงการที่ "คุ้มกว่า"
 * (เงินให้เปล่า > สินเชื่อดอกต่ำ) และวงเงินที่ครอบคลุมความต้องการ
 */
function scoreOf(
  total: number,
  passed: number,
  eligible: boolean,
  program: FundingProgram,
  input: EvaluateInput,
): number {
  let score = (passed / total) * 70;

  if (eligible) {
    if (program.type === 'grant' || program.type === 'subsidy') {
      score += 20; // ไม่ต้องคืนเงินต้น จึงคุ้มที่สุด
    } else if (program.type === 'guarantee') {
      score += 12; // ช่วยให้ผ่านเกณฑ์หลักประกัน แต่ยังมีต้นทุนค้ำประกัน
    } else if (program.rateMin !== null) {
      // ดอกเบี้ยยิ่งต่ำยิ่งได้แต้ม (0% -> 15 แต้ม, 8% ขึ้นไป -> 0 แต้ม)
      score += Math.max(0, 15 - program.rateMin * 1.875);
    }
    if (!program.requiresCollateral) score += 5;
    if (input.amountNeeded !== undefined && input.amountNeeded <= program.maxAmount) score += 5;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

function buildEstimate(
  program: FundingProgram,
  amount: number,
  rates: ReferenceRates,
): FundingMatch['estimate'] {
  if (program.type === 'grant' || program.type === 'subsidy' || program.type === 'equity') {
    return null; // ไม่มีภาระดอกเบี้ย จึงไม่ประมาณต้นทุนสินเชื่อ
  }

  let ratePct: number | null = null;
  let referenceName: 'MLR' | 'MRR' | null = null;
  let provenance: Provenance | null = null;

  if (program.rateBasis === 'mlr_spread' || program.rateBasis === 'mrr_spread') {
    referenceName = program.rateBasis === 'mlr_spread' ? 'MLR' : 'MRR';
    const reference = rates[referenceName];
    provenance = reference.provenance;
    if (reference.value !== null) {
      // ใช้กึ่งกลางของช่วงส่วนต่างที่โครงการประกาศ
      const spread = midpoint(program.rateMin, program.rateMax) ?? 0;
      ratePct = round2(reference.value + spread);
    }
  } else if (program.rateMin !== null || program.rateMax !== null) {
    ratePct = midpoint(program.rateMin, program.rateMax);
  }

  const termMonths = program.maxTermMonths;
  const monthly =
    ratePct !== null && termMonths && termMonths > 0
      ? payment(amount, ratePct, termMonths / 12)
      : null;

  return {
    amount,
    estimatedRatePct: ratePct,
    referenceRateName: referenceName,
    annualInterest: ratePct === null ? null : annualInterest(amount, ratePct),
    monthlyPayment: monthly,
    termMonths: termMonths ?? null,
    provenance,
  };
}

function reason(checks: EligibilityCheck[], eligible: boolean, program: FundingProgram): string {
  if (eligible) {
    const highlight =
      program.type === 'grant' || program.type === 'subsidy'
        ? 'ไม่ต้องคืนเงินต้น'
        : program.requiresCollateral
          ? 'ต้องมีหลักประกัน'
          : 'ไม่ต้องมีหลักประกัน';
    return `ผ่านเงื่อนไขที่ตรวจได้ทั้งหมด (${highlight})`;
  }
  const failed = checks.filter((c) => !c.passed);
  return `ยังไม่ผ่าน ${failed.length} เงื่อนไข: ${failed
    .map((c) => `${c.labelTh} (มี ${c.actual} / ต้องการ ${c.required})`)
    .join(' · ')}`;
}

function midpoint(min: number | null, max: number | null): number | null {
  if (min === null && max === null) return null;
  if (min === null) return max;
  if (max === null) return min;
  return round2((min + max) / 2);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
