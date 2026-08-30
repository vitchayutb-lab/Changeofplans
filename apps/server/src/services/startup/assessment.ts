/**
 * ประกอบผลประเมินโหมด Startup
 *
 * รวมเครื่องคิดคะแนน (scoring.ts) เข้ากับอัตราดอกเบี้ยจริงจาก ธปท. และฐานข้อมูล
 * แหล่งเงินทุนที่มีอยู่ เพื่อตอบสามคำถามที่ผู้ประกอบการหน้าใหม่ถามจริง ๆ:
 *   1) ควรกู้แบบไหน   2) ควรไปที่ไหน   3) เขาจะให้กู้ไหม
 */

import type {
  FundingProgram,
  FundingType,
  LenderRecommendation,
  StartupAssessment,
  StartupProfile,
} from '@sme/shared';
import { listPrograms } from '../../db/fundingRepo.js';
import { loadReferenceRates } from '../finance/debt.js';
import { annualInterest, payment } from '../finance/loan.js';
import {
  affordablePrincipal,
  buildActions,
  computeMetrics,
  evaluateFactors,
  hardBlockers,
  likelihoodOf,
  LIKELIHOOD_LABELS,
  scoreFactors,
} from './scoring.js';

const DISCLAIMER_TH =
  'ผลประเมินนี้คำนวณจากตัวเลขที่กรอกเข้ามาและเกณฑ์ที่สถาบันการเงินไทยใช้กันทั่วไป ' +
  'ไม่ใช่การอนุมัติสินเชื่อและไม่ใช่คำสัญญาจากธนาคารใด ๆ ' +
  'แต่ละแห่งมีนโยบายและน้ำหนักการพิจารณาต่างกัน และดูปัจจัยเชิงคุณภาพที่ระบบนี้ไม่เห็น ' +
  'อัตราดอกเบี้ยที่แสดงเป็นค่าประมาณจากอัตราประกาศของ ธปท. บวกส่วนต่างความเสี่ยง';

/** ประเภทสินเชื่อที่เข้ากับวัตถุประสงค์การใช้เงิน */
const PURPOSE_PRODUCTS: Record<
  StartupProfile['purpose'],
  { type: FundingType; titleTh: string; whyTh: string }
> = {
  working_capital: {
    type: 'loan',
    titleTh: 'วงเงินหมุนเวียน (O/D) หรือสินเชื่อระยะสั้น',
    whyTh:
      'เงินทุนหมุนเวียนควรใช้วงเงินที่เบิกใช้เท่าที่จำเป็นและคิดดอกเบี้ยตามยอดที่ใช้จริง ' +
      'ไม่ควรกู้ระยะยาวมาถือเป็นเงินสดเพราะจะจ่ายดอกเบี้ยเต็มจำนวนตลอดสัญญา',
  },
  equipment: {
    type: 'loan',
    titleTh: 'สินเชื่อระยะยาวหรือลีสซิ่งเครื่องจักร',
    whyTh:
      'ควรให้ระยะเวลาผ่อนใกล้เคียงอายุการใช้งานของเครื่องจักร และตัวเครื่องจักรมักใช้เป็น ' +
      'หลักประกันได้ในตัว ทำให้อัตราดอกเบี้ยถูกลง',
  },
  expansion: {
    type: 'loan',
    titleTh: 'สินเชื่อระยะยาวเพื่อการลงทุน',
    whyTh: 'การขยายกิจการให้ผลตอบแทนเป็นช่วงหลายปี จึงควรผ่อนยาวให้สอดคล้องกับกระแสเงินสดที่จะเข้ามา',
  },
  inventory: {
    type: 'loan',
    titleTh: 'วงเงินซื้อสินค้า (O/D หรือ Trade Finance)',
    whyTh: 'สต็อกหมุนเป็นรอบ จึงเหมาะกับวงเงินหมุนเวียนที่เบิกและคืนตามรอบการขาย',
  },
  refinance: {
    type: 'loan',
    titleTh: 'สินเชื่อรีไฟแนนซ์',
    whyTh:
      'ถ้าหนี้เดิมมีอัตราดอกเบี้ยสูงกว่าที่ประเมินไว้ การย้ายหนี้จะลดค่างวดได้ทันที ' +
      'แต่ต้องดูค่าธรรมเนียมและค่าปรับกรณีปิดก่อนกำหนดของสัญญาเดิมด้วย',
  },
};

