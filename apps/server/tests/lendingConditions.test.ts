/**
 * เทสต์เงื่อนไขการกู้
 *
 * หัวใจของหน้านี้คือประโยค "แก้ข้อนี้แล้วจะปลดล็อกเพิ่ม N โครงการ" ถ้าตัวเลขนั้นไม่จริง
 * ฟีเจอร์ทั้งฟีเจอร์ก็ไม่มีค่า เทสต์ส่วนใหญ่จึงตรวจว่าคำแนะนำเกิดผลตามที่บอกจริง
 * ไม่ใช่แค่ว่ามีข้อความออกมา
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Industry, LendingProfile } from '@sme/shared';
import { listPrograms } from '../src/db/fundingRepo.js';
import {
  INDUSTRIES,
  checkProgram,
  industryOpenness,
  lendingConditions,
  lendingOverview,
} from '../src/services/funding/conditions.js';
import { freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
});

/** กิจการใหม่ตัวเล็ก ไม่มีหลักประกัน — ชนเงื่อนไขหลายข้อพอให้มีอะไรให้ปลดล็อก */
const NEW_SHOP: LendingProfile = {
  industry: 'retail',
  province: 'เชียงใหม่',
  yearsOperating: 0,
  employees: 8,
  annualRevenue: 4_000_000,
  dscr: null,
  hasCollateral: false,
  amountNeeded: 400_000,
};

