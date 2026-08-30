/**
 * เครื่องมือวิเคราะห์การเงินของกิจการ
 *
 * ทุกตัวคำนวณจากงบการเงินที่บันทึกไว้จริงในฐานข้อมูล และเมื่อเกี่ยวกับอัตราดอกเบี้ย
 * จะดึงอัตราอ้างอิงจาก ธปท. ผ่าน BotService ไม่ใช้ค่าคงที่ในโค้ด
 */

import type { RateBasis } from '@sme/shared';
import { getSme, listSmes } from '../../db/smeRepo.js';
import { getBotService } from '../../services/bot/botService.js';
import { analyzeSme, loadStatements, NotFoundError } from '../../services/finance/analysis.js';
import { getDebtOverview, loadReferenceRates } from '../../services/finance/debt.js';
import { convertCurrency, fxSensitivity } from '../../services/finance/fx.js';
import { annualDebtService, dscr, quote } from '../../services/finance/loan.js';
import { simulateLoan } from '../../services/finance/simulation.js';
import { derive } from '../../services/finance/statement.js';
import { defineSchema, field } from '../schema.js';
import type { ToolContext, ToolDefinition } from '../registry.js';

function resolveSmeId(args: { smeId?: string }, ctx: ToolContext): string {
  const smeId = args.smeId ?? ctx.smeId;
  if (!smeId) throw new NotFoundError('ต้องระบุ smeId ของกิจการที่ต้องการวิเคราะห์');
  if (!getSme(smeId)) {
    throw new NotFoundError(
      `ไม่พบกิจการ "${smeId}" — ที่มีอยู่: ${listSmes().map((s) => s.id).join(', ')}`,
    );
  }
  return smeId;
}

const smeIdField = field.string('รหัสกิจการ เช่น sme-siam-textile (ถ้าไม่ระบุจะใช้กิจการที่เลือกอยู่)');
const fiscalYearField = field.integer('ปีบัญชีที่ต้องการ (ถ้าไม่ระบุจะใช้ปีล่าสุด)');

const listCompanies: ToolDefinition = {
  name: 'list_smes',
  title: 'รายชื่อกิจการในระบบ',
  description: 'แสดงกิจการทั้งหมดที่มีข้อมูลอยู่ พร้อมอุตสาหกรรม จังหวัด และปีที่ก่อตั้ง',
  category: 'finance',
  readOnly: true,
  schema: defineSchema({}),
  async handler() {
    return {
      data: {
        smes: listSmes().map((sme) => ({
          id: sme.id,
          name: sme.nameTh,
          nameEn: sme.nameEn,
          industry: sme.industry,
          province: sme.province,
          foundedYear: sme.foundedYear,
          employees: sme.employees,
        })),
      },
      source: 'local' as const,
    };
  },
};

