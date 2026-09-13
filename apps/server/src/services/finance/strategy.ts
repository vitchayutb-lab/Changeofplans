/**
 * จัดหาแหล่งเงินทุน — ควรหาเงินจากไหนก่อน-หลัง
 *
 * หน้าแหล่งเงินทุนตอบว่ามีโครงการอะไรสมัครได้ ส่วนนี้ตอบคำถามที่มาก่อนหน้านั้น:
 * ถ้าต้องการเงินก้อนหนึ่ง ควรหามาจากไหน โดยเรียงตามต้นทุนจริงไม่ใช่ตามความสะดวก
 *
 * จุดที่มักถูกมองข้าม: เงินที่ถูกที่สุดไม่ใช่เงินกู้ แต่เป็นเงินของกิจการเองที่จมอยู่ใน
 * ลูกหนี้และสินค้าคงเหลือ ซึ่งคิดออกมาเป็นบาทได้จากงบจริงและไม่มีดอกเบี้ยเลย
 * เป้าหมายจำนวนวันที่ใช้มาจากทะเบียนเกณฑ์เดียวกับหน้าเกณฑ์การวัดธุรกิจ ไม่ใช่ค่าที่
 * ตั้งขึ้นเฉพาะที่นี่ ถ้าเกณฑ์เปลี่ยน ตัวเลขหน้านี้จะเปลี่ยนตามเอง
 */

import type {
  FundingProgram,
  FundingSource,
  FundingSourceKind,
  FundingPlanStep,
  FundingStrategy,
  RatioVerdict,
  WorkingCapitalRelease,
} from '@sme/shared';
import { listPrograms } from '../../db/fundingRepo.js';
import { getSme } from '../../db/smeRepo.js';
import { loadStatements, NotFoundError } from './analysis.js';
import { debtCapacity } from './capacity.js';
import { ratioCatalog } from './ratios.js';
import { derive } from './statement.js';

/**
 * ลำดับการใช้แหล่งเงิน เรียงตามต้นทุนที่แท้จริงของแต่ละแบบ
 *
 * เงินตัวเองมาก่อนเพราะไม่มีต้นทุน ตามด้วยเงินที่ไม่ต้องคืน แล้วจึงเป็นหนี้
 * ส่วนการเพิ่มทุนอยู่ท้ายสุดเพราะไม่มีดอกเบี้ยก็จริง แต่แลกด้วยสัดส่วนความเป็นเจ้าของ
 * ซึ่งเป็นต้นทุนที่จ่ายครั้งเดียวแล้วจ่ายตลอดไป
 */
const PECKING_ORDER: FundingSourceKind[] = [
  'working_capital',
  'grant',
  'subsidy',
  'debt',
  'equity',
];

const round2 = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number): string => `฿${Math.round(value).toLocaleString('en-US')}`;

/** เกณฑ์จำนวนวันจากทะเบียนอัตราส่วน เพื่อไม่ให้หน้านี้ตั้งเป้าคนละค่ากับที่ระบบใช้ตัดสิน */
function benchmarkDays(key: 'receivable_days' | 'inventory_days'): { good: number; watch: number } {
  const ratio = ratioCatalog()
    .flatMap((group) => group.ratios)
    .find((item) => item.key === key);
  if (!ratio) throw new Error(`ไม่พบเกณฑ์ ${key} ในทะเบียนอัตราส่วน`);
  return { good: ratio.benchmark.good, watch: ratio.benchmark.watch };
}

function daysVerdict(current: number | null, band: { good: number; watch: number }): RatioVerdict {
  if (current === null) return 'na';
  if (current <= band.good) return 'good';
  if (current <= band.watch) return 'watch';
  return 'risk';
}

/**
 * เงินที่ปลดล็อกได้ถ้าทำจำนวนวันให้ถึงเกณฑ์
 *
 *   เงินที่คืนมา = ยอดต่อวัน × จำนวนวันที่ลดได้
 *
 * ดีกว่าเกณฑ์อยู่แล้วจะได้ศูนย์ ไม่ใช่ค่าติดลบ เพราะการยืดวันออกไปเพื่อ "ปลดล็อกเงิน"
 * คือการสร้างปัญหาให้ตัวเอง ไม่ใช่แหล่งเงินทุน
 */
export function releaseFromDays(
  perDay: number,
  currentDays: number | null,
  targetDays: number,
): number {
  if (currentDays === null || perDay <= 0) return 0;
  return round2(Math.max(0, (currentDays - targetDays) * perDay));
}

function eligible(program: FundingProgram, industry: string, province: string): boolean {
  const industryOk =
    program.eligibleIndustries.includes('*') || program.eligibleIndustries.includes(industry);
  const provinceOk =
    program.eligibleProvinces.includes('*') || program.eligibleProvinces.includes(province);
  return industryOk && provinceOk;
}

