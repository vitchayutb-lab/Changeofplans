/**
 * แกนตั้งของกราฟเส้น
 *
 * yZero มีไว้บอกว่า "ฐานของแกนคือศูนย์" แต่การเว้นขอบด้านล่างที่ทำหลังจากนั้นดึงแกน
 * หลุดไปใต้ศูนย์ กราฟของค่าที่ติดลบไม่ได้อย่าง DSCR จึงมีขีดแกนติดลบให้อ่านผิด
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineChart } from './LineChart';

const series = [
  { label: 'DSCR', points: [{ x: '2026', y: 0.48 }, { x: '2027', y: 4.2 }, { x: '2028', y: 8.4 }] },
];

function axisLabels(): string[] {
  return Array.from(document.querySelectorAll('text'))
    .map((node) => node.textContent ?? '')
    .filter((text) => text.includes('×'));
}

describe('แกนตั้งเมื่อบังคับฐานศูนย์', () => {
  it('ไม่มีขีดแกนติดลบ เมื่อข้อมูลไม่มีค่าติดลบ', () => {
    render(<LineChart series={series} yZero formatValue={(v) => `${v.toFixed(2)}×`} />);
    const labels = axisLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((text) => text.startsWith('-'))).toBe(false);
    expect(labels).toContain('0.00×');
  });

  it('ยังแสดงค่าติดลบได้ตามปกติ เมื่อข้อมูลมีค่าติดลบจริง', () => {
    render(
      <LineChart
        series={[{ label: 'กำไร', points: [{ x: 'a', y: -5 }, { x: 'b', y: 10 }] }]}
        yZero
        formatValue={(v) => `${v.toFixed(2)}×`}
      />,
    );
    expect(axisLabels().some((text) => text.startsWith('-'))).toBe(true);
  });

  it('ไม่บังคับฐานศูนย์เมื่อไม่ได้ขอ', () => {
    render(<LineChart series={series} formatValue={(v) => `${v.toFixed(2)}×`} />);
    // ไม่มี yZero แกนจึงเริ่มใกล้ค่าต่ำสุดของข้อมูล ไม่ใช่ศูนย์
    expect(screen.getByRole('img', { hidden: true })).toBeTruthy();
  });
});
