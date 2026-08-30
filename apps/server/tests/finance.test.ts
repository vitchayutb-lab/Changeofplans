/** เทสต์เครื่องคำนวณทางการเงิน — เป็น pure function จึงตรวจกับค่าที่คำนวณมือได้ */

import { beforeEach, describe, expect, it } from 'vitest';
import { listStatements, listSmes } from '../src/db/smeRepo.js';
import { balanceCheck, derive, yearOverYear } from '../src/services/finance/statement.js';
import { amortize, annualDebtService, annualInterest, dscr, payment, quote } from '../src/services/finance/loan.js';
import { calculateRatios, findRatio, verdictFor } from '../src/services/finance/ratios.js';
import { effectiveRate } from '../src/services/finance/debt.js';
import { judge } from '../src/services/finance/simulation.js';
import { fxSensitivity } from '../src/services/finance/fx.js';
import { freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
});

describe('งบการเงินตั้งต้น', () => {
  it('งบดุลของทุกกิจการทุกปีสมดุลจริง (สินทรัพย์ = หนี้สิน + ทุน)', () => {
    const smes = listSmes();
    expect(smes.length).toBeGreaterThan(0);

    for (const sme of smes) {
      const statements = listStatements(sme.id);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        const check = balanceCheck(statement);
        expect(
          check.balanced,
          `${sme.id} ปี ${statement.fiscalYear} ต่างกัน ${check.difference}`,
        ).toBe(true);
      }
    }
  });

  it('ยอดหนี้คงค้างรวมของสินเชื่อตรงกับหนี้ที่มีดอกเบี้ยในงบปีล่าสุด', async () => {
    const { listLoans } = await import('../src/db/smeRepo.js');
    for (const sme of listSmes()) {
      const statements = listStatements(sme.id);
      const latest = derive(statements[statements.length - 1]!);
      const outstanding = listLoans(sme.id).reduce((sum, loan) => sum + loan.outstanding, 0);
      expect(outstanding, sme.id).toBeCloseTo(latest.totalDebt, 2);
    }
  });
});

describe('derive', () => {
  it('คำนวณลำดับกำไรตามนิยามบัญชี', () => {
    const statements = listStatements('sme-siam-textile');
    const latest = derive(statements[statements.length - 1]!);

    expect(latest.grossProfit).toBe(latest.revenue - latest.cogs);
    expect(latest.ebitda).toBe(latest.grossProfit - latest.operatingExpenses);
    expect(latest.ebit).toBe(latest.ebitda - latest.depreciation);
    expect(latest.ebt).toBe(latest.ebit - latest.interestExpense);
    expect(latest.netProfit).toBe(latest.ebt - latest.tax);
    expect(latest.operatingCashFlow).toBe(latest.ebitda - latest.interestExpense - latest.tax);
  });
});

describe('yearOverYear', () => {
  it('คืน null เมื่อไม่มีปีก่อนให้เทียบ', () => {
    const statements = listStatements('sme-siam-textile');
    expect(yearOverYear(derive(statements[0]!), null).revenue).toBeNull();
  });

  it('คำนวณอัตราการเติบโตเป็นสัดส่วน', () => {
    const statements = listStatements('sme-siam-textile');
    const yoy = yearOverYear(derive(statements[2]!), derive(statements[1]!));
    // 185.0M เทียบ 168.0M = +10.12%
    expect(yoy.revenue).toBeCloseTo(0.1012, 3);
  });
});

describe('payment / amortize', () => {
  it('คำนวณค่างวดตามสูตร annuity', () => {
    // 1,000,000 บาท 6% ต่อปี 5 ปี → 19,332.80 บาท/เดือน
    expect(payment(1_000_000, 6, 5)).toBeCloseTo(19332.8, 1);
  });

  it('ดอกเบี้ย 0% แบ่งเงินต้นเท่ากันทุกงวด', () => {
    expect(payment(1_200_000, 0, 1)).toBe(100_000);
  });

  it('ตารางผ่อนปิดยอดคงเหลือเป็นศูนย์พอดี', () => {
    const rows = amortize(1_000_000, 6.5, 3);
    expect(rows).toHaveLength(36);
    expect(rows[rows.length - 1]!.closingBalance).toBe(0);
    const principalPaid = rows.reduce((sum, row) => sum + row.principal, 0);
    expect(principalPaid).toBeCloseTo(1_000_000, 1);
  });

  it('ดอกเบี้ยรวมของ quote ตรงกับผลรวมในตาราง', () => {
    const result = quote(10_000_000, 6.5, 5);
    const scheduleInterest = result.schedule.reduce((sum, row) => sum + row.interest, 0);
    expect(result.totalInterest).toBeCloseTo(scheduleInterest, 2);
    expect(result.firstYearInterest).toBeLessThan(result.totalInterest);
    expect(result.isEstimate).toBe(true);
  });

  it('ปฏิเสธระยะเวลาผ่อนที่เป็นศูนย์', () => {
    expect(() => payment(1_000_000, 6, 0)).toThrow();
  });
});