const analyzeStatement: ToolDefinition = {
  name: 'analyze_financial_statement',
  title: 'วิเคราะห์งบการเงิน',
  description:
    'อ่านงบการเงินของกิจการแล้วคืนค่าที่คำนวณแล้ว: รายได้ กำไรขั้นต้น EBITDA EBIT กำไรสุทธิ ' +
    'สินทรัพย์ หนี้สิน ส่วนของผู้ถือหุ้น กระแสเงินสดจากการดำเนินงาน และการเปลี่ยนแปลงเทียบปีก่อน ' +
    'เรียกก่อนเสมอเมื่อคำถามเกี่ยวข้องกับฐานะการเงินของกิจการ',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ smeId?: string; fiscalYear?: number }>({
    smeId: smeIdField,
    fiscalYear: fiscalYearField,
  }),
  async handler(args: { smeId?: string; fiscalYear?: number }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const sme = getSme(smeId)!;
    const { current, previous } = loadStatements(smeId, args.fiscalYear);
    const derived = derive(current);
    const previousDerived = previous ? derive(previous) : null;

    return {
      data: {
        sme: { id: sme.id, name: sme.nameTh, industry: sme.industry, province: sme.province },
        fiscalYear: derived.fiscalYear,
        currency: 'THB',
        incomeStatement: {
          revenue: derived.revenue,
          cogs: derived.cogs,
          grossProfit: derived.grossProfit,
          operatingExpenses: derived.operatingExpenses,
          ebitda: derived.ebitda,
          depreciation: derived.depreciation,
          ebit: derived.ebit,
          interestExpense: derived.interestExpense,
          tax: derived.tax,
          netProfit: derived.netProfit,
        },
        balanceSheet: {
          cash: derived.cash,
          accountsReceivable: derived.accountsReceivable,
          inventory: derived.inventory,
          currentAssets: derived.currentAssets,
          totalAssets: derived.totalAssets,
          currentLiabilities: derived.currentLiabilities,
          totalDebt: derived.totalDebt,
          totalLiabilities: derived.totalLiabilities,
          equity: derived.equity,
          workingCapital: derived.workingCapital,
        },
        operatingCashFlow: derived.operatingCashFlow,
        previousFiscalYear: previousDerived?.fiscalYear ?? null,
        yoyRevenueChangePct:
          previousDerived && previousDerived.revenue !== 0
            ? round2(((derived.revenue - previousDerived.revenue) / previousDerived.revenue) * 100)
            : null,
        yoyNetProfitChangePct:
          previousDerived && previousDerived.netProfit !== 0
            ? round2(
                ((derived.netProfit - previousDerived.netProfit) /
                  Math.abs(previousDerived.netProfit)) *
                  100,
              )
            : null,
      },
      source: 'local' as const,
      citation: { label: `งบการเงินที่บันทึกไว้ของ ${sme.nameTh} (ปี ${derived.fiscalYear})`, asOf: null },
    };
  },
};

const financialRatios: ToolDefinition = {
  name: 'calculate_financial_ratios',
  title: 'คำนวณอัตราส่วนทางการเงิน',
  description:
    'คำนวณอัตราส่วนครบชุด (สภาพคล่อง โครงสร้างหนี้ ความสามารถทำกำไร ประสิทธิภาพ และ DSCR) ' +
    'พร้อมเกณฑ์เทียบและคำตัดสิน good/watch/risk ของแต่ละตัว ' +
    'ค่า DSCR คำนวณจากภาระหนี้จริงที่คิดอัตราดอกเบี้ยล่าสุดจาก ธปท. แล้ว',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ smeId?: string; fiscalYear?: number }>({
    smeId: smeIdField,
    fiscalYear: fiscalYearField,
  }),
  async handler(args: { smeId?: string; fiscalYear?: number }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const analysis = await analyzeSme(smeId, args.fiscalYear);

    const flat: Record<string, unknown> = {};
    for (const group of analysis.groups) {
      for (const ratio of group.ratios) {
        flat[ratio.key] = {
          label: ratio.labelTh,
          value: ratio.value,
          unit: ratio.unit,
          verdict: ratio.verdict,
          benchmarkGood: ratio.benchmark.good,
          benchmarkWatch: ratio.benchmark.watch,
          formula: ratio.formula,
        };
      }
    }

    return {
      data: {
        smeId,
        fiscalYear: analysis.fiscalYear,
        ratios: flat,
        alerts: analysis.alerts.map((a) => ({ level: a.level, title: a.titleTh, detail: a.detailTh })),
      },
      source: 'local' as const,
      citation: { label: `อัตราส่วนคำนวณจากงบปี ${analysis.fiscalYear}`, asOf: null },
    };
  },
};