describe('ภาพรวมความเปิดกว้างรายอุตสาหกรรม', () => {
  it('ครอบคลุมทุกอุตสาหกรรมและนับจากทะเบียนจริง', () => {
    const overview = lendingOverview();
    expect(overview.industries).toHaveLength(INDUSTRIES.length);
    expect(overview.totalPrograms).toBe(listPrograms().length);
    for (const entry of overview.industries) {
      expect(entry.totalPrograms).toBe(overview.totalPrograms);
      expect(entry.programs).toBeGreaterThan(0);
      expect(entry.programs).toBeLessThanOrEqual(entry.totalPrograms);
      expect(entry.opennessScore).toBeGreaterThanOrEqual(0);
      expect(entry.opennessScore).toBeLessThanOrEqual(100);
    }
  });

  it('เรียงจากอุตสาหกรรมที่หาแหล่งเงินได้ง่ายที่สุด', () => {
    const scores = lendingOverview().industries.map((i) => i.opennessScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('คะแนนตรงกับสูตรที่ประกาศไว้', () => {
    const programs = listPrograms();
    const entry = industryOpenness('tech', programs);
    const total = programs.length;
    const expected = Math.round(
      100 *
        (0.4 * (entry.programs / total) +
          0.25 * (entry.noCollateral / total) +
          0.2 * (entry.dayOne / total) +
          0.15 * (entry.noDscr / total)),
    );
    expect(entry.opennessScore).toBe(expected);
  });

  it('นับโครงการที่เจาะจงอุตสาหกรรมแยกจากโครงการที่เปิดให้ทุกคน', () => {
    const tech = industryOpenness('tech');
    // ทุนนวัตกรรมแบบเปิดรับเฉพาะ tech กับ food จึงต้องนับเป็นโครงการเจาะจง
    expect(tech.targetedProgramsTh).toContain('ทุนนวัตกรรมแบบเปิด (Open Innovation)');
    expect(tech.targeted).toBe(tech.targetedProgramsTh.length);
    expect(tech.targeted).toBeLessThan(tech.programs);
  });

  it('สรุปเงื่อนไขมาตรฐานโดยไม่นับโครงการที่ไม่ได้กำหนดข้อนั้น', () => {
    const overview = lendingOverview();
    const collateral = overview.rules.find((r) => r.rule === 'collateral')!;
    const withCollateral = listPrograms().filter((p) => p.requiresCollateral).length;
    expect(collateral.programsWithRule).toBe(withCollateral);
    expect(collateral.programsWithRule).toBeLessThan(collateral.totalPrograms);

    const dscr = overview.rules.find((r) => r.rule === 'dscr')!;
    expect(dscr.thresholdsTh.length).toBeGreaterThan(0);
    // เรียงจากผ่อนปรนไปเข้ม เพื่อให้อ่านไล่ลงมาได้
    expect(dscr.thresholdsTh[0]).toBe('อย่างน้อย 1.00 เท่า');
  });
});

describe('การตรวจเงื่อนไขรายโครงการ', () => {
  it('บอกได้ว่าข้อไหนไม่ผ่าน พร้อมตัวเลขสองฝั่ง', () => {
    const green = listPrograms().find((p) => p.id === 'fp-gsb-green')!;
    const outcome = checkProgram(green, NEW_SHOP);

    expect(outcome.eligible).toBe(false);
    // โครงการสีเขียวรับเฉพาะ ผลิต/ขนส่ง/เกษตร ต้องมีหลักประกัน และขอ 3 ปีขึ้นไป
    expect(outcome.failedRules).toContain('industry');
    expect(outcome.failedRules).toContain('collateral');
    expect(outcome.failedRules).toContain('years_operating');

    const collateral = outcome.conditions.find((c) => c.rule === 'collateral')!;
    expect(collateral.actual).toBe('ไม่มีหลักประกัน');
    expect(collateral.required).toBe('ต้องมีหลักประกัน');
  });

  it('ผ่านครบเมื่อโปรไฟล์เข้าเกณฑ์ทุกข้อ', () => {
    const micro = listPrograms().find((p) => p.id === 'fp-gsb-microbiz')!;
    const outcome = checkProgram(micro, NEW_SHOP);
    expect(outcome.failedRules).toEqual([]);
    expect(outcome.eligible).toBe(true);
  });

  it('ถือว่า DSCR ที่ยังไม่ระบุเป็นยังไม่ผ่าน แทนที่จะเดาว่าผ่าน', () => {
    const needsDscr = listPrograms().find((p) => p.minDscr !== null)!;
    const outcome = checkProgram(needsDscr, { ...NEW_SHOP, dscr: null });
    const check = outcome.conditions.find((c) => c.rule === 'dscr')!;
    expect(check.passed).toBe(false);
    expect(check.actual).toBe('ยังไม่ระบุ');
  });
});

describe('เงื่อนไขที่ปลดล็อกได้', () => {
  it('ไม่เสนอให้เปลี่ยนประเภทธุรกิจ เพราะไม่ใช่สิ่งที่ทำเพื่อให้กู้ผ่าน', () => {
    const report = lendingConditions(NEW_SHOP);
    expect(report.levers.map((l) => l.rule)).not.toContain('industry');
  });

  it('จำนวนที่บอกว่าจะปลดล็อก เกิดขึ้นจริงเมื่อแก้ตามนั้น', () => {
    const report = lendingConditions(NEW_SHOP);
    const programs = listPrograms();

    for (const lever of report.levers) {
      // สร้างโปรไฟล์ที่แก้เฉพาะข้อนี้ไปถึงเกณฑ์ที่ lever เสนอ แล้วนับใหม่ทั้งทะเบียน
      const fixed = applyTarget(lever.rule, lever.targetTh, NEW_SHOP);
      if (fixed === null) continue;
      const after = programs.filter((p) => checkProgram(p, fixed).eligible).length;
      expect(after - report.eligiblePrograms).toBe(lever.unlocks);
    }
  });

  it('โครงการที่บอกว่าจะปลดล็อก ตอนนี้ยังไม่ผ่านจริง', () => {
    const report = lendingConditions(NEW_SHOP);
    const eligibleNow = new Set(
      report.outcomes.filter((o) => o.eligible).map((o) => o.nameTh),
    );
    for (const lever of report.levers) {
      expect(lever.unlockedProgramsTh).toHaveLength(lever.unlocks);
      for (const name of lever.unlockedProgramsTh) {
        expect(eligibleNow.has(name)).toBe(false);
      }
    }
  });

  it('เรียงข้อที่ปลดล็อกได้มากที่สุดขึ้นก่อน', () => {
    const unlocks = lendingConditions(NEW_SHOP).levers.map((l) => l.unlocks);
    expect([...unlocks].sort((a, b) => b - a)).toEqual(unlocks);
  });

  it('จำนวนที่ข้อหนึ่งขวางอยู่ ไม่น้อยกว่าจำนวนที่แก้แล้วปลดล็อกได้', () => {
    for (const lever of lendingConditions(NEW_SHOP).levers) {
      expect(lever.blocking).toBeGreaterThanOrEqual(lever.unlocks);
    }
  });
});

describe('การเทียบข้ามประเภทธุรกิจ', () => {
  it('คุมตัวแปรอื่นให้เท่ากันหมด เปลี่ยนแค่ประเภทธุรกิจ', () => {
    const report = lendingConditions(NEW_SHOP);
    expect(report.industrySwitches).toHaveLength(INDUSTRIES.length);

    const current = report.industrySwitches.find((s) => s.current)!;
    expect(current.industry).toBe(NEW_SHOP.industry);
    expect(current.eligiblePrograms).toBe(report.eligiblePrograms);
    expect(current.delta).toBe(0);

    for (const entry of report.industrySwitches) {
      expect(entry.delta).toBe(entry.eligiblePrograms - report.eligiblePrograms);
      // ตรวจซ้ำด้วยการนับตรง ๆ ว่าจำนวนตรงกับการสลับอุตสาหกรรมจริง
      const recount = listPrograms().filter(
        (p) => checkProgram(p, { ...NEW_SHOP, industry: entry.industry }).eligible,
      ).length;
      expect(entry.eligiblePrograms).toBe(recount);
    }
  });

  it('มีอุตสาหกรรมที่ทำเครื่องหมายว่าเลือกอยู่เพียงรายการเดียว', () => {
    const current = lendingConditions(NEW_SHOP).industrySwitches.filter((s) => s.current);
    expect(current).toHaveLength(1);
  });
});

describe('รายงานรวม', () => {
  it('นับโครงการที่ผ่านตรงกับรายการผลลัพธ์', () => {
    const report = lendingConditions(NEW_SHOP);
    expect(report.totalPrograms).toBe(report.outcomes.length);
    expect(report.eligiblePrograms).toBe(report.outcomes.filter((o) => o.eligible).length);
  });

  it('เรียงโครงการที่ผ่านขึ้นก่อน แล้วตามด้วยที่ติดน้อยข้อที่สุด', () => {
    const outcomes = lendingConditions(NEW_SHOP).outcomes;
    const failedCounts = outcomes.filter((o) => !o.eligible).map((o) => o.failedRules.length);
    expect(outcomes.slice(0, report_eligible(outcomes)).every((o) => o.eligible)).toBe(true);
    expect([...failedCounts].sort((a, b) => a - b)).toEqual(failedCounts);
  });

  it('สรุปด้วยตัวเลขจริง ไม่ใช่ข้อความกำกวม', () => {
    const report = lendingConditions(NEW_SHOP);
    expect(report.summaryTh).toContain(`${report.eligiblePrograms} จาก ${report.totalPrograms}`);
    expect(report.disclaimerTh).toContain('ไม่ใช่การอนุมัติ');
  });

  it('กิจการที่ตัวเลขดีกว่า ผ่านเงื่อนไขได้ไม่น้อยกว่ากิจการที่ตัวเลขแย่กว่า', () => {
    const weak = lendingConditions(NEW_SHOP).eligiblePrograms;
    const strong = lendingConditions({
      ...NEW_SHOP,
      yearsOperating: 5,
      dscr: 1.5,
      hasCollateral: true,
    }).eligiblePrograms;
    expect(strong).toBeGreaterThanOrEqual(weak);
  });
});

function report_eligible(outcomes: { eligible: boolean }[]): number {
  return outcomes.filter((o) => o.eligible).length;
}

/** แปลงเกณฑ์ที่ lever เสนอกลับเป็นโปรไฟล์ เพื่อตรวจว่าคำแนะนำให้ผลตามที่บอก */
function applyTarget(
  rule: string,
  targetTh: string,
  profile: LendingProfile,
): LendingProfile | null {
  const digits = (text: string): number => Number(text.replace(/[^\d.]/g, ''));
  switch (rule) {
    case 'years_operating':
      return { ...profile, yearsOperating: digits(targetTh) };
    case 'dscr':
      return { ...profile, dscr: digits(targetTh) };
    case 'collateral':
      return { ...profile, hasCollateral: true };
    case 'employees':
      return { ...profile, employees: digits(targetTh) };
    case 'revenue':
      return { ...profile, annualRevenue: digits(targetTh) };
    case 'province':
      return { ...profile, province: targetTh.split(', ')[0]! };
    case 'amount': {
      const [min] = targetTh.split(' – ');
      return { ...profile, amountNeeded: digits(min!) };
    }
    default:
      return null;
  }
}

describe('อุตสาหกรรมทุกประเภท', () => {
  it('ให้ผลที่สมเหตุสมผลได้ทุกประเภท ไม่ใช่แค่ที่ทดสอบไว้', () => {
    for (const industry of INDUSTRIES as Industry[]) {
      const report = lendingConditions({ ...NEW_SHOP, industry });
      expect(report.eligiblePrograms).toBeGreaterThanOrEqual(0);
      expect(report.eligiblePrograms).toBeLessThanOrEqual(report.totalPrograms);
      expect(report.industry.industry).toBe(industry);
      expect(report.summaryTh.length).toBeGreaterThan(0);
    }
  });
});

describe('การเลือกวงเงินเป้าหมาย', () => {
  /** โปรไฟล์ที่ขอวงเงินเกินช่วงของหลายโครงการ จึงมีตัวเลือกให้เลือกผิดได้ */
  const OVERSIZED: LendingProfile = {
    ...NEW_SHOP,
    yearsOperating: 3,
    employees: 30,
    annualRevenue: 50_000_000,
    dscr: 1.3,
    province: 'กรุงเทพมหานคร',
    amountNeeded: 3_000_000,
  };

  it('เลือกวงเงินที่ให้ผลดีที่สุด ไม่ใช่ช่วงที่ใกล้ตัวเลขเดิมที่สุด', () => {
    const report = lendingConditions(OVERSIZED);
    const lever = report.levers.find((l) => l.rule === 'amount');
    expect(lever).toBeDefined();

    const programs = listPrograms();
    // ลองทุกขอบของช่วงวงเงินที่มีจริง แล้วหาผลสุทธิที่ดีที่สุดด้วยวิธีตรง ๆ
    const candidates = programs.flatMap((p) => [p.minAmount, p.maxAmount]);
    const bestGain = Math.max(
      ...candidates.map(
        (amountNeeded) =>
          programs.filter((p) => checkProgram(p, { ...OVERSIZED, amountNeeded }).eligible).length -
          report.eligiblePrograms,
      ),
    );

    expect(lever!.unlocks).toBe(bestGain);
  });

  it('นับผลสุทธิ จึงไม่บวกเฉพาะที่ได้เพิ่มโดยลืมที่หลุดไป', () => {
    const report = lendingConditions(OVERSIZED);
    const programs = listPrograms();

    for (const lever of report.levers) {
      const fixed = applyTarget(lever.rule, lever.targetTh, OVERSIZED);
      if (fixed === null) continue;
      const after = programs.filter((p) => checkProgram(p, fixed).eligible).length;
      // ผลสุทธิต้องตรงกับจำนวนที่รายงาน แม้กรณีที่ขยับแล้วมีโครงการหลุดออกไปด้วย
      expect(after - report.eligiblePrograms).toBe(lever.unlocks);
      expect(lever.unlocks).toBeLessThanOrEqual(lever.unlockedProgramsTh.length);
    }
  });
});
