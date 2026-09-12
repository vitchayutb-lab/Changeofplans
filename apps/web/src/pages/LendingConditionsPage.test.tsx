/**
 * หน้าเงื่อนไขการกู้
 *
 * จุดที่พังแล้วเสียหายที่สุดคือแถวที่บอกว่า "แก้ข้อนี้แล้วปลดล็อกเพิ่มกี่โครงการ" —
 * ถ้าแสดงตัวเลขของเงื่อนไขผิดข้อ ผู้ใช้จะไปแก้ผิดเรื่อง เทสต์จึงเจาะที่แถวเหล่านี้เป็นหลัก
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LendingConditionsReport, LendingOverview, LendingProfile } from '@sme/shared';
import { LendingConditionsPage } from './LendingConditionsPage';
import { api } from '../api/client';

const PROFILE: LendingProfile = {
  industry: 'services',
  province: 'กรุงเทพมหานคร',
  yearsOperating: 3,
  employees: 30,
  annualRevenue: 50_000_000,
  dscr: 1.3,
  hasCollateral: false,
  amountNeeded: 3_000_000,
};

const OVERVIEW: LendingOverview = {
  totalPrograms: 14,
  opennessFormulaTh: 'คะแนน = 40% × สัดส่วนโครงการที่รับอุตสาหกรรมนี้ + …',
  industries: [
    {
      industry: 'food', labelTh: 'อาหารและเครื่องดื่ม', programs: 12, totalPrograms: 14,
      targeted: 4, byType: { loan: 7, grant: 2, guarantee: 2, equity: 1, subsidy: 1 },
      noCollateral: 12, dayOne: 4, noDscr: 8, rateMinPct: 0, rateMaxPct: 7,
      maxAmount: 50_000_000, opennessScore: 70,
      targetedProgramsTh: ['ทุนนวัตกรรมแบบเปิด (Open Innovation)'],
    },
    {
      industry: 'services', labelTh: 'บริการ', programs: 8, totalPrograms: 14,
      targeted: 0, byType: { loan: 5, grant: 0, guarantee: 2, equity: 0, subsidy: 1 },
      noCollateral: 8, dayOne: 3, noDscr: 5, rateMinPct: 0.5, rateMaxPct: 6.5,
      maxAmount: 40_000_000, opennessScore: 47,
      targetedProgramsTh: [],
    },
  ],
  rules: [
    {
      rule: 'dscr', labelTh: 'ความสามารถชำระหนี้ (DSCR)',
      explanationTh: 'กระแสเงินสดหารภาระผ่อน',
      programsWithRule: 6, totalPrograms: 14,
      thresholdsTh: ['อย่างน้อย 1.00 เท่า', 'อย่างน้อย 1.30 เท่า'],
    },
    {
      rule: 'collateral', labelTh: 'หลักประกัน',
      explanationTh: 'ทรัพย์ที่ยึดได้ถ้าผิดนัด',
      programsWithRule: 1, totalPrograms: 14,
      thresholdsTh: ['ต้องมีหลักประกัน'],
    },
  ],
};

const REPORT: LendingConditionsReport = {
  profile: PROFILE,
  totalPrograms: 14,
  eligiblePrograms: 4,
  summaryTh: 'ธุรกิจบริการตามตัวเลขที่กรอก ผ่านเงื่อนไข 4 จาก 14 โครงการ',
  disclaimerTh: 'ผลนี้คือการตรวจเงื่อนไขที่แต่ละโครงการประกาศไว้เท่านั้น ไม่ใช่การอนุมัติ',
  industry: OVERVIEW.industries[1]!,
  outcomes: [
    {
      programId: 'fp-a', nameTh: 'สินเชื่อผ่านเกณฑ์', provider: 'ธนาคาร ก', type: 'loan',
      eligible: true, conditions: [], failedRules: [], descriptionTh: '', url: null,
    },
    {
      programId: 'fp-b', nameTh: 'สินเชื่อที่ยังไม่ผ่าน', provider: 'ธนาคาร ข', type: 'loan',
      eligible: false,
      conditions: [
        { rule: 'amount', labelTh: 'วงเงิน', passed: false, actual: '฿3,000,000', required: '฿50,000 – ฿2,000,000' },
        { rule: 'dscr', labelTh: 'ความสามารถชำระหนี้ (DSCR)', passed: true, actual: '1.30 เท่า', required: 'ไม่กำหนด' },
      ],
      failedRules: ['amount'], descriptionTh: '', url: null,
    },
  ],
  levers: [
    {
      rule: 'amount', labelTh: 'วงเงิน', blocking: 5, unlocks: 1,
      currentTh: '฿3,000,000', targetTh: '฿50,000 – ฿2,000,000',
      actionTh: 'ปรับวงเงินที่ขอจาก ฿3,000,000 เป็น ฿2,000,000',
      unlockedProgramsTh: ['สินเชื่อที่ยังไม่ผ่าน'],
    },
    {
      rule: 'collateral', labelTh: 'หลักประกัน', blocking: 1, unlocks: 0,
      currentTh: 'ไม่มีหลักประกัน', targetTh: 'ต้องมีหลักประกัน',
      actionTh: 'แก้ข้อนี้อย่างเดียวยังไม่ปลดล็อกโครงการใด',
      unlockedProgramsTh: [],
    },
  ],
  industrySwitches: [
    { industry: 'food', labelTh: 'อาหารและเครื่องดื่ม', eligiblePrograms: 7, delta: 3, current: false },
    { industry: 'services', labelTh: 'บริการ', eligiblePrograms: 4, delta: 0, current: true },
    { industry: 'retail', labelTh: 'ค้าปลีก', eligiblePrograms: 2, delta: -2, current: false },
  ],
};

/**
 * ตารางในส่วนที่มีหัวข้อนั้น
 *
 * หน้านี้มีหลายตารางและข้อความหัวข้อบางอันไปซ้ำกับคำโปรยด้านบน จึงต้องจับจาก heading
 * ไม่ใช่จากข้อความเปล่า ๆ
 */