const loanPayment: ToolDefinition = {
  name: 'calculate_loan_payment',
  title: 'คำนวณค่างวดและดอกเบี้ยสินเชื่อ',
  description:
    'คำนวณค่างวดรายเดือน ดอกเบี้ยรวมตลอดสัญญา และดอกเบี้ยปีแรก จากเงินต้น อัตราดอกเบี้ย ' +
    'และจำนวนปีที่ผ่อน ใช้สูตรผ่อนเท่ากันทุกงวด (annuity) ผลลัพธ์เป็นค่าประมาณ',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{
    principal: number;
    annualRatePct: number;
    years: number;
    paymentsPerYear?: number;
  }>({
    principal: field.number('เงินต้นเป็นบาท', { required: true, minimum: 0 }),
    annualRatePct: field.number('อัตราดอกเบี้ยต่อปีเป็นเปอร์เซ็นต์ เช่น 6.5', {
      required: true,
      minimum: 0,
      maximum: 60,
    }),
    years: field.number('จำนวนปีที่ผ่อน', { required: true, minimum: 0.25, maximum: 40 }),
    paymentsPerYear: field.integer('จำนวนงวดต่อปี (ค่าเริ่มต้น 12)', { default: 12 }),
  }),
  async handler(args: {
    principal: number;
    annualRatePct: number;
    years: number;
    paymentsPerYear?: number;
  }) {
    const result = quote(
      args.principal,
      args.annualRatePct,
      args.years,
      args.paymentsPerYear ?? 12,
    );
    return {
      data: {
        principal: result.principal,
        annualRatePct: result.annualRatePct,
        years: result.years,
        monthlyPayment: result.monthlyPayment,
        totalPayment: result.totalPayment,
        totalInterest: result.totalInterest,
        firstYearInterest: result.firstYearInterest,
        note: 'ค่าประมาณจากสูตรผ่อนเท่ากันทุกงวด ไม่รวมค่าธรรมเนียมและประกัน',
      },
      source: 'local' as const,
    };
  },
};

const financingCost: ToolDefinition = {
  name: 'estimate_financing_cost',
  title: 'ประมาณต้นทุนทางการเงินเมื่อกู้เพิ่ม',
  description:
    'ดึงอัตราดอกเบี้ยเงินกู้ล่าสุดจาก ธปท. บวกส่วนต่างที่ระบุ แล้วประมาณดอกเบี้ยต่อปี ' +
    'ค่างวด และสัดส่วนดอกเบี้ยต่อ EBIT ของกิจการ ' +
    'ใช้ตอบคำถามแนว "ถ้ากู้ X ล้านบาท จะกระทบต้นทุนทางการเงินอย่างไร"',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{
    principal: number;
    years?: number;
    spreadPct?: number;
    rateBasis?: string;
    smeId?: string;
  }>({
    principal: field.number('วงเงินที่ต้องการกู้ เป็นบาท', { required: true, minimum: 0 }),
    years: field.number('จำนวนปีที่ผ่อน (ค่าเริ่มต้น 5)', { default: 5, minimum: 0.25, maximum: 40 }),
    spreadPct: field.number('ส่วนต่างที่บวกจากอัตราอ้างอิง เช่น 0.5 (ค่าเริ่มต้น 0.5)', {
      default: 0.5,
    }),
    rateBasis: field.enumOf('อัตราอ้างอิงที่ใช้', ['MLR', 'MOR', 'MRR'], { default: 'MRR' }),
    smeId: smeIdField,
  }),
  async handler(
    args: { principal: number; years?: number; spreadPct?: number; rateBasis?: string; smeId?: string },
    ctx,
  ) {
    const rates = await loadReferenceRates();
    const basis = (args.rateBasis ?? 'MRR').toUpperCase() as 'MLR' | 'MOR' | 'MRR';
    const reference = rates[basis];
    if (reference.value === null) {
      throw new Error('ไม่สามารถดึงอัตราดอกเบี้ยอ้างอิงจาก ธปท. ได้ในขณะนี้');
    }

    const spread = args.spreadPct ?? 0.5;
    const estimatedRate = round2(reference.value + spread);
    const years = args.years ?? 5;
    const loan = quote(args.principal, estimatedRate, years);

    // ถ้ารู้ว่าเป็นกิจการไหน ให้บอกด้วยว่าดอกเบี้ยนี้กินกำไรจากการดำเนินงานไปเท่าไร
    let context: Record<string, unknown> | null = null;
    const smeId = args.smeId ?? ctx.smeId;
    if (smeId && getSme(smeId)) {
      const { current } = loadStatements(smeId);
      const statement = derive(current);
      const debt = await getDebtOverview(smeId);
      const newService = annualDebtService(args.principal, estimatedRate, Math.round(years * 12));
      context = {
        smeId,
        ebit: statement.ebit,
        existingInterestExpense: statement.interestExpense,
        interestToEbitPct: statement.ebit > 0 ? round2((loan.firstYearInterest / statement.ebit) * 100) : null,
        dscrBefore: dscr(statement.operatingCashFlow, debt.totalAnnualDebtService),
        dscrAfter: dscr(statement.operatingCashFlow, debt.totalAnnualDebtService + newService),
      };
    }

    return {
      data: {
        referenceRateName: basis,
        referenceRatePct: reference.value,
        spreadPct: spread,
        estimatedRatePct: estimatedRate,
        principal: args.principal,
        years,
        estimatedAnnualInterest: round2((args.principal * estimatedRate) / 100),
        firstYearInterest: loan.firstYearInterest,
        monthlyPayment: loan.monthlyPayment,
        totalInterest: loan.totalInterest,
        smeContext: context,
        isEstimate: true,
        source: reference.provenance.sourceLabel,
        asOf: reference.provenance.lastUpdated,
        isDemoData: reference.provenance.source === 'demo',
        note: 'อัตราที่ใช้เป็นอัตราประกาศของธนาคารพาณิชย์บวกส่วนต่างโดยประมาณ ไม่ใช่ข้อเสนอสินเชื่อ',
      },
      source: reference.provenance.source,
      notice: reference.provenance.notice,
      citation: {
        label: `${reference.provenance.sourceLabel} — ${basis}`,
        asOf: reference.provenance.lastUpdated,
      },
    };
  },
};

