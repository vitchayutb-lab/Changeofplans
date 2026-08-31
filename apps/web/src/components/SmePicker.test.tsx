/**
 * ตัวกรอง การเรียงลำดับ และการเลื่อนดูให้ครบทุกรายการ
 *
 * เดิมช่องค้นหาขอมา 20 รายการแล้วจบ ที่เหลืออีกเก้าร้อยกว่ารายไม่มีทางไปถึง
 * และตัวกรองที่เซิร์ฟเวอร์รองรับอยู่แล้วก็ไม่มีอะไรเรียกใช้
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SmeSummary } from '@sme/shared';
import { SmePicker } from './SmePicker';
import { api } from '../api/client';

function sme(n: number, over: Partial<SmeSummary> = {}): SmeSummary {
  return {
    id: `sme-${n}`,
    nameTh: `บริษัท ทดสอบ ${n}`,
    nameEn: `Test ${n}`,
    industry: 'food',
    province: 'กรุงเทพมหานคร',
    foundedYear: 2015,
    employees: 20,
    latestRevenue: 1_000_000,
    latestFiscalYear: 2025,
    ...over,
  };
}

const FACETS = { industries: ['food', 'tech'], provinces: ['กรุงเทพมหานคร', 'เชียงใหม่'] };

/** ฐานข้อมูลจำลอง 60 ราย ตอบตาม limit/offset ที่ขอมาจริง */
function stubSearch(totalCount = 60) {
  const all = Array.from({ length: totalCount }, (_, i) => sme(i));
  const calls: Record<string, unknown>[] = [];

  vi.spyOn(api.smes, 'search').mockImplementation(async (params = {}) => {
    calls.push(params);
    const offset = (params.offset as number) ?? 0;
    const limit = (params.limit as number) ?? 25;
    return {
      smes: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
      facets: FACETS,
      sort: (params.sort as never) ?? 'name',
    };
  });
  return calls;
}

/**
 * รายการผลลัพธ์เท่านั้น
 *
 * ต้องจำกัดขอบเขตด้วย listbox เพราะ <option> ของ <select> ที่เป็นตัวกรอง
 * ก็มี role เป็น option เหมือนกัน การถามหาทั้งหน้าจะได้ตัวเลือกของตัวกรองปนมาด้วย
 */
function options(): HTMLElement[] {
  return within(screen.getByRole('listbox')).queryAllByRole('option');
}

async function openPicker() {
  render(<SmePicker selected={null} total={60} onSelect={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /เลือกกิจการ/ }));
  await waitFor(() => expect(options().length).toBeGreaterThan(0));
}

describe('SmePicker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('บอกจำนวนที่พบทั้งหมดและจำนวนที่แสดงอยู่', async () => {
    stubSearch(60);
    await openPicker();
    expect(screen.getByText(/พบ 60 กิจการ · แสดง 25/)).toBeTruthy();
  });

  it('กดโหลดเพิ่มแล้วได้รายการต่อท้าย ไม่ใช่แทนที่ของเดิม', async () => {
    // นี่คือหัวใจของคำขอ: ต้องเลื่อนไปให้ถึงรายการสุดท้ายได้จริง
    stubSearch(60);
    await openPicker();
    expect(options()).toHaveLength(25);

    fireEvent.click(screen.getByRole('button', { name: /โหลดเพิ่ม/ }));
    await waitFor(() => expect(options()).toHaveLength(50));
    expect(screen.getByText(/แสดง 50/)).toBeTruthy();
  });

  it('โหลดจนครบแล้วปุ่มโหลดเพิ่มหายไป', async () => {
    stubSearch(60);
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: /โหลดเพิ่ม/ }));
    await waitFor(() => expect(options()).toHaveLength(50));
    fireEvent.click(screen.getByRole('button', { name: /โหลดเพิ่ม/ }));

    await waitFor(() => expect(options()).toHaveLength(60));
    expect(screen.queryByRole('button', { name: /โหลดเพิ่ม/ })).toBeNull();
  });

  it('ตัวเลือกของตัวกรองมาจากข้อมูลจริง ไม่ได้ฮาร์ดโค้ด', async () => {
    stubSearch();
    await openPicker();
    const provinces = screen.getByLabelText('กรองตามจังหวัด') as HTMLSelectElement;
    expect([...provinces.options].map((o) => o.value)).toEqual(['', ...FACETS.provinces]);
  });

  it('เลือกตัวกรองแล้วส่งไปให้เซิร์ฟเวอร์กรอง ไม่ได้กรองในเบราว์เซอร์', async () => {
    const calls = stubSearch();
    await openPicker();
    fireEvent.change(screen.getByLabelText('กรองตามจังหวัด'), { target: { value: 'เชียงใหม่' } });

    await waitFor(() => expect(calls.at(-1)?.province).toBe('เชียงใหม่'));
    expect(calls.at(-1)?.offset).toBeUndefined();
  });

  it('เปลี่ยนการเรียงลำดับแล้วเริ่มนับหน้าใหม่ ไม่ใช่ต่อท้ายของเดิม', async () => {
    // ถ้าไม่เริ่มใหม่ รายการจะเป็นของสองลำดับปนกัน
    const calls = stubSearch(60);
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: /โหลดเพิ่ม/ }));
    await waitFor(() => expect(options()).toHaveLength(50));

    fireEvent.change(screen.getByLabelText('เรียงลำดับ'), { target: { value: 'revenue_desc' } });
    await waitFor(() => expect(calls.at(-1)?.sort).toBe('revenue_desc'));
    await waitFor(() => expect(options()).toHaveLength(25));
  });

  it('ปุ่มล้างตัวกรองขึ้นเมื่อมีตัวกรองอยู่ และล้างได้จริง', async () => {
    stubSearch();
    await openPicker();
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรอง' })).toBeNull();

    fireEvent.change(screen.getByLabelText('กรองตามอุตสาหกรรม'), { target: { value: 'tech' } });
    fireEvent.click(await screen.findByRole('button', { name: 'ล้างตัวกรอง' }));

    await waitFor(() =>
      expect((screen.getByLabelText('กรองตามอุตสาหกรรม') as HTMLSelectElement).value).toBe(''),
    );
  });

  it('ไม่มีผลลัพธ์ก็บอกให้ชัด', async () => {
    stubSearch(0);
    render(<SmePicker selected={null} total={0} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /เลือกกิจการ/ }));
    expect(await screen.findByText('ไม่พบกิจการที่ตรงกับเงื่อนไข')).toBeTruthy();
  });
});
