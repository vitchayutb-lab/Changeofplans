/**
 * เทสต์การจัดหาแหล่งเงินทุน
 *
 * สองอย่างที่พังแล้วให้คำแนะนำผิดทาง: จัดสรรเกินกว่าที่แหล่งนั้นมีจริง (แผนดูครอบคลุม
 * ทั้งที่หาเงินไม่ได้) และการนับการค้ำประกันเป็นเงิน (นับเงินซ้ำกับสินเชื่อ)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { FundingSource } from '@sme/shared';
import { listPrograms } from '../src/db/fundingRepo.js';
import { debtCapacity } from '../src/services/finance/capacity.js';
import { ratioCatalog } from '../src/services/finance/ratios.js';
import { allocate, fundingStrategy, releaseFromDays } from '../src/services/finance/strategy.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

const FOOD = 'sme-kruathai-foods';
const STRAINED = 'sme-baansuan-retail';

describe('เงินที่ปลดล็อกจากเงินทุนหมุนเวียน', () => {
  it('คิดจากยอดต่อวันคูณจำนวนวันที่ลดได้', () => {
    expect(releaseFromDays(100_000, 60, 45)).toBe(1_500_000);
  });

  it('ได้ศูนย์เมื่อดีกว่าเกณฑ์อยู่แล้ว ไม่ใช่ค่าติดลบ', () => {
    // การยืดวันออกไปเพื่อ "ปลดล็อกเงิน" คือการสร้างปัญหา ไม่ใช่แหล่งเงินทุน
    expect(releaseFromDays(100_000, 30, 45)).toBe(0);
  });

  it('คิดไม่ได้เมื่อไม่มีจำนวนวันหรือไม่มียอด', () => {
    expect(releaseFromDays(100_000, null, 45)).toBe(0);
    expect(releaseFromDays(0, 60, 45)).toBe(0);
  });

  it('ใช้เป้าหมายจากทะเบียนเกณฑ์ของระบบ ไม่ใช่ค่าที่ตั้งเองในหน้านี้', async () => {
    const result = await fundingStrategy({ smeId: FOOD });
    const ratios = ratioCatalog().flatMap((g) => g.ratios);
    const receivable = ratios.find((r) => r.key === 'receivable_days')!;
    const inventory = ratios.find((r) => r.key === 'inventory_days')!;

    expect(result.workingCapital.releases.find((r) => r.key === 'receivables')!.targetDays).toBe(
      receivable.benchmark.good,
    );
    expect(result.workingCapital.releases.find((r) => r.key === 'inventory')!.targetDays).toBe(
      inventory.benchmark.good,
    );
  });

  it('ยอดที่ปลดล็อกตรงกับจำนวนวันที่รายงาน', async () => {
    const result = await fundingStrategy({ smeId: FOOD });
    for (const release of result.workingCapital.releases) {
      if (release.currentDays === null) continue;
      const expected = release.currentDays <= release.targetDays;
      expect(release.releasableAmount === 0).toBe(expected);
    }
  });
});

describe('การจัดสรรตามลำดับต้นทุน', () => {
  const sources: FundingSource[] = [
    { kind: 'working_capital', labelTh: 'หมุนเวียน', availableAmount: 1_000_000, annualCostPct: 0, nonCashCostTh: null, countsTowardPlan: true, whyTh: '', howToTh: '', basisTh: '', programsTh: [] },
    { kind: 'grant', labelTh: 'ให้เปล่า', availableAmount: 2_000_000, annualCostPct: null, nonCashCostTh: null, countsTowardPlan: true, whyTh: '', howToTh: '', basisTh: '', programsTh: [] },
    { kind: 'debt', labelTh: 'สินเชื่อ', availableAmount: 5_000_000, annualCostPct: 7, nonCashCostTh: null, countsTowardPlan: true, whyTh: '', howToTh: '', basisTh: '', programsTh: [] },
    { kind: 'guarantee', labelTh: 'ค้ำประกัน', availableAmount: 40_000_000, annualCostPct: null, nonCashCostTh: null, countsTowardPlan: false, whyTh: '', howToTh: '', basisTh: '', programsTh: [] },
  ];

  it('ใช้แหล่งที่ถูกที่สุดจนหมดก่อนขยับไปแหล่งถัดไป', () => {
    const plan = allocate(2_500_000, sources);
    expect(plan.map((s) => s.kind)).toEqual(['working_capital', 'grant']);
    expect(plan[0]!.amount).toBe(1_000_000);
    expect(plan[1]!.amount).toBe(1_500_000);
  });

  it('ไม่จัดสรรเกินกว่าที่แต่ละแหล่งมีจริง', () => {
    const plan = allocate(100_000_000, sources);
    for (const step of plan) {
      const source = sources.find((s) => s.kind === step.kind)!;
      expect(step.amount).toBeLessThanOrEqual(source.availableAmount);
    }
  });

  it('ไม่จัดสรรเกินกว่าที่ต้องการ', () => {
    const plan = allocate(500_000, sources);
    expect(plan.reduce((sum, s) => sum + s.amount, 0)).toBe(500_000);
  });

  it('ไม่นับการค้ำประกันเป็นเงิน เพราะจะกลายเป็นการนับซ้ำกับสินเชื่อ', () => {
    const plan = allocate(100_000_000, sources);
    expect(plan.map((s) => s.kind)).not.toContain('guarantee');
    // รวมทุกก้อนต้องไม่เกินผลรวมของแหล่งที่นับได้จริง
    const realTotal = sources
      .filter((s) => s.countsTowardPlan)
      .reduce((sum, s) => sum + s.availableAmount, 0);
    expect(plan.reduce((sum, s) => sum + s.amount, 0)).toBe(realTotal);
  });

  it('ยอดสะสมเพิ่มขึ้นเรื่อย ๆ และเท่ากับผลรวมของก้อนก่อนหน้า', () => {
    const plan = allocate(7_000_000, sources);
    let running = 0;
    for (const step of plan) {
      running += step.amount;
      expect(step.cumulativeAmount).toBeCloseTo(running, 2);
    }
  });

  it('คิดดอกเบี้ยต่อปีเฉพาะก้อนที่มีต้นทุน', () => {
    const plan = allocate(7_000_000, sources);
    const debt = plan.find((s) => s.kind === 'debt')!;
    expect(debt.annualCost).toBeCloseTo((debt.amount * 7) / 100, 2);
    expect(plan.find((s) => s.kind === 'grant')!.annualCost).toBe(0);
  });
});

describe('แผนจัดหาเงินของกิจการจริง', () => {
  it('ครอบคลุมบวกส่วนที่ขาด เท่ากับที่ต้องการเสมอ', async () => {
    for (const need of [1_000_000, 10_000_000, 60_000_000]) {
      const result = await fundingStrategy({ smeId: FOOD, needAmount: need });
      expect(result.coveredAmount + result.gapAmount).toBeCloseTo(need, 1);
    }
  });

  it('วงเงินสินเชื่อตรงกับที่หน้าต้นทุนหนี้คำนวณ ไม่ใช่ตัวเลขคนละชุด', async () => {
    const strategy = await fundingStrategy({ smeId: FOOD, needAmount: 50_000_000 });
    const capacity = await debtCapacity({ smeId: FOOD });
    const fromStrategy = strategy.sources.find((s) => s.kind === 'debt')!;
    const fromCapacity = capacity.capacities.find((c) => c.targetDscr === 1.2)!;
    expect(fromStrategy.availableAmount).toBe(fromCapacity.maxAmount);
    expect(fromStrategy.annualCostPct).toBe(capacity.market.estimatedRatePct);
  });

  it('เสนอเฉพาะโครงการที่กิจการนี้เข้าเกณฑ์จริง', async () => {
    const result = await fundingStrategy({ smeId: STRAINED });
    const names = result.sources.flatMap((s) => s.programsTh);
    const eligibleNames = listPrograms()
      .filter(
        (p) =>
          (p.eligibleIndustries.includes('*') || p.eligibleIndustries.includes('retail')) &&
          (p.eligibleProvinces.includes('*') || p.eligibleProvinces.includes('เชียงใหม่')),
      )
      .map((p) => p.nameTh);
    for (const name of names) expect(eligibleNames).toContain(name);
  });

  it('กิจการที่กู้ไม่ได้เลย ยังหาเงินจากแหล่งอื่นได้และแผนบอกส่วนที่ขาด', async () => {
    const result = await fundingStrategy({ smeId: STRAINED, needAmount: 60_000_000 });
    expect(result.sources.find((s) => s.kind === 'debt')!.availableAmount).toBe(0);
    expect(result.plan.map((s) => s.kind)).not.toContain('debt');
    expect(result.coveredAmount).toBeGreaterThan(0);
    expect(result.gapAmount).toBeGreaterThan(0);
    expect(result.summaryTh).toContain('ยังขาดอีก');
  });

  it('ต้นทุนถัวเฉลี่ยคิดบนยอดทั้งแผน ไม่ใช่เฉพาะก้อนที่มีดอกเบี้ย', async () => {
    const result = await fundingStrategy({ smeId: FOOD, needAmount: 50_000_000 });
    if (result.coveredAmount > 0) {
      expect(result.blendedCostPct).toBeCloseTo(
        (result.planAnnualCost / result.coveredAmount) * 100,
        2,
      );
    }
  });

  it('วงจรเงินสดคิดจากสามส่วนตามสูตร', async () => {
    const result = await fundingStrategy({ smeId: FOOD });
    const { releases, payableDays, cashCycleDays } = result.workingCapital;
    const ar = releases.find((r) => r.key === 'receivables')!.currentDays!;
    const inv = releases.find((r) => r.key === 'inventory')!.currentDays!;
    expect(cashCycleDays).toBeCloseTo(ar + inv - payableDays!, 1);
  });
});
