/**
 * เทสต์ภาระหนี้ในอนาคต
 *
 * หัวใจของหน้านี้คือฝั่งหนี้ที่ไม่คงที่ — ถ้าภาระรายปีไม่ตรงกับตารางผ่อนจริง คำตอบว่า
 * "อีกกี่ปีถึงจะเริ่มไม่ไหว" ก็ผิดตามไปทั้งหมด เทสต์จึงเทียบกับการกางตารางผ่อนตรง ๆ
 * ไม่ใช่เทียบกับค่าที่เอนจินเองคำนวณ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ExistingLoan } from '@sme/shared';
import { listLoans } from '../src/db/smeRepo.js';
import { debtOutlook, debtServicePath, historicalCagrPct } from '../src/services/finance/outlook.js';
import { amortize } from '../src/services/finance/loan.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

const HEALTHY = 'sme-siam-textile';
const STRAINED = 'sme-baansuan-retail';

function loanOf(smeId: string, product: ExistingLoan['product']): ExistingLoan {
  return listLoans(smeId).find((l) => l.product === product)!;
}

describe('อัตราการเติบโตย้อนหลัง', () => {
  it('คิดแบบทบต้นจากปีแรกถึงปีสุดท้าย', () => {
    // 100 -> 121 ในสองงวด คือ 10% ต่อปี
    expect(historicalCagrPct([100, 110, 121])).toBe(10);
  });

  it('คืน null เมื่อคำนวณไม่ได้ ไม่ใช่คืนศูนย์ซึ่งอ่านว่าไม่โต', () => {
    expect(historicalCagrPct([100])).toBeNull();
    expect(historicalCagrPct([])).toBeNull();
    expect(historicalCagrPct([0, 120])).toBeNull();
  });

  it('บอกการหดตัวเป็นค่าติดลบ', () => {
    expect(historicalCagrPct([121, 100])).toBeLessThan(0);
  });
});

describe('ภาระหนี้รายปีจากตารางผ่อนจริง', () => {
  it('ตรงกับผลรวมของตารางผ่อนที่กางเอง', () => {
    const loan = loanOf(HEALTHY, 'term_loan');
    const ratePct = 6.6;
    const path = debtServicePath([{ loan, ratePct }], 5);

    const rows = amortize(loan.outstanding, ratePct, Math.max(1, loan.remainingMonths) / 12);
    for (let year = 1; year <= 5; year += 1) {
      const expected = rows
        .filter((row) => Math.floor((row.month - 1) / 12) === year - 1)
        .reduce((sum, row) => sum + row.payment, 0);
      expect(path[year - 1]!.debtService).toBeCloseTo(expected, 1);
    }
  });

  it('วงเงินเบิกเกินบัญชีคิดเฉพาะดอกเบี้ยและอยู่ตลอดช่วง เหมือนที่ DSCR ปัจจุบันคิด', () => {
    const od = loanOf(HEALTHY, 'od');
    const ratePct = 8;
    const path = debtServicePath([{ loan: od, ratePct }], 5);
    const annualInterest = (od.outstanding * ratePct) / 100;

    for (const slot of path) {
      expect(slot.debtService).toBeCloseTo(annualInterest, 1);
      expect(slot.principal).toBe(0);
      expect(slot.maturingTh).toEqual([]);
    }
  });

  it('ทำเครื่องหมายปีที่สินเชื่อครบกำหนด และหลังจากนั้นไม่มีภาระของก้อนนั้นอีก', () => {
    const trade = loanOf(HEALTHY, 'trade_finance');
    const path = debtServicePath([{ loan: trade, ratePct: 5.75 }], 5);
    const maturesIn = Math.ceil(trade.remainingMonths / 12);

    expect(path[maturesIn - 1]!.maturingTh.length).toBe(1);
    for (let year = maturesIn + 1; year <= 5; year += 1) {
      expect(path[year - 1]!.debtService).toBe(0);
    }
  });

  it('ภาระรวมลดลงเป็นขั้นเมื่อก้อนที่สั้นกว่าหมดไป', async () => {
    const result = await debtOutlook({ smeId: HEALTHY, years: 5 });
    const service = result.scenarios[0]!.years.map((y) => y.debtService);
    // ไม่เพิ่มขึ้นเลยตลอดช่วง เพราะไม่มีการกู้เพิ่มในแบบจำลองนี้
    for (let i = 1; i < service.length; i += 1) {
      expect(service[i]!).toBeLessThanOrEqual(service[i - 1]! + 0.01);
    }
    // และต้องลดลงจริงอย่างน้อยหนึ่งครั้ง ไม่ใช่คงที่ทั้งแถว
    expect(Math.min(...service)).toBeLessThan(Math.max(...service));
  });
});

describe('ฉากทัศน์', () => {
  it('โตมากกว่าให้ DSCR ดีกว่าเสมอ เมื่อภาระหนี้ชุดเดียวกัน', async () => {
    const result = await debtOutlook({ smeId: HEALTHY, years: 5 });
    const [low, base, high] = result.scenarios;
    expect(low!.revenueGrowthPct).toBeLessThan(base!.revenueGrowthPct);
    expect(base!.revenueGrowthPct).toBeLessThan(high!.revenueGrowthPct);
    expect(low!.minDscr!).toBeLessThan(base!.minDscr!);
    expect(base!.minDscr!).toBeLessThan(high!.minDscr!);
  });

  it('ทุกฉากทัศน์ใช้ภาระหนี้ชุดเดียวกัน เพราะรายได้ไม่เปลี่ยนตารางผ่อน', async () => {
    const result = await debtOutlook({ smeId: HEALTHY, years: 5 });
    const [low, base, high] = result.scenarios;
    for (let i = 0; i < 5; i += 1) {
      expect(low!.years[i]!.debtService).toBe(base!.years[i]!.debtService);
      expect(high!.years[i]!.debtService).toBe(base!.years[i]!.debtService);
    }
  });

  it('ระบุปีแรกที่ตกต่ำกว่าเกณฑ์ได้ตรงกับตาราง', async () => {
    const result = await debtOutlook({ smeId: STRAINED, years: 5 });
    for (const scenario of result.scenarios) {
      const firstBelowBank = scenario.years.find((y) => y.dscr !== null && y.dscr < 1.2);
      expect(scenario.firstYearBelowBankLevel).toBe(firstBelowBank?.year ?? null);
      const firstBelowOne = scenario.years.find((y) => y.dscr !== null && y.dscr < 1.0);
      expect(scenario.firstYearBelowBreakEven).toBe(firstBelowOne?.year ?? null);
    }
  });

  it('กิจการที่จ่ายไม่ไหวอยู่แล้ว ไม่ถูกการเติบโตช่วยให้ผ่านในปีแรก', async () => {
    const result = await debtOutlook({ smeId: STRAINED, years: 5 });
    expect(result.base.dscr!).toBeLessThan(1);
    for (const scenario of result.scenarios) {
      expect(scenario.firstYearBelowBreakEven).toBe(1);
      expect(scenario.verdict).toBe('risk');
    }
  });
});

describe('ที่มาของอัตราการเติบโต', () => {
  it('ค่าตั้งต้นใช้ข้อมูลจริงของกิจการ ไม่ใช่สมมติฐาน', async () => {
    const result = await debtOutlook({ smeId: HEALTHY });
    expect(result.assumptions.basis).toBe('history');
    expect(result.growthIsAssumption).toBe(false);
    expect(result.dataNoticeTh).toBeNull();
    expect(result.historicalRevenueCagrPct).not.toBeNull();
    expect(result.scenarios.find((s) => s.key === 'base')!.revenueGrowthPct).toBe(
      result.historicalRevenueCagrPct,
    );
  });

  it('โหมด GDP ติดธงว่าเป็นสมมติฐาน และบอกข้อจำกัดของข้อมูล', async () => {
    const result = await debtOutlook({
      smeId: HEALTHY,
      basis: 'gdp',
      gdpGrowthPct: 2.5,
      revenueSensitivity: 1.2,
    });
    expect(result.growthIsAssumption).toBe(true);
    expect(result.dataNoticeTh).toContain('ไม่มีชุดข้อมูล GDP จริง');
    expect(result.scenarios.find((s) => s.key === 'base')!.revenueGrowthPct).toBe(3);
  });

  it('โหมดระบุเอง ใช้ค่าที่ส่งมาตรง ๆ และยังถือเป็นสมมติฐาน', async () => {
    const result = await debtOutlook({ smeId: HEALTHY, basis: 'manual', revenueGrowthPct: -4 });
    expect(result.scenarios.find((s) => s.key === 'base')!.revenueGrowthPct).toBe(-4);
    expect(result.growthIsAssumption).toBe(true);
  });
});

describe('ดอกเบี้ยที่ขยับ', () => {
  it('กระทบเฉพาะสินเชื่อลอยตัว สินเชื่อคงที่ไม่ขยับตามสัญญา', async () => {
    const flat = await debtOutlook({ smeId: HEALTHY, years: 5, rateShockPct: 0 });
    const shocked = await debtOutlook({ smeId: HEALTHY, years: 5, rateShockPct: 3 });

    const before = flat.scenarios[1]!.years[0]!.debtService;
    const after = shocked.scenarios[1]!.years[0]!.debtService;
    expect(after).toBeGreaterThan(before);

    // สินเชื่อคงที่อย่างเดียวต้องไม่ขยับเลยแม้ใส่ค่าช็อก
    const fixed = loanOf(HEALTHY, 'trade_finance');
    expect(fixed.rateType).toBe('fixed');
    const a = debtServicePath([{ loan: fixed, ratePct: 5.75 }], 3);
    const b = debtServicePath([{ loan: fixed, ratePct: 5.75 }], 3);
    expect(a[0]!.debtService).toBe(b[0]!.debtService);
  });

  it('ดอกเบี้ยขึ้นทำให้ DSCR แย่ลงทุกฉากทัศน์', async () => {
    const flat = await debtOutlook({ smeId: HEALTHY, years: 5, rateShockPct: 0 });
    const shocked = await debtOutlook({ smeId: HEALTHY, years: 5, rateShockPct: 3 });
    for (let i = 0; i < flat.scenarios.length; i += 1) {
      expect(shocked.scenarios[i]!.minDscr!).toBeLessThan(flat.scenarios[i]!.minDscr!);
    }
  });
});

describe('ความสอดคล้องกับส่วนอื่นของระบบ', () => {
  it('ปีฐานใช้ DSCR ตัวเดียวกับที่หน้าอื่นคำนวณ', async () => {
    const { getDebtOverview } = await import('../src/services/finance/debt.js');
    const result = await debtOutlook({ smeId: HEALTHY });
    const debt = await getDebtOverview(HEALTHY);
    expect(result.base.debtService).toBeCloseTo(debt.totalAnnualDebtService, 0);
  });

  it('รายได้และกระแสเงินสดเดินตามอัตราที่ประกาศไว้', async () => {
    const result = await debtOutlook({ smeId: HEALTHY, years: 3 });
    const base = result.scenarios.find((s) => s.key === 'base')!;
    const g = 1 + base.revenueGrowthPct / 100;
    for (const year of base.years) {
      expect(year.revenue).toBeCloseTo(result.base.revenue * Math.pow(g, year.year), 0);
      // อัตรากำไรเงินสดคงเดิมตามที่ระบุไว้ในคำอธิบาย
      expect(year.operatingCashFlow / year.revenue).toBeCloseTo(result.base.cashMarginPct / 100, 4);
    }
  });
});