const debtCapacity: ToolDefinition = {
  name: 'assess_debt_capacity',
  title: 'ประเมินความสามารถในการก่อหนี้เพิ่ม',
  description:
    'เทียบ DSCR, D/E และความสามารถจ่ายดอกเบี้ย ก่อนและหลังกู้เพิ่ม พร้อมคำตัดสิน ' +
    'good/watch/risk และเหตุผล ใช้ตอบว่า "ควรกู้ตอนนี้ไหม" หรือ "กู้ได้เท่าไรถึงยังปลอดภัย"',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{
    additionalPrincipal: number;
    years?: number;
    rateBasis?: string;
    spreadPct?: number;
    fixedRatePct?: number;
    smeId?: string;
  }>({
    additionalPrincipal: field.number('วงเงินที่จะกู้เพิ่ม เป็นบาท', { required: true, minimum: 0 }),
    years: field.number('จำนวนปีที่ผ่อน (ค่าเริ่มต้น 5)', { default: 5, minimum: 0.25, maximum: 40 }),
    rateBasis: field.enumOf('ฐานอัตราดอกเบี้ย', ['MLR', 'MOR', 'MRR', 'fixed'], { default: 'MRR' }),
    spreadPct: field.number('ส่วนต่างจากอัตราอ้างอิง (ใช้เมื่อไม่ใช่ fixed)', { default: 0.5 }),
    fixedRatePct: field.number('อัตราคงที่ต่อปี (ใช้เมื่อ rateBasis = fixed)'),
    smeId: smeIdField,
  }),
  async handler(
    args: {
      additionalPrincipal: number;
      years?: number;
      rateBasis?: string;
      spreadPct?: number;
      fixedRatePct?: number;
      smeId?: string;
    },
    ctx,
  ) {
    const smeId = resolveSmeId(args, ctx);
    const basis = (args.rateBasis ?? 'MRR').toUpperCase();
    const rateBasis: RateBasis =
      basis === 'FIXED'
        ? 'fixed'
        : basis === 'MLR'
          ? 'mlr_spread'
          : basis === 'MOR'
            ? 'mor_spread'
            : 'mrr_spread';

    const simulation = await simulateLoan({
      smeId,
      amount: args.additionalPrincipal,
      years: args.years ?? 5,
      rateBasis,
      ...(args.spreadPct !== undefined ? { spreadPct: args.spreadPct } : {}),
      ...(args.fixedRatePct !== undefined ? { fixedRatePct: args.fixedRatePct } : {}),
    });

    return {
      data: {
        smeId,
        additionalPrincipal: args.additionalPrincipal,
        effectiveRatePct: simulation.rate.effectiveRatePct,
        referenceRateName: simulation.rate.referenceRateName,
        referenceRatePct: simulation.rate.referenceRatePct,
        monthlyPayment: simulation.quote.monthlyPayment,
        firstYearInterest: simulation.quote.firstYearInterest,
        impact: simulation.impact,
        isEstimate: true,
        source: simulation.rate.provenance?.sourceLabel ?? 'ข้อมูลภายในระบบ',
        asOf: simulation.rate.provenance?.lastUpdated ?? null,
        isDemoData: simulation.rate.provenance?.source === 'demo',
      },
      source: simulation.rate.provenance?.source ?? 'local',
      notice: simulation.rate.provenance?.notice ?? null,
      citation: simulation.rate.provenance
        ? {
            label: `${simulation.rate.provenance.sourceLabel} — ${simulation.rate.referenceRateName ?? 'rate'}`,
            asOf: simulation.rate.provenance.lastUpdated,
          }
        : null,
    };
  },
};

