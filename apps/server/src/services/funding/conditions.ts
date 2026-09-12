/**
 * เงื่อนไขการกู้ — ตอบว่าธุรกิจแบบไหนหาแหล่งเงินได้ง่ายกว่า และตอนนี้ติดอะไรอยู่
 *
 * ทุกตัวเลขมาจากทะเบียนโครงการจริงในฐานข้อมูล ไม่มีค่าที่ตั้งขึ้นเอง: ความเปิดกว้าง
 * ของอุตสาหกรรมคือการนับเงื่อนไขในทะเบียน และ "ถ้าแก้ข้อนี้จะปลดล็อกกี่โครงการ"
 * คือการนับโครงการที่ติดข้อนั้นข้อเดียวจริง ๆ ไม่ใช่คำแนะนำลอย ๆ
 */

import type {
  FundingProgram,
  FundingType,
  Industry,
  IndustryOpenness,
  IndustrySwitch,
  LendingCondition,
  LendingConditionsReport,
  LendingLever,
  LendingOverview,
  LendingProfile,
  LendingRule,
  LendingRuleSummary,
  ProgramOutcome,
} from '@sme/shared';
import { listPrograms } from '../../db/fundingRepo.js';

export const INDUSTRIES: Industry[] = [
  'manufacturing',
  'retail',
  'food',
  'services',
  'logistics',
  'agriculture',
  'tech',
];

export const INDUSTRY_LABEL_TH: Record<Industry, string> = {
  manufacturing: 'การผลิต',
  retail: 'ค้าปลีก',
  food: 'อาหารและเครื่องดื่ม',
  services: 'บริการ',
  logistics: 'ขนส่งและโลจิสติกส์',
  agriculture: 'เกษตร',
  tech: 'เทคโนโลยี',
};

const FUNDING_TYPES: FundingType[] = ['loan', 'grant', 'guarantee', 'equity', 'subsidy'];

const THB = (value: number): string => `฿${Math.round(value).toLocaleString('en-US')}`;

const accepts = (program: FundingProgram, industry: Industry): boolean =>
  program.eligibleIndustries.includes('*') || program.eligibleIndustries.includes(industry);

/** โครงการที่เจาะจงบางอุตสาหกรรม ไม่ใช่โครงการที่เปิดให้ทุกประเภทธุรกิจ */
const isTargeted = (program: FundingProgram, industry: Industry): boolean =>
  !program.eligibleIndustries.includes('*') && program.eligibleIndustries.includes(industry);

