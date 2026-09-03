/**
 * หน้าเกณฑ์การวัดธุรกิจ
 *
 * หัวใจคือ "ดี/ต้องจับตา/เสี่ยง" ต้องอ่านแล้วเข้าใจทิศทางถูก — ตัวชี้วัดบางตัวมากดี
 * บางตัวน้อยดี ถ้าเขียนสลับกันหน้าจอจะแนะนำตรงข้ามกับที่ระบบตัดสิน
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { RatioDefinition } from '@sme/shared';
import { BenchmarksPage, describeBenchmark } from './BenchmarksPage';
import { api } from '../api/client';

const CURRENT_RATIO: RatioDefinition = {
  key: 'current_ratio',
  label: 'Current Ratio',
  labelTh: 'อัตราส่วนสภาพคล่อง',
  unit: 'x',
  formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน',
  explanationTh: 'ครอบคลุมหนี้ที่ต้องจ่ายใน 1 ปีกี่เท่า',
  benchmark: { good: 1.5, watch: 1.0, higherIsBetter: true },
};

const DEBT_TO_EQUITY: RatioDefinition = {
  key: 'debt_to_equity',
  label: 'Debt to Equity',
  labelTh: 'หนี้สินต่อทุน (D/E)',
  unit: 'x',
  formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น',
  explanationTh: 'เกิน 3 เท่ามักถูกมองว่าใช้หนี้มากเกินไป',
  benchmark: { good: 1.5, watch: 3.0, higherIsBetter: false },
};

describe('describeBenchmark', () => {
  it('ตัวที่ยิ่งมากยิ่งดี: ดีคือตั้งแต่เกณฑ์ขึ้นไป', () => {
    expect(describeBenchmark(CURRENT_RATIO)).toEqual({
      good: 'ตั้งแต่ 1.50× ขึ้นไป',
      watch: '1.00× ถึง 1.50×',
      risk: 'ต่ำกว่า 1.00×',
    });
  });

  it('ตัวที่ยิ่งน้อยยิ่งดี: ดีคือไม่เกินเกณฑ์', () => {
    // ตัวเลข good/watch เท่ากันทั้งสองเคสได้ ความหมายอยู่ที่ทิศทางล้วน ๆ
    expect(describeBenchmark(DEBT_TO_EQUITY)).toEqual({
      good: 'ไม่เกิน 1.50×',
      watch: '1.50× ถึง 3.00×',
      risk: 'เกิน 3.00×',
    });
  });

  it('หน่วยเปอร์เซ็นต์กับวันก็อ่านออกตามหน่วยของตัวเอง', () => {
    expect(
      describeBenchmark({ ...CURRENT_RATIO, unit: 'percent', benchmark: { good: 10, watch: 0, higherIsBetter: true } }).good,
    ).toContain('10.0%');
    expect(
      describeBenchmark({ ...CURRENT_RATIO, unit: 'days', benchmark: { good: 45, watch: 75, higherIsBetter: false } }).good,
    ).toContain('45 วัน');
  });
});

describe('BenchmarksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'ratios').mockResolvedValue({
      groups: [
        { key: 'liquidity', label: 'Liquidity', labelTh: 'สภาพคล่อง', ratios: [CURRENT_RATIO] },
        { key: 'leverage', label: 'Leverage', labelTh: 'โครงสร้างหนี้', ratios: [DEBT_TO_EQUITY] },
      ],
    });
  });

  it('แสดงสูตรออกมาให้อ่าน ไม่ใช่ซ่อนไว้ในทูลทิป', async () => {
    // เดิมสูตรอยู่ใน title ของช่องตาราง ซึ่งบนมือถือไม่มีทางเห็นเลย
    render(<BenchmarksPage />);
    expect(await screen.findByText('สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน')).toBeTruthy();
    expect(screen.getByText('ครอบคลุมหนี้ที่ต้องจ่ายใน 1 ปีกี่เท่า')).toBeTruthy();
  });

  it('แต่ละตัวชี้วัดบอกช่วงครบทั้งสามระดับ', async () => {
    render(<BenchmarksPage />);
    const row = (await screen.findByText('อัตราส่วนสภาพคล่อง')).closest('tr') as HTMLElement;
    expect(within(row).getByText('ตั้งแต่ 1.50× ขึ้นไป')).toBeTruthy();
    expect(within(row).getByText('1.00× ถึง 1.50×')).toBeTruthy();
    expect(within(row).getByText('ต่ำกว่า 1.00×')).toBeTruthy();
  });

  it('จัดกลุ่มตามที่เซิร์ฟเวอร์ส่งมา ไม่ได้เรียงเอง', async () => {
    render(<BenchmarksPage />);
    await waitFor(() => expect(screen.getByText('สภาพคล่อง')).toBeTruthy());
    expect(screen.getByText('โครงสร้างหนี้')).toBeTruthy();
  });

  it('บอกว่าเกณฑ์ไม่ใช่กฎของธนาคาร', async () => {
    // ตัวเลขพวกนี้เป็นค่าอ้างอิงทั่วไป การปล่อยให้เข้าใจว่าเป็นเกณฑ์อนุมัติจริงคือทำให้เข้าใจผิด
    render(<BenchmarksPage />);
    expect(await screen.findByText(/ไม่ใช่กฎของธนาคาร/)).toBeTruthy();
  });
});
