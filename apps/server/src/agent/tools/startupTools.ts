/**
 * เครื่องมือสำหรับผู้ประกอบการหน้าใหม่ที่ยังไม่มีงบการเงินให้วิเคราะห์
 *
 * ต่างจากเครื่องมือกลุ่ม finance ตรงที่ไม่ได้อ่านจากฐานข้อมูล แต่รับตัวเลขที่ผู้ใช้บอก
 * เข้ามาตรง ๆ แล้วคำนวณตัวชี้วัดที่ธนาคารใช้ พร้อมดึงอัตราดอกเบี้ยจริงจาก ธปท. มาตั้งราคา
 */

import { assessStartup } from '../../services/startup/assessment.js';
import { parseStartupProfile } from '../../services/startup/parseProfile.js';
import { defineSchema, field } from '../schema.js';
import type { ToolDefinition } from '../registry.js';

const assessTool: ToolDefinition = {
  name: 'assess_startup_loan_readiness',
  title: 'ประเมินความพร้อมกู้ของกิจการใหม่',
  description:
    'ประเมินว่ากิจการที่เพิ่งเริ่มต้น (ยังไม่มีงบการเงินย้อนหลังในระบบ) จะกู้ได้ไหม ควรกู้แบบไหน ' +
    'และควรไปที่สถาบันการเงินใด โดยคำนวณ DSCR ภาระหนี้ต่อรายได้ ส่วนร่วมของเจ้าของ ' +
    'ความครอบคลุมของหลักประกัน และวงเงินสูงสุดที่กระแสเงินสดรองรับได้ ' +
    'อัตราดอกเบี้ยที่ใช้มาจากอัตราอ้างอิงล่าสุดของ ธปท. บวกส่วนต่างความเสี่ยง ' +
    'ใช้เครื่องมือนี้เมื่อผู้ใช้พูดถึงธุรกิจที่เพิ่งเปิด กำลังจะเปิด หรือยังไม่มีงบการเงิน',
  category: 'finance',
  readOnly: true,
  schema: defineSchema<Record<string, unknown>>({
    industry: field.enumOf(
      'ประเภทธุรกิจ',
      ['manufacturing', 'retail', 'food', 'services', 'logistics', 'agriculture', 'tech'],
      { default: 'services' },
    ),
    province: field.string('จังหวัดที่ตั้งกิจการ', { default: 'กรุงเทพมหานคร' }),
    monthsOperating: field.number('เปิดดำเนินการมาแล้วกี่เดือน (0 = ยังไม่เริ่มขาย)', {
      default: 0,
    }),
    ownerCapital: field.number('เงินทุนของเจ้าของที่ใส่เข้าธุรกิจแล้ว (บาท)', { default: 0 }),
    cashOnHand: field.number('เงินสดที่มีอยู่ตอนนี้ (บาท)', { default: 0 }),
    monthlyRevenue: field.number('รายได้ต่อเดือน หรือประมาณการ (บาท)', { default: 0 }),
    monthlyExpenses: field.number('ค่าใช้จ่ายรวมต่อเดือน (บาท)', { default: 0 }),
    existingDebtOutstanding: field.number('หนี้เดิมคงค้างทั้งหมด (บาท)', { default: 0 }),
    existingDebtMonthlyPayment: field.number('ค่างวดหนี้เดิมต่อเดือน (บาท)', { default: 0 }),
    ownerMonthlyIncome: field.number('รายได้อื่นของเจ้าของต่อเดือน (บาท)', { default: 0 }),
    collateralValue: field.number('มูลค่าหลักประกันที่มี (บาท, 0 = ไม่มี)', { default: 0 }),
    hasGuarantor: field.boolean('มีผู้ค้ำประกันหรือไม่', { default: false }),
    creditHistory: field.enumOf('ประวัติเครดิต', ['clean', 'none', 'late', 'default'], {
      default: 'none',
    }),
    requestedAmount: field.number('วงเงินที่ต้องการกู้ (บาท)', { required: true, minimum: 10_000 }),
    requestedYears: field.number('ระยะเวลาผ่อน (ปี)', { default: 5 }),
    purpose: field.enumOf(
      'วัตถุประสงค์การใช้เงิน',
      ['working_capital', 'equipment', 'expansion', 'inventory', 'refinance'],
      { default: 'working_capital' },
    ),
  }),
  async handler(args: Record<string, unknown>) {
    const profile = parseStartupProfile(args);
    const assessment = await assessStartup(profile);

    const topLenders = assessment.recommendations.slice(0, 5).map((item) => ({
      program: item.program.nameTh,
      provider: item.program.provider,
      type: item.program.type,
      eligible: item.eligible,
      score: item.score,
      blockedBy: item.blockedByTh,
      estimatedRatePct: item.estimate?.estimatedRatePct ?? null,
      monthlyPayment: item.estimate?.monthlyPayment ?? null,
    }));

    return {
      data: {
        // คำตอบสามข้อที่ผู้ใช้ถามจริง ๆ
        willBankLend: {
          score: assessment.score,
          likelihood: assessment.likelihood,
          likelihoodTh: assessment.likelihoodLabelTh,
          blockers: assessment.blockersTh,
        },
        whatToBorrow: assessment.suggestedProductsTh,
        whereToApply: topLenders,

        metrics: {
          monthlyProfit: assessment.metrics.monthlyProfit,
          estimatedRatePct: assessment.metrics.estimatedRatePct,
          referenceRateName: assessment.metrics.referenceRateName,
          referenceRatePct: assessment.metrics.referenceRatePct,
          riskSpreadPct: assessment.metrics.riskSpreadPct,
          newMonthlyPayment: assessment.metrics.newMonthlyPayment,
          totalMonthlyDebtService: assessment.metrics.totalMonthlyDebtService,
          dscr: assessment.metrics.dscr,
          dsrPercent: assessment.metrics.dsrPercent,
          ownerEquitySharePercent: assessment.metrics.ownerEquitySharePercent,
          cashRunwayMonths: assessment.metrics.cashRunwayMonths,
        },
        affordableAmount: assessment.affordableAmount,
        factors: assessment.factors.map((factor) => ({
          label: factor.labelTh,
          status: factor.status,
          actual: factor.actual,
          benchmark: factor.benchmark,
        })),
        actions: assessment.actions.map((action) => ({
          title: action.titleTh,
          detail: action.detailTh,
          impact: action.impactTh,
        })),
        summary: assessment.summaryTh,
        isEstimate: true,
        source: assessment.provenance?.sourceLabel ?? 'ข้อมูลภายในระบบ',
        asOf: assessment.provenance?.lastUpdated ?? null,
        isDemoData: assessment.provenance?.source === 'demo',
        note: assessment.disclaimerTh,
      },
      source: assessment.provenance?.source ?? 'local',
      notice: assessment.provenance?.notice ?? null,
      citation: assessment.provenance
        ? {
            label: `${assessment.provenance.sourceLabel} — ${assessment.metrics.referenceRateName ?? 'rate'}`,
            asOf: assessment.provenance.lastUpdated,
          }
        : null,
    };
  },
};

export const startupTools: ToolDefinition[] = [assessTool];