/** ตรวจเงื่อนไขทุกข้อของโครงการหนึ่งกับโปรไฟล์ที่กรอก */
export function checkProgram(program: FundingProgram, profile: LendingProfile): ProgramOutcome {
  const conditions: LendingCondition[] = [];

  conditions.push({
    rule: 'industry',
    labelTh: 'ประเภทธุรกิจ',
    passed: accepts(program, profile.industry),
    actual: INDUSTRY_LABEL_TH[profile.industry],
    required: program.eligibleIndustries.includes('*')
      ? 'ทุกประเภทธุรกิจ'
      : program.eligibleIndustries
          .map((key) => INDUSTRY_LABEL_TH[key as Industry] ?? key)
          .join(', '),
  });

  conditions.push({
    rule: 'province',
    labelTh: 'พื้นที่',
    passed:
      program.eligibleProvinces.includes('*') ||
      program.eligibleProvinces.includes(profile.province),
    actual: profile.province,
    required: program.eligibleProvinces.includes('*')
      ? 'ทั่วประเทศ'
      : program.eligibleProvinces.join(', '),
  });

  conditions.push({
    rule: 'years_operating',
    labelTh: 'อายุกิจการ',
    passed: profile.yearsOperating >= program.minYearsOperating,
    actual: `${profile.yearsOperating} ปี`,
    required:
      program.minYearsOperating === 0
        ? 'เปิดใหม่ก็ยื่นได้'
        : `อย่างน้อย ${program.minYearsOperating} ปี`,
  });

  conditions.push({
    rule: 'employees',
    labelTh: 'จำนวนพนักงาน',
    passed: program.maxEmployees === null || profile.employees <= program.maxEmployees,
    actual: `${profile.employees} คน`,
    required: program.maxEmployees === null ? 'ไม่จำกัด' : `ไม่เกิน ${program.maxEmployees} คน`,
  });

  conditions.push({
    rule: 'revenue',
    labelTh: 'รายได้ต่อปี',
    passed: program.maxAnnualRevenue === null || profile.annualRevenue <= program.maxAnnualRevenue,
    actual: THB(profile.annualRevenue),
    required:
      program.maxAnnualRevenue === null ? 'ไม่จำกัด' : `ไม่เกิน ${THB(program.maxAnnualRevenue)}`,
  });

  conditions.push({
    rule: 'dscr',
    labelTh: 'ความสามารถชำระหนี้ (DSCR)',
    passed:
      program.minDscr === null || (profile.dscr !== null && profile.dscr >= program.minDscr),
    actual: profile.dscr === null ? 'ยังไม่ระบุ' : `${profile.dscr.toFixed(2)} เท่า`,
    required: program.minDscr === null ? 'ไม่กำหนด' : `อย่างน้อย ${program.minDscr.toFixed(2)} เท่า`,
  });

  conditions.push({
    rule: 'collateral',
    labelTh: 'หลักประกัน',
    passed: !program.requiresCollateral || profile.hasCollateral,
    actual: profile.hasCollateral ? 'มีหลักประกัน' : 'ไม่มีหลักประกัน',
    required: program.requiresCollateral ? 'ต้องมีหลักประกัน' : 'ไม่ต้องมีหลักประกัน',
  });

  conditions.push({
    rule: 'amount',
    labelTh: 'วงเงิน',
    passed:
      profile.amountNeeded >= program.minAmount && profile.amountNeeded <= program.maxAmount,
    actual: THB(profile.amountNeeded),
    required: `${THB(program.minAmount)} – ${THB(program.maxAmount)}`,
  });

  const failedRules = conditions.filter((c) => !c.passed).map((c) => c.rule);

  return {
    programId: program.id,
    nameTh: program.nameTh,
    provider: program.provider,
    type: program.type,
    eligible: failedRules.length === 0,
    conditions,
    failedRules,
    descriptionTh: program.descriptionTh,
    url: program.url,
  };
}

/**
 * น้ำหนักของคะแนนความเปิดกว้าง
 *
 * กว้างที่สุดคือ "รับอุตสาหกรรมนี้ไหม" รองลงมาคือสองด่านที่ธุรกิจเล็กติดบ่อยที่สุด
 * (หลักประกันและประวัติการดำเนินงาน) ทุกสัดส่วนหารด้วยจำนวนโครงการทั้งหมดเท่ากัน
 * เพื่อให้อุตสาหกรรมที่มีทางเลือกมากกว่าได้คะแนนมากกว่าจริง ๆ ไม่ใช่แค่สัดส่วนสวย
 */
const OPENNESS_WEIGHTS = { accepted: 0.4, noCollateral: 0.25, dayOne: 0.2, noDscr: 0.15 };

export const OPENNESS_FORMULA_TH =
  'คะแนน = 40% × สัดส่วนโครงการที่รับอุตสาหกรรมนี้ + 25% × สัดส่วนที่ไม่ต้องมีหลักประกัน ' +
  '+ 20% × สัดส่วนที่เปิดใหม่ก็ยื่นได้ + 15% × สัดส่วนที่ไม่กำหนด DSCR ' +
  '(ทุกสัดส่วนหารด้วยจำนวนโครงการทั้งหมด คะแนนเต็ม 100 จึงเกิดขึ้นได้ต่อเมื่อทุกโครงการรับโดยไม่มีเงื่อนไขใดเลย)';

