/**
 * หน้าภาระหนี้ในอนาคต
 *
 * สองอย่างที่พังแล้วเสียหายที่สุด: (1) ป้ายว่าอัตราการเติบโตเป็นข้อมูลจริงหรือสมมติฐาน
 * ถ้าติดผิด ผู้ใช้จะเชื่อตัวเลข GDP ที่ตัวเองกรอกเองราวกับเป็นการพยากรณ์
 * (2) เส้นเกณฑ์ในกราฟ ถ้าไม่มี เส้น DSCR ก็อ่านไม่ออกว่าผ่านหรือไม่ผ่าน
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { DebtOutlook, OutlookScenario, OutlookYear } from '@sme/shared';
import { DebtOutlookPage, buildChartSeries, describeScenario } from './DebtOutlookPage';
import { api } from '../api/client';
import { AppProvider } from '../context';

function year(over: Partial<OutlookYear>): OutlookYear {
  return {
    year: 1,
    fiscalYear: 2026,
    revenue: 204_090_000,
    operatingCashFlow: 18_200_000,
    debtService: 11_558_364,
    interest: 4_000_000,
    principal: 7_558_364,
    dscr: 1.5749,
    verdict: 'good',
    maturingTh: [],
    ...over,
  };
}

function scenario(over: Partial<OutlookScenario>): OutlookScenario {
  return {
    key: 'base',
    labelTh: 'ฐาน',
    revenueGrowthPct: 10.32,
    years: [
      year({ year: 1, fiscalYear: 2026, dscr: 1.5749 }),
      year({ year: 2, fiscalYear: 2027, dscr: 1.8206, maturingTh: ['สินเชื่อการค้า · ธนาคาร ก'] }),
      year({ year: 3, fiscalYear: 2028, dscr: 2.6404, debtService: 8_390_000 }),
    ],
    firstYearBelowBankLevel: null,
    firstYearBelowBreakEven: null,
    minDscr: 1.5749,
    verdict: 'good',
    summaryTh: 'ฐาน: DSCR อยู่เหนือ 1.20 ตลอดช่วงคาดการณ์',
    ...over,
  };
}

const REPORT: DebtOutlook = {
  smeId: 'sme-siam-textile',
  baseFiscalYear: 2025,
  assumptions: {
    years: 3,
    basis: 'history',
    gdpGrowthPct: 3,
    revenueSensitivity: 1,
    revenueGrowthPct: 0,
    rateShockPct: 0,
    scenarioSpreadPct: 2,
  },
  base: {
    revenue: 185_000_000,
    operatingCashFlow: 16_500_000,
    cashMarginPct: 8.92,
    debtService: 11_558_364,
    dscr: 1.4275,
  },
  historicalRevenueCagrPct: 10.32,
  historicalYears: 3,
  growthSourceTh: 'อัตราการเติบโตย้อนหลัง 3 ปีของกิจการเอง 10.32% ต่อปี คำนวณจากงบจริง',
  growthIsAssumption: false,
  scenarios: [
    scenario({ key: 'low', labelTh: 'เศรษฐกิจชะลอ', revenueGrowthPct: 8.32, minDscr: 1.5463 }),
    scenario({}),
    scenario({ key: 'high', labelTh: 'เศรษฐกิจขยายตัว', revenueGrowthPct: 12.32, minDscr: 1.6034 }),
  ],
  summaryTh: 'ฐาน: DSCR อยู่เหนือ 1.20 ตลอดช่วงคาดการณ์',
  dataNoticeTh: null,
  disclaimerTh: 'การคาดการณ์นี้ถือว่าอัตรากำไรเงินสดคงเดิมและไม่มีการกู้เพิ่ม',
};

describe('การอ่านผลของแต่ละฉากทัศน์', () => {
  it('บอกปีที่จ่ายไม่ไหวก่อน เพราะร้ายแรงกว่าการหลุดเกณฑ์', () => {
    const s = scenario({ firstYearBelowBankLevel: 1, firstYearBelowBreakEven: 2 });
    expect(describeScenario(s)).toBe('จ่ายไม่ไหวตั้งแต่ปี 2027');
  });

  it('แยกการหลุดเกณฑ์ผู้ให้กู้ออกจากการจ่ายไม่ไหว', () => {
    const s = scenario({ firstYearBelowBankLevel: 2, firstYearBelowBreakEven: null });
    expect(describeScenario(s)).toBe('ยังจ่ายไหว แต่หลุดเกณฑ์ผู้ให้กู้ปี 2027');
  });

  it('บอกตรง ๆ เมื่อผ่านตลอดช่วง', () => {
    expect(describeScenario(scenario({}))).toBe('ผ่านเกณฑ์ตลอดช่วง');
  });
});

describe('กราฟเส้นทาง DSCR', () => {
  it('มีเส้นของทุกฉากทัศน์ พร้อมเส้นเกณฑ์สองเส้นให้เทียบ', () => {
    const series = buildChartSeries(REPORT);
    expect(series).toHaveLength(5);
    expect(series.map((s) => s.label)).toEqual([
      'เศรษฐกิจชะลอ',
      'ฐาน',
      'เศรษฐกิจขยายตัว',
      'เกณฑ์ผู้ให้กู้ 1.20',
      'จ่ายไหวพอดี 1.00',
    ]);
  });

  it('เส้นเกณฑ์เป็นเส้นตรงคลุมทุกปีเท่ากับตัวเลขเกณฑ์', () => {
    const series = buildChartSeries(REPORT);
    const bank = series.find((s) => s.label === 'เกณฑ์ผู้ให้กู้ 1.20')!;
    expect(bank.points.every((p) => p.y === 1.2)).toBe(true);
    expect(bank.points.map((p) => p.x)).toEqual(['2026', '2027', '2028']);
  });
});

async function renderWith(report: DebtOutlook) {
  vi.spyOn(api.smes, 'debtOutlook').mockResolvedValue(report);
  vi.spyOn(api.smes, 'search').mockResolvedValue({
    smes: [{ id: 'sme-siam-textile', nameTh: 'ก', nameEn: 'A', industry: 'manufacturing', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
    total: 1, limit: 25, offset: 0,
    facets: { industries: ['manufacturing'], provinces: ['กรุงเทพมหานคร'] },
    sort: 'name',
  } as never);
  vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

  render(
    <AppProvider>
      <DebtOutlookPage />
    </AppProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /สรุปแต่ละฉากทัศน์/ })).toBeTruthy());
}

describe('ป้ายกำกับความน่าเชื่อถือของอัตราการเติบโต', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('บอกว่ามาจากข้อมูลจริง เมื่อคิดจากงบของกิจการเอง', async () => {
    await renderWith(REPORT);
    expect(screen.getByText('อัตราการเติบโตจากข้อมูลจริง')).toBeTruthy();
    expect(screen.queryByText(/ตัวเลข GDP ที่ใช้เป็นสมมติฐาน/)).toBeNull();
  });

  it('เตือนให้เห็นชัด เมื่ออัตราที่ใช้เป็นสมมติฐานจาก GDP', async () => {
    await renderWith({
      ...REPORT,
      growthIsAssumption: true,
      assumptions: { ...REPORT.assumptions, basis: 'gdp' },
      growthSourceTh: 'GDP 3.00% × ความอ่อนไหวของรายได้ 1.00 เท่า = 3.00% ต่อปี',
      dataNoticeTh: 'ระบบไม่มีชุดข้อมูล GDP จริง — ตัวเลขที่ใช้เป็นสมมติฐานที่คุณกำหนดเอง',
    });
    expect(screen.getByText('อัตราการเติบโตเป็นสมมติฐาน')).toBeTruthy();
    expect(screen.getByText(/ตัวเลข GDP ที่ใช้เป็นสมมติฐาน ไม่ใช่การพยากรณ์/)).toBeTruthy();
    expect(screen.getByText(/ระบบไม่มีชุดข้อมูล GDP จริง/)).toBeTruthy();
  });
});

describe('ตารางรายปี', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ชี้ปีที่สินเชื่อครบกำหนด ซึ่งเป็นเหตุผลที่ภาระลดลง', async () => {
    await renderWith(REPORT);
    const section = screen.getByRole('heading', { name: /รายปี/ }).closest('.section') as HTMLElement;
    const rows = within(section).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('สินเชื่อการค้า · ธนาคาร ก')).toBeTruthy();
    expect(within(rows[0]!).getByText('—')).toBeTruthy();
  });

  it('แสดงทุกฉากทัศน์ในตารางสรุป พร้อมผลที่อ่านได้ทันที', async () => {
    await renderWith(REPORT);
    const section = screen.getByRole('heading', { name: /สรุปแต่ละฉากทัศน์/ }).closest('.section') as HTMLElement;
    const rows = within(section).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('เศรษฐกิจชะลอ')).toBeTruthy();
    expect(within(rows[0]!).getByText('ผ่านเกณฑ์ตลอดช่วง')).toBeTruthy();
  });
});
