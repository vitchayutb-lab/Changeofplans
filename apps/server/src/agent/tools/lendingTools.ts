/**
 * เครื่องมือตอบคำถาม "ธุรกิจแบบไหนกู้ง่ายขึ้น"
 *
 * ต่างจาก assess_startup_loan_readiness ที่ตอบว่ากิจการหนึ่งจะกู้ผ่านไหม เครื่องมือชุดนี้
 * ตอบคำถามก่อนหน้านั้น คือเงื่อนไขในตลาดเป็นอย่างไร ธุรกิจประเภทไหนมีทางเลือกมากกว่า
 * และถ้าจะให้กู้ง่ายขึ้นต้องแก้อะไรก่อน
 */

import { lendingConditions, lendingOverview } from '../../services/funding/conditions.js';
import { parseLendingProfile } from '../../services/funding/parseLendingProfile.js';
import { defineSchema, field } from '../schema.js';
import type { ToolDefinition } from '../registry.js';

const INDUSTRY_VALUES = [
  'manufacturing',
  'retail',
  'food',
  'services',
  'logistics',
  'agriculture',
  'tech',
];

const overviewTool: ToolDefinition = {
  name: 'lending_conditions_overview',
  title: 'ภาพรวมเงื่อนไขการกู้รายอุตสาหกรรม',
  description:
    'บอกว่าธุรกิจแต่ละประเภทเข้าถึงแหล่งเงินได้กว้างแค่ไหน โดยนับจากทะเบียนโครงการจริงในระบบ: ' +
    'มีกี่โครงการที่รับ กี่โครงการที่ไม่ต้องมีหลักประกัน กี่โครงการที่เปิดใหม่ก็ยื่นได้ ' +
    'พร้อมสรุปเกณฑ์มาตรฐานของแต่ละเงื่อนไข เช่น อายุกิจการและ DSCR ที่โครงการต่าง ๆ กำหนด ' +
    'ใช้เมื่อผู้ใช้ถามว่าธุรกิจประเภทไหนกู้ง่ายกว่ากัน หรือถามว่าเงื่อนไขการกู้โดยทั่วไปมีอะไรบ้าง ' +
    'เครื่องมือนี้ไม่ต้องใช้ข้อมูลของกิจการใด',
  category: 'funding',
  readOnly: true,
  schema: defineSchema<Record<string, never>>({}),
  async handler() {
    const overview = lendingOverview();
    return {
      data: {
        totalPrograms: overview.totalPrograms,
        industries: overview.industries.map((entry) => ({
          industry: entry.industry,
          industryTh: entry.labelTh,
          opennessScore: entry.opennessScore,
          programsAccepting: entry.programs,
          programsTargetingThisIndustry: entry.targeted,
          noCollateralRequired: entry.noCollateral,
          openFromDayOne: entry.dayOne,
          noDscrRequirement: entry.noDscr,
          rateRangePct: [entry.rateMinPct, entry.rateMaxPct],
          maxAmount: entry.maxAmount,
          targetedPrograms: entry.targetedProgramsTh,
        })),
        standardConditions: overview.rules.map((rule) => ({
          condition: rule.labelTh,
          whyItMatters: rule.explanationTh,
          programsWithThisRule: `${rule.programsWithRule}/${rule.totalPrograms}`,
          thresholdsFound: rule.thresholdsTh,
        })),
        opennessFormula: overview.opennessFormulaTh,
        note: 'คะแนนความเปิดกว้างคือการนับเงื่อนไขในทะเบียนโครงการ ไม่ใช่สถิติอัตราอนุมัติของผู้ให้กู้',
      },
      source: 'local',
      notice: null,
      citation: null,
    };
  },
};