export function industryOpenness(
  industry: Industry,
  programs: FundingProgram[] = listPrograms(),
): IndustryOpenness {
  const total = programs.length;
  const open = programs.filter((p) => accepts(p, industry));

  const byType = FUNDING_TYPES.reduce(
    (acc, type) => {
      acc[type] = open.filter((p) => p.type === type).length;
      return acc;
    },
    {} as Record<FundingType, number>,
  );

  const noCollateral = open.filter((p) => !p.requiresCollateral).length;
  const dayOne = open.filter((p) => p.minYearsOperating === 0).length;
  const noDscr = open.filter((p) => p.minDscr === null).length;

  const rates = open.map((p) => p.rateMin).filter((r): r is number => r !== null);
  const rateMaxes = open.map((p) => p.rateMax).filter((r): r is number => r !== null);

  const score =
    total === 0
      ? 0
      : 100 *
        (OPENNESS_WEIGHTS.accepted * (open.length / total) +
          OPENNESS_WEIGHTS.noCollateral * (noCollateral / total) +
          OPENNESS_WEIGHTS.dayOne * (dayOne / total) +
          OPENNESS_WEIGHTS.noDscr * (noDscr / total));

  return {
    industry,
    labelTh: INDUSTRY_LABEL_TH[industry],
    programs: open.length,
    totalPrograms: total,
    targeted: programs.filter((p) => isTargeted(p, industry)).length,
    byType,
    noCollateral,
    dayOne,
    noDscr,
    rateMinPct: rates.length ? Math.min(...rates) : null,
    rateMaxPct: rateMaxes.length ? Math.max(...rateMaxes) : null,
    maxAmount: open.reduce((max, p) => Math.max(max, p.maxAmount), 0),
    opennessScore: Math.round(score),
    targetedProgramsTh: programs.filter((p) => isTargeted(p, industry)).map((p) => p.nameTh),
  };
}

/** ข้อความอธิบายว่าทำไมผู้ให้กู้ถึงดูเงื่อนไขข้อนี้ */
const RULE_META: Record<LendingRule, { labelTh: string; explanationTh: string }> = {
  industry: {
    labelTh: 'ประเภทธุรกิจ',
    explanationTh:
      'บางโครงการตั้งขึ้นเพื่อหนุนอุตสาหกรรมที่รัฐให้ความสำคัญ จึงเปิดรับเฉพาะบางประเภทธุรกิจ ส่วนที่เหลือเปิดให้ทุกประเภท',
  },
  province: {
    labelTh: 'พื้นที่',
    explanationTh: 'โครงการของธนาคารบางแห่งจำกัดเฉพาะจังหวัดที่มีสาขาดูแลหรือพื้นที่เป้าหมายของโครงการ',
  },
  years_operating: {
    labelTh: 'อายุกิจการ',
    explanationTh:
      'ผู้ให้กู้ใช้ประวัติการดำเนินงานแทนหลักฐานว่าธุรกิจอยู่รอดได้จริง ยิ่งเปิดมานาน ยิ่งมีงบการเงินให้ตรวจย้อนหลัง',
  },
  employees: {
    labelTh: 'จำนวนพนักงาน',
    explanationTh: 'ใช้นิยามขนาดกิจการ โครงการสำหรับรายย่อยจะกันกิจการที่ใหญ่เกินเกณฑ์ออก',
  },
  revenue: {
    labelTh: 'รายได้ต่อปี',
    explanationTh: 'อีกตัวที่ใช้นิยามขนาดกิจการ กิจการที่รายได้สูงเกินเกณฑ์ถือว่าเข้าถึงแหล่งเงินปกติได้อยู่แล้ว',
  },
  dscr: {
    labelTh: 'ความสามารถชำระหนี้ (DSCR)',
    explanationTh:
      'กระแสเงินสดจากการดำเนินงานหารด้วยภาระผ่อนทั้งปี ต่ำกว่า 1 เท่าแปลว่าเงินที่หาได้ไม่พอผ่อน จึงเป็นด่านที่ปฏิเสธบ่อยที่สุด',
  },
  collateral: {
    labelTh: 'หลักประกัน',
    explanationTh:
      'ทรัพย์ที่ยึดได้ถ้าผิดนัดชำระ ถ้าไม่มี ยังใช้การค้ำประกันของ บสย. ทดแทนได้ในหลายโครงการ',
  },
  amount: {
    labelTh: 'วงเงิน',
    explanationTh: 'แต่ละโครงการมีช่วงวงเงินของตัวเอง ขอน้อยหรือมากเกินช่วงก็ไม่เข้าเกณฑ์ แม้คุณสมบัติอื่นจะผ่าน',
  },
};

