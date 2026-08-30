/**
 * ตัวสร้างข้อมูลกิจการจำนวนมากแบบ deterministic
 *
 * ทำไมต้องสร้าง ไม่เขียนมือ: ต้องการกิจการหลักพันรายเพื่อให้ช่องค้นหาและการจับคู่
 * แหล่งเงินทุนมีของให้ทำงานจริง การเขียนมือทั้งหมดเป็นไปไม่ได้
 *
 * ข้อกำหนดที่ตัวสร้างนี้ต้องรักษาไว้ (มีเทสต์ตรวจทุกข้อ):
 *  1. งบดุลของทุกกิจการทุกปี "สมดุลจริง" — ส่วนของผู้ถือหุ้นถูกคำนวณจาก
 *     สินทรัพย์รวม ลบ หนี้สินรวม จึงสมดุลโดยโครงสร้าง ไม่ใช่โดยบังเอิญ
 *  2. ดอกเบี้ยจ่ายคิดจากยอดหนี้ที่มีดอกเบี้ยจริงในงบปีนั้น ไม่ใช่ตัวเลขสุ่มลอย ๆ
 *     อัตราส่วนอย่างความสามารถจ่ายดอกเบี้ยจึงมีความหมาย
 *  3. ยอดคงค้างของสินเชื่อที่สร้างให้ รวมแล้วเท่ากับหนี้ที่มีดอกเบี้ยในงบพอดี
 *  4. ค่าเดิมเสมอสำหรับ seed เดิม — ฐานข้อมูลที่สร้างใหม่จะได้ข้อมูลชุดเดิมทุกครั้ง
 *
 * ข้อจำกัดที่ยอมรับไว้: กำไรสะสมไม่ได้ยกยอดข้ามปีแบบบัญชีจริง ๆ (ซึ่งต้องมีแบบจำลอง
 * กระแสเงินสดเต็มรูป) แต่เคลื่อนไปตามส่วนของผู้ถือหุ้นที่โตตามสินทรัพย์ เรื่องราวรายปี
 * จึงยังอ่านได้สมเหตุสมผล
 */

import type { Industry } from '@sme/shared';

/** ตัวสุ่มแบบ deterministic (mulberry32) — seed เดิมได้ลำดับเดิมเสมอ */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** ลักษณะทางการเงินของแต่ละอุตสาหกรรม — ช่วงที่พบได้จริงในธุรกิจไทย */
interface IndustryShape {
  grossMargin: [number, number];
  /** ค่าใช้จ่ายดำเนินงานเป็นสัดส่วนของรายได้ */
  opexRatio: [number, number];
  receivableDays: [number, number];
  inventoryDays: [number, number];
  payableDays: [number, number];
  /** สินทรัพย์ถาวรเป็นสัดส่วนของสินทรัพย์รวม */
  fixedShare: [number, number];
  /** รายได้ต่อปี (ล้านบาท) */
  revenueMillions: [number, number];
  employeesPerMillion: [number, number];
}

const INDUSTRY_SHAPES: Record<Industry, IndustryShape> = {
  manufacturing: {
    grossMargin: [0.18, 0.34],
    opexRatio: [0.1, 0.2],
    receivableDays: [45, 95],
    inventoryDays: [60, 140],
    payableDays: [40, 85],
    fixedShare: [0.35, 0.6],
    revenueMillions: [18, 320],
    employeesPerMillion: [0.25, 0.6],
  },
  retail: {
    grossMargin: [0.14, 0.28],
    opexRatio: [0.08, 0.18],
    receivableDays: [5, 25],
    inventoryDays: [55, 130],
    payableDays: [35, 75],
    fixedShare: [0.25, 0.45],
    revenueMillions: [8, 180],
    employeesPerMillion: [0.25, 0.7],
  },
  food: {
    grossMargin: [0.26, 0.44],
    opexRatio: [0.18, 0.3],
    receivableDays: [25, 65],
    inventoryDays: [20, 60],
    payableDays: [30, 65],
    fixedShare: [0.3, 0.55],
    revenueMillions: [10, 160],
    employeesPerMillion: [0.35, 0.9],
  },
  services: {
    grossMargin: [0.35, 0.62],
    opexRatio: [0.26, 0.46],
    receivableDays: [40, 90],
    inventoryDays: [0, 15],
    payableDays: [20, 50],
    fixedShare: [0.15, 0.35],
    revenueMillions: [5, 120],
    employeesPerMillion: [0.5, 1.4],
  },
  logistics: {
    grossMargin: [0.16, 0.3],
    opexRatio: [0.09, 0.18],
    receivableDays: [35, 80],
    inventoryDays: [3, 20],
    payableDays: [25, 60],
    fixedShare: [0.45, 0.7],
    revenueMillions: [12, 200],
    employeesPerMillion: [0.3, 0.8],
  },
  agriculture: {
    grossMargin: [0.18, 0.32],
    opexRatio: [0.08, 0.17],
    receivableDays: [20, 60],
    inventoryDays: [45, 120],
    payableDays: [25, 60],
    fixedShare: [0.4, 0.68],
    revenueMillions: [6, 140],
    employeesPerMillion: [0.3, 0.9],
  },
  tech: {
    grossMargin: [0.5, 0.78],
    opexRatio: [0.36, 0.62],
    receivableDays: [40, 95],
    inventoryDays: [0, 20],
    payableDays: [20, 45],
    fixedShare: [0.12, 0.3],
    revenueMillions: [4, 90],
    employeesPerMillion: [0.6, 1.6],
  },
};