const checkTool: ToolDefinition = {
  name: 'check_lending_conditions',
  title: 'ตรวจเงื่อนไขการกู้ของธุรกิจ',
  description:
    'รับคุณสมบัติของธุรกิจแล้วตอบว่าผ่านเงื่อนไขกี่โครงการจากทั้งหมด ติดเงื่อนไขข้อไหน ' +
    'แก้ข้อไหนแล้วจะปลดล็อกเพิ่มกี่โครงการ (คำนวณโดยแก้โปรไฟล์แล้วตรวจใหม่จริง ไม่ใช่ประมาณ) ' +
    'และถ้าเป็นธุรกิจประเภทอื่นโดยตัวเลขอื่นเท่าเดิม จะผ่านมากขึ้นหรือน้อยลงเท่าไร ' +
    'ใช้เมื่อผู้ใช้ถามว่าธุรกิจของตัวเองจะกู้ง่ายขึ้นได้อย่างไร หรือถามว่าทำธุรกิจแบบไหนถึงจะกู้ผ่านง่ายกว่า',
  category: 'funding',
  readOnly: true,
  schema: defineSchema<Record<string, unknown>>({
    industry: field.enumOf('ประเภทธุรกิจ', INDUSTRY_VALUES, { default: 'services' }),
    province: field.string('จังหวัดที่ตั้งกิจการ', { default: 'กรุงเทพมหานคร' }),
    yearsOperating: field.number('เปิดดำเนินการมาแล้วกี่ปี (0 = เพิ่งเริ่ม)', { default: 0 }),
    employees: field.number('จำนวนพนักงาน', { default: 0 }),
    annualRevenue: field.number('รายได้ต่อปี (บาท)', { default: 0 }),
    dscr: field.number(
      'ความสามารถชำระหนี้ปัจจุบัน (กระแสเงินสดจากการดำเนินงาน ÷ ภาระผ่อนทั้งปี) — ไม่ต้องส่งถ้ายังไม่ทราบ',
    ),
    hasCollateral: field.boolean('มีหลักประกัน (ที่ดิน อาคาร เครื่องจักร) หรือไม่', {
      default: false,
    }),
    amountNeeded: field.number('วงเงินที่ต้องการ (บาท)', { required: true, minimum: 10_000 }),
  }),
  async handler(args: Record<string, unknown>) {
    const report = lendingConditions(parseLendingProfile(args));

    return {
      data: {
        eligibility: `ผ่านเงื่อนไข ${report.eligiblePrograms} จาก ${report.totalPrograms} โครงการ`,
        eligiblePrograms: report.outcomes
          .filter((outcome) => outcome.eligible)
          .map((outcome) => ({
            program: outcome.nameTh,
            provider: outcome.provider,
            type: outcome.type,
          })),
        blockedPrograms: report.outcomes
          .filter((outcome) => !outcome.eligible)
          .map((outcome) => ({
            program: outcome.nameTh,
            failedConditions: outcome.conditions
              .filter((condition) => !condition.passed)
              .map((condition) => `${condition.labelTh}: มี ${condition.actual} / ต้องการ ${condition.required}`),
          })),
        howToBorrowMoreEasily: report.levers.map((lever) => ({
          condition: lever.labelTh,
          current: lever.currentTh,
          target: lever.targetTh,
          blocksPrograms: lever.blocking,
          unlocksIfFixed: lever.unlocks,
          whatToDo: lever.actionTh,
          programsUnlocked: lever.unlockedProgramsTh,
        })),
        ifTheBusinessWereAnotherIndustry: report.industrySwitches.map((entry) => ({
          industry: entry.industry,
          industryTh: entry.labelTh,
          eligiblePrograms: entry.eligiblePrograms,
          differenceFromCurrent: entry.delta,
          isCurrent: entry.current,
        })),
        industryOpenness: {
          score: report.industry.opennessScore,
          programsAccepting: report.industry.programs,
          of: report.industry.totalPrograms,
        },
        summary: report.summaryTh,
        isEstimate: true,
        note: report.disclaimerTh,
      },
      source: 'local',
      notice: null,
      citation: null,
    };
  },
};

export const lendingTools: ToolDefinition[] = [overviewTool, checkTool];
