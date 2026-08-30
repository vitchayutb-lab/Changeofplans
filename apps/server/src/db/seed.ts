/**
 * ข้อมูลตั้งต้นของระบบ
 *
 * ตัวเลขของ SME ทั้งสามรายเป็น "ตัวอย่างธุรกิจ" ที่แต่งขึ้นให้สมจริงและงบดุลสมดุลจริง
 * (สินทรัพย์รวม = หนี้สินรวม + ส่วนของผู้ถือหุ้น) เพื่อให้การวิเคราะห์ทุกอย่างที่ต่อยอด
 * จากตัวเลขเหล่านี้เป็นการคำนวณจริง ไม่ใช่ค่าที่ hardcode ไว้
 *
 * รายละเอียดโครงการสนับสนุนเงินทุนเป็นข้อมูลตัวอย่างสำหรับสาธิตการจับคู่เงื่อนไข
 * ผู้ใช้ควรตรวจสอบเงื่อนไขล่าสุดกับผู้ให้บริการเสมอ
 */

import type { Db } from './index.js';

interface SeedStatement {
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

interface SeedLoan {
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

interface SeedSme {
  id: string;
  nameTh: string;
  nameEn: string;
  registrationNo: string;
  industry: string;
  province: string;
  foundedYear: number;
  employees: number;
  fxExposureCurrency: string | null;
  fxAnnualExposure: number;
  statements: SeedStatement[];
  loans: SeedLoan[];
}

const SMES: SeedSme[] = [
  {
    id: 'sme-siam-textile',
    nameTh: 'บริษัท สยามเท็กซ์ไทล์ เอ็กซ์พอร์ต จำกัด',
    nameEn: 'Siam Textile Export Co., Ltd.',
    registrationNo: '0105557000123',
    industry: 'manufacturing',
    province: 'สมุทรปราการ',
    foundedYear: 2014,
    employees: 68,
    fxExposureCurrency: 'USD',
    fxAnnualExposure: 42_000_000,
    statements: [
      {
        fiscalYear: 2023,
        revenue: 152_000_000, cogs: 108_500_000, operatingExpenses: 29_000_000,
        depreciation: 5_400_000, interestExpense: 3_100_000, tax: 1_500_000,
        cash: 8_200_000, accountsReceivable: 30_800_000, inventory: 36_900_000,
        otherCurrentAssets: 2_400_000, fixedAssets: 70_500_000,
        accountsPayable: 24_500_000, shortTermDebt: 20_000_000,
        otherCurrentLiabilities: 5_300_000, longTermDebt: 38_000_000,
        equityPaidUp: 30_000_000, retainedEarnings: 31_000_000,
      },
      {
        fiscalYear: 2024,
        revenue: 168_000_000, cogs: 118_000_000, operatingExpenses: 31_500_000,
        depreciation: 5_800_000, interestExpense: 3_400_000, tax: 2_000_000,
        cash: 9_800_000, accountsReceivable: 34_000_000, inventory: 40_500_000,
        otherCurrentAssets: 2_800_000, fixedAssets: 74_000_000,
        accountsPayable: 27_000_000, shortTermDebt: 22_000_000,
        otherCurrentLiabilities: 5_900_000, longTermDebt: 40_500_000,
        equityPaidUp: 30_000_000, retainedEarnings: 35_700_000,
      },
      {
        fiscalYear: 2025,
        revenue: 185_000_000, cogs: 128_000_000, operatingExpenses: 34_000_000,
        depreciation: 6_200_000, interestExpense: 3_900_000, tax: 2_600_000,
        cash: 12_400_000, accountsReceivable: 38_500_000, inventory: 44_200_000,
        otherCurrentAssets: 3_100_000, fixedAssets: 78_000_000,
        accountsPayable: 29_800_000, shortTermDebt: 24_000_000,
        otherCurrentLiabilities: 6_400_000, longTermDebt: 42_000_000,
        equityPaidUp: 30_000_000, retainedEarnings: 44_000_000,
      },
    ],
    loans: [
      {
        lender: 'ธนาคารกรุงเทพ', product: 'term_loan',
        principal: 50_000_000, outstanding: 42_000_000,
        rateType: 'mlr_spread', rateValue: 0.75,
        termMonths: 120, remainingMonths: 92, startDate: '2022-03-01',
      },
      {
        lender: 'ธนาคารกสิกรไทย', product: 'od',
        principal: 25_000_000, outstanding: 18_500_000,
        rateType: 'mor_spread', rateValue: 1.25,
        termMonths: 12, remainingMonths: 8, startDate: '2025-01-15',
      },
      {
        lender: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม', product: 'trade_finance',
        principal: 8_000_000, outstanding: 5_500_000,
        rateType: 'fixed', rateValue: 5.75,
        termMonths: 36, remainingMonths: 22, startDate: '2024-06-01',
      },
    ],
  },
  {
    id: 'sme-baansuan-retail',
    nameTh: 'ห้างหุ้นส่วนจำกัด บ้านสวนรีเทล',
    nameEn: 'Baan Suan Retail Ltd., Part.',
    registrationNo: '0503561000456',
    industry: 'retail',
    province: 'เชียงใหม่',
    foundedYear: 2018,
    employees: 24,
    fxExposureCurrency: null,
    fxAnnualExposure: 0,
    statements: [
      {
        fiscalYear: 2023,
        revenue: 54_000_000, cogs: 42_100_000, operatingExpenses: 9_400_000,
        depreciation: 1_200_000, interestExpense: 820_000, tax: 110_000,
        cash: 2_400_000, accountsReceivable: 1_900_000, inventory: 11_600_000,
        otherCurrentAssets: 480_000, fixedAssets: 14_900_000,
        accountsPayable: 9_600_000, shortTermDebt: 7_400_000,
        otherCurrentLiabilities: 980_000, longTermDebt: 7_600_000,
        equityPaidUp: 5_000_000, retainedEarnings: 700_000,
      },
      {
        fiscalYear: 2024,
        revenue: 58_500_000, cogs: 45_600_000, operatingExpenses: 10_100_000,
        depreciation: 1_300_000, interestExpense: 980_000, tax: 90_000,
        cash: 2_100_000, accountsReceivable: 2_150_000, inventory: 12_900_000,
        otherCurrentAssets: 540_000, fixedAssets: 15_800_000,
        accountsPayable: 10_400_000, shortTermDebt: 8_200_000,
        otherCurrentLiabilities: 1_110_000, longTermDebt: 7_200_000,
        equityPaidUp: 5_000_000, retainedEarnings: 1_580_000,
      },
      {
        fiscalYear: 2025,
        revenue: 62_000_000, cogs: 48_500_000, operatingExpenses: 10_800_000,
        depreciation: 1_400_000, interestExpense: 1_150_000, tax: 30_000,
        cash: 1_850_000, accountsReceivable: 2_400_000, inventory: 14_200_000,
        otherCurrentAssets: 620_000, fixedAssets: 16_500_000,
        accountsPayable: 11_300_000, shortTermDebt: 9_500_000,
        otherCurrentLiabilities: 1_270_000, longTermDebt: 6_800_000,
        equityPaidUp: 5_000_000, retainedEarnings: 1_700_000,
      },
    ],
    loans: [
      {
        lender: 'ธนาคารออมสิน', product: 'term_loan',
        principal: 9_000_000, outstanding: 6_800_000,
        rateType: 'mrr_spread', rateValue: 1.5,
        termMonths: 84, remainingMonths: 58, startDate: '2021-09-01',
      },
      {
        lender: 'ธนาคารกรุงไทย', product: 'od',
        principal: 10_000_000, outstanding: 9_500_000,
        rateType: 'mor_spread', rateValue: 2.0,
        termMonths: 12, remainingMonths: 5, startDate: '2025-04-01',
      },
    ],
  },
  {
    id: 'sme-kruathai-foods',
    nameTh: 'บริษัท ครัวไทยฟู้ดส์ จำกัด',
    nameEn: 'Krua Thai Foods Co., Ltd.',
    registrationNo: '0735563000789',
    industry: 'food',
    province: 'นครปฐม',
    foundedYear: 2020,
    employees: 41,
    fxExposureCurrency: 'USD',
    fxAnnualExposure: 6_000_000,
    statements: [
      {
        fiscalYear: 2023,
        revenue: 48_000_000, cogs: 32_600_000, operatingExpenses: 11_400_000,
        depreciation: 2_100_000, interestExpense: 890_000, tax: 190_000,
        cash: 5_300_000, accountsReceivable: 7_400_000, inventory: 5_100_000,
        otherCurrentAssets: 600_000, fixedAssets: 28_900_000,
        accountsPayable: 7_100_000, shortTermDebt: 5_600_000,
        otherCurrentLiabilities: 1_200_000, longTermDebt: 13_500_000,
        equityPaidUp: 15_000_000, retainedEarnings: 4_900_000,
      },
      {
        fiscalYear: 2024,
        revenue: 71_000_000, cogs: 46_800_000, operatingExpenses: 18_600_000,
        depreciation: 2_700_000, interestExpense: 1_320_000, tax: 380_000,
        cash: 4_100_000, accountsReceivable: 11_900_000, inventory: 7_200_000,
        otherCurrentAssets: 850_000, fixedAssets: 35_500_000,
        accountsPayable: 10_200_000, shortTermDebt: 8_500_000,
        otherCurrentLiabilities: 1_750_000, longTermDebt: 16_000_000,
        equityPaidUp: 15_000_000, retainedEarnings: 8_100_000,
      },
      {
        fiscalYear: 2025,
        revenue: 96_000_000, cogs: 62_400_000, operatingExpenses: 24_900_000,
        depreciation: 3_300_000, interestExpense: 1_750_000, tax: 720_000,
        cash: 3_200_000, accountsReceivable: 16_800_000, inventory: 9_400_000,
        otherCurrentAssets: 1_100_000, fixedAssets: 41_000_000,
        accountsPayable: 13_600_000, shortTermDebt: 11_000_000,
        otherCurrentLiabilities: 2_300_000, longTermDebt: 19_500_000,
        equityPaidUp: 15_000_000, retainedEarnings: 10_100_000,
      },
    ],
    loans: [
      {
        lender: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม', product: 'term_loan',
        principal: 22_000_000, outstanding: 19_500_000,
        rateType: 'fixed', rateValue: 4.5,
        termMonths: 84, remainingMonths: 66, startDate: '2023-11-01',
      },
      {
        lender: 'ธนาคารไทยพาณิชย์', product: 'od',
        principal: 12_000_000, outstanding: 11_000_000,
        rateType: 'mrr_spread', rateValue: 1.75,
        termMonths: 12, remainingMonths: 7, startDate: '2025-02-01',
      },
    ],
  },
];

const CENTRAL_PROVINCES = [
  'กรุงเทพมหานคร',
  'สมุทรปราการ',
  'นนทบุรี',
  'ปทุมธานี',
  'สมุทรสาคร',
  'นครปฐม',
];

interface SeedProgram {
  id: string;
  nameTh: string;
  nameEn: string;
  provider: string;
  type: string;
  minAmount: number;
  maxAmount: number;
  rateMin: number | null;
  rateMax: number | null;
  rateBasis: string | null;
  maxTermMonths: number | null;
  eligibleIndustries: string[];
  eligibleProvinces: string[];
  minYearsOperating: number;
  maxEmployees: number | null;
  maxAnnualRevenue: number | null;
  requiresCollateral: boolean;
  minDscr: number | null;
  descriptionTh: string;
  descriptionEn: string;
  url: string | null;
}

const PROGRAMS: SeedProgram[] = [
  {
    id: 'fp-smed-transform',
    nameTh: 'สินเชื่อ SME Transformation Loan',
    nameEn: 'SME Transformation Loan',
    provider: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย (SME D Bank)',
    type: 'loan',
    minAmount: 500_000, maxAmount: 15_000_000,
    rateMin: 4.5, rateMax: 6.5, rateBasis: 'fixed', maxTermMonths: 84,
    eligibleIndustries: ['*'], eligibleProvinces: ['*'],
    minYearsOperating: 2, maxEmployees: 200, maxAnnualRevenue: 500_000_000,
    requiresCollateral: false, minDscr: 1.2,
    descriptionTh: 'สินเชื่อเพื่อปรับปรุงเครื่องจักรและยกระดับกระบวนการผลิตของ SME อัตราคงที่ ผ่อนได้สูงสุด 7 ปี',
    descriptionEn: 'Term loan for machinery upgrades and process improvement, fixed rate, up to 7 years.',
    url: null,
  },
  {
    id: 'fp-tcg-pgs',
    nameTh: 'โครงการค้ำประกันสินเชื่อ Portfolio Guarantee Scheme',
    nameEn: 'Portfolio Guarantee Scheme (PGS)',
    provider: 'บรรษัทประกันสินเชื่ออุตสาหกรรมขนาดย่อม (บสย. / TCG)',
    type: 'guarantee',
    minAmount: 200_000, maxAmount: 40_000_000,
    rateMin: null, rateMax: null, rateBasis: null, maxTermMonths: 120,
    eligibleIndustries: ['*'], eligibleProvinces: ['*'],
    minYearsOperating: 1, maxEmployees: null, maxAnnualRevenue: null,
    requiresCollateral: false, minDscr: null,
    descriptionTh: 'ค้ำประกันสินเชื่อให้ SME ที่หลักประกันไม่พอ ช่วยให้ธนาคารอนุมัติวงเงินได้ง่ายขึ้น มีค่าธรรมเนียมค้ำประกันรายปี',
    descriptionEn: 'Credit guarantee for SMEs with insufficient collateral; annual guarantee fee applies.',
    url: null,
  },
  {
    id: 'fp-dip-innovation',
    nameTh: 'เงินอุดหนุนพัฒนานวัตกรรมและกระบวนการผลิต',
    nameEn: 'Industrial Innovation Grant',
    provider: 'กรมส่งเสริมอุตสาหกรรม (DIP)',
    type: 'grant',
    minAmount: 100_000, maxAmount: 2_000_000,
    rateMin: null, rateMax: null, rateBasis: null, maxTermMonths: null,
    eligibleIndustries: ['manufacturing', 'food', 'tech'], eligibleProvinces: ['*'],
    minYearsOperating: 3, maxEmployees: 200, maxAnnualRevenue: 200_000_000,
    requiresCollateral: false, minDscr: null,
    descriptionTh: 'เงินให้เปล่าแบบร่วมจ่าย สำหรับพัฒนาผลิตภัณฑ์หรือปรับปรุงกระบวนการผลิต ไม่ต้องคืนเงินต้น',
    descriptionEn: 'Matching grant for product development or process improvement; no repayment.',
    url: null,
  },
  {
    id: 'fp-gsb-green',
    nameTh: 'สินเชื่อธุรกิจสีเขียว GSB Green Business',
    nameEn: 'GSB Green Business Loan',
    provider: 'ธนาคารออมสิน',
    type: 'loan',
    minAmount: 1_000_000, maxAmount: 50_000_000,
    rateMin: 0, rateMax: 1.0, rateBasis: 'mlr_spread', maxTermMonths: 120,
    eligibleIndustries: ['manufacturing', 'logistics', 'agriculture'], eligibleProvinces: ['*'],
    minYearsOperating: 3, maxEmployees: null, maxAnnualRevenue: null,
    requiresCollateral: true, minDscr: 1.3,
    descriptionTh: 'สินเชื่อลงทุนด้านพลังงานสะอาดและลดการปล่อยคาร์บอน อัตราอ้างอิง MLR บวกส่วนต่าง ต้องมีหลักประกัน',
    descriptionEn: 'Investment loan for clean energy and emission reduction; priced off MLR, collateral required.',
    url: null,
  },
  {
    id: 'fp-exim-export',
    nameTh: 'สินเชื่อเพื่อผู้ส่งออก SMEs',
    nameEn: 'SME Export Financing',
    provider: 'ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย (EXIM Bank)',
    type: 'loan',
    minAmount: 1_000_000, maxAmount: 30_000_000,
    rateMin: 5.0, rateMax: 7.0, rateBasis: 'fixed', maxTermMonths: 60,
    eligibleIndustries: ['manufacturing', 'food', 'agriculture'], eligibleProvinces: ['*'],
    minYearsOperating: 2, maxEmployees: null, maxAnnualRevenue: null,
    requiresCollateral: false, minDscr: 1.15,
    descriptionTh: 'เงินทุนหมุนเวียนก่อนและหลังการส่งออก พร้อมเครื่องมือป้องกันความเสี่ยงอัตราแลกเปลี่ยน',
    descriptionEn: 'Pre- and post-shipment working capital with FX hedging support for exporters.',
    url: null,
  },
  {
    id: 'fp-nia-openinnovation',
    nameTh: 'ทุนนวัตกรรมแบบเปิด (Open Innovation)',
    nameEn: 'Open Innovation Grant',
    provider: 'สำนักงานนวัตกรรมแห่งชาติ (NIA)',
    type: 'grant',
    minAmount: 500_000, maxAmount: 5_000_000,
    rateMin: null, rateMax: null, rateBasis: null, maxTermMonths: null,
    eligibleIndustries: ['tech', 'food'], eligibleProvinces: ['*'],
    minYearsOperating: 0, maxEmployees: 50, maxAnnualRevenue: 100_000_000,
    requiresCollateral: false, minDscr: null,
    descriptionTh: 'ทุนให้เปล่าสำหรับโครงการนวัตกรรมที่พิสูจน์แนวคิดแล้ว เน้นธุรกิจขนาดเล็กที่ขยายผลได้',
    descriptionEn: 'Grant for proven-concept innovation projects, aimed at small scalable businesses.',
    url: null,
  },
  {
    id: 'fp-bkk-microloan',
    nameTh: 'สินเชื่อรายย่อยเพื่อผู้ประกอบการ',
    nameEn: 'Small Business Micro Loan',
    provider: 'ธนาคารกรุงเทพ',
    type: 'loan',
    minAmount: 100_000, maxAmount: 3_000_000,
    rateMin: 0.5, rateMax: 2.5, rateBasis: 'mrr_spread', maxTermMonths: 60,
    eligibleIndustries: ['*'], eligibleProvinces: CENTRAL_PROVINCES,
    minYearsOperating: 1, maxEmployees: null, maxAnnualRevenue: 100_000_000,
    requiresCollateral: false, minDscr: 1.0,
    descriptionTh: 'วงเงินขนาดเล็กสำหรับเสริมสภาพคล่อง อนุมัติเร็ว อ้างอิงอัตรา MRR บวกส่วนต่าง (เขตกรุงเทพฯ และปริมณฑล)',
    descriptionEn: 'Small working-capital facility, fast approval, priced off MRR (Bangkok and vicinity).',
    url: null,
  },
  {
    id: 'fp-depa-voucher',
    nameTh: 'คูปองดิจิทัลเพื่อการปรับตัว (mini Transformation Voucher)',
    nameEn: 'Digital Transformation Voucher',
    provider: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล (depa)',
    type: 'subsidy',
    minAmount: 50_000, maxAmount: 500_000,
    rateMin: null, rateMax: null, rateBasis: null, maxTermMonths: null,
    eligibleIndustries: ['*'], eligibleProvinces: ['*'],
    minYearsOperating: 1, maxEmployees: 200, maxAnnualRevenue: null,
    requiresCollateral: false, minDscr: null,
    descriptionTh: 'เงินสนับสนุนค่าใช้จ่ายซอฟต์แวร์และระบบดิจิทัลที่ขึ้นทะเบียน ช่วยลดต้นทุนการปรับตัวของ SME',
    descriptionEn: 'Subsidy covering registered software and digital systems adoption costs.',
    url: null,
  },
  {
    id: 'fp-ktb-supplychain',
    nameTh: 'สินเชื่อ Supply Chain Financing',
    nameEn: 'Supply Chain Financing',
    provider: 'ธนาคารกรุงไทย',
    type: 'loan',
    minAmount: 500_000, maxAmount: 20_000_000,
    rateMin: 0.25, rateMax: 1.75, rateBasis: 'mlr_spread', maxTermMonths: 36,
    eligibleIndustries: ['retail', 'logistics', 'manufacturing'], eligibleProvinces: ['*'],
    minYearsOperating: 2, maxEmployees: null, maxAnnualRevenue: null,
    requiresCollateral: false, minDscr: 1.1,
    descriptionTh: 'วงเงินหมุนเวียนอิงใบสั่งซื้อจากคู่ค้ารายใหญ่ ช่วยแก้ปัญหาลูกหนี้การค้าเก็บเงินช้า',
    descriptionEn: 'Revolving facility against purchase orders from anchor buyers; eases receivable delays.',
    url: null,
  },
  {
    id: 'fp-equity-growth',
    nameTh: 'ร่วมลงทุนในกิจการระยะเติบโต',
    nameEn: 'Growth-Stage Equity Investment',
    provider: 'กองทุนร่วมลงทุนเพื่อ SME',
    type: 'equity',
    minAmount: 3_000_000, maxAmount: 50_000_000,
    rateMin: null, rateMax: null, rateBasis: null, maxTermMonths: null,
    eligibleIndustries: ['tech', 'food'], eligibleProvinces: ['*'],
    minYearsOperating: 2, maxEmployees: 100, maxAnnualRevenue: 150_000_000,
    requiresCollateral: false, minDscr: null,
    descriptionTh: 'ร่วมลงทุนแลกหุ้น ไม่มีภาระดอกเบี้ยและไม่ต้องมีหลักประกัน แต่ผู้ถือหุ้นเดิมจะถูกลดสัดส่วน',
    descriptionEn: 'Equity investment: no interest burden or collateral, but existing owners are diluted.',
    url: null,
  },
];

/** ใส่ข้อมูลตั้งต้นเฉพาะตอนที่ตารางยังว่าง — เรียกซ้ำได้อย่างปลอดภัย */
export function seedDatabase(db: Db): { smes: number; statements: number; programs: number } {
  const smeCount = (db.prepare('SELECT COUNT(*) AS n FROM smes').get() as { n: number }).n;
  const programCount = (
    db.prepare('SELECT COUNT(*) AS n FROM funding_programs').get() as { n: number }
  ).n;

  let smes = 0;
  let statements = 0;
  let programs = 0;
  const now = new Date().toISOString();

  if (smeCount === 0) {
    const insertSme = db.prepare(
      `INSERT INTO smes (id, name_th, name_en, registration_no, industry, province,
                         founded_year, employees, currency, fx_exposure_currency,
                         fx_annual_exposure, created_at)
       VALUES (@id, @nameTh, @nameEn, @registrationNo, @industry, @province,
               @foundedYear, @employees, 'THB', @fxExposureCurrency,
               @fxAnnualExposure, @createdAt)`,
    );
    const insertStatement = db.prepare(
      `INSERT INTO financial_statements (
         id, sme_id, fiscal_year, period, revenue, cogs, operating_expenses, depreciation,
         interest_expense, tax, cash, accounts_receivable, inventory, other_current_assets,
         fixed_assets, accounts_payable, short_term_debt, other_current_liabilities,
         long_term_debt, equity_paid_up, retained_earnings, source)
       VALUES (@id, @smeId, @fiscalYear, 'FY', @revenue, @cogs, @operatingExpenses,
               @depreciation, @interestExpense, @tax, @cash, @accountsReceivable, @inventory,
               @otherCurrentAssets, @fixedAssets, @accountsPayable, @shortTermDebt,
               @otherCurrentLiabilities, @longTermDebt, @equityPaidUp, @retainedEarnings,
               'seed')`,
    );
    const insertLoan = db.prepare(
      `INSERT INTO existing_loans (id, sme_id, lender, product, principal, outstanding,
                                   rate_type, rate_value, term_months, remaining_months, start_date)
       VALUES (@id, @smeId, @lender, @product, @principal, @outstanding,
               @rateType, @rateValue, @termMonths, @remainingMonths, @startDate)`,
    );

    db.transaction(() => {
      for (const sme of SMES) {
        insertSme.run({
          id: sme.id, nameTh: sme.nameTh, nameEn: sme.nameEn,
          registrationNo: sme.registrationNo, industry: sme.industry, province: sme.province,
          foundedYear: sme.foundedYear, employees: sme.employees,
          fxExposureCurrency: sme.fxExposureCurrency, fxAnnualExposure: sme.fxAnnualExposure,
          createdAt: now,
        });
        smes += 1;
        for (const st of sme.statements) {
          insertStatement.run({ id: `${sme.id}-fy${st.fiscalYear}`, smeId: sme.id, ...st });
          statements += 1;
        }
        sme.loans.forEach((loan, index) => {
          insertLoan.run({ id: `${sme.id}-loan${index + 1}`, smeId: sme.id, ...loan });
        });
      }
    })();
  }

  if (programCount === 0) {
    const insertProgram = db.prepare(
      `INSERT INTO funding_programs (
         id, name_th, name_en, provider, type, min_amount, max_amount, rate_min, rate_max,
         rate_basis, max_term_months, eligible_industries, eligible_provinces,
         min_years_operating, max_employees, max_annual_revenue, requires_collateral,
         min_dscr, description_th, description_en, url, active)
       VALUES (@id, @nameTh, @nameEn, @provider, @type, @minAmount, @maxAmount, @rateMin,
               @rateMax, @rateBasis, @maxTermMonths, @eligibleIndustries, @eligibleProvinces,
               @minYearsOperating, @maxEmployees, @maxAnnualRevenue, @requiresCollateral,
               @minDscr, @descriptionTh, @descriptionEn, @url, 1)`,
    );
    db.transaction(() => {
      for (const program of PROGRAMS) {
        insertProgram.run({
          ...program,
          eligibleIndustries: JSON.stringify(program.eligibleIndustries),
          eligibleProvinces: JSON.stringify(program.eligibleProvinces),
          requiresCollateral: program.requiresCollateral ? 1 : 0,
        });
        programs += 1;
      }
    })();
  }

  return { smes, statements, programs };
}
