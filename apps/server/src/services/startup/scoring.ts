/**
 * เครื่องประเมินความพร้อมกู้ของกิจการที่ยังไม่มีงบการเงิน (โหมด Startup)
 *
 * ทั้งไฟล์เป็น pure function — รับตัวเลขที่เจ้าของกรอก บวกอัตราดอกเบี้ยอ้างอิงจาก ธปท.
 * แล้วคำนวณตัวชี้วัดที่สถาบันการเงินไทยใช้จริงในการพิจารณาสินเชื่อ SME
 *
 * ย้ำให้ชัด: ผลลัพธ์คือ "การประเมินจากเกณฑ์ที่ใช้กันทั่วไป" ไม่ใช่การอนุมัติสินเชื่อ
 * ธนาคารแต่ละแห่งมีนโยบายและน้ำหนักต่างกัน และดูปัจจัยเชิงคุณภาพที่ระบบนี้ไม่เห็น
 */

import type {
  ApprovalLikelihood,
  AssessmentFactor,
  FactorStatus,
  ImprovementAction,
  StartupMetrics,
  StartupProfile,
} from '@sme/shared';
import { payment } from '../finance/loan.js';

/** ส่วนต่างความเสี่ยงที่บวกจากอัตราอ้างอิง — ยิ่งความเสี่ยงสูง ธนาคารยิ่งคิดแพง */
export function riskSpread(profile: StartupProfile): number {
  let spread = 1.5; // ฐานสำหรับกิจการใหม่

  if (profile.monthsOperating < 12) spread += 1.0;
  else if (profile.monthsOperating < 24) spread += 0.5;

  const collateralCoverage =
    profile.requestedAmount > 0 ? profile.collateralValue / profile.requestedAmount : 0;
  if (collateralCoverage < 0.5) spread += profile.hasGuarantor ? 0.5 : 1.25;
  else if (collateralCoverage < 1) spread += 0.5;

  if (profile.creditHistory === 'late') spread += 1.0;
  else if (profile.creditHistory === 'none') spread += 0.25;
  else if (profile.creditHistory === 'default') spread += 2.5;

  const monthlyProfit = profile.monthlyRevenue - profile.monthlyExpenses;
  if (monthlyProfit <= 0) spread += 1.0;

  // เพดานไว้ไม่ให้ตัวเลขหลุดจากช่วงที่พบได้จริงในตลาด
  return Math.round(Math.min(spread, 7) * 100) / 100;
}

/**
 * วงเงินสูงสุดที่กระแสเงินสดปัจจุบันรองรับได้ที่ DSCR เป้าหมาย
 *
 * คิดย้อนจากค่างวดที่จ่ายไหว กลับไปเป็นเงินต้นด้วยสูตรมูลค่าปัจจุบันของเงินรายงวด
 *   P = PMT × (1 − (1 + i)^−n) ÷ i
 */
export function affordablePrincipal(
  input: {
    monthlyProfit: number;
    ownerMonthlyIncome: number;
    existingDebtMonthlyPayment: number;
    annualRatePct: number;
    years: number;
  },
  targetDscr = 1.2,
): number {
  const available =
    (input.monthlyProfit + input.ownerMonthlyIncome) / targetDscr - input.existingDebtMonthlyPayment;
  if (available <= 0) return 0;

  const i = input.annualRatePct / 100 / 12;
  const n = Math.round(input.years * 12);
  if (n <= 0) return 0;

  const principal = i === 0 ? available * n : (available * (1 - Math.pow(1 + i, -n))) / i;
  // ปัดลงเป็นหลักหมื่นเพื่อให้เป็นตัวเลขที่พูดกับธนาคารได้จริง
  return Math.max(0, Math.floor(principal / 10_000) * 10_000);
}