/**
 * วงเงินที่แหล่งประเภทหนึ่งให้ได้จริง
 *
 * ใช้วงเงินสูงสุดของ "โครงการเดียว" ไม่ใช่ผลรวมของทุกโครงการ เพราะการสมมติว่าจะได้
 * ทุกโครงการพร้อมกันเป็นการประเมินที่สูงเกินจริง และทำให้แผนที่ได้ดูครอบคลุมกว่าที่เป็น
 */
function bestProgram(programs: FundingProgram[]): { amount: number; names: string[] } {
  if (programs.length === 0) return { amount: 0, names: [] };
  const amount = Math.max(...programs.map((p) => p.maxAmount));
  return { amount, names: programs.map((p) => p.nameTh) };
}

export interface StrategyOptions {
  smeId: string;
  /** เงินที่ต้องการ — ไม่ระบุจะใช้วงเงินกู้ที่รับไหวที่ DSCR 1.20 เป็นค่าตั้งต้น */
  needAmount?: number;
  fiscalYear?: number;
}

export async function fundingStrategy(options: StrategyOptions): Promise<FundingStrategy> {
  const sme = getSme(options.smeId);
  if (!sme) throw new NotFoundError(`ไม่พบข้อมูลกิจการ ${options.smeId}`);

  const { current } = loadStatements(options.smeId, options.fiscalYear);
  const statement = derive(current);
  const capacity = await debtCapacity({ smeId: options.smeId });

  const receivableBand = benchmarkDays('receivable_days');
  const inventoryBand = benchmarkDays('inventory_days');

  const revenuePerDay = statement.revenue > 0 ? statement.revenue / 365 : 0;
  const cogsPerDay = statement.cogs > 0 ? statement.cogs / 365 : 0;

  const receivableDays = revenuePerDay > 0 ? round2(statement.accountsReceivable / revenuePerDay) : null;
  const inventoryDays = cogsPerDay > 0 ? round2(statement.inventory / cogsPerDay) : null;
  const payableDays = cogsPerDay > 0 ? round2(current.accountsPayable / cogsPerDay) : null;

  const releases: WorkingCapitalRelease[] = [
    {
      key: 'receivables',
      labelTh: 'เร่งเก็บหนี้จากลูกค้า',
      currentDays: receivableDays,
      targetDays: receivableBand.good,
      releasableAmount: releaseFromDays(revenuePerDay, receivableDays, receivableBand.good),
      formulaTh: `รายได้ต่อวัน ${money(revenuePerDay)} × จำนวนวันที่ลดได้`,
      actionTh:
        'ออกใบแจ้งหนี้ทันทีที่ส่งของ ติดตามก่อนครบกำหนด และให้ส่วนลดเงินสดกับลูกค้าที่จ่ายเร็ว',
      verdict: daysVerdict(receivableDays, receivableBand),
    },
    {
      key: 'inventory',
      labelTh: 'ลดสินค้าค้างคลัง',
      currentDays: inventoryDays,
      targetDays: inventoryBand.good,
      releasableAmount: releaseFromDays(cogsPerDay, inventoryDays, inventoryBand.good),
      formulaTh: `ต้นทุนขายต่อวัน ${money(cogsPerDay)} × จำนวนวันที่ลดได้`,
      actionTh: 'ระบายสินค้าที่หมุนช้า สั่งถี่ขึ้นทีละน้อย และแยกรายการที่ขายไม่ออกออกจากการสั่งซ้ำ',
      verdict: daysVerdict(inventoryDays, inventoryBand),
    },
  ];

  const totalReleasable = round2(releases.reduce((sum, r) => sum + r.releasableAmount, 0));

  const programs = listPrograms().filter((p) => eligible(p, sme.industry, sme.province));
  const byType = (type: FundingProgram['type']): FundingProgram[] =>
    programs.filter((p) => p.type === type);

  const grants = bestProgram(byType('grant'));
  const subsidies = bestProgram(byType('subsidy'));
  const equity = bestProgram(byType('equity'));
  const guarantees = bestProgram(byType('guarantee'));

  const borrowable =
    capacity.capacities.find((c) => c.targetDscr === 1.2)?.maxAmount ?? 0;
  const debtRatePct = capacity.market.estimatedRatePct;

  const sources: FundingSource[] = [
    {
      kind: 'working_capital',
      labelTh: 'เงินที่จมอยู่ในเงินทุนหมุนเวียน',
      availableAmount: totalReleasable,
      annualCostPct: 0,
      nonCashCostTh: null,
      countsTowardPlan: true,
      whyTh: 'เป็นเงินของกิจการเองที่ยังไม่ได้ใช้ ไม่มีดอกเบี้ยและไม่ต้องขออนุมัติจากใคร',
      howToTh: 'เร่งเก็บหนี้และลดสินค้าค้างคลังให้ถึงเกณฑ์ ดูรายละเอียดที่ตารางด้านบน',
      basisTh: 'คำนวณจากงบการเงินจริง เทียบกับเกณฑ์ในทะเบียนอัตราส่วนของระบบ',
      programsTh: [],
    },
    {
      kind: 'grant',
      labelTh: 'เงินให้เปล่า',
      availableAmount: grants.amount,
      annualCostPct: null,
      nonCashCostTh: 'ไม่ต้องคืนเงินต้น แต่ต้องใช้ตามวัตถุประสงค์และมีภาระรายงานผล',
      countsTowardPlan: true,
      whyTh: 'ไม่ต้องคืนเงินต้นและไม่มีดอกเบี้ย จึงเป็นเงินที่ถูกที่สุดรองจากเงินของตัวเอง',
      howToTh: 'ยื่นตามรอบที่ประกาศ เตรียมแผนงานและงบประมาณที่ตรงกับวัตถุประสงค์ของทุน',
      basisTh: 'วงเงินสูงสุดของโครงการเดียวที่กิจการนี้เข้าเกณฑ์',
      programsTh: grants.names,
    },
    {
      kind: 'subsidy',
      labelTh: 'เงินอุดหนุน',
      availableAmount: subsidies.amount,
      annualCostPct: null,
      nonCashCostTh: 'มักต้องร่วมจ่ายบางส่วนและใช้กับรายการที่กำหนดเท่านั้น',
      countsTowardPlan: true,
      whyTh: 'ช่วยลดเงินที่ต้องออกเองสำหรับรายการที่โครงการกำหนด',
      howToTh: 'ตรวจว่ารายการที่จะซื้ออยู่ในขอบเขตที่อุดหนุน แล้วยื่นก่อนเริ่มจ่ายเงิน',
      basisTh: 'วงเงินสูงสุดของโครงการเดียวที่กิจการนี้เข้าเกณฑ์',
      programsTh: subsidies.names,
    },
    {
      kind: 'debt',
      labelTh: 'สินเชื่อ',
      availableAmount: borrowable,
      annualCostPct: debtRatePct,
      nonCashCostTh: null,
      countsTowardPlan: true,
      whyTh: 'ได้เงินก้อนเร็วและไม่เสียสัดส่วนความเป็นเจ้าของ แต่มีภาระผ่อนที่ต้องจ่ายทุกเดือน',
      howToTh: 'เตรียมงบการเงินย้อนหลังและหลักประกัน หรือใช้การค้ำประกันทดแทนหลักประกันที่ไม่มี',
      basisTh: 'วงเงินสูงสุดที่กระแสเงินสดรับไหวที่ DSCR 1.20 คำนวณจากงบและสินเชื่อจริง',
      programsTh: [],
    },
    {
      kind: 'equity',
      labelTh: 'เพิ่มทุน / ร่วมลงทุน',
      availableAmount: equity.amount,
      annualCostPct: null,
      nonCashCostTh: 'ไม่มีดอกเบี้ย แต่ผู้ถือหุ้นเดิมถูกลดสัดส่วนอย่างถาวร',
      countsTowardPlan: true,
      whyTh: 'ไม่เพิ่มภาระผ่อน จึงเหมาะเมื่อ DSCR ตึงจนรับหนี้เพิ่มไม่ไหว',
      howToTh: 'เตรียมแผนธุรกิจและการประเมินมูลค่ากิจการ ใช้เวลานานกว่าการขอสินเชื่อมาก',
      basisTh: 'วงเงินสูงสุดของโครงการเดียวที่กิจการนี้เข้าเกณฑ์',
      programsTh: equity.names,
    },
    {
      kind: 'guarantee',
      labelTh: 'การค้ำประกันสินเชื่อ',
      availableAmount: guarantees.amount,
      annualCostPct: null,
      nonCashCostTh: 'มีค่าธรรมเนียมค้ำประกันรายปี',
      // ไม่ใช่เงิน แต่เป็นตัวปลดเงื่อนไขหลักประกัน ถ้านับรวมจะกลายเป็นการนับเงินซ้ำกับสินเชื่อ
      countsTowardPlan: false,
      whyTh: 'ไม่ได้ให้เงิน แต่ทำให้กู้ได้ทั้งที่ไม่มีหลักประกัน จึงเป็นตัวปลดล็อกสินเชื่อข้างต้น',
      howToTh: 'ขอผ่านธนาคารที่ยื่นกู้ ธนาคารจะเป็นผู้ประสานกับผู้ค้ำประกันให้',
      basisTh: 'วงเงินค้ำประกันสูงสุดของโครงการเดียวที่กิจการนี้เข้าเกณฑ์',
      programsTh: guarantees.names,
    },
  ];

  const needAmount = options.needAmount ?? borrowable;
  const plan = allocate(needAmount, sources);

  const coveredAmount = round2(plan.reduce((sum, step) => sum + step.amount, 0));
  const planAnnualCost = round2(plan.reduce((sum, step) => sum + step.annualCost, 0));

  return {
    smeId: options.smeId,
    fiscalYear: statement.fiscalYear,
    needAmount,
    workingCapital: {
      releases,
      totalReleasable,
      payableDays,
      cashCycleDays:
        receivableDays === null || inventoryDays === null || payableDays === null
          ? null
          : round2(receivableDays + inventoryDays - payableDays),
    },
    sources,
    plan,
    coveredAmount,
    gapAmount: round2(Math.max(0, needAmount - coveredAmount)),
    planAnnualCost,
    /*
     * ต้นทุนถัวเฉลี่ยคิดบนยอดทั้งแผน ไม่ใช่เฉพาะก้อนที่มีดอกเบี้ย
     * ถ้าหารด้วยเฉพาะก้อนที่มีดอกเบี้ย เงินให้เปล่าจะหลุดออกจากตัวหารและตัวเลขที่ได้
     * จะตอบคนละคำถามกับที่คนอ่านคิดว่ากำลังอ่าน ("แผนนี้แพงแค่ไหน")
     */
    blendedCostPct: coveredAmount > 0 ? round2((planAnnualCost / coveredAmount) * 100) : null,
    summaryTh: summarize(needAmount, plan, coveredAmount, totalReleasable, planAnnualCost),
    disclaimerTh:
      'วงเงินของเงินให้เปล่า เงินอุดหนุน และการร่วมลงทุน เป็นวงเงินสูงสุดที่โครงการประกาศไว้ ' +
      'ไม่ใช่จำนวนที่อนุมัติแล้ว การได้รับจริงขึ้นกับการพิจารณาของแต่ละโครงการ ' +
      'ส่วนเงินจากเงินทุนหมุนเวียนต้องใช้เวลาปรับกระบวนการ ไม่ได้มาทันทีในวันเดียว',
  };
}

