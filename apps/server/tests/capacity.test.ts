/**
 * เทสต์ต้นทุนหนี้ที่รับไหว
 *
 * ตัวเลขที่หน้านี้ให้คือ "เพดานดอกเบี้ย" ซึ่งถ้าคลาดแม้นิดเดียวก็ชี้ผิดทาง —
 * เทสต์ส่วนใหญ่จึงเป็นการเดินกลับ: เอาเพดานที่รายงานไปคิดค่างวดจริง แล้วตรวจว่า
 * DSCR ที่ได้ตกลงมาที่เป้าหมายพอดี ไม่ใช่แค่ตรวจว่ามีตัวเลขออกมา
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { debtCapacity } from '../src/services/finance/capacity.js';
import { maxRateForPayment, payment, principalForPayment } from '../src/services/finance/loan.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

const SME = 'sme-siam-textile';

describe('สูตรกลับด้านของค่างวด', () => {
  it('เงินต้นที่คิดย้อนกลับ ให้ค่างวดเท่าเดิม', () => {
    for (const rate of [0, 3.25, 7, 12.5]) {
      const principal = principalForPayment(25_000, rate, 7);
      expect(payment(principal, rate, 7)).toBeCloseTo(25_000, 0);
    }
  });

  it('ดอกเบี้ยศูนย์คือเงินต้นหารจำนวนงวดพอดี', () => {
    expect(principalForPayment(10_000, 0, 5)).toBe(600_000);
  });

  it('ไม่มีเงินเหลือจ่าย ก็กู้ไม่ได้', () => {
    expect(principalForPayment(0, 7, 7)).toBe(0);
    expect(principalForPayment(-5_000, 7, 7)).toBe(0);
  });
});

describe('เพดานอัตราดอกเบี้ย', () => {
  it('อัตราที่คืนมา ทำให้ค่างวดไม่เกินเพดานที่จ่ายไหว', () => {
    const principal = 2_000_000;
    const cap = 32_000;
    const rate = maxRateForPayment(principal, cap, 7)!;
    expect(rate).not.toBeNull();
    expect(payment(principal, rate, 7)).toBeLessThanOrEqual(cap);
  });

  it('เป็นอัตราสูงสุดจริง — ขยับขึ้นอีกนิดเดียวก็เกินเพดาน', () => {
    const principal = 2_000_000;
    const cap = 32_000;
    const rate = maxRateForPayment(principal, cap, 7)!;
    // เผื่อการปัดลง 2 ตำแหน่งไว้หนึ่งขั้น แล้วต้องเกินเพดานแน่นอน
    expect(payment(principal, rate + 0.02, 7)).toBeGreaterThan(cap);
  });

  it('คืน null เมื่อเงินต้นอย่างเดียวก็เกินกำลัง แทนที่จะรายงานเป็น 0%', () => {
    // ผ่อน 7 ปี เงินต้นล้วนต้องจ่ายเดือนละ ~23,810 แต่จ่ายได้แค่ 10,000
    expect(maxRateForPayment(2_000_000, 10_000, 7)).toBeNull();
  });

  it('ไม่กู้เลยก็ไม่มีเพดาน — รับได้ทุกอัตรา', () => {
    expect(maxRateForPayment(0, 10_000, 7)).toBe(100);
  });
});

describe('ต้นทุนหนี้ที่รับไหวของกิจการจริง', () => {
  it('เพดานที่รายงาน ทำให้ DSCR ตกมาที่เป้าหมายพอดี', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000, years: 7 });
    const { operatingCashFlow, existingAnnualDebtService } = result.basis;

    for (const ceiling of result.ceilings) {
      if (ceiling.maxRatePct === null) continue;
      const newAnnual = payment(result.request.amount, ceiling.maxRatePct, result.request.years) * 12;
      const resulting = operatingCashFlow / (existingAnnualDebtService + newAnnual);
      // ปัดอัตราลง DSCR ที่ได้จึงต้องไม่ต่ำกว่าเป้าหมายเสมอ
      expect(resulting).toBeGreaterThanOrEqual(ceiling.targetDscr);
      // แต่ต้องอยู่ที่ขอบพอดี เว้นกรณีที่ชนเพดานการค้นหาเพราะอัตราไม่ใช่ข้อจำกัด
      if (!ceiling.unbounded) expect(resulting).toBeLessThan(ceiling.targetDscr * 1.02);
    }
  });

  it('วงเงินที่รายงาน ทำให้ DSCR ตกมาที่เป้าหมายพอดีเช่นกัน', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000, years: 7 });
    const rate = result.market.estimatedRatePct;
    expect(rate).not.toBeNull();

    for (const capacity of result.capacities) {
      if (capacity.maxAmount <= 0) continue;
      const newAnnual = payment(capacity.maxAmount, rate!, result.request.years) * 12;
      const resulting =
        result.basis.operatingCashFlow / (result.basis.existingAnnualDebtService + newAnnual);
      expect(resulting).toBeGreaterThanOrEqual(capacity.targetDscr);
    }
  });

  it('เป้าหมายยิ่งเข้ม เพดานยิ่งต่ำและวงเงินยิ่งน้อย', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000, years: 7 });
    const rates = result.ceilings.map((c) => c.maxRatePct ?? -1);
    const amounts = result.capacities.map((c) => c.maxAmount);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('ใช้ระดับ DSCR ชุดเดียวกับเกณฑ์การวัดธุรกิจ', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000 });
    expect(result.ceilings.map((c) => c.targetDscr)).toEqual([1.0, 1.2, 1.5]);
    expect(result.capacities.map((c) => c.targetDscr)).toEqual([1.0, 1.2, 1.5]);
  });

  it('ส่วนต่างจากอัตราตลาดคิดจากเพดานลบอัตราตลาดจริง', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000 });
    const market = result.market.estimatedRatePct!;
    for (const ceiling of result.ceilings) {
      if (ceiling.maxRatePct === null) {
        expect(ceiling.headroomPct).toBeNull();
        continue;
      }
      expect(ceiling.headroomPct).toBeCloseTo(ceiling.maxRatePct - market, 2);
      expect(ceiling.withinReach).toBe(market <= ceiling.maxRatePct);
    }
  });

  it('ไม่ระบุวงเงิน ใช้วงเงินสูงสุดที่รับไหวที่ระดับ 1.20', async () => {
    const result = await debtCapacity({ smeId: SME });
    const atBankLevel = result.capacities.find((c) => c.targetDscr === 1.2)!;
    expect(result.request.amount).toBe(atBankLevel.maxAmount);
  });

  it('อัตราตลาดคืออัตราอ้างอิงบวกส่วนต่าง ไม่ใช่ค่าที่ตั้งขึ้นเอง', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 1_000_000, spreadPct: 2 });
    expect(result.market.spreadPct).toBe(2);
    expect(result.market.estimatedRatePct).toBeCloseTo(result.market.referenceRatePct! + 2, 2);
    expect(result.market.provenance).not.toBeNull();
  });

  it('ต้นทุนหนี้รวมหลังกู้ อยู่ระหว่างต้นทุนเดิมกับอัตราใหม่', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000 });
    const before = result.basis.existingWeightedRatePct;
    const market = result.market.estimatedRatePct!;
    const after = result.blendedRateAfterPct!;
    expect(after).not.toBeNull();
    if (before !== null) {
      expect(after).toBeGreaterThanOrEqual(Math.min(before, market) - 0.01);
      expect(after).toBeLessThanOrEqual(Math.max(before, market) + 0.01);
    }
  });

  it('สรุปด้วยตัวเลขจริง ไม่ใช่ข้อความกำกวม', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 3_000_000 });
    expect(result.summaryTh).toContain('1.20');
    expect(result.disclaimerTh.length).toBeGreaterThan(0);
    expect(['good', 'watch', 'risk', 'na']).toContain(result.verdict);
  });
});

describe('การแยกสองกรณีที่ตรงข้ามกัน', () => {
  it('รับไหวเกินอัตราที่มีใครเสนอจริง ต้องไม่รายงานเป็นตัวเลขลอย ๆ', async () => {
    // วงเงินเล็กเมื่อเทียบกับกระแสเงินสด อัตราดอกเบี้ยจึงไม่ใช่ข้อจำกัด
    const result = await debtCapacity({ smeId: SME, amount: 50_000, years: 7 });
    const loose = result.ceilings.find((c) => c.targetDscr === 1.0)!;
    expect(loose.unbounded).toBe(true);
    expect(loose.maxRatePct).not.toBeNull();
    expect(loose.withinReach).toBe(true);
  });

  it('รับไม่ไหวแม้ดอกเบี้ยศูนย์ ต้องเป็น null ไม่ใช่ unbounded', async () => {
    const result = await debtCapacity({ smeId: SME, amount: 900_000_000, years: 7 });
    const strict = result.ceilings.find((c) => c.targetDscr === 1.5)!;
    expect(strict.maxRatePct).toBeNull();
    expect(strict.unbounded).toBe(false);
    expect(strict.withinReach).toBe(false);
    expect(strict.headroomPct).toBeNull();
  });
});

describe('กิจการที่ภาระเดิมกินกำลังไปหมดแล้ว', () => {
  const STRAINED = 'sme-baansuan-retail';

  it('อธิบายสาเหตุจริง ไม่ใช่บอกว่า "ที่วงเงิน ฿0 รับไม่ไหว"', async () => {
    const result = await debtCapacity({ smeId: STRAINED });
    expect(result.request.amount).toBe(0);
    expect(result.summaryTh).not.toContain('฿0');
    expect(result.summaryTh).toContain('ภาระผ่อนหนี้เดิม');
    expect(result.summaryTh).toContain('ลดภาระเดิมหรือเพิ่มกระแสเงินสด');
  });

  it('ตัดสินว่าเสี่ยง และไม่มีวงเงินรองรับที่ระดับใดเลย', async () => {
    const result = await debtCapacity({ smeId: STRAINED });
    expect(result.verdict).toBe('risk');
    expect(result.capacities.every((c) => c.maxAmount === 0)).toBe(true);
    expect(result.basis.currentDscr).toBeLessThan(1);
  });
});
