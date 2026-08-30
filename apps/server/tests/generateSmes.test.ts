/**
 * เทสต์ตัวสร้างกิจการ
 *
 * ข้อสำคัญที่สุด: กิจการที่สร้างขึ้นต้องมีงบที่ "สมดุลจริง" ทุกรายทุกปี
 * มิฉะนั้นอัตราส่วนทางการเงินทั้งระบบจะเชื่อถือไม่ได้
 */

import { describe, expect, it } from 'vitest';
import { createRandom, generateSmes } from '../src/db/generateSmes.js';

const SMES = generateSmes({ count: 1000 });

describe('createRandom', () => {
  it('seed เดิมให้ลำดับเดิมเสมอ', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('seed ต่างกันให้ลำดับต่างกัน', () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });

  it('ค่าที่ได้อยู่ในช่วง [0,1)', () => {
    const rng = createRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generateSmes', () => {
  it('สร้างครบตามจำนวนที่ขอ', () => {
    expect(SMES).toHaveLength(1000);
    expect(generateSmes({ count: 25 })).toHaveLength(25);
  });

  it('ให้ผลลัพธ์เดิมเสมอสำหรับ seed เดิม', () => {
    const a = generateSmes({ count: 20, seed: 999 });
    const b = generateSmes({ count: 20, seed: 999 });
    expect(a).toEqual(b);
  });

  it('รหัสและชื่อกิจการไม่ซ้ำกัน', () => {
    expect(new Set(SMES.map((sme) => sme.id)).size).toBe(SMES.length);
    expect(new Set(SMES.map((sme) => sme.nameTh)).size).toBe(SMES.length);
  });

  it('งบดุลของทุกกิจการทุกปีสมดุลจริง', () => {
    const broken: string[] = [];

    for (const sme of SMES) {
      for (const s of sme.statements) {
        const currentAssets = s.cash + s.accountsReceivable + s.inventory + s.otherCurrentAssets;
        const totalAssets = currentAssets + s.fixedAssets;
        const totalLiabilities =
          s.accountsPayable + s.shortTermDebt + s.otherCurrentLiabilities + s.longTermDebt;
        const equity = s.equityPaidUp + s.retainedEarnings;
        const difference = totalAssets - (totalLiabilities + equity);
        if (Math.abs(difference) >= 1) {
          broken.push(`${sme.id} ปี ${s.fiscalYear} ต่าง ${difference}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('ยอดคงค้างของสินเชื่อรวมเท่ากับหนี้ที่มีดอกเบี้ยในงบปีล่าสุดพอดี', () => {
    const broken: string[] = [];

    for (const sme of SMES) {
      const latest = sme.statements[sme.statements.length - 1]!;
      const interestBearing = latest.shortTermDebt + latest.longTermDebt;
      const outstanding = sme.loans.reduce((sum, loan) => sum + loan.outstanding, 0);
      if (Math.abs(interestBearing - outstanding) >= 1) {
        broken.push(`${sme.id}: งบ ${interestBearing} vs สินเชื่อ ${outstanding}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('ดอกเบี้ยจ่ายสอดคล้องกับหนี้ที่มีดอกเบี้ย (อัตราอยู่ในช่วงที่เป็นไปได้)', () => {
    for (const sme of SMES) {
      for (const s of sme.statements) {
        const debt = s.shortTermDebt + s.longTermDebt;
        if (debt < 100_000) continue;
        const impliedRate = (s.interestExpense / debt) * 100;
        expect(impliedRate).toBeGreaterThan(3);
        expect(impliedRate).toBeLessThan(10);
      }
    }
  });

  it('สร้างงบสามปีเรียงจากเก่าไปใหม่', () => {
    for (const sme of SMES.slice(0, 50)) {
      expect(sme.statements).toHaveLength(3);
      const years = sme.statements.map((s) => s.fiscalYear);
      expect(years).toEqual([...years].sort((a, b) => a - b));
    }
  });

  it('ค่าพื้นฐานของกิจการสมเหตุสมผล', () => {
    for (const sme of SMES) {
      expect(sme.employees).toBeGreaterThanOrEqual(3);
      expect(sme.foundedYear).toBeGreaterThan(1990);
      expect(sme.registrationNo).toHaveLength(13);
      expect(sme.statements[2]!.revenue).toBeGreaterThan(0);
      // มีรายการเงินตราต่างประเทศก็ต่อเมื่อระบุสกุลเงินไว้
      if (sme.fxExposureCurrency === null) expect(sme.fxAnnualExposure).toBe(0);
      else expect(sme.fxAnnualExposure).toBeGreaterThan(0);
    }
  });

  it('กระจายตัวหลากหลายพอที่จะทำให้การค้นหาและการจับคู่มีความหมาย', () => {
    expect(new Set(SMES.map((sme) => sme.industry)).size).toBe(7);
    expect(new Set(SMES.map((sme) => sme.province)).size).toBeGreaterThan(20);

    // ต้องมีทั้งกิจการที่กำไรและขาดทุน มิฉะนั้นการวิเคราะห์จะไม่มีอะไรให้เตือน
    const netProfits = SMES.map((sme) => {
      const s = sme.statements[2]!;
      return s.revenue - s.cogs - s.operatingExpenses - s.depreciation - s.interestExpense - s.tax;
    });
    expect(netProfits.filter((value) => value > 0).length).toBeGreaterThan(500);
    expect(netProfits.filter((value) => value < 0).length).toBeGreaterThan(20);
  });
});