/** จัดสรรเงินที่ต้องการลงแหล่งต่าง ๆ ตามลำดับต้นทุน ไม่เกินที่แต่ละแหล่งให้ได้ */
export function allocate(need: number, sources: FundingSource[]): FundingPlanStep[] {
  let remaining = Math.max(0, need);
  const steps: FundingPlanStep[] = [];
  let cumulative = 0;

  for (const kind of PECKING_ORDER) {
    if (remaining <= 0) break;
    const source = sources.find((s) => s.kind === kind);
    if (!source || !source.countsTowardPlan || source.availableAmount <= 0) continue;

    const amount = round2(Math.min(remaining, source.availableAmount));
    if (amount <= 0) continue;

    cumulative = round2(cumulative + amount);
    remaining = round2(remaining - amount);
    steps.push({
      kind,
      labelTh: source.labelTh,
      amount,
      cumulativeAmount: cumulative,
      annualCostPct: source.annualCostPct,
      annualCost: round2((amount * (source.annualCostPct ?? 0)) / 100),
    });
  }

  return steps;
}

function summarize(
  need: number,
  plan: FundingPlanStep[],
  covered: number,
  releasable: number,
  annualCost: number,
): string {
  if (need <= 0) {
    return 'ยังไม่ได้ระบุจำนวนเงินที่ต้องการ จึงแสดงเฉพาะแหล่งเงินที่มีให้เลือกและวงเงินของแต่ละแหล่ง';
  }

  const parts = [`ต้องการ ${money(need)}`];

  if (plan.length === 0) {
    parts.push('แต่ยังไม่มีแหล่งเงินใดที่ใช้ได้ในตอนนี้');
    return parts.join(' · ');
  }

  parts.push(
    `แผนนี้ครอบคลุม ${money(covered)} จาก ${plan.length} แหล่ง โดยเริ่มจากแหล่งที่ถูกที่สุดก่อน`,
  );

  if (releasable > 0) {
    const first = plan[0];
    if (first?.kind === 'working_capital') {
      parts.push(
        `${money(first.amount)} แรกมาจากเงินของกิจการเองที่จมอยู่ในลูกหนี้และสินค้าคงเหลือ จึงไม่มีดอกเบี้ย`,
      );
    }
  }

  parts.push(
    annualCost > 0
      ? `ต้นทุนดอกเบี้ยรวมของแผนอยู่ที่ ${money(annualCost)} ต่อปี`
      : 'แผนนี้ไม่มีต้นทุนดอกเบี้ยเลย',
  );

  const gap = round2(need - covered);
  if (gap > 0) parts.push(`ยังขาดอีก ${money(gap)} ที่ยังไม่มีแหล่งรองรับ`);

  return parts.join(' · ');
}