const INDUSTRIES = Object.keys(INDUSTRY_SHAPES) as Industry[];

/** ชิ้นส่วนชื่อกิจการ แยกตามอุตสาหกรรมเพื่อให้ชื่ออ่านแล้วเดาธุรกิจได้ */
const NAME_HEADS: { th: string; en: string }[] = [
  { th: 'สยาม', en: 'Siam' },
  { th: 'ไทย', en: 'Thai' },
  { th: 'เอเชีย', en: 'Asia' },
  { th: 'บูรพา', en: 'Burapha' },
  { th: 'นครหลวง', en: 'Nakhonluang' },
  { th: 'ทรัพย์เจริญ', en: 'Sapcharoen' },
  { th: 'มิตรภาพ', en: 'Mittraphap' },
  { th: 'ศรีสุข', en: 'Srisuk' },
  { th: 'รุ่งเรือง', en: 'Rungrueang' },
  { th: 'เจริญชัย', en: 'Charoenchai' },
  { th: 'พงษ์ทวี', en: 'Pongtawee' },
  { th: 'ยูไนเต็ด', en: 'United' },
  { th: 'โกลเด้น', en: 'Golden' },
  { th: 'เกรทเทอร์', en: 'Greater' },
  { th: 'อีสาน', en: 'Isan' },
  { th: 'ล้านนา', en: 'Lanna' },
  { th: 'อันดามัน', en: 'Andaman' },
  { th: 'สุวรรณ', en: 'Suwan' },
  { th: 'ธนกิจ', en: 'Thanakit' },
  { th: 'วัฒนา', en: 'Wattana' },
  { th: 'ประเสริฐ', en: 'Prasert' },
  { th: 'กิจไพศาล', en: 'Kitpaisan' },
  { th: 'ชัยมงคล', en: 'Chaimongkol' },
  { th: 'เพชรรัตน์', en: 'Phetcharat' },
  { th: 'อุดมทรัพย์', en: 'Udomsap' },
  { th: 'ไพบูลย์', en: 'Paiboon' },
  { th: 'สหกิจ', en: 'Sahakit' },
  { th: 'เมธา', en: 'Metha' },
  { th: 'จินดา', en: 'Chinda' },
  { th: 'ภูมิพัฒน์', en: 'Phumiphat' },
  { th: 'ตะวันออก', en: 'Tawan-ok' },
  { th: 'พรีเมียร์', en: 'Premier' },
  { th: 'แปซิฟิก', en: 'Pacific' },
  { th: 'อีสเทิร์น', en: 'Eastern' },
  { th: 'เวสเทิร์น', en: 'Western' },
  { th: 'นอร์เทิร์น', en: 'Northern' },
  { th: 'เซาท์เทิร์น', en: 'Southern' },
  { th: 'เมกะ', en: 'Mega' },
  { th: 'ไพร์ม', en: 'Prime' },
];