const existingDebt: ToolDefinition = {
  name: 'get_existing_debt',
  title: 'ภาระหนี้ปัจจุบันของกิจการ',
  description:
    'แสดงสินเชื่อทุกก้อนที่กิจการมีอยู่ พร้อมอัตราดอกเบี้ยที่คิดใหม่จากอัตราอ้างอิงล่าสุดของ ธปท. ' +
    'สำหรับสินเชื่อลอยตัว รวมถึงดอกเบี้ยรวมต่อปีและภาระผ่อนต่อปี',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ smeId?: string }>({ smeId: smeIdField }),
  async handler(args: { smeId?: string }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const overview = await getDebtOverview(smeId);
    const demo = overview.loans.some((l) => l.provenance?.source === 'demo');
    return {
      data: {
        smeId,
        loans: overview.loans.map((loan) => ({
          lender: loan.lender,
          product: loan.product,
          outstanding: loan.outstanding,
          rateType: loan.rateType,
          effectiveRatePct: loan.effectiveRatePct,
          referenceRateName: loan.referenceRateName,
          annualInterest: loan.annualInterest,
          monthlyPayment: loan.monthlyPayment,
          remainingMonths: loan.remainingMonths,
        })),
        totalOutstanding: overview.totalOutstanding,
        totalAnnualInterest: overview.totalAnnualInterest,
        totalAnnualDebtService: overview.totalAnnualDebtService,
        weightedAverageRatePct: overview.weightedAverageRatePct,
        source:
          overview.loans.find((l) => l.provenance)?.provenance?.sourceLabel ?? 'ข้อมูลภายในระบบ',
        asOf: overview.loans.find((l) => l.provenance)?.provenance?.lastUpdated ?? null,
      },
      source: demo ? 'demo' : 'bot',
      notice: overview.notice,
    };
  },
};

const cashRunway: ToolDefinition = {
  name: 'project_cash_runway',
  title: 'ประมาณระยะเวลาที่เงินสดพอใช้',
  description:
    'คำนวณว่าเงินสดที่มีอยู่ประคองธุรกิจได้กี่เดือน จากค่าใช้จ่ายดำเนินงานและภาระหนี้จริง ' +
    'ระบุค่าใช้จ่ายต่อเดือนเองได้ถ้าต้องการจำลองสถานการณ์',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ smeId?: string; monthlyBurnOverride?: number }>({
    smeId: smeIdField,
    monthlyBurnOverride: field.number('ค่าใช้จ่ายต่อเดือนที่ต้องการใช้แทนค่าจากงบ (บาท)'),
  }),
  async handler(args: { smeId?: string; monthlyBurnOverride?: number }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const { current } = loadStatements(smeId);
    const statement = derive(current);
    const debt = await getDebtOverview(smeId);

    const monthlyOpex = statement.operatingExpenses / 12;
    const monthlyDebtService = debt.totalAnnualDebtService / 12;
    const burn = args.monthlyBurnOverride ?? monthlyOpex + monthlyDebtService;
    const runwayMonths = burn > 0 ? round2(statement.cash / burn) : null;

    return {
      data: {
        smeId,
        cash: statement.cash,
        monthlyOperatingExpenses: round2(monthlyOpex),
        monthlyDebtService: round2(monthlyDebtService),
        monthlyBurnUsed: round2(burn),
        runwayMonths,
        note:
          'สมมติว่ารายรับหยุดทั้งหมด เป็นการมองกรณีเลวร้าย ไม่ใช่การพยากรณ์กระแสเงินสดปกติ',
      },
      source: debt.loans.some((l) => l.provenance?.source === 'demo') ? 'demo' : 'local',
      notice: debt.notice,
    };
  },
};

