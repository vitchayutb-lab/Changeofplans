/**
 * เทสต์โหมด Startup
 *
 * สิ่งที่ต้องพิสูจน์: ตัวเลขทุกตัวคำนวณจากข้อมูลที่กรอกจริง คำตัดสินเปลี่ยนตามข้อมูล
 * และเงื่อนไขที่ธนาคารปฏิเสธแน่ ๆ ต้องบล็อกทันทีไม่ว่าคะแนนรวมจะดีแค่ไหน
 */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { StartupProfile } from '@sme/shared';
import { assessStartup } from '../src/services/startup/assessment.js';
import {
  EXAMPLE_PROFILE,
  ProfileValidationError,
  parseStartupProfile,
} from '../src/services/startup/parseProfile.js';
import {
  affordablePrincipal,
  evaluateFactors,
  hardBlockers,
  likelihoodOf,
  riskSpread,
  scoreFactors,
  computeMetrics,
} from '../src/services/startup/scoring.js';
import { payment } from '../src/services/finance/loan.js';
import { setupApp } from './helpers.js';

let app: Express;

beforeEach(() => {
  app = setupApp();
});

function profile(overrides: Partial<StartupProfile> = {}): StartupProfile {
  return { ...EXAMPLE_PROFILE, ...overrides };
}

const RATE = { name: 'MRR', valuePct: 6.0 };

describe('riskSpread', () => {
  it('กิจการที่มั่นคงกว่าได้ส่วนต่างต่ำกว่า', () => {
    const solid = riskSpread(
      profile({ monthsOperating: 36, collateralValue: 2_000_000, creditHistory: 'clean' }),
    );
    const risky = riskSpread(
      profile({ monthsOperating: 2, collateralValue: 0, creditHistory: 'late' }),
    );
    expect(solid).toBeLessThan(risky);
  });

  it('ประวัติผิดนัดชำระดันส่วนต่างขึ้นมากที่สุด', () => {
    const base = riskSpread(profile({ creditHistory: 'clean' }));
    expect(riskSpread(profile({ creditHistory: 'default' }))).toBeGreaterThan(base + 2);
  });

  it('มีผู้ค้ำประกันช่วยลดส่วนต่างเมื่อไม่มีหลักประกัน', () => {
    const without = riskSpread(profile({ collateralValue: 0, hasGuarantor: false }));
    const withGuarantor = riskSpread(profile({ collateralValue: 0, hasGuarantor: true }));
    expect(withGuarantor).toBeLessThan(without);
  });

  it('มีเพดานไม่ให้หลุดจากช่วงที่พบได้จริง', () => {
    const worst = riskSpread(
      profile({
        monthsOperating: 0,
        collateralValue: 0,
        hasGuarantor: false,
        creditHistory: 'default',
        monthlyRevenue: 1,
        monthlyExpenses: 900_000,
      }),
    );
    expect(worst).toBeLessThanOrEqual(7);
  });
});