/** คำขยายที่แทรกกลางชื่อ ทำให้ชื่อไม่ซ้ำกันแม้มีกิจการหลักพันราย */
const NAME_QUALIFIERS: { th: string; en: string }[] = [
  { th: '', en: '' },
  { th: '', en: '' },
  { th: 'อินเตอร์', en: 'Inter' },
  { th: 'กรุ๊ป', en: 'Group' },
  { th: 'เอ็นเตอร์ไพรส์', en: 'Enterprise' },
  { th: 'พลัส', en: 'Plus' },
  { th: 'โกลบอล', en: 'Global' },
  { th: 'แอดวานซ์', en: 'Advance' },
  { th: 'ซินเนอร์จี้', en: 'Synergy' },
  { th: 'สมาร์ท', en: 'Smart' },
];

const NAME_TAILS: Record<Industry, { th: string; en: string }[]> = {
  manufacturing: [
    { th: 'อุตสาหกรรม', en: 'Industry' },
    { th: 'การผลิต', en: 'Manufacturing' },
    { th: 'เอ็นจิเนียริ่ง', en: 'Engineering' },
    { th: 'โลหะกิจ', en: 'Metalworks' },
    { th: 'พลาสติก', en: 'Plastics' },
  ],
  retail: [
    { th: 'สโตร์', en: 'Store' },
    { th: 'พาณิชย์', en: 'Commercial' },
    { th: 'มาร์ท', en: 'Mart' },
    { th: 'ค้าปลีก', en: 'Retail' },
    { th: 'ซัพพลาย', en: 'Supply' },
  ],
  food: [
    { th: 'ฟู้ดส์', en: 'Foods' },
    { th: 'อาหาร', en: 'Food Products' },
    { th: 'เบเกอรี่', en: 'Bakery' },
    { th: 'ครัวไทย', en: 'Thai Kitchen' },
    { th: 'เครื่องดื่ม', en: 'Beverage' },
  ],
  services: [
    { th: 'เซอร์วิส', en: 'Service' },
    { th: 'คอนซัลติ้ง', en: 'Consulting' },
    { th: 'บริการ', en: 'Services' },
    { th: 'แมเนจเมนท์', en: 'Management' },
    { th: 'พร็อพเพอร์ตี้', en: 'Property' },
  ],
  logistics: [
    { th: 'ขนส่ง', en: 'Transport' },
    { th: 'โลจิสติกส์', en: 'Logistics' },
    { th: 'เอ็กซ์เพรส', en: 'Express' },
    { th: 'ทรานสปอร์ต', en: 'Transportation' },
    { th: 'คาร์โก้', en: 'Cargo' },
  ],
  agriculture: [
    { th: 'การเกษตร', en: 'Agriculture' },
    { th: 'ฟาร์ม', en: 'Farm' },
    { th: 'เกษตรภัณฑ์', en: 'Agri Products' },
    { th: 'สวนผลไม้', en: 'Orchard' },
    { th: 'ประมง', en: 'Fishery' },
  ],
  tech: [
    { th: 'เทคโนโลยี', en: 'Technology' },
    { th: 'ซอฟต์แวร์', en: 'Software' },
    { th: 'โซลูชั่น', en: 'Solutions' },
    { th: 'ดิจิทัล', en: 'Digital' },
    { th: 'อินโนเวชั่น', en: 'Innovation' },
  ],
};

/** จังหวัดที่มี SME หนาแน่น พร้อมน้ำหนักคร่าว ๆ ตามความหนาแน่นจริง */
const PROVINCES: { th: string; weight: number }[] = [
  { th: 'กรุงเทพมหานคร', weight: 18 },
  { th: 'สมุทรปราการ', weight: 6 },
  { th: 'นนทบุรี', weight: 5 },
  { th: 'ปทุมธานี', weight: 5 },
  { th: 'สมุทรสาคร', weight: 4 },
  { th: 'นครปฐม', weight: 4 },
  { th: 'ชลบุรี', weight: 6 },
  { th: 'ระยอง', weight: 3 },
  { th: 'พระนครศรีอยุธยา', weight: 3 },
  { th: 'ฉะเชิงเทรา', weight: 2 },
  { th: 'เชียงใหม่', weight: 5 },
  { th: 'เชียงราย', weight: 2 },
  { th: 'ลำพูน', weight: 1 },
  { th: 'พิษณุโลก', weight: 2 },
  { th: 'นครสวรรค์', weight: 2 },
  { th: 'ขอนแก่น', weight: 4 },
  { th: 'นครราชสีมา', weight: 4 },
  { th: 'อุดรธานี', weight: 3 },
  { th: 'อุบลราชธานี', weight: 2 },
  { th: 'บุรีรัมย์', weight: 2 },
  { th: 'สุรินทร์', weight: 1 },
  { th: 'สงขลา', weight: 4 },
  { th: 'ภูเก็ต', weight: 3 },
  { th: 'สุราษฎร์ธานี', weight: 3 },
  { th: 'นครศรีธรรมราช', weight: 2 },
  { th: 'กระบี่', weight: 1 },
  { th: 'ตรัง', weight: 1 },
  { th: 'ราชบุรี', weight: 2 },
  { th: 'กาญจนบุรี', weight: 2 },
  { th: 'ประจวบคีรีขันธ์', weight: 1 },
];