export function computeMetrics(
  profile: StartupProfile,
  rate: { name: string | null; valuePct: number | null },
): StartupMetrics {
  const monthlyProfit = profile.monthlyRevenue - profile.monthlyExpenses;
  const annualRevenue = profile.monthlyRevenue * 12;

  const spread = riskSpread(profile);
  // ไม่มีอัตราอ้างอิงจาก ธปท. ก็ยังประเมินต่อได้ แต่ต้องบอกให้ชัดว่าใช้ค่าประมาณ
  const base = rate.valuePct ?? 7.0;
  const estimatedRatePct = Math.round((base + spread) * 100) / 100;

  const newMonthlyPayment =
    profile.requestedAmount > 0 && profile.requestedYears > 0
      ? payment(profile.requestedAmount, estimatedRatePct, profile.requestedYears)
      : 0;
  const totalMonthlyDebtService = round2(
    profile.existingDebtMonthlyPayment + newMonthlyPayment,
  );

  const incomeForDebt = monthlyProfit + profile.ownerMonthlyIncome;
  const dscr = totalMonthlyDebtService > 0 ? round4(incomeForDebt / totalMonthlyDebtService) : null;

  const incomeBase = profile.monthlyRevenue + profile.ownerMonthlyIncome;
  const dsrPercent =
    incomeBase > 0 ? round2((totalMonthlyDebtService / incomeBase) * 100) : null;

  const investedTotal =
    profile.ownerCapital + profile.requestedAmount + profile.existingDebtOutstanding;
  const ownerEquitySharePercent =
    investedTotal > 0 ? round2((profile.ownerCapital / investedTotal) * 100) : 0;

  return {
    monthlyProfit: round2(monthlyProfit),
    annualRevenue: round2(annualRevenue),
    estimatedRatePct,
    referenceRateName: rate.name,
    referenceRatePct: rate.valuePct,
    riskSpreadPct: spread,
    newMonthlyPayment,
    totalMonthlyDebtService,
    firstYearInterest: round2((profile.requestedAmount * estimatedRatePct) / 100),
    dscr,
    dsrPercent,
    ownerEquitySharePercent,
    collateralCoverage:
      profile.requestedAmount > 0
        ? round4(profile.collateralValue / profile.requestedAmount)
        : null,
    cashRunwayMonths:
      profile.monthlyExpenses > 0 ? round2(profile.cashOnHand / profile.monthlyExpenses) : null,
    loanToAnnualRevenue: annualRevenue > 0 ? round4(profile.requestedAmount / annualRevenue) : null,
  };
}

const BAHT = (value: number): string => `฿${Math.round(value).toLocaleString('en-US')}`;

/**
 * ปัจจัยที่ธนาคารดู พร้อมน้ำหนัก
 *
 * น้ำหนักสะท้อนลำดับความสำคัญที่พบในเกณฑ์สินเชื่อ SME ทั่วไป:
 * ความสามารถชำระหนี้มาก่อนหลักประกัน และประวัติเครดิตเป็นด่านที่ตกแล้วตกเลย
 */
