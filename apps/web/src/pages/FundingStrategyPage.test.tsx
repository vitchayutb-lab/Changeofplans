/**
 * หน้าจัดหาแหล่งเงินทุน
 *
 * จุดที่ต้องไม่พลาด: การค้ำประกันไม่ใช่เงิน ถ้าหน้าแสดงเหมือนแหล่งเงินอื่นผู้ใช้จะนับซ้ำ
 * และ "ไม่มีต้นทุน" กับ "ไม่มีดอกเบี้ย" ต้องแยกกัน เพราะการเพิ่มทุนไม่มีดอกเบี้ยแต่มีต้นทุน
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { FundingSource, FundingStrategy } from '@sme/shared';
import { FundingStrategyPage, describeCost } from './FundingStrategyPage';
import { api } from '../api/client';
import { AppProvider } from '../context';

function source(over: Partial<FundingSource>): FundingSource {
  return {
    kind: 'debt',
    labelTh: 'สินเชื่อ',
    availableAmount: 1_790_000,
    annualCostPct: 7.35,
    nonCashCostTh: null,
    countsTowardPlan: true,
    whyTh: 'ได้เงินก้อนเร็ว',
    howToTh: 'เตรียมงบย้อนหลัง',
    basisTh: 'คำนวณจากงบจริง',
    programsTh: [],
    ...over,
  };
}

const REPORT: FundingStrategy = {
  smeId: 'sme-kruathai-foods',
  fiscalYear: 2025,
  needAmount: 10_000_000,
  workingCapital: {
    releases: [
      {
        key: 'receivables',
        labelTh: 'เร่งเก็บหนี้จากลูกค้า',
        currentDays: 63.88,
        targetDays: 45,
        releasableAmount: 4_965_699,
        formulaTh: 'รายได้ต่อวัน ฿263,014 × จำนวนวันที่ลดได้',
        actionTh: 'ออกใบแจ้งหนี้ทันทีที่ส่งของ',
        verdict: 'watch',
      },
      {
        key: 'inventory',
        labelTh: 'ลดสินค้าค้างคลัง',
        currentDays: 54.98,
        targetDays: 60,
        releasableAmount: 0,
        formulaTh: 'ต้นทุนขายต่อวัน ฿197,260 × จำนวนวันที่ลดได้',
        actionTh: 'ระบายสินค้าที่หมุนช้า',
        verdict: 'good',
      },
    ],
    totalReleasable: 4_965_699,
    payableDays: 79.55,
    cashCycleDays: 39.31,
  },
  sources: [
    source({ kind: 'working_capital', labelTh: 'เงินที่จมอยู่ในเงินทุนหมุนเวียน', availableAmount: 4_965_699, annualCostPct: 0 }),
    source({ kind: 'grant', labelTh: 'เงินให้เปล่า', availableAmount: 5_000_000, annualCostPct: null, nonCashCostTh: 'ไม่ต้องคืนเงินต้น แต่มีภาระรายงานผล', programsTh: ['ทุนนวัตกรรมแบบเปิด'] }),
    source({}),
    source({ kind: 'equity', labelTh: 'เพิ่มทุน / ร่วมลงทุน', availableAmount: 50_000_000, annualCostPct: null, nonCashCostTh: 'ผู้ถือหุ้นเดิมถูกลดสัดส่วนอย่างถาวร' }),
    source({ kind: 'guarantee', labelTh: 'การค้ำประกันสินเชื่อ', availableAmount: 40_000_000, annualCostPct: null, countsTowardPlan: false, nonCashCostTh: 'มีค่าธรรมเนียมรายปี' }),
  ],
  plan: [
    { kind: 'working_capital', labelTh: 'เงินที่จมอยู่ในเงินทุนหมุนเวียน', amount: 4_965_699, cumulativeAmount: 4_965_699, annualCostPct: 0, annualCost: 0 },
    { kind: 'grant', labelTh: 'เงินให้เปล่า', amount: 5_000_000, cumulativeAmount: 9_965_699, annualCostPct: null, annualCost: 0 },
    { kind: 'debt', labelTh: 'สินเชื่อ', amount: 34_301, cumulativeAmount: 10_000_000, annualCostPct: 7.35, annualCost: 2521 },
  ],
  coveredAmount: 10_000_000,
  gapAmount: 0,
  planAnnualCost: 2521,
  blendedCostPct: 0.03,
  summaryTh: 'ต้องการ ฿10,000,000 · แผนนี้ครอบคลุม ฿10,000,000 จาก 3 แหล่ง',
  disclaimerTh: 'วงเงินของเงินให้เปล่าเป็นวงเงินสูงสุดที่ประกาศไว้ ไม่ใช่จำนวนที่อนุมัติแล้ว',
};

describe('การอ่านต้นทุนของแต่ละแหล่ง', () => {
  it('แยก "ไม่มีต้นทุน" ออกจาก "ไม่มีดอกเบี้ย"', () => {
    // เงินตัวเอง: ต้นทุน 0 จริง ๆ
    expect(describeCost(source({ annualCostPct: 0 })).text).toBe('ไม่มีต้นทุน');
    // เพิ่มทุน: ไม่มีดอกเบี้ย แต่เสียสัดส่วน จึงไม่ใช่ "ไม่มีต้นทุน"
    expect(describeCost(source({ annualCostPct: null })).text).toBe('ไม่มีดอกเบี้ย');
  });

  it('แสดงอัตราจริงเมื่อมีดอกเบี้ย', () => {
    expect(describeCost(source({ annualCostPct: 7.35 })).text).toContain('7.35');
  });

  it('ไม่แสดงต้นทุนเป็นข้อดี เมื่อแหล่งนั้นให้เงินไม่ได้เลย', () => {
    // "฿0 · ไม่มีดอกเบี้ย" อ่านแล้วเหมือนเป็นทางเลือกที่ใช้ได้ ทั้งที่ใช้ไม่ได้
    expect(describeCost(source({ availableAmount: 0, annualCostPct: null })).text).toBe('ยังใช้ไม่ได้');
    expect(describeCost(source({ availableAmount: 0, annualCostPct: 0 })).text).toBe('ยังใช้ไม่ได้');
  });
});

async function renderPage(report: FundingStrategy = REPORT) {
  vi.spyOn(api.smes, 'fundingStrategy').mockResolvedValue(report);
  vi.spyOn(api.smes, 'search').mockResolvedValue({
    smes: [{ id: 'sme-kruathai-foods', nameTh: 'ก', nameEn: 'A', industry: 'food', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
    total: 1, limit: 25, offset: 0,
    facets: { industries: ['food'], provinces: ['กรุงเทพมหานคร'] },
    sort: 'name',
  } as never);
  vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

  render(
    <AppProvider>
      <FundingStrategyPage />
    </AppProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /แผนจัดหาเงิน/ })).toBeTruthy());
}

function rowsUnder(heading: RegExp): HTMLElement[] {
  const section = screen.getByRole('heading', { name: heading }).closest('.section') as HTMLElement;
  return within(section).getAllByRole('row').slice(1);
}

describe('เงินที่ปลดล็อกจากเงินทุนหมุนเวียน', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงจำนวนเงินเมื่อยังมีให้ปลดล็อก และบอกว่าดีกว่าเกณฑ์แล้วเมื่อไม่มี', async () => {
    await renderPage();
    const rows = rowsUnder(/เงินของคุณเองที่ยังไม่ได้ใช้/);
    expect(within(rows[0]!).getByText(/4,965,699/)).toBeTruthy();
    expect(within(rows[1]!).getByText('ดีกว่าเกณฑ์แล้ว')).toBeTruthy();
  });

  it('บอกวันจ่ายเจ้าหนี้เป็นบริบท พร้อมเหตุผลที่ไม่เสนอให้ยืด', async () => {
    await renderPage();
    expect(screen.getByText(/ระบบไม่เสนอให้ยืดหนี้การค้า/)).toBeTruthy();
  });
});

describe('รายการแหล่งเงิน', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ทำเครื่องหมายว่าการค้ำประกันไม่ใช่เงิน เพื่อไม่ให้นับซ้ำ', async () => {
    await renderPage();
    const rows = rowsUnder(/แหล่งเงินที่มี/);
    const guarantee = rows.find((row) => within(row).queryByText('การค้ำประกันสินเชื่อ'))!;
    expect(within(guarantee).getByText('ไม่ใช่เงิน')).toBeTruthy();
  });

  it('แสดงต้นทุนที่ไม่ใช่ดอกเบี้ยของการเพิ่มทุน', async () => {
    await renderPage();
    expect(screen.getByText(/ผู้ถือหุ้นเดิมถูกลดสัดส่วนอย่างถาวร/)).toBeTruthy();
  });
});

describe('แผนจัดสรร', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('เรียงลำดับและแสดงยอดสะสมจนครบตามที่ต้องการ', async () => {
    await renderPage();
    const rows = rowsUnder(/แผนจัดหาเงิน/);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('เงินที่จมอยู่ในเงินทุนหมุนเวียน')).toBeTruthy();
    expect(within(rows[2]!).getByText(/10,000,000/)).toBeTruthy();
  });

  it('บอกส่วนที่ยังขาด เมื่อหาได้ไม่ครบ', async () => {
    await renderPage({
      ...REPORT,
      coveredAmount: 6_727_932,
      gapAmount: 53_272_068,
      needAmount: 60_000_000,
    });
    expect(screen.getByText(/ยังขาด ฿53,272,068/)).toBeTruthy();
  });

  it('บอกตรง ๆ เมื่อไม่มีแหล่งเงินใดใช้ได้เลย', async () => {
    await renderPage({ ...REPORT, plan: [], coveredAmount: 0, gapAmount: REPORT.needAmount });
    expect(screen.getByText(/ยังไม่มีแหล่งเงินใดที่ใช้ได้ในตอนนี้/)).toBeTruthy();
  });
});