const PROVINCE_TOTAL_WEIGHT = PROVINCES.reduce((sum, p) => sum + p.weight, 0);

function pickProvince(rng: Rng): string {
  let roll = rng() * PROVINCE_TOTAL_WEIGHT;
  for (const province of PROVINCES) {
    roll -= province.weight;
    if (roll <= 0) return province.th;
  }
  return PROVINCES[0]!.th;
}

const LENDERS = [
  'ธนาคารกรุงเทพ',
  'ธนาคารกสิกรไทย',
  'ธนาคารไทยพาณิชย์',
  'ธนาคารกรุงไทย',
  'ธนาคารกรุงศรีอยุธยา',
  'ธนาคารทหารไทยธนชาต',
  'ธนาคารออมสิน',
  'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม',
  'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',
  'ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย',
];

export interface GeneratedStatement {
  fiscalYear: number;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  depreciation: number;
  interestExpense: number;
  tax: number;
  cash: number;
  accountsReceivable: number;
  inventory: number;
  otherCurrentAssets: number;
  fixedAssets: number;
  accountsPayable: number;
  shortTermDebt: number;
  otherCurrentLiabilities: number;
  longTermDebt: number;
  equityPaidUp: number;
  retainedEarnings: number;
}

export interface GeneratedLoan {
  lender: string;
  product: string;
  principal: number;
  outstanding: number;
  rateType: string;
  rateValue: number;
  termMonths: number;
  remainingMonths: number;
  startDate: string;
}

export interface GeneratedSme {
  id: string;
  nameTh: string;
  nameEn: string;
  registrationNo: string;
  industry: Industry;
  province: string;
  foundedYear: number;
  employees: number;
  fxExposureCurrency: string | null;
  fxAnnualExposure: number;
  statements: GeneratedStatement[];
  loans: GeneratedLoan[];
}

export interface GenerateOptions {
  count?: number;
  seed?: number;
  /** ปีบัญชีล่าสุดที่จะสร้าง (สร้างย้อนหลังรวม 3 ปี) */
  latestFiscalYear?: number;
}

/**
 * สร้างงบหนึ่งปีให้สมดุลโดยโครงสร้าง
 *
 * ลำดับสำคัญ: สร้างฝั่งสินทรัพย์ก่อน → กำหนดหนี้สินจากอัตราส่วนหนี้ → ส่วนของผู้ถือหุ้น
 * คือส่วนต่างที่เหลือ จึงไม่มีทางไม่สมดุล จากนั้นค่อยคิดดอกเบี้ยจากหนี้ที่มีดอกเบี้ยจริง
 */