export function evaluateFactors(
  profile: StartupProfile,
  metrics: StartupMetrics,
): AssessmentFactor[] {
  const factors: AssessmentFactor[] = [];

  const add = (factor: AssessmentFactor): void => {
    factors.push(factor);
  };

  // 1) ความสามารถชำระหนี้ — ตัวชี้ขาดอันดับหนึ่ง
  const dscr = metrics.dscr;
  add({
    key: 'dscr',
    labelTh: 'ความสามารถชำระหนี้ (DSCR)',
    labelEn: 'Debt service coverage',
    weight: 20,
    status: dscr === null ? 'warn' : dscr >= 1.5 ? 'good' : dscr >= 1.2 ? 'warn' : 'fail',
    actual: dscr === null ? 'ยังไม่มีภาระหนี้' : `${dscr.toFixed(2)} เท่า`,
    benchmark: 'อย่างน้อย 1.20 เท่า (ดี 1.50 เท่าขึ้นไป)',
    explanationTh:
      'กำไรต่อเดือนบวกรายได้อื่นของเจ้าของ หารด้วยภาระผ่อนทั้งหมดต่อเดือน ' +
      'ต่ำกว่า 1 เท่าแปลว่าเงินที่หาได้ไม่พอผ่อน',
  });

  // 2) ภาระผ่อนเทียบยอดขาย — กฎง่าย ๆ ที่ผู้ให้กู้ใช้เช็กว่าวงเงินใหญ่เกินตัวไหม
  // (คนละตัวกับ DSCR ข้างบนซึ่งเทียบกับ "กำไร" ไม่ใช่ "ยอดขาย")
  const dsr = metrics.dsrPercent;
  add({
    key: 'dsr',
    labelTh: 'ภาระผ่อนต่อยอดขาย',
    labelEn: 'Debt service to revenue',
    weight: 15,
    status: dsr === null ? 'warn' : dsr <= 10 ? 'good' : dsr <= 20 ? 'warn' : 'fail',
    actual: dsr === null ? 'คำนวณไม่ได้' : `${dsr.toFixed(1)}% ของยอดขาย`,
    benchmark: 'ไม่เกิน 20% ของยอดขาย (ดีคือไม่เกิน 10%)',
    explanationTh:
      'ค่างวดทั้งหมดกินยอดขายไปกี่เปอร์เซ็นต์ ยิ่งสูงยิ่งไม่เหลือพื้นที่รับมือเดือนที่ขายไม่ดี ' +
      'ต่างจาก DSCR ตรงที่ตัวนี้เทียบกับยอดขาย ไม่ใช่กำไร',
  });

  // 3) อายุกิจการ — ธนาคารส่วนใหญ่อยากเห็นรายการเดินบัญชีย้อนหลัง
  const months = profile.monthsOperating;
  add({
    key: 'business_age',
    labelTh: 'อายุกิจการ',
    labelEn: 'Time in business',
    weight: 12,
    status: months >= 24 ? 'good' : months >= 12 ? 'warn' : 'fail',
    actual: months === 0 ? 'ยังไม่เริ่มดำเนินการ' : `${months} เดือน`,
    benchmark: 'อย่างน้อย 12 เดือน (ดี 24 เดือนขึ้นไป)',
    explanationTh:
      'ธนาคารส่วนใหญ่ขอดูรายการเดินบัญชีย้อนหลัง 6-12 เดือน กิจการที่เพิ่งเปิดจึงต้องใช้ ' +
      'สินเชื่อกลุ่มที่ออกแบบมาสำหรับรายใหม่โดยเฉพาะ',
  });

  // 4) ส่วนร่วมของเจ้าของ — ธนาคารไม่ปล่อยให้ความเสี่ยงตกอยู่ที่ตัวเองฝ่ายเดียว
  add({
    key: 'owner_equity',
    labelTh: 'ส่วนร่วมของเจ้าของ',
    labelEn: 'Owner equity contribution',
    weight: 12,
    status:
      metrics.ownerEquitySharePercent >= 30
        ? 'good'
        : metrics.ownerEquitySharePercent >= 20
          ? 'warn'
          : 'fail',
    actual: `${metrics.ownerEquitySharePercent.toFixed(1)}%`,
    benchmark: 'อย่างน้อย 20% (ดี 30% ขึ้นไป)',
    explanationTh:
      'เงินของเจ้าของคิดเป็นกี่เปอร์เซ็นต์ของเงินลงทุนทั้งหมด ยิ่งเจ้าของลงเองมาก ' +
      'ธนาคารยิ่งเชื่อว่าจะไม่ทิ้งกิจการเมื่อเจอปัญหา',
  });

  // 5) หลักประกัน — สำคัญแต่มาทีหลังกระแสเงินสด และมี บสย. ทดแทนได้
  const coverage = metrics.collateralCoverage;
  const collateralStatus: FactorStatus =
    coverage !== null && coverage >= 1
      ? 'good'
      : profile.hasGuarantor || (coverage !== null && coverage >= 0.5)
        ? 'warn'
        : 'fail';
  add({
    key: 'collateral',
    labelTh: 'หลักประกัน / ผู้ค้ำประกัน',
    labelEn: 'Collateral and guarantee',
    weight: 12,
    status: collateralStatus,
    actual:
      coverage === null
        ? 'ไม่ได้ระบุวงเงิน'
        : `${BAHT(profile.collateralValue)} (${(coverage * 100).toFixed(0)}% ของวงเงิน)` +
          (profile.hasGuarantor ? ' + มีผู้ค้ำประกัน' : ''),
    benchmark: 'ครอบคลุมวงเงินเต็มจำนวน หรือใช้ บสย. ค้ำประกันแทน',
    explanationTh:
      'หลักประกันไม่พอไม่ได้แปลว่ากู้ไม่ได้ — บสย. มีโครงการค้ำประกันสำหรับผู้ที่ไม่มีหลักประกันโดยเฉพาะ',
  });

  // 6) ประวัติเครดิต — เป็นด่านที่ตกแล้วแทบไม่มีทางผ่าน
  const creditStatus: FactorStatus =
    profile.creditHistory === 'clean'
      ? 'good'
      : profile.creditHistory === 'default'
        ? 'fail'
        : 'warn';
  const creditLabels: Record<StartupProfile['creditHistory'], string> = {
    clean: 'ไม่เคยผิดนัดชำระ',
    none: 'ยังไม่มีประวัติสินเชื่อ',
    late: 'เคยชำระล่าช้า',
    default: 'เคยผิดนัดชำระหนี้',
  };
  add({
    key: 'credit_history',
    labelTh: 'ประวัติเครดิต',
    labelEn: 'Credit history',
    weight: 12,
    status: creditStatus,
    actual: creditLabels[profile.creditHistory],
    benchmark: 'ไม่มีประวัติผิดนัดชำระในเครดิตบูโร',
    explanationTh:
      'ประวัติผิดนัดชำระเป็นด่านแรกที่ธนาคารตรวจ และมักปฏิเสธทันทีโดยไม่ดูปัจจัยอื่น',
  });

  // 7) ทำกำไรได้หรือยัง
  add({
    key: 'profitability',
    labelTh: 'ผลกำไรต่อเดือน',
    labelEn: 'Monthly profitability',
    weight: 10,
    status:
      metrics.monthlyProfit > profile.monthlyRevenue * 0.1
        ? 'good'
        : metrics.monthlyProfit > 0
          ? 'warn'
          : 'fail',
    actual: `${BAHT(metrics.monthlyProfit)} ต่อเดือน`,
    benchmark: 'ต้องเป็นบวก (ดีคือเกิน 10% ของรายได้)',
    explanationTh:
      'กิจการที่ยังขาดทุนทุกเดือนจะเอาเงินที่ไหนมาผ่อน ธนาคารจึงมองว่าเป็นความเสี่ยงสูงมาก',
  });

  // 8) เงินสดสำรอง
  const runway = metrics.cashRunwayMonths;
  add({
    key: 'cash_runway',
    labelTh: 'เงินสดสำรอง',
    labelEn: 'Cash runway',
    weight: 4,
    status: runway === null ? 'warn' : runway >= 6 ? 'good' : runway >= 3 ? 'warn' : 'fail',
    actual: runway === null ? 'คำนวณไม่ได้' : `พอใช้ ${runway.toFixed(1)} เดือน`,
    benchmark: 'อย่างน้อย 3 เดือน (ดี 6 เดือนขึ้นไป)',
    explanationTh: 'ถ้ารายรับสะดุด เงินสดที่มีต้องประคองธุรกิจและค่างวดไปได้สักระยะ',
  });

  // 9) ขนาดวงเงินเทียบรายได้
  const ltr = metrics.loanToAnnualRevenue;
  add({
    key: 'loan_size',
    labelTh: 'ขนาดวงเงินเทียบรายได้ต่อปี',
    labelEn: 'Loan to annual revenue',
    weight: 3,
    status: ltr === null ? 'warn' : ltr <= 0.5 ? 'good' : ltr <= 1 ? 'warn' : 'fail',
    actual: ltr === null ? 'คำนวณไม่ได้' : `${(ltr * 100).toFixed(0)}% ของรายได้ต่อปี`,
    benchmark: 'ไม่เกิน 100% ของรายได้ต่อปี (ดีคือไม่เกิน 50%)',
    explanationTh: 'ขอวงเงินสูงกว่ารายได้ทั้งปีมักถูกมองว่าเกินขนาดของกิจการ',
  });

  return factors;
}

