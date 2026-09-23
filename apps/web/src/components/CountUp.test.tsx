/**
 * ตัวเลข KPI ต้องนับขึ้นถึงค่าจริงในที่สุด — ไม่ใช่ค้างอยู่ระหว่างทางหรือข้ามไปเลขอื่น
 *
 * ใช้ fake timer ควบคุมเวลาเอง แทนการรอเวลาจริงด้วย waitFor — การรอเวลาจริงกับ
 * requestAnimationFrame ไม่แน่นอนเวลารันพร้อมเทสต์ไฟล์อื่นจำนวนมาก (CPU ถูกแบ่ง)
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from './CountUp';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CountUp', () => {
  it('ตอนปรากฏครั้งแรกเริ่มนับจาก 0', () => {
    render(<CountUp value={1000} format={(n) => String(Math.round(n))} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('จบลงที่ค่าจริงเสมอ', () => {
    render(<CountUp value={1_682_062} format={(n) => `฿${Math.round(n).toLocaleString('en-US')}`} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('฿1,682,062')).toBeTruthy();
  });

  it('เปลี่ยนค่าใหม่แล้วจบลงที่ค่าใหม่', () => {
    const { rerender } = render(<CountUp value={100} format={(n) => String(Math.round(n))} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('100')).toBeTruthy();

    rerender(<CountUp value={900} format={(n) => String(Math.round(n))} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('900')).toBeTruthy();
  });

  it('ไม่พังเมื่อ matchMedia ใช้ไม่ได้ในสภาพแวดล้อมทดสอบ', () => {
    const original = window.matchMedia;
    // @ts-expect-error จำลองสภาพแวดล้อมที่ไม่รองรับ matchMedia
    window.matchMedia = undefined;
    expect(() =>
      render(<CountUp value={42} format={(n) => String(Math.round(n))} />),
    ).not.toThrow();
    window.matchMedia = original;
    vi.restoreAllMocks();
  });
});