function buildStatement(
  rng: Rng,
  shape: IndustryShape,
  input: {
    fiscalYear: number;
    revenue: number;
    leverage: number;
    paidUpCapital: number;
    borrowingRatePct: number;
  },
): GeneratedStatement {
  const revenue = Math.round(input.revenue);
  const grossMargin = between(rng, shape.grossMargin[0], shape.grossMargin[1]);
  const cogs = Math.round(revenue * (1 - grossMargin));

  // ── ฝั่งสินทรัพย์: ผูกกับรายได้และต้นทุนขายผ่านจำนวนวันหมุนเวียน ──────────
  const receivableDays = between(rng, shape.receivableDays[0], shape.receivableDays[1]);
  const inventoryDays = between(rng, shape.inventoryDays[0], shape.inventoryDays[1]);
  const accountsReceivable = Math.round((revenue * receivableDays) / 365);
  const inventory = Math.round((cogs * inventoryDays) / 365);
  const otherCurrentAssets = Math.round(revenue * between(rng, 0.004, 0.02));

  const fixedShare = between(rng, shape.fixedShare[0], shape.fixedShare[1]);
  // เงินสดเป็นตัวปรับสมดุล: กำหนดเป็นจำนวนเดือนของค่าใช้จ่ายที่ถือไว้
  const cashMonths = between(rng, 0.4, 3.2);
  const monthlyCosts = (cogs + revenue * between(rng, 0.08, 0.2)) / 12;
  const cash = Math.round(monthlyCosts * cashMonths);

  const currentAssets = cash + accountsReceivable + inventory + otherCurrentAssets;
  // สินทรัพย์ถาวรคิดจากสัดส่วนที่ต้องการ โดยรู้ว่าสินทรัพย์หมุนเวียนคือส่วนที่เหลือ
  const fixedAssets = Math.round((currentAssets * fixedShare) / (1 - fixedShare));
  const totalAssets = currentAssets + fixedAssets;

  // ── ฝั่งหนี้สิน: กำหนดจากอัตราส่วนหนี้ แล้วแบ่งเป็นรายการย่อยให้รวมพอดี ──
  const totalLiabilities = Math.round(totalAssets * input.leverage);

  const payableDays = between(rng, shape.payableDays[0], shape.payableDays[1]);
  let accountsPayable = Math.round((cogs * payableDays) / 365);
  let otherCurrentLiabilities = Math.round(revenue * between(rng, 0.01, 0.035));

  // เจ้าหนี้การค้าและหนี้สินอื่นรวมกันต้องไม่กินพื้นที่หนี้ที่มีดอกเบี้ยจนหมด
  const nonDebtCap = Math.round(totalLiabilities * 0.68);
  if (accountsPayable + otherCurrentLiabilities > nonDebtCap) {
    const scale = nonDebtCap / (accountsPayable + otherCurrentLiabilities || 1);
    accountsPayable = Math.round(accountsPayable * scale);
    otherCurrentLiabilities = Math.round(otherCurrentLiabilities * scale);
  }

  const interestBearing = Math.max(0, totalLiabilities - accountsPayable - otherCurrentLiabilities);
  const shortTermShare = between(rng, 0.25, 0.55);
  const shortTermDebt = Math.round(interestBearing * shortTermShare);
  const longTermDebt = interestBearing - shortTermDebt;

  // ── งบกำไรขาดทุน: ดอกเบี้ยคิดจากหนี้ที่มีดอกเบี้ยข้างบนจริง ๆ ────────────
  const operatingExpenses = Math.round(revenue * between(rng, shape.opexRatio[0], shape.opexRatio[1]));
  const depreciation = Math.round(fixedAssets * between(rng, 0.06, 0.13));
  const interestExpense = Math.round((interestBearing * input.borrowingRatePct) / 100);

  const ebitda = revenue - cogs - operatingExpenses;
  const ebit = ebitda - depreciation;
  const ebt = ebit - interestExpense;
  // อัตราภาษีนิติบุคคล SME แบบมีขั้น — ใช้อัตราประสิทธิผลโดยประมาณ
  const tax = ebt > 0 ? Math.round(ebt * between(rng, 0.1, 0.2)) : 0;

  // ── ส่วนของผู้ถือหุ้น = ส่วนต่าง จึงสมดุลเสมอ ────────────────────────────
  // ผู้เรียกจะแบ่งเป็นทุนจดทะเบียน/กำไรสะสมอีกทีเมื่อสร้างครบทุกปีแล้ว
  const equity = totalAssets - totalLiabilities;
  const equityPaidUp = input.paidUpCapital;
  const retainedEarnings = equity - equityPaidUp;

  return {
    fiscalYear: input.fiscalYear,
    revenue,
    cogs,
    operatingExpenses,
    depreciation,
    interestExpense,
    tax,
    cash,
    accountsReceivable,
    inventory,
    otherCurrentAssets,
    fixedAssets,
    accountsPayable,
    shortTermDebt,
    otherCurrentLiabilities,
    longTermDebt,
    equityPaidUp,
    retainedEarnings,
  };
}

/**
 * สร้างสินเชื่อให้ยอดคงค้างรวมเท่ากับหนี้ที่มีดอกเบี้ยในงบปีล่าสุดพอดี
 * (วงเงินเบิกเกินบัญชี = หนี้ระยะสั้น, สินเชื่อระยะยาว = หนี้ระยะยาว)
 */