const currencyTool: ToolDefinition = {
  name: 'convert_currency',
  title: 'แปลงสกุลเงินด้วยอัตราของ ธปท.',
  description:
    'แปลงจำนวนเงินระหว่างสกุลเงินโดยใช้อัตราแลกเปลี่ยนล่าสุดจาก ธปท. ' +
    'รองรับ THB, USD, EUR, JPY, CNY, GBP, SGD',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ amount: number; from: string; to: string }>({
    amount: field.number('จำนวนเงินที่ต้องการแปลง', { required: true }),
    from: field.enumOf('สกุลเงินต้นทาง', ['THB', 'USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'], {
      required: true,
    }),
    to: field.enumOf('สกุลเงินปลายทาง', ['THB', 'USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'], {
      required: true,
    }),
  }),
  async handler(args: { amount: number; from: string; to: string }) {
    const result = await convertCurrency(args.amount, args.from, args.to);
    return {
      data: {
        amount: result.amount,
        from: result.from,
        to: result.to,
        converted: result.converted,
        rateUsed: result.rateUsed,
        asOf: result.asOf,
        source: result.provenance.sourceLabel,
        isDemoData: result.provenance.source === 'demo',
      },
      source: result.provenance.source,
      notice: result.provenance.notice,
      citation: { label: `${result.provenance.sourceLabel} — ${result.rateLabel}`, asOf: result.asOf },
    };
  },
};

const fxRisk: ToolDefinition = {
  name: 'assess_fx_exposure',
  title: 'ประเมินความเสี่ยงอัตราแลกเปลี่ยน',
  description:
    'ประเมินผลกระทบต่อกำไรของกิจการเมื่อค่าเงินบาทแข็งหรืออ่อนตามสัดส่วนที่กำหนด ' +
    'อ้างอิงมูลค่าธุรกรรมเงินตราต่างประเทศต่อปีที่บันทึกไว้และอัตราแลกเปลี่ยนล่าสุดจาก ธปท.',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<{ smeId?: string; movePercent?: number }>({
    smeId: smeIdField,
    movePercent: field.number('สมมติค่าเงินเปลี่ยนกี่เปอร์เซ็นต์ (ค่าเริ่มต้น 5)', { default: 5 }),
  }),
  async handler(args: { smeId?: string; movePercent?: number }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const sme = getSme(smeId)!;
    const move = args.movePercent ?? 5;

    if (!sme.fxExposureCurrency || sme.fxAnnualExposure <= 0) {
      return {
        data: {
          smeId,
          hasExposure: false,
          message: 'กิจการนี้ไม่มีรายการเงินตราต่างประเทศที่บันทึกไว้',
        },
        source: 'local' as const,
      };
    }

    const metric = await getBotService().getExchangeRate(sme.fxExposureCurrency);
    const up = fxSensitivity(sme.fxAnnualExposure, move);
    const down = fxSensitivity(sme.fxAnnualExposure, -move);

    return {
      data: {
        smeId,
        hasExposure: true,
        currency: sme.fxExposureCurrency,
        annualExposureThb: sme.fxAnnualExposure,
        currentRate: metric.current,
        asOf: metric.currentPeriod,
        scenarios: [
          { movePercent: up.movePercent, profitImpactThb: up.impactThb },
          { movePercent: down.movePercent, profitImpactThb: down.impactThb },
        ],
        note: 'ประมาณแบบเชิงเส้นจากมูลค่าธุรกรรมต่อปี ไม่รวมผลของการทำประกันความเสี่ยง',
      },
      source: metric.provenance.source,
      notice: metric.provenance.notice,
      citation: {
        label: `${metric.provenance.sourceLabel} — ${sme.fxExposureCurrency}/THB`,
        asOf: metric.currentPeriod,
      },
    };
  },
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const financeTools: ToolDefinition[] = [
  listCompanies,
  analyzeStatement,
  financialRatios,
  loanPayment,
  financingCost,
  debtCapacity,
  existingDebt,
  cashRunway,
  currencyTool,
  fxRisk,
];