/**
 * ประเภทเงินทุนตอบโจทย์การใช้เงินนั้นหรือไม่
 *
 * เงินให้เปล่ามักผูกกับโครงการเฉพาะ (พัฒนาสินค้า/นวัตกรรม) เอาไปหมุนเวียนหรือรีไฟแนนซ์ไม่ได้
 * ส่วนการร่วมลงทุนเหมาะกับการขยายกิจการ ไม่ใช่สภาพคล่องระยะสั้น
 */
function fitsPurpose(type: FundingType, purpose: StartupProfile['purpose']): boolean {
  if (type === 'loan' || type === 'guarantee') return true;
  if (type === 'grant' || type === 'subsidy') {
    return purpose === 'equipment' || purpose === 'expansion';
  }
  if (type === 'equity') return purpose === 'expansion';
  return true;
}

interface ProgramCheck {
  passed: boolean;
  labelTh: string;
}

/** ตรวจเงื่อนไขของโครงการกับข้อมูลกิจการใหม่ (ซึ่งยังไม่มีงบการเงิน) */
function checkProgram(
  program: FundingProgram,
  profile: StartupProfile,
  metrics: { annualRevenue: number; dscr: number | null },
): ProgramCheck[] {
  const yearsOperating = profile.monthsOperating / 12;
  const checks: ProgramCheck[] = [];

  checks.push({
    passed:
      program.eligibleIndustries.includes('*') ||
      program.eligibleIndustries.includes(profile.industry),
    labelTh: `ประเภทธุรกิจ (${profile.industry})`,
  });
  checks.push({
    passed:
      program.eligibleProvinces.includes('*') ||
      program.eligibleProvinces.includes(profile.province),
    labelTh: `พื้นที่ (${profile.province})`,
  });
  checks.push({
    passed: yearsOperating >= program.minYearsOperating,
    labelTh: `อายุกิจการ (ต้องการอย่างน้อย ${program.minYearsOperating} ปี)`,
  });
  checks.push({
    passed:
      profile.requestedAmount >= program.minAmount &&
      profile.requestedAmount <= program.maxAmount,
    labelTh: 'วงเงินที่ขออยู่ในช่วงของโครงการ',
  });
  checks.push({
    passed: program.maxAnnualRevenue === null || metrics.annualRevenue <= program.maxAnnualRevenue,
    labelTh: 'รายได้ต่อปีไม่เกินเพดานของโครงการ',
  });
  checks.push({
    passed: !program.requiresCollateral || profile.collateralValue > 0,
    labelTh: 'มีหลักประกันตามที่โครงการกำหนด',
  });
  checks.push({
    passed:
      program.minDscr === null || (metrics.dscr !== null && metrics.dscr >= program.minDscr),
    labelTh:
      program.minDscr === null
        ? 'ไม่กำหนด DSCR'
        : `DSCR อย่างน้อย ${program.minDscr.toFixed(2)} เท่า`,
  });

  return checks;
}