describe('dscr และภาระหนี้', () => {
  it('DSCR = กระแสเงินสด ÷ ภาระชำระหนี้', () => {
    expect(dscr(1_500_000, 1_000_000)).toBe(1.5);
  });

  it('คืน null เมื่อไม่มีภาระหนี้', () => {
    expect(dscr(1_000_000, 0)).toBeNull();
  });

  it('annualInterest คิดจากยอดคงค้าง', () => {
    expect(annualInterest(10_000_000, 6.5)).toBe(650_000);
  });

  it('annualDebtService รวมเงินต้นจึงมากกว่าดอกเบี้ยอย่างเดียว', () => {
    const service = annualDebtService(10_000_000, 6.5, 60);
    expect(service).toBeGreaterThan(annualInterest(10_000_000, 6.5));
  });
});

describe('effectiveRate', () => {
  const rates = {
    MLR: { value: 5.85, provenance: null as never },
    MOR: { value: 6.3, provenance: null as never },
    MRR: { value: 6.0, provenance: null as never },
  };

  it('สินเชื่อคงที่ใช้อัตราที่บันทึกไว้ตรง ๆ', () => {
    expect(effectiveRate({ rateType: 'fixed', rateValue: 4.5 }, rates).ratePct).toBe(4.5);
  });

  it('สินเชื่อลอยตัวบวกส่วนต่างเข้ากับอัตราอ้างอิงล่าสุด', () => {
    const result = effectiveRate({ rateType: 'mlr_spread', rateValue: 0.75 }, rates);
    expect(result.ratePct).toBe(6.6);
    expect(result.referenceName).toBe('MLR');
  });

  it('คืน null เมื่อดึงอัตราอ้างอิงไม่ได้ แทนที่จะเดา', () => {
    const missing = { ...rates, MRR: { value: null, provenance: null as never } };
    expect(effectiveRate({ rateType: 'mrr_spread', rateValue: 1 }, missing).ratePct).toBeNull();
  });
});

describe('อัตราส่วนทางการเงิน', () => {
  it('คำนวณอัตราส่วนหลักของกิจการตัวอย่างได้ถูกต้อง', () => {
    const statements = listStatements('sme-siam-textile');
    const latest = derive(statements[statements.length - 1]!);
    const groups = calculateRatios(latest, { annualDebtService: 11_560_000 });

    const current = findRatio(groups, 'current_ratio');
    // (12.4 + 38.5 + 44.2 + 3.1) / (29.8 + 24.0 + 6.4) = 98.2 / 60.2
    expect(current?.value).toBeCloseTo(1.6312, 3);

    const de = findRatio(groups, 'debt_to_equity');
    // 102.2 / 74.0
    expect(de?.value).toBeCloseTo(1.3811, 3);

    const coverage = findRatio(groups, 'interest_coverage');
    // 16.8 / 3.9
    expect(coverage?.value).toBeCloseTo(4.3077, 3);
  });

  it('กิจการที่สภาพคล่องต่ำถูกตีเป็นความเสี่ยง', () => {
    const statements = listStatements('sme-baansuan-retail');
    const latest = derive(statements[statements.length - 1]!);
    const groups = calculateRatios(latest, { annualDebtService: 3_000_000 });
    expect(findRatio(groups, 'current_ratio')?.verdict).toBe('risk');
  });

  it('verdictFor เคารพทิศทางของเกณฑ์', () => {
    const higher = { good: 1.5, watch: 1.0, higherIsBetter: true };
    expect(verdictFor(2, higher)).toBe('good');
    expect(verdictFor(1.2, higher)).toBe('watch');
    expect(verdictFor(0.5, higher)).toBe('risk');
    expect(verdictFor(null, higher)).toBe('na');

    const lower = { good: 1.5, watch: 3.0, higherIsBetter: false };
    expect(verdictFor(1.0, lower)).toBe('good');
    expect(verdictFor(2.0, lower)).toBe('watch');
    expect(verdictFor(4.0, lower)).toBe('risk');
  });
});

describe('judge', () => {
  it('DSCR ต่ำกว่า 1 คือความเสี่ยง', () => {
    expect(judge(0.8, 3, 1).verdict).toBe('risk');
  });

  it('DSCR ระหว่าง 1 ถึง 1.2 คือควรจับตา', () => {
    const result = judge(1.1, 3, 1);
    expect(result.verdict).toBe('watch');
    expect(result.reasonTh).toContain('1.10');
  });

  it('ตัวเลขดีทุกด้านผ่านเกณฑ์', () => {
    expect(judge(2.0, 5, 1).verdict).toBe('good');
  });

  it('D/E สูงเกิน 3 เท่าดันผลให้เป็นควรจับตา', () => {
    expect(judge(2.0, 5, 4).verdict).toBe('watch');
  });
});

describe('fxSensitivity', () => {
  it('ผลกระทบเป็นสัดส่วนตรงกับมูลค่าธุรกรรม', () => {
    expect(fxSensitivity(42_000_000, 5).impactThb).toBe(2_100_000);
    expect(fxSensitivity(42_000_000, -5).impactThb).toBe(-2_100_000);
  });
});