export function scoreFactors(factors: AssessmentFactor[]): number {
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight === 0) return 0;
  const earned = factors.reduce((sum, factor) => {
    const multiplier = factor.status === 'good' ? 1 : factor.status === 'warn' ? 0.5 : 0;
    return sum + factor.weight * multiplier;
  }, 0);
  return Math.round((earned / totalWeight) * 100);
}

/** เงื่อนไขที่ทำให้ไม่ผ่านทันทีโดยไม่ต้องดูคะแนนรวม */
export function hardBlockers(profile: StartupProfile, metrics: StartupMetrics): string[] {
  const blockers: string[] = [];

  if (profile.creditHistory === 'default') {
    blockers.push(
      'มีประวัติผิดนัดชำระหนี้ — สถาบันการเงินในระบบมักปฏิเสธทันที ' +
        'ต้องเคลียร์สถานะในเครดิตบูโรและรอให้พ้นระยะเวลาแสดงข้อมูลก่อน',
    );
  }
  if (metrics.monthlyProfit <= 0) {
    blockers.push(
      `รายได้ต่อเดือนยังน้อยกว่าค่าใช้จ่าย (ขาดทุนเดือนละ ${BAHT(Math.abs(metrics.monthlyProfit))}) — ` +
        'ต้องทำให้มีกำไรก่อน จึงจะมีเงินไปผ่อนได้',
    );
  }
  if (metrics.dscr !== null && metrics.dscr < 1) {
    blockers.push(
      `ภาระผ่อนรวม ${BAHT(metrics.totalMonthlyDebtService)} ต่อเดือน สูงกว่าเงินที่หาได้จริง ` +
        '(DSCR ต่ำกว่า 1 เท่า)',
    );
  }

  return blockers;
}