function buildRecommendations(
  profile: StartupProfile,
  metrics: { annualRevenue: number; dscr: number | null; estimatedRatePct: number },
  rates: Awaited<ReturnType<typeof loadReferenceRates>>,
): LenderRecommendation[] {
  const results = listPrograms().map((program): LenderRecommendation => {
    const checks = checkProgram(program, profile, metrics);
    const passed = checks.filter((check) => check.passed).length;
    const eligible = passed === checks.length;
    const blockedByTh = checks.filter((check) => !check.passed).map((check) => check.labelTh);

    // ── ประมาณอัตราและค่างวดของโครงการนี้โดยเฉพาะ ──────────────────────────
    let ratePct: number | null = null;
    let referenceRateName: 'MLR' | 'MRR' | null = null;

    if (program.type === 'loan') {
      if (program.rateBasis === 'mlr_spread' || program.rateBasis === 'mrr_spread') {
        referenceRateName = program.rateBasis === 'mlr_spread' ? 'MLR' : 'MRR';
        const reference = rates[referenceRateName];
        if (reference.value !== null) {
          // กิจการใหม่มักได้ส่วนต่างค่อนไปทางสูงของช่วงที่โครงการประกาศ
          const spread = program.rateMax ?? program.rateMin ?? 0;
          ratePct = round2(reference.value + spread);
        }
      } else if (program.rateMax !== null || program.rateMin !== null) {
        ratePct = program.rateMax ?? program.rateMin;
      }
    }

    const termMonths = program.maxTermMonths;
    const monthlyPayment =
      ratePct !== null && termMonths
        ? payment(profile.requestedAmount, ratePct, termMonths / 12)
        : null;

    let score = (passed / checks.length) * 60;
    if (eligible) {
      if (program.type === 'grant' || program.type === 'subsidy') score += 25;
      else if (program.type === 'guarantee') score += 20;
      else if (ratePct !== null) score += Math.max(0, 18 - ratePct * 1.6);
      if (!program.requiresCollateral) score += 6;
      // โครงการที่รับกิจการอายุน้อยมีค่ามากเป็นพิเศษสำหรับผู้ประกอบการหน้าใหม่
      if (program.minYearsOperating === 0) score += 8;
      // แต่เงินให้เปล่าและการร่วมลงทุนไม่ตอบโจทย์เงินทุนหมุนเวียนหรือการย้ายหนี้
      // จึงไม่ควรขึ้นเป็นอันดับต้น ๆ เมื่อผู้ใช้ต้องการเงินไปใช้แบบนั้น
      if (!fitsPurpose(program.type, profile.purpose)) score -= 22;
    }

    return {
      program,
      score: Math.round(Math.max(0, Math.min(100, score))),
      eligible,
      reasonTh: eligible
        ? program.type === 'grant' || program.type === 'subsidy'
          ? 'ผ่านเงื่อนไขที่ตรวจได้ และไม่ต้องคืนเงินต้น'
          : program.minYearsOperating === 0
            ? 'ผ่านเงื่อนไข และรับกิจการที่เพิ่งเริ่มต้นโดยเฉพาะ'
            : 'ผ่านเงื่อนไขที่ตรวจได้ทั้งหมด'
        : `ยังไม่ผ่าน ${blockedByTh.length} เงื่อนไข`,
      blockedByTh,
      estimate:
        program.type === 'grant' || program.type === 'subsidy' || program.type === 'equity'
          ? null
          : {
              amount: profile.requestedAmount,
              estimatedRatePct: ratePct,
              referenceRateName,
              monthlyPayment,
              annualInterest: ratePct === null ? null : annualInterest(profile.requestedAmount, ratePct),
              termMonths,
            },
    };
  });

  return results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });
}

/** ประเภทสินเชื่อที่ควรพิจารณา ตามวัตถุประสงค์และสถานะของกิจการ */
function suggestProducts(
  profile: StartupProfile,
): { type: FundingType; titleTh: string; whyTh: string }[] {
  const suggestions = [PURPOSE_PRODUCTS[profile.purpose]];

  const coverage =
    profile.requestedAmount > 0 ? profile.collateralValue / profile.requestedAmount : 0;
  if (coverage < 1 && !profile.hasGuarantor) {
    suggestions.push({
      type: 'guarantee',
      titleTh: 'โครงการค้ำประกันของ บสย.',
      whyTh:
        'หลักประกันยังไม่ครอบคลุมวงเงินที่ขอ การให้ บสย. ค้ำประกันเป็นทางที่ผู้ประกอบการรายใหม่ ' +
        'ใช้บ่อยที่สุดเพื่อให้ธนาคารอนุมัติได้',
    });
  }

  if (['tech', 'food', 'manufacturing'].includes(profile.industry)) {
    suggestions.push({
      type: 'grant',
      titleTh: 'เงินอุดหนุนหรือทุนนวัตกรรม',
      whyTh:
        'อุตสาหกรรมนี้มีเงินให้เปล่าจากหน่วยงานรัฐที่ไม่ต้องคืนเงินต้นและไม่มีภาระดอกเบี้ย ' +
        'ควรลองก่อนหรือควบคู่ไปกับการกู้',
    });
  }

  return suggestions;
}