const unique = (values: string[]): string[] => [...new Set(values)];

function ruleSummary(rule: LendingRule, programs: FundingProgram[]): LendingRuleSummary {
  const meta = RULE_META[rule];
  let constrained: FundingProgram[];
  let thresholdsTh: string[];

  switch (rule) {
    case 'industry':
      constrained = programs.filter((p) => !p.eligibleIndustries.includes('*'));
      thresholdsTh = unique(
        constrained.map((p) =>
          p.eligibleIndustries.map((k) => INDUSTRY_LABEL_TH[k as Industry] ?? k).join(', '),
        ),
      );
      break;
    case 'province':
      constrained = programs.filter((p) => !p.eligibleProvinces.includes('*'));
      thresholdsTh = unique(
        constrained.map((p) => `${p.eligibleProvinces.length} จังหวัด: ${p.eligibleProvinces.join(', ')}`),
      );
      break;
    case 'years_operating':
      constrained = programs.filter((p) => p.minYearsOperating > 0);
      thresholdsTh = unique(
        [...constrained]
          .sort((a, b) => a.minYearsOperating - b.minYearsOperating)
          .map((p) => `อย่างน้อย ${p.minYearsOperating} ปี`),
      );
      break;
    case 'employees':
      constrained = programs.filter((p) => p.maxEmployees !== null);
      thresholdsTh = unique(
        [...constrained]
          .sort((a, b) => b.maxEmployees! - a.maxEmployees!)
          .map((p) => `ไม่เกิน ${p.maxEmployees} คน`),
      );
      break;
    case 'revenue':
      constrained = programs.filter((p) => p.maxAnnualRevenue !== null);
      thresholdsTh = unique(
        [...constrained]
          .sort((a, b) => b.maxAnnualRevenue! - a.maxAnnualRevenue!)
          .map((p) => `ไม่เกิน ${THB(p.maxAnnualRevenue!)} ต่อปี`),
      );
      break;
    case 'dscr':
      constrained = programs.filter((p) => p.minDscr !== null);
      thresholdsTh = unique(
        [...constrained]
          .sort((a, b) => a.minDscr! - b.minDscr!)
          .map((p) => `อย่างน้อย ${p.minDscr!.toFixed(2)} เท่า`),
      );
      break;
    case 'collateral':
      constrained = programs.filter((p) => p.requiresCollateral);
      thresholdsTh = constrained.length ? ['ต้องมีหลักประกัน'] : [];
      break;
    case 'amount':
      constrained = programs;
      thresholdsTh = programs.length
        ? [
            `วงเงินต่ำสุดที่มีโครงการรองรับ ${THB(Math.min(...programs.map((p) => p.minAmount)))}`,
            `วงเงินสูงสุดที่มีโครงการรองรับ ${THB(Math.max(...programs.map((p) => p.maxAmount)))}`,
          ]
        : [];
      break;
  }

  return {
    rule,
    labelTh: meta.labelTh,
    explanationTh: meta.explanationTh,
    programsWithRule: constrained.length,
    totalPrograms: programs.length,
    thresholdsTh,
  };
}

const RULE_ORDER: LendingRule[] = [
  'industry',
  'years_operating',
  'dscr',
  'collateral',
  'revenue',
  'employees',
  'amount',
  'province',
];

