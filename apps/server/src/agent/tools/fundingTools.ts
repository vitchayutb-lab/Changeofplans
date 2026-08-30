/** เครื่องมือค้นหาและจับคู่แหล่งเงินทุน */

import type { FundingType } from '@sme/shared';
import { getProgram, listPrograms } from '../../db/fundingRepo.js';
import { getSme, listSmes } from '../../db/smeRepo.js';
import { NotFoundError } from '../../services/finance/analysis.js';
import { matchFundingPrograms } from '../../services/funding/matcher.js';
import { defineSchema, field } from '../schema.js';
import type { ToolContext, ToolDefinition } from '../registry.js';

function resolveSmeId(args: { smeId?: string }, ctx: ToolContext): string {
  const smeId = args.smeId ?? ctx.smeId;
  if (!smeId) throw new NotFoundError('ต้องระบุ smeId ของกิจการ');
  if (!getSme(smeId)) {
    throw new NotFoundError(
      `ไม่พบกิจการ "${smeId}" — ที่มีอยู่: ${listSmes().map((s) => s.id).join(', ')}`,
    );
  }
  return smeId;
}

const searchPrograms: ToolDefinition = {
  name: 'search_funding_programs',
  title: 'ค้นหาโครงการสนับสนุนเงินทุน',
  description:
    'ค้นหาโครงการสินเชื่อ เงินให้เปล่า การค้ำประกัน และการร่วมลงทุนในฐานข้อมูล ' +
    'กรองตามประเภท ช่วงวงเงิน และอุตสาหกรรมได้',
  category: 'funding',
  readOnly: true,
  schema: defineSchema<{
    type?: string;
    minAmount?: number;
    maxAmount?: number;
    industry?: string;
  }>({
    type: field.enumOf('ประเภทแหล่งเงินทุน', ['loan', 'grant', 'guarantee', 'equity', 'subsidy']),
    minAmount: field.number('วงเงินขั้นต่ำที่ต้องการ (บาท)'),
    maxAmount: field.number('วงเงินสูงสุดที่ต้องการ (บาท)'),
    industry: field.string('อุตสาหกรรม เช่น manufacturing, retail, food'),
  }),
  async handler(args: { type?: string; minAmount?: number; maxAmount?: number; industry?: string }) {
    let programs = listPrograms(args.type ? { type: args.type as FundingType } : {});

    if (args.minAmount !== undefined) {
      programs = programs.filter((p) => p.maxAmount >= args.minAmount!);
    }
    if (args.maxAmount !== undefined) {
      programs = programs.filter((p) => p.minAmount <= args.maxAmount!);
    }
    if (args.industry) {
      const industry = args.industry.toLowerCase();
      programs = programs.filter(
        (p) =>
          p.eligibleIndustries.includes('*') ||
          p.eligibleIndustries.some((i) => i.toLowerCase() === industry),
      );
    }

    return {
      data: {
        count: programs.length,
        programs: programs.map((p) => ({
          id: p.id,
          name: p.nameTh,
          provider: p.provider,
          type: p.type,
          amountRange: [p.minAmount, p.maxAmount],
          rateRange: p.rateMin === null ? null : [p.rateMin, p.rateMax],
          rateBasis: p.rateBasis,
          maxTermMonths: p.maxTermMonths,
          requiresCollateral: p.requiresCollateral,
          description: p.descriptionTh,
        })),
      },
      source: 'local' as const,
      citation: { label: 'ฐานข้อมูลแหล่งเงินทุนในระบบ', asOf: null },
    };
  },
};

const matchPrograms: ToolDefinition = {
  name: 'match_funding_programs',
  title: 'จับคู่แหล่งเงินทุนกับกิจการ',
  description:
    'ตรวจเงื่อนไขทุกข้อของทุกโครงการกับข้อมูลจริงของกิจการ (อุตสาหกรรม พื้นที่ อายุกิจการ ' +
    'จำนวนพนักงาน รายได้ DSCR วงเงิน) แล้วจัดอันดับ พร้อมบอกว่าข้อไหนไม่ผ่านเพราะอะไร ' +
    'ประมาณการต้นทุนใช้อัตราอ้างอิงล่าสุดจาก ธปท.',
  category: 'funding',
  readOnly: true,
  schema: defineSchema<{ smeId?: string; amountNeeded?: number; limit?: number }>({
    smeId: field.string('รหัสกิจการ (ถ้าไม่ระบุจะใช้กิจการที่เลือกอยู่)'),
    amountNeeded: field.number('วงเงินที่ต้องการ (บาท)'),
    limit: field.integer('จำนวนผลลัพธ์สูงสุด (ค่าเริ่มต้น 5)', { default: 5, minimum: 1, maximum: 20 }),
  }),
  async handler(args: { smeId?: string; amountNeeded?: number; limit?: number }, ctx) {
    const smeId = resolveSmeId(args, ctx);
    const matches = await matchFundingPrograms({
      smeId,
      ...(args.amountNeeded !== undefined ? { amountNeeded: args.amountNeeded } : {}),
    });
    const limited = matches.slice(0, args.limit ?? 5);
    const usesDemoRate = limited.some((m) => m.estimate?.provenance?.source === 'demo');

    return {
      data: {
        smeId,
        eligibleCount: matches.filter((m) => m.eligible).length,
        totalEvaluated: matches.length,
        matches: limited.map((m) => ({
          programId: m.program.id,
          name: m.program.nameTh,
          provider: m.program.provider,
          type: m.program.type,
          score: m.score,
          eligible: m.eligible,
          reason: m.reasonTh,
          failedRules: m.checks.filter((c) => !c.passed).map((c) => c.labelTh),
          estimate: m.estimate
            ? {
                amount: m.estimate.amount,
                estimatedRatePct: m.estimate.estimatedRatePct,
                referenceRateName: m.estimate.referenceRateName,
                annualInterest: m.estimate.annualInterest,
                monthlyPayment: m.estimate.monthlyPayment,
              }
            : null,
        })),
      },
      source: usesDemoRate ? 'demo' : 'local',
      notice: limited.map((m) => m.estimate?.provenance?.notice).find((n) => n) ?? null,
      citation: { label: 'ฐานข้อมูลแหล่งเงินทุน + อัตราอ้างอิงจาก ธปท.', asOf: null },
    };
  },
};

const programDetail: ToolDefinition = {
  name: 'get_funding_program',
  title: 'รายละเอียดโครงการเงินทุน',
  description: 'ดึงรายละเอียดทั้งหมดของโครงการหนึ่งตามรหัสโครงการ',
  category: 'funding',
  readOnly: true,
  schema: defineSchema<{ programId: string }>({
    programId: field.string('รหัสโครงการ เช่น fp-smed-transform', { required: true }),
  }),
  async handler(args: { programId: string }) {
    const program = getProgram(args.programId);
    if (!program) {
      throw new NotFoundError(
        `ไม่พบโครงการ "${args.programId}" — ใช้ search_funding_programs เพื่อดูรายการที่มี`,
      );
    }
    return { data: { program }, source: 'local' as const };
  },
};

export const fundingTools: ToolDefinition[] = [searchPrograms, matchPrograms, programDetail];
