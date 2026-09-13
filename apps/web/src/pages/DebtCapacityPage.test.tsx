/**
 * หน้าต้นทุนหนี้ที่รับไหว
 *
 * จุดที่พังแล้วอันตรายที่สุดคือช่องเพดานดอกเบี้ย เพราะสองกรณีที่ตรงข้ามกันสุดทาง
 * ("รับไหวเกินตลาด" กับ "รับไม่ไหวเลย") ถ้าแสดงเหมือนกันหรือสลับกัน ผู้ใช้จะอ่านผลกลับด้าน
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { DebtCapacity, RateCeiling } from '@sme/shared';
import { DebtCapacityPage, describeCeiling } from './DebtCapacityPage';
import { api } from '../api/client';
import { AppProvider } from '../context';

function ceiling(over: Partial<RateCeiling>): RateCeiling {
  return {
    targetDscr: 1.2,
    labelTh: 'ระดับที่ผู้ให้กู้มักกำหนด',
    maxRatePct: 7.4,
    unbounded: false,
    headroomPct: 0.05,
    withinReach: true,
    ...over,
  };
}

const REPORT: DebtCapacity = {
  smeId: 'sme-siam-textile',
  fiscalYear: 2025,
  basis: {
    operatingCashFlow: 16_500_000,
    existingAnnualDebtService: 11_558_364,
    existingOutstanding: 62_000_000,
    existingWeightedRatePct: 6.79,
    currentDscr: 1.4275,
  },
  request: { amount: 11_960_000, years: 7 },
  market: {
    referenceRateName: 'MLR',
    referenceRatePct: 5.85,
    spreadPct: 1.5,
    estimatedRatePct: 7.35,
    provenance: {
      source: 'demo',
      sourceLabel: 'ข้อมูลจำลอง',
      lastUpdated: '2026-09-01',
      fetchedAt: '2026-09-13T00:00:00.000Z',
      stale: false,
      cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
      notice: null,
    },
  },
  ceilings: [
    ceiling({ targetDscr: 1.0, labelTh: 'จ่ายไหวพอดี', unbounded: true, maxRatePct: 25, headroomPct: 17.65 }),
    ceiling({ targetDscr: 1.2, maxRatePct: 7.36, headroomPct: 0.01, withinReach: true }),
    ceiling({ targetDscr: 1.5, labelTh: 'ระดับที่ถือว่าปลอดภัย', maxRatePct: null, headroomPct: null, withinReach: false }),
  ],
  capacities: [
    { targetDscr: 1.0, labelTh: 'จ่ายไหวพอดี', maxAmount: 26_970_000, monthlyPayment: 411_680, coversRequest: true },
    { targetDscr: 1.2, labelTh: 'ระดับที่ผู้ให้กู้มักกำหนด', maxAmount: 11_960_000, monthlyPayment: 182_562, coversRequest: true },
    { targetDscr: 1.5, labelTh: 'ระดับที่ถือว่าปลอดภัย', maxAmount: 0, monthlyPayment: 0, coversRequest: false },
  ],
  blendedRateAfterPct: 6.88,
  verdict: 'watch',
  summaryTh: 'ที่วงเงิน ฿11,960,000 รับดอกเบี้ยได้สูงสุด 7.36% ก่อน DSCR ตกถึง 1.20',
  disclaimerTh: 'เพดานอัตราดอกเบี้ยคำนวณจากกระแสเงินสดในงบล่าสุด',
};

describe('การอ่านเพดานเป็นคำ', () => {
  it('แยกสามกรณีที่มีความหมายต่างกันคนละทาง', () => {
    expect(describeCeiling(ceiling({ unbounded: true })).text).toBe('ไม่ถูกจำกัดด้วยอัตราดอกเบี้ย');
    expect(describeCeiling(ceiling({ maxRatePct: null })).text).toBe('รับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์');
    expect(describeCeiling(ceiling({ maxRatePct: 7.4 })).text).toContain('7.40');
  });

  it('ให้โทนสีตรงกับความหมาย ไม่ใช่ตรงกับว่ามีตัวเลขหรือไม่', () => {
    expect(describeCeiling(ceiling({ unbounded: true })).tone).toBe('good');
    expect(describeCeiling(ceiling({ maxRatePct: null })).tone).toBe('risk');
    // มีตัวเลขแต่ตลาดแพงกว่าเพดาน ต้องเป็นความเสี่ยง ไม่ใช่ผ่าน
    expect(describeCeiling(ceiling({ maxRatePct: 6, withinReach: false })).tone).toBe('risk');
  });
});

async function renderPage() {
  vi.spyOn(api.smes, 'debtCapacity').mockResolvedValue(REPORT);
  vi.spyOn(api.smes, 'search').mockResolvedValue({
    smes: [{ id: 'sme-siam-textile', nameTh: 'ก', nameEn: 'A', industry: 'manufacturing', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
    total: 1, limit: 25, offset: 0,
    facets: { industries: ['manufacturing'], provinces: ['กรุงเทพมหานคร'] },
    sort: 'name',
  } as never);
  vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

  render(
    <AppProvider>
      <DebtCapacityPage />
    </AppProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /เพดานอัตราดอกเบี้ย/ })).toBeTruthy());
}

function rowsUnder(heading: RegExp): HTMLElement[] {
  const section = screen.getByRole('heading', { name: heading }).closest('.section') as HTMLElement;
  return within(section).getAllByRole('row').slice(1);
}

describe('ตารางเพดานดอกเบี้ย', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงทั้งสามระดับ พร้อมข้อความที่ต่างกันตามกรณี', async () => {
    await renderPage();
    const rows = rowsUnder(/เพดานอัตราดอกเบี้ย/);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('ไม่ถูกจำกัดด้วยอัตราดอกเบี้ย')).toBeTruthy();
    expect(within(rows[1]!).getByText(/7\.36/)).toBeTruthy();
    expect(within(rows[2]!).getByText('รับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์')).toBeTruthy();
  });

  it('แสดงส่วนต่างพร้อมเครื่องหมาย และเว้นไว้เมื่อคำนวณไม่ได้', async () => {
    await renderPage();
    const rows = rowsUnder(/เพดานอัตราดอกเบี้ย/);
    expect(within(rows[1]!).getByText(/\+0\.01 จุด/)).toBeTruthy();
    expect(within(rows[2]!).getByText('—')).toBeTruthy();
  });

  it('บอกอัตราตลาดที่ใช้เทียบ พร้อมที่มาของอัตราอ้างอิง', async () => {
    await renderPage();
    const banner = screen.getByText(/อัตราตลาดตอนนี้ประมาณ/).closest('.banner') as HTMLElement;
    // อัตราที่ใช้เทียบต้องบอกทั้งอัตราอ้างอิงและส่วนต่าง ไม่ใช่ตัวเลขรวมลอย ๆ
    expect(within(banner).getByText(/MLR/)).toBeTruthy();
    expect(within(banner).getByText(/5\.85/)).toBeTruthy();
    expect(within(banner).getByText(/1\.50 จุด/)).toBeTruthy();
  });
});

describe('ตารางวงเงินที่รับไหว', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('บอกว่าระดับไหนครอบคลุมวงเงินที่ขอและระดับไหนไม่พอ', async () => {
    await renderPage();
    const rows = rowsUnder(/วงเงินสูงสุดที่รับไหว/);
    expect(within(rows[0]!).getByText('ครอบคลุม')).toBeTruthy();
    expect(within(rows[2]!).getByText('ไม่พอ')).toBeTruthy();
  });
});

describe('ฐานที่ใช้คำนวณ', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('เปิดเผยตัวเลขตั้งต้นทุกตัว ไม่ใช่แค่ผลลัพธ์', async () => {
    await renderPage();
    const section = screen.getByRole('heading', { name: /ฐานที่ใช้คำนวณ/ }).closest('.section') as HTMLElement;
    expect(within(section).getByText(/16,500,000/)).toBeTruthy();
    expect(within(section).getByText(/11,558,364/)).toBeTruthy();
    expect(within(section).getByText(/1\.43/)).toBeTruthy();
    expect(within(section).getByText(/6\.79/)).toBeTruthy();
    expect(within(section).getByText(/หลังกู้เพิ่มจะเป็น 6\.88/)).toBeTruthy();
  });
});

describe('กิจการที่ไม่เหลือช่องกู้เพิ่ม', () => {
  beforeEach(() => vi.restoreAllMocks());

  const NO_ROOM: DebtCapacity = {
    ...REPORT,
    request: { amount: 0, years: 7 },
    basis: { ...REPORT.basis, currentDscr: 0.47 },
    capacities: REPORT.capacities.map((c) => ({ ...c, maxAmount: 0, monthlyPayment: 0, coversRequest: false })),
    ceilings: REPORT.ceilings.map((c) => ({ ...c, maxRatePct: null, unbounded: false, headroomPct: null, withinReach: false })),
    verdict: 'risk',
    summaryTh: 'ภาระผ่อนหนี้เดิมสูงกว่ากระแสเงินสด ยังไม่เหลือช่องให้รับหนี้เพิ่ม',
  };

  it('อธิบายว่าปัญหาไม่ได้อยู่ที่อัตรา แทนที่จะโชว์ตารางเพดานของเงินกู้ ฿0', async () => {
    vi.spyOn(api.smes, 'debtCapacity').mockResolvedValue(NO_ROOM);
    vi.spyOn(api.smes, 'search').mockResolvedValue({
      smes: [{ id: 'x', nameTh: 'ก', nameEn: 'A', industry: 'logistics', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
      total: 1, limit: 25, offset: 0,
      facets: { industries: ['logistics'], provinces: ['กรุงเทพมหานคร'] },
      sort: 'name',
    } as never);
    vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

    render(
      <AppProvider>
        <DebtCapacityPage />
      </AppProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /เพดานอัตราดอกเบี้ย/ })).toBeTruthy(),
    );

    const section = screen
      .getByRole('heading', { name: /เพดานอัตราดอกเบี้ย/ })
      .closest('.section') as HTMLElement;
    expect(within(section).queryByRole('table')).toBeNull();
    expect(within(section).getByText(/ยังไม่มีวงเงินให้คิดเพดานดอกเบี้ย/)).toBeTruthy();
    // ต้องไม่พูดถึงวงเงิน ฿0 ราวกับเป็นคำขอจริง
    expect(section.textContent).not.toContain('฿0');
  });

  it('ไม่บอกต้นทุนหลังกู้เพิ่ม ในเมื่อกู้เพิ่มไม่ได้', async () => {
    vi.spyOn(api.smes, 'debtCapacity').mockResolvedValue(NO_ROOM);
    vi.spyOn(api.smes, 'search').mockResolvedValue({
      smes: [{ id: 'x', nameTh: 'ก', nameEn: 'A', industry: 'logistics', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
      total: 1, limit: 25, offset: 0,
      facets: { industries: ['logistics'], provinces: ['กรุงเทพมหานคร'] },
      sort: 'name',
    } as never);
    vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

    render(
      <AppProvider>
        <DebtCapacityPage />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: /ฐานที่ใช้คำนวณ/ })).toBeTruthy());
    expect(screen.queryByText(/หลังกู้เพิ่มจะเป็น/)).toBeNull();
  });
});