function tableUnder(heading: RegExp): HTMLElement {
  const section = screen
    .getByRole('heading', { name: heading })
    .closest('.section') as HTMLElement;
  return within(section).getAllByRole('table')[0]!;
}

function rowsUnder(heading: RegExp): HTMLElement[] {
  return within(tableUnder(heading)).getAllByRole('row').slice(1);
}

async function renderPage() {
  vi.spyOn(api.lending, 'overview').mockResolvedValue(OVERVIEW);
  vi.spyOn(api.lending, 'example').mockResolvedValue({ profile: PROFILE });
  vi.spyOn(api.lending, 'check').mockResolvedValue(REPORT);

  render(<LendingConditionsPage />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'ตรวจเงื่อนไข' })).toBeTruthy(),
  );
}

async function renderAndCheck() {
  await renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'ตรวจเงื่อนไข' }));
  await waitFor(() => expect(screen.getByText(/แก้อะไรแล้วกู้ง่ายขึ้น/)).toBeTruthy());
}

describe('ตารางความเปิดกว้างรายอุตสาหกรรม', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงทุกอุตสาหกรรมที่เซิร์ฟเวอร์ส่งมา', async () => {
    await renderPage();
    expect(rowsUnder(/ธุรกิจแบบไหนหาแหล่งเงินได้ง่ายกว่า/)).toHaveLength(2);
  });

  it('บอกคะแนนความเปิดกว้างให้โปรแกรมอ่านหน้าจอด้วย ไม่ใช่แค่แถบสี', async () => {
    await renderPage();
    expect(screen.getByLabelText('คะแนนความเปิดกว้าง 70 จาก 100')).toBeTruthy();
    expect(screen.getByLabelText('คะแนนความเปิดกว้าง 47 จาก 100')).toBeTruthy();
  });

  it('บอกตรง ๆ เมื่ออุตสาหกรรมนั้นไม่มีโครงการเจาะจงรองรับ', async () => {
    await renderPage();
    expect(screen.getByText(/ไม่มี — เข้าถึงได้เฉพาะโครงการที่เปิดให้ทุกประเภทธุรกิจ/)).toBeTruthy();
  });

  it('แสดงสูตรของคะแนน เพื่อไม่ให้เป็นกล่องดำ', async () => {
    await renderPage();
    expect(screen.getByText(/คะแนน = 40%/)).toBeTruthy();
  });
});