function buildLoans(rng: Rng, latest: GeneratedStatement, foundedYear: number): GeneratedLoan[] {
  const loans: GeneratedLoan[] = [];
  const startYear = Math.max(foundedYear, latest.fiscalYear - 6);

  if (latest.shortTermDebt > 0) {
    loans.push({
      lender: pick(rng, LENDERS),
      product: 'od',
      principal: roundTo(latest.shortTermDebt * between(rng, 1.05, 1.4), 100_000),
      outstanding: latest.shortTermDebt,
      rateType: pick(rng, ['mor_spread', 'mrr_spread']),
      rateValue: Math.round(between(rng, 0.75, 2.5) * 100) / 100,
      termMonths: 12,
      remainingMonths: Math.floor(between(rng, 2, 12)),
      startDate: `${latest.fiscalYear}-${String(Math.floor(between(rng, 1, 13))).padStart(2, '0')}-01`,
    });
  }

  if (latest.longTermDebt > 0) {
    // แบ่งเป็นหนึ่งหรือสองก้อน โดยก้อนสุดท้ายรับเศษไปทั้งหมดเพื่อให้รวมพอดี
    const pieces = rng() < 0.45 ? 2 : 1;
    let remaining = latest.longTermDebt;
    for (let i = 0; i < pieces; i += 1) {
      const isLast = i === pieces - 1;
      const outstanding = isLast ? remaining : Math.round(remaining * between(rng, 0.45, 0.65));
      remaining -= outstanding;
      if (outstanding <= 0) continue;

      const termMonths = pick(rng, [36, 48, 60, 84, 120]);
      const fixed = rng() < 0.4;
      loans.push({
        lender: pick(rng, LENDERS),
        product: pick(rng, ['term_loan', 'term_loan', 'leasing', 'trade_finance']),
        principal: roundTo(outstanding * between(rng, 1.15, 1.9), 100_000),
        outstanding,
        rateType: fixed ? 'fixed' : pick(rng, ['mlr_spread', 'mrr_spread']),
        rateValue: fixed
          ? Math.round(between(rng, 4.0, 7.5) * 100) / 100
          : Math.round(between(rng, 0.25, 2.0) * 100) / 100,
        termMonths,
        remainingMonths: Math.max(6, Math.floor(termMonths * between(rng, 0.25, 0.9))),
        startDate: `${Math.floor(between(rng, startYear, latest.fiscalYear + 1))}-${String(
          Math.floor(between(rng, 1, 13)),
        ).padStart(2, '0')}-01`,
      });
    }
  }

  return loans;
}

