/** เทสต์การจับคู่แหล่งเงินทุน — ต้องตรวจเงื่อนไขจริงและอธิบายได้ว่าข้อไหนไม่ผ่าน */

import { beforeEach, describe, expect, it } from 'vitest';
import { getProgram, listPrograms, listApplications, upsertApplication } from '../src/db/fundingRepo.js';
import { matchFundingPrograms } from '../src/services/funding/matcher.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

describe('ฐานข้อมูลแหล่งเงินทุน', () => {
  it('มีโครงการตั้งต้นครบทุกประเภท', () => {
    const programs = listPrograms();
    expect(programs.length).toBeGreaterThanOrEqual(10);
    const types = new Set(programs.map((p) => p.type));
    expect([...types].sort()).toEqual(['equity', 'grant', 'guarantee', 'loan', 'subsidy']);
  });

  it('กรองตามประเภทได้', () => {
    const grants = listPrograms({ type: 'grant' });
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((p) => p.type === 'grant')).toBe(true);
  });

  it('แปลง JSON ของเงื่อนไขกลับมาเป็น array', () => {
    const program = getProgram('fp-dip-innovation');
    expect(program?.eligibleIndustries).toContain('manufacturing');
    expect(getProgram('fp-smed-transform')?.eligibleIndustries).toEqual(['*']);
  });
});

describe('matchFundingPrograms', () => {
  it('เรียงโครงการที่ผ่านเงื่อนไขไว้ก่อน', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-siam-textile', amountNeeded: 10_000_000 });
    const firstIneligible = matches.findIndex((m) => !m.eligible);
    const lastEligible = matches.map((m) => m.eligible).lastIndexOf(true);
    if (firstIneligible !== -1 && lastEligible !== -1) {
      expect(lastEligible).toBeLessThan(firstIneligible);
    }
  });

  it('ตรวจทุกเงื่อนไขและเก็บตัวเลขที่ใช้เทียบไว้ทั้งสองฝั่ง', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-siam-textile', amountNeeded: 10_000_000 });
    const first = matches[0]!;
    const rules = first.checks.map((c) => c.rule).sort();
    expect(rules).toEqual(['amount', 'dscr', 'employees', 'industry', 'province', 'revenue', 'years_operating']);
    for (const check of first.checks) {
      expect(check.actual.length).toBeGreaterThan(0);
      expect(check.required.length).toBeGreaterThan(0);
    }
  });

  it('ตัดสิทธิ์ตามพื้นที่: กิจการเชียงใหม่ไม่ผ่านโครงการเฉพาะกรุงเทพฯ และปริมณฑล', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-baansuan-retail', amountNeeded: 2_000_000 });
    const bangkokOnly = matches.find((m) => m.program.id === 'fp-bkk-microloan')!;
    const provinceCheck = bangkokOnly.checks.find((c) => c.rule === 'province')!;
    expect(provinceCheck.passed).toBe(false);
    expect(bangkokOnly.eligible).toBe(false);
    expect(bangkokOnly.reasonTh).toContain('พื้นที่');
  });

  it('ตัดสิทธิ์ตามอุตสาหกรรม: ร้านค้าปลีกไม่ผ่านทุนนวัตกรรมภาคผลิต', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-baansuan-retail' });
    const grant = matches.find((m) => m.program.id === 'fp-dip-innovation')!;
    expect(grant.checks.find((c) => c.rule === 'industry')?.passed).toBe(false);
  });

  it('ตัดสิทธิ์ตามวงเงินที่ขอ', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-siam-textile', amountNeeded: 40_000_000 });
    const smallProgram = matches.find((m) => m.program.id === 'fp-depa-voucher')!;
    expect(smallProgram.checks.find((c) => c.rule === 'amount')?.passed).toBe(false);
  });

  it('ประมาณต้นทุนสินเชื่อโดยใช้อัตราอ้างอิงจาก ธปท.', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-siam-textile', amountNeeded: 10_000_000 });
    const floating = matches.find((m) => m.program.rateBasis === 'mlr_spread')!;
    expect(floating.estimate).not.toBeNull();
    expect(floating.estimate!.referenceRateName).toBe('MLR');
    expect(floating.estimate!.estimatedRatePct).toBeGreaterThan(0);
    expect(floating.estimate!.annualInterest).toBeCloseTo(
      (10_000_000 * floating.estimate!.estimatedRatePct!) / 100,
      0,
    );
    // ทำงานในโหมดจำลอง จึงต้องติดป้ายว่าเป็นข้อมูลจำลอง
    expect(floating.estimate!.provenance?.source).toBe('demo');
  });

  it('เงินให้เปล่าไม่มีการประมาณต้นทุนดอกเบี้ย', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-kruathai-foods' });
    const grant = matches.find((m) => m.program.type === 'grant')!;
    expect(grant.estimate).toBeNull();
  });

  it('คะแนนอยู่ในช่วง 0-100 เสมอ', async () => {
    const matches = await matchFundingPrograms({ smeId: 'sme-kruathai-foods' });
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(100);
    }
  });

  it('ปฏิเสธกิจการที่ไม่มีในระบบ', async () => {
    await expect(matchFundingPrograms({ smeId: 'ไม่มีจริง' })).rejects.toThrow();
  });
});

describe('การติดตามการยื่นขอ', () => {
  it('บันทึกและอัปเดตสถานะโดยไม่สร้างแถวซ้ำ', () => {
    upsertApplication({
      smeId: 'sme-siam-textile',
      programId: 'fp-smed-transform',
      amountRequested: 5_000_000,
      status: 'interested',
    });
    upsertApplication({
      smeId: 'sme-siam-textile',
      programId: 'fp-smed-transform',
      amountRequested: 8_000_000,
      status: 'submitted',
    });

    const applications = listApplications('sme-siam-textile');
    expect(applications).toHaveLength(1);
    expect(applications[0]!.status).toBe('submitted');
    expect(applications[0]!.amountRequested).toBe(8_000_000);
  });
});