/** ข้อมูลที่อ่านได้ก่อนกรอกโปรไฟล์ — ความเปิดกว้างรายอุตสาหกรรมและเงื่อนไขมาตรฐาน */
export function lendingOverview(): LendingOverview {
  const programs = listPrograms();
  return {
    totalPrograms: programs.length,
    industries: INDUSTRIES.map((industry) => industryOpenness(industry, programs)).sort(
      (a, b) => b.opennessScore - a.opennessScore,
    ),
    rules: RULE_ORDER.map((rule) => ruleSummary(rule, programs)),
    opennessFormulaTh: OPENNESS_FORMULA_TH,
  };
}

/**
 * แผนการแก้เงื่อนไขหนึ่งข้อ: เกณฑ์ที่ต้องไปให้ถึง สิ่งที่ต้องทำ และโปรไฟล์หลังแก้
 *
 * patch คือสิ่งที่ทำให้ตัวเลขเชื่อถือได้ — แทนที่จะนับว่า "น่าจะปลดล็อกเท่าไร"
 * ระบบเอา patch ไปทับโปรไฟล์แล้วตรวจเงื่อนไขใหม่ทั้งทะเบียน จำนวนที่รายงานจึงเป็น
 * ผลที่จะเกิดขึ้นจริงถ้าแก้ได้ถึงเกณฑ์นั้น ไม่ใช่ค่าที่ประมาณเอา
 */
interface LeverPlan {
  targetTh: string;
  actionTh: string;
  patch: Partial<LendingProfile>;
}