/** สร้างกิจการหนึ่งรายพร้อมงบสามปีและสินเชื่อที่สอดคล้องกัน */
function buildSme(
  rng: Rng,
  index: number,
  latestFiscalYear: number,
  usedNames: Set<string>,
): GeneratedSme {
  const industry = pick(rng, INDUSTRIES);
  const shape = INDUSTRY_SHAPES[industry];
  const province = pickProvince(rng);

  const head = pick(rng, NAME_HEADS);
  const tail = pick(rng, NAME_TAILS[industry]);
  let qualifier = pick(rng, NAME_QUALIFIERS);
  const isPartnership = rng() < 0.28;

  const compose = (q: { th: string; en: string }): { th: string; en: string } => ({
    th: isPartnership
      ? `ห้างหุ้นส่วนจำกัด ${head.th}${q.th}${tail.th}`
      : `บริษัท ${head.th}${q.th}${tail.th} จำกัด`,
    en: isPartnership
      ? `${head.en} ${q.en ? `${q.en} ` : ''}${tail.en} Ltd., Part.`
      : `${head.en} ${q.en ? `${q.en} ` : ''}${tail.en} Co., Ltd.`,
  });

  // ชื่อซ้ำได้ในโลกจริง แต่ในรายการค้นหาจะสับสน จึงไล่หาคำขยายที่ยังไม่ถูกใช้
  let name = compose(qualifier);
  for (const candidate of NAME_QUALIFIERS) {
    if (!usedNames.has(name.th)) break;
    qualifier = candidate;
    name = compose(candidate);
  }
  usedNames.add(name.th);
  const nameTh = name.th;
  const nameEn = name.en;

  const foundedYear = Math.floor(between(rng, 1998, latestFiscalYear - 1));
  const latestRevenue =
    between(rng, shape.revenueMillions[0], shape.revenueMillions[1]) * 1_000_000;

  // แนวโน้มการเติบโตประจำตัวกิจการ บวกความผันผวนรายปี
  const growthTrend = between(rng, -0.06, 0.28);
  const leverageBase = between(rng, 0.32, 0.78);
  const borrowingRatePct = Math.round(between(rng, 4.5, 8.5) * 100) / 100;

  // ทุนจดทะเบียนจริงตั้งครั้งเดียวและไม่เปลี่ยนรายปี แต่ต้องได้สัดส่วนที่สมเหตุสมผล
  // กับส่วนของผู้ถือหุ้นที่งบคำนวณออกมา จึงสร้างงบด้วยค่าชั่วคราวก่อนแล้วค่อยตั้งจริง
  const paidUpPlaceholder = 0;

  const statements: GeneratedStatement[] = [];
  for (let offset = 2; offset >= 0; offset -= 1) {
    const fiscalYear = latestFiscalYear - offset;
    // ย้อนกลับจากรายได้ปีล่าสุดตามอัตราการเติบโต
    const revenue = latestRevenue / Math.pow(1 + growthTrend, offset);
    const yearNoise = between(rng, 0.94, 1.06);
    const leverage = Math.min(0.82, Math.max(0.2, leverageBase + between(rng, -0.05, 0.05)));

    statements.push(
      buildStatement(rng, shape, {
        fiscalYear,
        revenue: revenue * yearNoise,
        leverage,
        paidUpCapital: paidUpPlaceholder,
        borrowingRatePct,
      }),
    );
  }

  // ── ตั้งทุนจดทะเบียนจากส่วนของผู้ถือหุ้นที่ต่ำที่สุดในสามปี ────────────────
  // กิจการส่วนใหญ่จึงมีกำไรสะสมเป็นบวก ส่วนกลุ่มน้อยตั้งทุนสูงกว่าที่มีจริง
  // ซึ่งทำให้กำไรสะสมติดลบ = ขาดทุนสะสม ซึ่งพบได้จริงใน SME
  const equities = statements.map((s) => s.equityPaidUp + s.retainedEarnings);
  const minEquity = Math.min(...equities);
  const hasAccumulatedLosses = rng() < 0.12;
  const paidUpCapital = Math.max(
    500_000,
    roundTo(
      minEquity * (hasAccumulatedLosses ? between(rng, 1.05, 1.5) : between(rng, 0.35, 0.8)),
      500_000,
    ),
  );
  for (const statement of statements) {
    const equity = statement.equityPaidUp + statement.retainedEarnings;
    statement.equityPaidUp = paidUpCapital;
    statement.retainedEarnings = equity - paidUpCapital;
  }

  const latest = statements[statements.length - 1]!;
  const employees = Math.max(
    3,
    Math.round(
      (latest.revenue / 1_000_000) *
        between(rng, shape.employeesPerMillion[0], shape.employeesPerMillion[1]),
    ),
  );

  // ประมาณหนึ่งในสี่ของกิจการมีรายการเงินตราต่างประเทศ
  const hasFx = rng() < 0.25;
  const fxCurrency = hasFx ? pick(rng, ['USD', 'USD', 'USD', 'CNY', 'EUR', 'JPY']) : null;

  const serial = String(index + 1).padStart(4, '0');

  return {
    id: `sme-gen-${serial}`,
    nameTh,
    nameEn,
    registrationNo: `0${Math.floor(between(rng, 105, 996))}${latestFiscalYear - 20}${serial}${Math.floor(
      between(rng, 0, 10),
    )}`.slice(0, 13),
    industry,
    province,
    foundedYear,
    employees,
    fxExposureCurrency: fxCurrency,
    fxAnnualExposure: fxCurrency ? roundTo(latest.revenue * between(rng, 0.08, 0.55), 100_000) : 0,
    statements,
    loans: buildLoans(rng, latest, foundedYear),
  };
}

/** สร้างกิจการตามจำนวนที่ขอ — seed เดิมได้ผลลัพธ์เดิมเสมอ */
export function generateSmes(options: GenerateOptions = {}): GeneratedSme[] {
  const count = options.count ?? 1000;
  const seed = options.seed ?? 20260830;
  const latestFiscalYear = options.latestFiscalYear ?? 2025;

  const rng = createRandom(seed);
  const usedNames = new Set<string>();
  const out: GeneratedSme[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(buildSme(rng, i, latestFiscalYear, usedNames));
  }
  return out;
}