export function likelihoodOf(score: number, blockers: string[]): ApprovalLikelihood {
  if (blockers.length > 0) return 'unlikely';
  if (score >= 75) return 'likely';
  if (score >= 55) return 'possible';
  if (score >= 35) return 'difficult';
  return 'unlikely';
}

export const LIKELIHOOD_LABELS: Record<ApprovalLikelihood, string> = {
  likely: 'มีโอกาสได้รับอนุมัติสูง',
  possible: 'พอมีโอกาส แต่ต้องเสริมบางจุด',
  difficult: 'ค่อนข้างยาก ต้องแก้หลายจุดก่อนยื่น',
  unlikely: 'ยังไม่ผ่านเกณฑ์พื้นฐาน',
};

/** สิ่งที่ทำได้เพื่อเพิ่มโอกาส พร้อมตัวเลขที่คำนวณให้แล้ว ไม่ใช่คำแนะนำลอย ๆ */
export function buildActions(
  profile: StartupProfile,
  metrics: StartupMetrics,
  factors: AssessmentFactor[],
  affordable: number,
): ImprovementAction[] {
  const actions: ImprovementAction[] = [];
  const statusOf = (key: string): FactorStatus | undefined =>
    factors.find((factor) => factor.key === key)?.status;

  // ลดวงเงินให้พอดีกับกระแสเงินสดจริง
  if (
    (statusOf('dscr') === 'fail' || statusOf('dsr') === 'fail') &&
    affordable > 0 &&
    affordable < profile.requestedAmount
  ) {
    actions.push({
      key: 'reduce_amount',
      titleTh: `ลดวงเงินเหลือประมาณ ${BAHT(affordable)}`,
      detailTh:
        `ที่อัตรา ${metrics.estimatedRatePct.toFixed(2)}% ผ่อน ${profile.requestedYears} ปี ` +
        `วงเงินนี้คือระดับที่กระแสเงินสดปัจจุบันรองรับได้ที่ DSCR 1.20 เท่า`,
      impactTh: `ลดจากที่ขอไว้ ${BAHT(profile.requestedAmount - affordable)}`,
    });
  }

  // ยืดระยะเวลาผ่อนเพื่อลดค่างวด
  if (statusOf('dscr') !== 'good' && profile.requestedYears < 7) {
    const longerYears = Math.min(7, profile.requestedYears + 2);
    const longerPayment = payment(profile.requestedAmount, metrics.estimatedRatePct, longerYears);
    const saved = metrics.newMonthlyPayment - longerPayment;
    if (saved > 0) {
      actions.push({
        key: 'extend_term',
        titleTh: `ยืดระยะเวลาผ่อนเป็น ${longerYears} ปี`,
        detailTh: `ค่างวดลดจาก ${BAHT(metrics.newMonthlyPayment)} เหลือ ${BAHT(longerPayment)} ต่อเดือน`,
        impactTh: `ผ่อนเบาลงเดือนละ ${BAHT(saved)} แต่ดอกเบี้ยรวมตลอดสัญญาจะสูงขึ้น`,
      });
    }
  }

  // เพิ่มส่วนร่วมของเจ้าของให้ถึงเกณฑ์
  if (statusOf('owner_equity') !== 'good') {
    // แก้สมการ (capital + x) / (capital + x + loan + debt) = 0.30
    const other = profile.requestedAmount + profile.existingDebtOutstanding;
    const needed = Math.max(0, (0.3 * other) / 0.7 - profile.ownerCapital);
    if (needed > 0) {
      actions.push({
        key: 'add_capital',
        titleTh: `เพิ่มเงินทุนของตัวเองอีกประมาณ ${BAHT(needed)}`,
        detailTh: 'จะทำให้ส่วนร่วมของเจ้าของถึง 30% ซึ่งเป็นระดับที่ธนาคารมองว่ามีส่วนได้ส่วนเสียเพียงพอ',
        impactTh: `จาก ${metrics.ownerEquitySharePercent.toFixed(1)}% เป็น 30%`,
      });
    }
  }

  // ใช้ บสย. แทนหลักประกัน
  if (statusOf('collateral') !== 'good' && !profile.hasGuarantor) {
    actions.push({
      key: 'use_guarantee',
      titleTh: 'ยื่นผ่านโครงการค้ำประกันของ บสย.',
      detailTh:
        'บสย. ออกแบบมาสำหรับผู้ประกอบการที่หลักประกันไม่พอโดยเฉพาะ ' +
        'มีค่าธรรมเนียมค้ำประกันรายปีแต่ทำให้ธนาคารอนุมัติได้ง่ายขึ้นมาก',
      impactTh: 'แก้ปัญหาหลักประกันไม่พอซึ่งเป็นเหตุผลที่ SME ถูกปฏิเสธบ่อยที่สุด',
    });
  }

  // รอให้กิจการมีอายุพอ
  if (statusOf('business_age') === 'fail') {
    const monthsToGo = 12 - profile.monthsOperating;
    actions.push({
      key: 'build_track_record',
      titleTh: `เดินบัญชีธุรกิจต่ออีกประมาณ ${monthsToGo} เดือน`,
      detailTh:
        'ระหว่างนี้ให้รับ-จ่ายผ่านบัญชีธุรกิจให้มากที่สุด เพื่อให้มีรายการเดินบัญชีที่ธนาคารใช้ประเมินได้ ' +
        'ระหว่างรอสามารถใช้สินเชื่อกลุ่มที่รับกิจการอายุน้อยไปก่อน',
      impactTh: 'ปลดล็อกสินเชื่อกลุ่มที่ต้องการอายุกิจการอย่างน้อย 1 ปี',
    });
  }

  // ปรับกำไรก่อน
  if (statusOf('profitability') === 'fail') {
    const gap = Math.abs(metrics.monthlyProfit);
    actions.push({
      key: 'fix_profitability',
      titleTh: `ทำให้มีกำไรก่อนยื่นกู้ — ยังขาดอีกเดือนละ ${BAHT(gap)}`,
      detailTh:
        'เพิ่มรายได้หรือลดค่าใช้จ่ายให้ผลต่างเป็นบวกก่อน เพราะการกู้เพิ่มตอนที่ยังขาดทุน ' +
        'จะเพิ่มภาระค่างวดเข้าไปอีกโดยไม่มีเงินมารองรับ',
      impactTh: 'เป็นเงื่อนไขที่ต้องผ่านก่อน ไม่ว่าจะยื่นที่ไหน',
    });
  }

  return actions;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
