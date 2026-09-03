/**
 * ตารางผ่อนชำระต้องแสดงทุกงวด
 *
 * เดิมตัดไว้ที่ 12 งวดแรก สินเชื่อสิบปีจึงดูได้ 12 จาก 120 งวด
 * และงวดท้าย ๆ ซึ่งเป็นช่วงที่เงินต้นลดเร็วที่สุดไม่มีทางเห็นเลย
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AmortizationRow, LoanSimulation } from '@sme/shared';
import { AppProvider } from '../context';
import { LoanSimulatorPage } from './LoanSimulatorPage';
import { api } from '../api/client';

function schedule(months: number): AmortizationRow[] {
  return Array.from({ length: months }, (_, i) => ({
    month: i + 1,
    openingBalance: 1_000_000 - i * 1000,
    payment: 12_000,
    interest: 5000,
    principal: 7000,
    closingBalance: 1_000_000 - (i + 1) * 1000,
  }));
}

function simulation(months: number): LoanSimulation {
  return {
    smeId: 'sme-1',
    quote: {
      principal: 1_000_000,
      annualRatePct: 7,
      years: months / 12,
      paymentsPerYear: 12,
      monthlyPayment: 12_000,
      totalPayment: 12_000 * months,
      totalInterest: 5000 * months,
      firstYearInterest: 60_000,
      isEstimate: true,
      schedule: schedule(months),
    },
    rate: {
      basis: 'fixed',
      referenceRateName: null,
      referenceRatePct: null,
      spreadPct: 0,
      effectiveRatePct: 7,
      provenance: null,
    },
    impact: {
      dscrBefore: 2, dscrAfter: 1.5,
      debtToEquityBefore: 1, debtToEquityAfter: 1.4,
      interestCoverageBefore: 5, interestCoverageAfter: 3,
      interestToEbit: 0.2,
      verdict: 'good',
      verdictReasonTh: 'ผ่าน',
    },
    downside: null,
    disclaimerTh: 'ประมาณการ',
    disclaimerEn: 'estimate',
  };
}

/** ตารางงวด (การ์ดอื่นในหน้าก็มีตาราง จึงต้องเจาะจงใบนี้) */
function scheduleRows(): HTMLElement[] {
  const card = screen.getByText(/ทุกงวด/).closest('.card') as HTMLElement;
  return within(card).getAllByRole('row').slice(1);
}

async function renderWith(months: number) {
  vi.spyOn(api.smes, 'simulate').mockResolvedValue(simulation(months));
  vi.spyOn(api.smes, 'debt').mockResolvedValue({ loans: [], totalOutstanding: 0, totalAnnualDebtService: 0 } as never);
  vi.spyOn(api.smes, 'search').mockResolvedValue({
    smes: [{ id: 'sme-1', nameTh: 'ก', nameEn: 'A', industry: 'food', province: 'กรุงเทพมหานคร', foundedYear: 2015, employees: 5, latestRevenue: 1, latestFiscalYear: 2025 }],
    total: 1, limit: 25, offset: 0,
    facets: { industries: ['food'], provinces: ['กรุงเทพมหานคร'] },
    sort: 'name',
  });
  vi.spyOn(api, 'health').mockResolvedValue({ modes: {}, bot: {}, llm: {} } as never);

  render(
    <AppProvider>
      <LoanSimulatorPage />
    </AppProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'คำนวณ' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'คำนวณ' }));
  await waitFor(() => expect(screen.getByText(/ทุกงวด/)).toBeTruthy());
}

describe('ตารางผ่อนชำระ', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงครบทุกงวด ไม่ใช่แค่งวดแรก ๆ', async () => {
    await renderWith(120);
    expect(scheduleRows()).toHaveLength(120);
  });

  it('งวดสุดท้ายอยู่ในตารางจริง', async () => {
    // นี่คือแถวที่ยอดคงเหลือเป็นศูนย์ ซึ่งเป็นเหตุผลที่คนเลื่อนลงมาดู
    await renderWith(120);
    const rows = scheduleRows();
    expect(within(rows[rows.length - 1]!).getByText('120')).toBeTruthy();
  });

  it('บอกจำนวนงวดไว้ที่หัวการ์ด ไม่ใช่ตัวเลขตายตัว', async () => {
    await renderWith(36);
    expect(screen.getByText('ทุกงวด (36 งวด)')).toBeTruthy();
    expect(scheduleRows()).toHaveLength(36);
  });

  it('ตารางเลื่อนในตัวเอง หัวตารางจึงไม่หลุดออกจากจอ', async () => {
    await renderWith(120);
    const card = screen.getByText(/ทุกงวด/).closest('.card') as HTMLElement;
    expect(card.querySelector('.table-wrap--tall')).not.toBeNull();
  });
});