/** เกณฑ์ที่ผ่อนปรนที่สุดในกลุ่มที่อ้างอิง เพราะแก้ถึงจุดนั้นก็เริ่มปลดล็อกได้แล้ว */
function leverPlan(
  rule: Exclude<LendingRule, 'industry'>,
  basis: FundingProgram[],
  profile: LendingProfile,
  netGain?: (patch: Partial<LendingProfile>) => number,
): LeverPlan {
  switch (rule) {
    case 'province': {
      const provinces = unique(basis.flatMap((p) => p.eligibleProvinces));
      return {
        targetTh: provinces.join(', '),
        actionTh: `โครงการกลุ่มนี้ดูแลเฉพาะ ${provinces.join(', ')} — ถ้าไม่ได้อยู่ในพื้นที่ ให้มองโครงการที่เปิดทั่วประเทศแทน`,
        patch: { province: provinces[0]! },
      };
    }
    case 'years_operating': {
      const needed = Math.min(...basis.map((p) => p.minYearsOperating));
      return {
        targetTh: `อย่างน้อย ${needed} ปี`,
        actionTh: `ดำเนินกิจการอีก ${needed - profile.yearsOperating} ปีให้ครบ ${needed} ปี (ตอนนี้ ${profile.yearsOperating} ปี) ระหว่างนี้เก็บงบการเงินและรายการเดินบัญชีไว้ให้ครบ เพราะเป็นสิ่งที่ผู้ให้กู้จะขอดูย้อนหลัง`,
        patch: { yearsOperating: needed },
      };
    }
    case 'dscr': {
      const needed = Math.min(...basis.map((p) => p.minDscr ?? Number.POSITIVE_INFINITY));
      return {
        targetTh: `อย่างน้อย ${needed.toFixed(2)} เท่า`,
        actionTh:
          profile.dscr === null
            ? `ยังไม่ได้ระบุ DSCR — คำนวณจากกระแสเงินสดจากการดำเนินงานหารภาระผ่อนทั้งปี แล้วทำให้ถึง ${needed.toFixed(2)} เท่า`
            : `ยกระดับ DSCR จาก ${profile.dscr.toFixed(2)} เป็น ${needed.toFixed(2)} เท่า ทำได้สองทาง: เพิ่มกำไรจากการดำเนินงาน หรือยืดงวดผ่อนให้ภาระต่อปีลดลง`,
        patch: { dscr: needed },
      };
    }
    case 'employees': {
      const limit = Math.max(...basis.map((p) => p.maxEmployees ?? 0));
      return {
        targetTh: `ไม่เกิน ${limit} คน`,
        actionTh: `โครงการกลุ่มนี้สงวนไว้ให้กิจการไม่เกิน ${limit} คน แต่ตอนนี้มี ${profile.employees} คน — ถ้าไม่ลดขนาดทีม ให้มองโครงการที่ไม่จำกัดจำนวนพนักงานแทน`,
        patch: { employees: limit },
      };
    }
    case 'revenue': {
      const limit = Math.max(...basis.map((p) => p.maxAnnualRevenue ?? 0));
      return {
        targetTh: `ไม่เกิน ${THB(limit)} ต่อปี`,
        actionTh: `โครงการกลุ่มนี้สงวนไว้ให้กิจการรายได้ไม่เกิน ${THB(limit)} ต่อปี แต่รายได้ปัจจุบัน ${THB(profile.annualRevenue)} สูงกว่าเกณฑ์ — กิจการขนาดนี้ถือว่าเข้าถึงสินเชื่อพาณิชย์ตามปกติได้แล้ว`,
        patch: { annualRevenue: limit },
      };
    }
    case 'collateral':
      return {
        targetTh: 'ต้องมีหลักประกัน',
        actionTh:
          'จัดหาหลักประกัน (ที่ดิน อาคาร เครื่องจักร) หรือใช้โครงการค้ำประกันของ บสย. เข้ามาแทนหลักประกันที่ไม่มี',
        patch: { hasCollateral: true },
      };
    case 'amount': {
      /*
       * วงเงินเป็นช่วง ไม่ใช่เกณฑ์ที่ยิ่งมากหรือยิ่งน้อยยิ่งง่าย การหยิบช่วงที่ใกล้ที่สุดจึง
       * พลาดค่าที่ปลดล็อกได้มากกว่า และการขยับวงเงินยังทำให้โครงการที่ผ่านอยู่หลุดได้ด้วย
       * ข้อนี้จึงลองทุกขอบของช่วงที่มีจริง แล้วเลือกค่าที่ได้ผลรวมดีที่สุด
       */
      const candidates = unique(
        basis.flatMap((program) => [program.minAmount, program.maxAmount]).map(String),
      ).map(Number);

      const best = candidates
        .map((amount) => ({ amount, gain: netGain?.({ amountNeeded: amount }) ?? 0 }))
        .sort(
          (a, b) =>
            b.gain - a.gain ||
            Math.abs(a.amount - profile.amountNeeded) - Math.abs(b.amount - profile.amountNeeded),
        )[0];

      const nearest = [...basis].sort(
        (a, b) => distanceToBand(profile.amountNeeded, a) - distanceToBand(profile.amountNeeded, b),
      )[0]!;
      const target =
        best && best.gain > 0
          ? best.amount
          : clamp(profile.amountNeeded, nearest.minAmount, nearest.maxAmount);

      return {
        targetTh: THB(target),
        actionTh: `ปรับวงเงินที่ขอจาก ${THB(profile.amountNeeded)} เป็น ${THB(target)} หรือแบ่งขอหลายโครงการให้แต่ละก้อนอยู่ในช่วงที่โครงการนั้นรับ`,
        patch: { amountNeeded: target },
      };
    }
  }
}