describe('เงื่อนไขที่ปลดล็อกได้', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงจำนวนที่ปลดล็อกได้เฉพาะข้อที่ปลดล็อกได้จริง', async () => {
    await renderAndCheck();
    const [amountRow, collateralRow] = rowsUnder(/แก้อะไรแล้วกู้ง่ายขึ้น/);

    expect(within(amountRow!).getByText('+1')).toBeTruthy();
    expect(within(amountRow!).getByText(/ตอนนี้ ฿3,000,000 → ต้องการ ฿50,000 – ฿2,000,000/)).toBeTruthy();
    expect(within(amountRow!).getByText('สินเชื่อที่ยังไม่ผ่าน')).toBeTruthy();

    // ข้อที่แก้แล้วยังไม่ปลดล็อกอะไร ต้องไม่แสดงตัวเลขที่ทำให้เข้าใจว่าได้ผล
    expect(within(collateralRow!).queryByText('+0')).toBeNull();
    expect(within(collateralRow!).getByText(/ยังไม่ปลดล็อกโครงการใด/)).toBeTruthy();
  });

  it('แสดงจำนวนโครงการที่แต่ละเงื่อนไขขวางอยู่', async () => {
    await renderAndCheck();
    const [amountRow] = rowsUnder(/แก้อะไรแล้วกู้ง่ายขึ้น/);
    expect(within(amountRow!).getByText('5')).toBeTruthy();
  });
});

describe('การเทียบประเภทธุรกิจ', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ทำเครื่องหมายประเภทที่เลือกอยู่ และแสดงส่วนต่างทั้งบวกและลบ', async () => {
    await renderAndCheck();
    const rows = rowsUnder(/ถ้าเป็นธุรกิจประเภทอื่น/);
    expect(rows).toHaveLength(3);

    expect(within(rows[1]!).getByText('ตอนนี้')).toBeTruthy();
    expect(rows[1]!.className).toContain('is-current');

    expect(within(rows[0]!).getByText('+3')).toBeTruthy();
    expect(within(rows[2]!).getByText('-2')).toBeTruthy();
  });
});

describe('ผลรวมและรายโครงการ', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('แสดงจำนวนที่ผ่านเทียบกับทั้งหมด', async () => {
    await renderAndCheck();
    const verdict = document.querySelector('.verdict') as HTMLElement;
    expect(within(verdict).getByText('4')).toBeTruthy();
    expect(within(verdict).getByText('/ 14')).toBeTruthy();
    expect(screen.getByText(REPORT.summaryTh)).toBeTruthy();
  });

  it('บอกเหตุผลรายข้อของโครงการที่ยังไม่ผ่าน ไม่ใช่แค่ว่าไม่ผ่าน', async () => {
    await renderAndCheck();
    const rows = rowsUnder(/ผลรายโครงการ/);
    const blocked = rows.find((row) => within(row).queryByText('ติด 1 ข้อ')) as HTMLElement;
    expect(within(blocked).getByText(/มี ฿3,000,000 \/ ต้องการ ฿50,000 – ฿2,000,000/)).toBeTruthy();
    // เงื่อนไขที่ผ่านแล้วต้องไม่ถูกนับเป็นเหตุผลที่ไม่ผ่าน
    expect(within(blocked).queryByText(/ไม่กำหนด/)).toBeNull();
  });

  it('ไม่ลืมข้อความกำกับว่าผลนี้ไม่ใช่การอนุมัติ', async () => {
    await renderAndCheck();
    expect(screen.getByText(REPORT.disclaimerTh)).toBeTruthy();
  });
});
