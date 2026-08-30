/**
 * ตัวเลขบนกราฟแท่งต้องอ่านได้จริงเมื่อชี้เมาส์และเมื่อโฟกัสด้วยคีย์บอร์ด
 *
 * เดิมมีแต่ <title> ของ SVG ซึ่งเป็นทูลทิปของระบบปฏิบัติการ — ขึ้นช้า จัดรูปแบบไม่ได้
 * และคีย์บอร์ดเข้าไม่ถึงเลย
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BarChart } from './BarChart';

const GROUPS = [
  {
    label: '2024',
    values: [
      { key: 'รายได้', value: 18.2 },
      { key: 'EBITDA', value: 6.4 },
      { key: 'กำไรสุทธิ', value: 4.1 },
    ],
  },
  {
    label: '2025',
    values: [
      { key: 'รายได้', value: 18.8 },
      { key: 'EBITDA', value: 4.6 },
      { key: 'กำไรสุทธิ', value: 3.2 },
    ],
  },
];

const format = (value: number) => value.toFixed(1);

function hitAreaFor(label: string): Element {
  const hit = screen.getByRole('button', { name: new RegExp(`^${label}:`) });
  return hit;
}

describe('BarChart hover', () => {
  it('ยังไม่ชี้ ขึ้นคำชวนให้ชี้ ไม่ใช่ตัวเลขมั่ว', () => {
    render(<BarChart groups={GROUPS} formatValue={format} />);
    expect(screen.getByText('ชี้ที่แท่งเพื่อดูตัวเลข')).toBeTruthy();
  });

  it('ชี้ที่ปีไหน แสดงทุกชุดของปีนั้นพร้อมกัน', () => {
    // คนดูกราฟนี้เทียบรายได้กับกำไรของปีเดียวกัน การให้ทีละแท่งทำให้ต้องชี้สามครั้ง
    const { container } = render(<BarChart groups={GROUPS} formatValue={format} />);
    fireEvent.mouseEnter(hitAreaFor('2024'));

    const tip = container.querySelector('.chart-readout');
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain('2024');
    expect(tip?.textContent).toContain('18.2');
    expect(tip?.textContent).toContain('6.4');
    expect(tip?.textContent).toContain('4.1');
    expect(tip?.textContent).not.toContain('18.8');
  });

  it('เอาเมาส์ออก กลับไปเป็นคำชวนให้ชี้', () => {
    const { container } = render(<BarChart groups={GROUPS} formatValue={format} />);
    fireEvent.mouseEnter(hitAreaFor('2024'));
    fireEvent.mouseLeave(hitAreaFor('2024'));
    expect(container.querySelector('.chart-readout')?.textContent).toBe('ชี้ที่แท่งเพื่อดูตัวเลข');
  });

  it('โฟกัสด้วยคีย์บอร์ดได้ตัวเลขชุดเดียวกับการชี้เมาส์', () => {
    const { container } = render(<BarChart groups={GROUPS} formatValue={format} />);
    fireEvent.focus(hitAreaFor('2025'));

    const tip = container.querySelector('.chart-readout');
    expect(tip?.textContent).toContain('2025');
    expect(tip?.textContent).toContain('18.8');
  });

  it('อ่านออกเสียงได้ครบทั้งปีและทุกชุด แม้ไม่เปิดกล่อง', () => {
    render(<BarChart groups={GROUPS} formatValue={format} />);
    expect(hitAreaFor('2024').getAttribute('aria-label')).toBe(
      '2024: รายได้ 18.2, EBITDA 6.4, กำไรสุทธิ 4.1',
    );
  });

  it('ไม่ใช้ทูลทิปของระบบปฏิบัติการซ้อนกับกล่องของเราเอง', () => {
    // <title> บน rect จะทำให้ขึ้นทูลทิปของเบราว์เซอร์ทับกล่องที่เพิ่งวาดไป
    const { container } = render(<BarChart groups={GROUPS} formatValue={format} />);
    expect(container.querySelectorAll('rect title')).toHaveLength(0);
  });

  it('ปีที่กำลังชี้เด่นขึ้น ปีอื่นจางลง', () => {
    const { container } = render(<BarChart groups={GROUPS} formatValue={format} />);
    const opacities = () =>
      [...container.querySelectorAll('svg > g[opacity]')].map((g) => g.getAttribute('opacity'));

    expect(opacities()).toEqual(['1', '1']);
    fireEvent.mouseEnter(hitAreaFor('2024'));
    expect(opacities()).toEqual(['1', '0.45']);
  });

  it('ไม่มีข้อมูลก็ไม่พัง', () => {
    render(<BarChart groups={[]} formatValue={format} />);
    expect(screen.getByText('ยังไม่มีข้อมูล')).toBeTruthy();
  });
});