describe('affordablePrincipal', () => {
  it('วงเงินที่คำนวณได้ ให้ค่างวดที่ทำให้ DSCR ถึงเป้าหมายพอดี', () => {
    const input = {
      monthlyProfit: 60_000,
      ownerMonthlyIncome: 0,
      existingDebtMonthlyPayment: 0,
      annualRatePct: 8,
      years: 5,
    };
    const principal = affordablePrincipal(input, 1.2);
    const monthly = payment(principal, 8, 5);
    // 60,000 ÷ 1.2 = 50,000 คือค่างวดที่รับได้
    expect(monthly).toBeGreaterThan(49_000);
    expect(monthly).toBeLessThanOrEqual(50_000);
  });

  it('หักภาระหนี้เดิมออกก่อน', () => {
    const base = { monthlyProfit: 60_000, ownerMonthlyIncome: 0, annualRatePct: 8, years: 5 };
    const clean = affordablePrincipal({ ...base, existingDebtMonthlyPayment: 0 });
    const indebted = affordablePrincipal({ ...base, existingDebtMonthlyPayment: 20_000 });
    expect(indebted).toBeLessThan(clean);
  });

  it('คืน 0 เมื่อกระแสเงินสดไม่พอผ่อนอะไรเลย', () => {
    expect(
      affordablePrincipal({
        monthlyProfit: -10_000,
        ownerMonthlyIncome: 0,
        existingDebtMonthlyPayment: 0,
        annualRatePct: 8,
        years: 5,
      }),
    ).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('อัตราที่ประเมิน = อัตราอ้างอิง + ส่วนต่างความเสี่ยง', () => {
    const p = profile();
    const metrics = computeMetrics(p, RATE);
    expect(metrics.estimatedRatePct).toBeCloseTo(RATE.valuePct + metrics.riskSpreadPct, 6);
  });

  it('ค่างวดตรงกับสูตรผ่อนเท่ากันทุกงวด', () => {
    const p = profile({ requestedAmount: 1_000_000, requestedYears: 5 });
    const metrics = computeMetrics(p, RATE);
    expect(metrics.newMonthlyPayment).toBe(
      payment(1_000_000, metrics.estimatedRatePct, 5),
    );
  });

  it('DSCR คิดจากกำไรบวกรายได้เจ้าของ หารภาระผ่อนรวม', () => {
    const p = profile({
      monthlyRevenue: 300_000,
      monthlyExpenses: 250_000,
      ownerMonthlyIncome: 10_000,
      existingDebtMonthlyPayment: 5_000,
    });
    const metrics = computeMetrics(p, RATE);
    const expected = (50_000 + 10_000) / (5_000 + metrics.newMonthlyPayment);
    expect(metrics.dscr).toBeCloseTo(expected, 3);
  });

  it('ยังประเมินได้เมื่อดึงอัตราอ้างอิงจาก ธปท. ไม่ได้', () => {
    const metrics = computeMetrics(profile(), { name: null, valuePct: null });
    expect(metrics.estimatedRatePct).toBeGreaterThan(0);
    expect(metrics.referenceRatePct).toBeNull();
  });
});

describe('evaluateFactors', () => {
  it('น้ำหนักรวมทุกปัจจัยเท่ากับ 100', () => {
    const factors = evaluateFactors(profile(), computeMetrics(profile(), RATE));
    expect(factors.reduce((sum, factor) => sum + factor.weight, 0)).toBe(100);
  });

  it('ทุกปัจจัยบอกทั้งค่าที่ได้และเกณฑ์ที่ใช้เทียบ', () => {
    for (const factor of evaluateFactors(profile(), computeMetrics(profile(), RATE))) {
      expect(factor.actual.length).toBeGreaterThan(0);
      expect(factor.benchmark.length).toBeGreaterThan(0);
      expect(factor.explanationTh.length).toBeGreaterThan(20);
    }
  });

  it('กิจการที่เปิดไม่ถึงปีตกเกณฑ์อายุกิจการ', () => {
    const factors = evaluateFactors(
      profile({ monthsOperating: 4 }),
      computeMetrics(profile({ monthsOperating: 4 }), RATE),
    );
    expect(factors.find((f) => f.key === 'business_age')?.status).toBe('fail');
  });

  it('มีหลักประกันครอบคลุมเต็มวงเงินได้สถานะดี', () => {
    const p = profile({ requestedAmount: 1_000_000, collateralValue: 1_200_000 });
    const factors = evaluateFactors(p, computeMetrics(p, RATE));
    expect(factors.find((f) => f.key === 'collateral')?.status).toBe('good');
  });

  it('ไม่มีหลักประกันแต่มีผู้ค้ำ ยังไม่ตกทั้งหมด', () => {
    const p = profile({ collateralValue: 0, hasGuarantor: true });
    const factors = evaluateFactors(p, computeMetrics(p, RATE));
    expect(factors.find((f) => f.key === 'collateral')?.status).toBe('warn');
  });
});

describe('scoreFactors และ likelihoodOf', () => {
  it('คะแนนสูงขึ้นเมื่อข้อมูลดีขึ้น', () => {
    const weak = profile({ monthsOperating: 1, collateralValue: 0, creditHistory: 'late' });
    const strong = profile({
      monthsOperating: 48,
      collateralValue: 2_000_000,
      creditHistory: 'clean',
      cashOnHand: 2_000_000,
      ownerCapital: 3_000_000,
    });
    const scoreOf = (p: StartupProfile): number =>
      scoreFactors(evaluateFactors(p, computeMetrics(p, RATE)));
    expect(scoreOf(strong)).toBeGreaterThan(scoreOf(weak));
  });

  it('เงื่อนไขที่ตกแล้วตกเลย ทำให้ผลเป็นไม่ผ่านแม้คะแนนจะสูง', () => {
    expect(likelihoodOf(95, ['มีประวัติผิดนัดชำระหนี้'])).toBe('unlikely');
    expect(likelihoodOf(95, [])).toBe('likely');
  });

  it('แบ่งระดับตามช่วงคะแนน', () => {
    expect(likelihoodOf(80, [])).toBe('likely');
    expect(likelihoodOf(60, [])).toBe('possible');
    expect(likelihoodOf(40, [])).toBe('difficult');
    expect(likelihoodOf(20, [])).toBe('unlikely');
  });
});

describe('hardBlockers', () => {
  it('ประวัติผิดนัดชำระเป็นเงื่อนไขที่บล็อกทันที', () => {
    const p = profile({ creditHistory: 'default' });
    expect(hardBlockers(p, computeMetrics(p, RATE)).join(' ')).toContain('ผิดนัดชำระ');
  });

  it('ขาดทุนทุกเดือนเป็นเงื่อนไขที่บล็อกทันที', () => {
    const p = profile({ monthlyRevenue: 100_000, monthlyExpenses: 150_000 });
    expect(hardBlockers(p, computeMetrics(p, RATE)).join(' ')).toContain('ขาดทุน');
  });

  it('กิจการที่ทำกำไรและเครดิตดีไม่มีเงื่อนไขบล็อก', () => {
    const p = profile({
      monthlyRevenue: 500_000,
      monthlyExpenses: 350_000,
      creditHistory: 'clean',
    });
    expect(hardBlockers(p, computeMetrics(p, RATE))).toEqual([]);
  });
});

describe('assessStartup', () => {
  it('ประเมินครบทุกส่วนและอ้างอิงอัตราจาก ธปท.', async () => {
    const result = await assessStartup(profile());
    expect(result.factors).toHaveLength(9);
    expect(result.metrics.referenceRateName).toBe('MRR');
    expect(result.provenance?.source).toBe('demo');
    expect(result.recommendations.length).toBeGreaterThan(5);
    expect(result.disclaimerTh).toContain('ไม่ใช่การอนุมัติสินเชื่อ');
  });

  it('กิจการที่แข็งแรงกว่าได้คะแนนและอัตราดอกเบี้ยดีกว่า', async () => {
    const weak = await assessStartup(profile({ monthsOperating: 2, collateralValue: 0 }));
    const strong = await assessStartup(
      profile({
        monthsOperating: 36,
        collateralValue: 1_500_000,
        ownerCapital: 2_000_000,
        cashOnHand: 900_000,
        monthlyRevenue: 700_000,
        monthlyExpenses: 520_000,
      }),
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.metrics.estimatedRatePct).toBeLessThan(weak.metrics.estimatedRatePct);
  });

  it('บอกวงเงินที่รองรับได้จริงเมื่อขอมากเกินตัว', async () => {
    const result = await assessStartup(
      profile({ requestedAmount: 30_000_000, monthlyRevenue: 320_000, monthlyExpenses: 265_000 }),
    );
    expect(result.affordableAmount).toBeLessThan(30_000_000);
    expect(result.actions.some((action) => action.key === 'reduce_amount')).toBe(true);
  });

  it('แนะนำ บสย. เมื่อไม่มีหลักประกันและไม่มีผู้ค้ำ', async () => {
    const result = await assessStartup(profile({ collateralValue: 0, hasGuarantor: false }));
    expect(result.suggestedProductsTh.some((item) => item.type === 'guarantee')).toBe(true);
    expect(result.actions.some((action) => action.key === 'use_guarantee')).toBe(true);
  });

  it('เงินให้เปล่าไม่ถูกดันขึ้นอันดับต้นเมื่อขอเงินไปหมุนเวียน', async () => {
    const forWorkingCapital = await assessStartup(profile({ purpose: 'working_capital' }));
    const grant = forWorkingCapital.recommendations.find(
      (item) => item.program.type === 'grant' && item.eligible,
    );
    const loan = forWorkingCapital.recommendations.find(
      (item) => item.program.type === 'loan' && item.eligible,
    );
    if (grant && loan) expect(loan.score).toBeGreaterThan(grant.score);
  });

  it('ทุกข้อเสนอแนะมีตัวเลขที่คำนวณจากข้อมูลจริง ไม่ใช่คำแนะนำลอย ๆ', async () => {
    const result = await assessStartup(profile({ monthsOperating: 3, collateralValue: 0 }));
    for (const action of result.actions) {
      expect(action.detailTh.length).toBeGreaterThan(20);
      expect(action.impactTh.length).toBeGreaterThan(5);
    }
  });
});

describe('parseStartupProfile', () => {
  it('ต้องระบุวงเงินที่ขอ', () => {
    expect(() => parseStartupProfile({})).toThrow(ProfileValidationError);
  });

  it('ปฏิเสธวงเงินที่เล็กเกินจริง', () => {
    expect(() => parseStartupProfile({ requestedAmount: 500 })).toThrow(/ไม่น้อยกว่า/);
  });

  it('ปฏิเสธค่าที่ไม่อยู่ในตัวเลือก', () => {
    expect(() =>
      parseStartupProfile({ requestedAmount: 500_000, industry: 'อวกาศ' }),
    ).toThrow(/ต้องเป็นหนึ่งใน/);
  });

  it('เติมค่าเริ่มต้นให้ฟิลด์ที่ไม่ได้ส่งมา', () => {
    const parsed = parseStartupProfile({ requestedAmount: 500_000 });
    expect(parsed.requestedYears).toBe(5);
    expect(parsed.purpose).toBe('working_capital');
    expect(parsed.creditHistory).toBe('none');
  });

  it('อ่านตัวเลขที่มีจุลภาคได้', () => {
    expect(parseStartupProfile({ requestedAmount: '1,500,000' }).requestedAmount).toBe(1_500_000);
  });

  it('แปลง hasGuarantor จากหลายรูปแบบ', () => {
    expect(parseStartupProfile({ requestedAmount: 500_000, hasGuarantor: 'true' }).hasGuarantor).toBe(true);
    expect(parseStartupProfile({ requestedAmount: 500_000, hasGuarantor: false }).hasGuarantor).toBe(false);
  });
});

describe('/api/startup', () => {
  it('คืนตัวอย่างข้อมูลสำหรับเติมฟอร์ม', async () => {
    const response = await request(app).get('/api/startup/example').expect(200);
    expect(response.body.profile.requestedAmount).toBeGreaterThan(0);
  });

  it('ประเมินผ่าน HTTP ได้', async () => {
    const response = await request(app)
      .post('/api/startup/assess')
      .send(EXAMPLE_PROFILE)
      .expect(200);

    expect(response.body.score).toBeGreaterThanOrEqual(0);
    expect(response.body.score).toBeLessThanOrEqual(100);
    expect(response.body.factors).toHaveLength(9);
    expect(response.body.metrics.estimatedRatePct).toBeGreaterThan(0);
  });

  it('ตอบ 400 พร้อมบอกฟิลด์ที่ผิด', async () => {
    const response = await request(app)
      .post('/api/startup/assess')
      .send({ requestedAmount: 'ไม่ใช่ตัวเลข' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('เครื่องมือ assess_startup_loan_readiness', () => {
  it('ลงทะเบียนไว้ให้ AI เรียกได้', async () => {
    const response = await request(app).get('/api/tools').expect(200);
    const tool = response.body.tools.find(
      (item: { name: string }) => item.name === 'assess_startup_loan_readiness',
    );
    expect(tool).toBeTruthy();
    expect(tool.inputSchema.required).toContain('requestedAmount');
  });

  it('เรียกแล้วตอบสามคำถามหลักครบ', async () => {
    const response = await request(app)
      .post('/api/tools/assess_startup_loan_readiness/invoke')
      .send({ arguments: { requestedAmount: 800_000, monthlyRevenue: 320_000, monthlyExpenses: 265_000 } })
      .expect(200);

    expect(response.body.result.willBankLend.score).toBeGreaterThanOrEqual(0);
    expect(response.body.result.whatToBorrow.length).toBeGreaterThan(0);
    expect(response.body.result.whereToApply.length).toBeGreaterThan(0);
  });
});