export async function assessStartup(profile: StartupProfile): Promise<StartupAssessment> {
  const rates = await loadReferenceRates();
  const reference = rates.MRR;

  const metrics = computeMetrics(profile, { name: 'MRR', valuePct: reference.value });
  const factors = evaluateFactors(profile, metrics);
  const score = scoreFactors(factors);
  const blockersTh = hardBlockers(profile, metrics);
  const likelihood = likelihoodOf(score, blockersTh);

  const affordableAmount = affordablePrincipal({
    monthlyProfit: metrics.monthlyProfit,
    ownerMonthlyIncome: profile.ownerMonthlyIncome,
    existingDebtMonthlyPayment: profile.existingDebtMonthlyPayment,
    annualRatePct: metrics.estimatedRatePct,
    years: profile.requestedYears,
  });

  const recommendations = buildRecommendations(
    profile,
    {
      annualRevenue: metrics.annualRevenue,
      dscr: metrics.dscr,
      estimatedRatePct: metrics.estimatedRatePct,
    },
    rates,
  );

  const eligibleCount = recommendations.filter((item) => item.eligible).length;

  return {
    profile,
    metrics,
    factors,
    score,
    likelihood,
    likelihoodLabelTh: LIKELIHOOD_LABELS[likelihood],
    summaryTh: buildSummary(profile, metrics, score, likelihood, eligibleCount, affordableAmount),
    blockersTh,
    suggestedProductsTh: suggestProducts(profile),
    recommendations,
    actions: buildActions(profile, metrics, factors, affordableAmount),
    affordableAmount,
    provenance: reference.provenance,
    disclaimerTh: DISCLAIMER_TH,
  };
}

function buildSummary(
  profile: StartupProfile,
  metrics: StartupAssessment['metrics'],
  score: number,
  likelihood: StartupAssessment['likelihood'],
  eligibleCount: number,
  affordable: number,
): string {
  const baht = (value: number): string => `฿${Math.round(value).toLocaleString('en-US')}`;
  const parts: string[] = [];

  parts.push(
    `จากตัวเลขที่กรอก คะแนนความพร้อมอยู่ที่ ${score}/100 — ${LIKELIHOOD_LABELS[likelihood]}`,
  );

  if (metrics.dscr !== null) {
    parts.push(
      `ขอวงเงิน ${baht(profile.requestedAmount)} ผ่อน ${profile.requestedYears} ปี ` +
        `ที่อัตราประมาณ ${metrics.estimatedRatePct.toFixed(2)}% จะมีค่างวดเดือนละ ` +
        `${baht(metrics.newMonthlyPayment)} รวมกับหนี้เดิมเป็น ${baht(metrics.totalMonthlyDebtService)} ` +
        `คิดเป็น DSCR ${metrics.dscr.toFixed(2)} เท่า`,
    );
  }

  if (affordable > 0 && affordable < profile.requestedAmount) {
    parts.push(
      `วงเงินที่กระแสเงินสดปัจจุบันรองรับได้จริงอยู่ที่ประมาณ ${baht(affordable)}`,
    );
  }

  parts.push(
    eligibleCount > 0
      ? `มีโครงการที่ผ่านเงื่อนไขที่ตรวจได้ ${eligibleCount} โครงการ`
      : 'ยังไม่มีโครงการใดในฐานข้อมูลที่ผ่านเงื่อนไขครบทุกข้อ',
  );

  return parts.join(' · ');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
