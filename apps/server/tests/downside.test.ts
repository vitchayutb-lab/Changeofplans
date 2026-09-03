/**
 * ต้นทุนของการผิดนัดชำระ
 *
 * ส่วนนี้มีหน้าที่บอกความเสี่ยงให้ตรง ตัวเลขผิดหรือตัวเลขที่เดาเอาจึงแย่กว่าไม่มีเลย
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loanDownside } from '../src/services/finance/downside.js';
import { simulateLoan } from '../src/services/finance/simulation.js';
import { getBotService } from '../src/services/bot/botService.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

function stubDefaultRate(value: number | null): void {
  vi.spyOn(getBotService(), 'getDefaultRate').mockResolvedValue({
    value,
    provenance: {
      source: 'bot',
      sourceLabel: 'Bank of Thailand',
      lastUpdated: '2026-08-29',
      fetchedAt: '2026-08-29T07:00:00.000Z',
      stale: false,
      cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
      notice: null,
    },
  });
}

describe('loanDownside', () => {
  it('คิดดอกเบี้ยที่อัตราผิดนัดจากยอดกู้เต็มจำนวน', async () => {
    stubDefaultRate(22.86);
    const result = await loanDownside(1_000_000, 70_000);

    expect(result?.defaultRatePct).toBe(22.86);
    expect(result?.annualInterestAtDefault).toBe(228_600);
    expect(result?.extraInterestPerYear).toBe(158_600);
  });

  it('บอกว่าแพงขึ้นกี่เท่า เพราะตัวคูณอ่านง่ายกว่าจำนวนเงิน', async () => {
    stubDefaultRate(21);
    const result = await loanDownside(1_000_000, 70_000);
    expect(result?.multipleOfContract).toBe(3);
  });

  it('ดอกเบี้ยตามสัญญาเป็นศูนย์ก็ไม่หารด้วยศูนย์', async () => {
    stubDefaultRate(22.86);
    const result = await loanDownside(1_000_000, 0);
    expect(result?.multipleOfContract).toBeNull();
    expect(result?.extraInterestPerYear).toBe(228_600);
  });

  it('ดึงอัตราผิดนัดไม่ได้ ต้องคืน null ไม่ใช่เดาค่าแทน', async () => {
    // ส่วนนี้พูดเรื่องความเสี่ยง ตัวเลขที่แต่งขึ้นจึงอันตรายกว่าการเว้นว่าง
    stubDefaultRate(null);
    expect(await loanDownside(1_000_000, 70_000)).toBeNull();
  });

  it('บอกไว้ว่าเป็นขอบบน ไม่ใช่ยอดที่จะถูกเรียกเก็บแน่นอน', async () => {
    // อัตราผิดนัดคิดกับยอดค้างชำระตามสัญญา ไม่ใช่ทั้งก้อนเสมอไป
    stubDefaultRate(22.86);
    const result = await loanDownside(1_000_000, 70_000);
    expect(result?.noteTh).toContain('ยอดที่ค้างชำระ');
    expect(result?.noteTh).toContain('ขอบบน');
  });
});

describe('simulateLoan พก downside มาด้วย', () => {
  it('เทียบกับดอกเบี้ยปีแรกของสัญญาเดียวกัน ไม่ใช่ตัวเลขอื่น', async () => {
    stubDefaultRate(22.86);
    const result = await simulateLoan({
      smeId: 'sme-siam-textile',
      amount: 5_000_000,
      years: 5,
      rateBasis: 'fixed',
      fixedRatePct: 7,
    });

    expect(result.downside).not.toBeNull();
    expect(result.downside?.annualInterestAtDefault).toBe(1_143_000);
    expect(result.downside?.extraInterestPerYear).toBe(
      Math.round((1_143_000 - result.quote.firstYearInterest) * 100) / 100,
    );
  });

  it('อัตราผิดนัดไม่มี ก็ยังจำลองสินเชื่อได้ตามปกติ', async () => {
    // ส่วนเสริมพังต้องไม่ล้มทั้งหน้า
    stubDefaultRate(null);
    const result = await simulateLoan({
      smeId: 'sme-siam-textile',
      amount: 5_000_000,
      years: 5,
      rateBasis: 'fixed',
      fixedRatePct: 7,
    });
    expect(result.downside).toBeNull();
    expect(result.quote.monthlyPayment).toBeGreaterThan(0);
  });
});