function distanceToBand(amount: number, program: FundingProgram): number {
  if (amount < program.minAmount) return program.minAmount - amount;
  if (amount > program.maxAmount) return amount - program.maxAmount;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function currentValue(rule: LendingRule, profile: LendingProfile): string {
  switch (rule) {
    case 'industry':
      return INDUSTRY_LABEL_TH[profile.industry];
    case 'province':
      return profile.province;
    case 'years_operating':
      return `${profile.yearsOperating} ปี`;
    case 'employees':
      return `${profile.employees} คน`;
    case 'revenue':
      return `${THB(profile.annualRevenue)} ต่อปี`;
    case 'dscr':
      return profile.dscr === null ? 'ยังไม่ระบุ' : `${profile.dscr.toFixed(2)} เท่า`;
    case 'collateral':
      return profile.hasCollateral ? 'มีหลักประกัน' : 'ไม่มีหลักประกัน';
    case 'amount':
      return THB(profile.amountNeeded);
  }
}

/**
 * เงื่อนไขที่ขวางอยู่ เรียงตามจำนวนโครงการที่จะปลดล็อกได้จริงถ้าแก้ข้อนั้นข้อเดียว
 *
 * ไม่มี 'industry' ในรายการนี้เพราะการเปลี่ยนประเภทธุรกิจไม่ใช่สิ่งที่ทำเพื่อให้กู้ผ่าน
 * — คำถามนั้นตอบด้วยตารางเทียบทุกอุตสาหกรรม (industrySwitches) ซึ่งบอกได้ครบกว่า
 */
export function computeLevers(
  outcomes: ProgramOutcome[],
  programs: FundingProgram[],
  profile: LendingProfile,
): LendingLever[] {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const eligibleNow = new Set(outcomes.filter((o) => o.eligible).map((o) => o.programId));

  const levers = RULE_ORDER.filter((rule) => rule !== 'industry').flatMap((rule): LendingLever[] => {
    const blocked = outcomes.filter((o) => o.failedRules.includes(rule));
    if (blocked.length === 0) return [];

    // อ้างอิงเกณฑ์จากกลุ่มที่ติดข้อนี้ข้อเดียวก่อน เพราะเป็นกลุ่มที่แก้แล้วผ่านทันที
    const single = blocked.filter((o) => o.failedRules.length === 1);
    const basis = (single.length > 0 ? single : blocked)
      .map((o) => byId.get(o.programId))
      .filter((p): p is FundingProgram => p !== undefined);

    const netGain = (patch: Partial<LendingProfile>): number =>
      programs.filter((program) => checkProgram(program, { ...profile, ...patch }).eligible).length -
      eligibleNow.size;

    const plan = leverPlan(rule as Exclude<LendingRule, 'industry'>, basis, profile, netGain);

    // ตรวจใหม่ทั้งทะเบียนด้วยโปรไฟล์ที่แก้แล้ว จำนวนที่ได้จึงเป็นผลจริงของเกณฑ์ที่เสนอ
    const fixed = { ...profile, ...plan.patch };
    const after = programs.filter((program) => checkProgram(program, fixed).eligible);
    const unlocked = after.filter((program) => !eligibleNow.has(program.id));
    const lost = programs.filter(
      (program) => eligibleNow.has(program.id) && !after.some((kept) => kept.id === program.id),
    );

    // บางเงื่อนไข (เช่น วงเงิน) ขยับแล้วทำให้โครงการที่ผ่านอยู่หลุดไปด้วย
    // ตัวเลขที่รายงานจึงต้องเป็นผลสุทธิ ไม่ใช่นับเฉพาะที่ได้เพิ่ม
    const net = after.length - eligibleNow.size;
    const costNote =
      lost.length === 0 ? '' : ` แต่จะทำให้หลุดจาก ${lost.map((p) => p.nameTh).join(', ')}`;

    return [
      {
        rule,
        labelTh: RULE_META[rule].labelTh,
        blocking: blocked.length,
        unlocks: net,
        currentTh: currentValue(rule, profile),
        targetTh: plan.targetTh,
        // เมื่อแก้ข้อเดียวแล้วยังไม่ปลดล็อกอะไร การเสนอเป้าหมายเฉย ๆ ทำให้เข้าใจผิดว่าทำแล้วได้ผล
        // จึงบอกแทนว่าต้องแก้ข้อไหนควบไปด้วย ซึ่งอ่านจากเงื่อนไขที่ค้างอยู่จริงของกลุ่มนั้น
        actionTh: net > 0 ? `${plan.actionTh}${costNote}` : blockedTogether(rule, blocked),
        unlockedProgramsTh: unlocked.map((p) => p.nameTh),
      },
    ];
  });

  return levers.sort((a, b) => b.unlocks - a.unlocks || b.blocking - a.blocking);
}

/** เงื่อนไขที่ค้างอยู่ควบกับข้อนี้ เรียงจากที่ขวางบ่อยที่สุด */
function blockedTogether(rule: LendingRule, blocked: ProgramOutcome[]): string {
  const counts = new Map<LendingRule, number>();
  for (const outcome of blocked) {
    for (const other of outcome.failedRules) {
      if (other !== rule) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }

  const together = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([other, count]) => `${RULE_META[other].labelTh} (${count} โครงการ)`);

  return together.length === 0
    ? `ข้อนี้ขวางอยู่ ${blocked.length} โครงการ แต่ทุกโครงการยังติดเงื่อนไขอื่นด้วย`
    : `แก้ข้อนี้อย่างเดียวยังไม่ปลดล็อกโครงการใด เพราะ ${blocked.length} โครงการที่ติดอยู่ยังค้างเงื่อนไขอื่นควบด้วย: ${together.join(' · ')}`;
}

/** รายงานเต็มสำหรับโปรไฟล์หนึ่ง */
export function lendingConditions(profile: LendingProfile): LendingConditionsReport {
  const programs = listPrograms();
  const outcomes = programs
    .map((program) => checkProgram(program, profile))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return a.failedRules.length - b.failedRules.length;
    });

  const eligiblePrograms = outcomes.filter((o) => o.eligible).length;

  const industrySwitches: IndustrySwitch[] = INDUSTRIES.map((industry) => {
    const count = programs.filter(
      (program) => checkProgram(program, { ...profile, industry }).eligible,
    ).length;
    return {
      industry,
      labelTh: INDUSTRY_LABEL_TH[industry],
      eligiblePrograms: count,
      delta: count - eligiblePrograms,
      current: industry === profile.industry,
    };
  }).sort((a, b) => b.eligiblePrograms - a.eligiblePrograms);

  const levers = computeLevers(outcomes, programs, profile);

  return {
    profile,
    totalPrograms: programs.length,
    eligiblePrograms,
    outcomes,
    levers,
    industry: industryOpenness(profile.industry, programs),
    industrySwitches,
    summaryTh: summarize(profile, eligiblePrograms, programs.length, levers, industrySwitches),
    disclaimerTh:
      'ผลนี้คือการตรวจเงื่อนไขที่แต่ละโครงการประกาศไว้เท่านั้น ไม่ใช่การอนุมัติ ' +
      'ผู้ให้กู้ยังพิจารณาประวัติเครดิต งบการเงินย้อนหลัง และหลักฐานรายได้ประกอบด้วยเสมอ',
  };
}

function summarize(
  profile: LendingProfile,
  eligible: number,
  total: number,
  levers: LendingLever[],
  switches: IndustrySwitch[],
): string {
  const parts = [
    `ธุรกิจ${INDUSTRY_LABEL_TH[profile.industry]}ตามตัวเลขที่กรอก ผ่านเงื่อนไข ${eligible} จาก ${total} โครงการ`,
  ];

  const best = levers.find((lever) => lever.unlocks > 0);
  if (best) {
    parts.push(`แก้เรื่อง${best.labelTh}ให้ถึง "${best.targetTh}" จะปลดล็อกเพิ่มอีก ${best.unlocks} โครงการ`);
  } else if (levers.length > 0) {
    parts.push(
      `ทุกโครงการที่เหลือติดเงื่อนไขมากกว่าหนึ่งข้อ แก้ข้อเดียวจึงยังไม่ปลดล็อกเพิ่ม (${levers[0]!.labelTh}ขวางอยู่ ${levers[0]!.blocking} โครงการ)`,
    );
  } else if (eligible === total) {
    parts.push('ไม่มีเงื่อนไขใดขวางอยู่');
  }

  const bestIndustry = switches[0];
  if (bestIndustry && !bestIndustry.current && bestIndustry.delta > 0) {
    parts.push(
      `ถ้าตัวเลขอื่นเท่าเดิมแต่เป็นธุรกิจ${bestIndustry.labelTh} จะผ่าน ${bestIndustry.eligiblePrograms} โครงการ (มากกว่าปัจจุบัน ${bestIndustry.delta})`,
    );
  }

  return parts.join(' · ');
}
