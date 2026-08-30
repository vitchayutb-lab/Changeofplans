import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('เรนเดอร์หัวข้อ รายการ และตัวหนา', () => {
    const { container } = render(
      <Markdown text={'## สรุป\n- ดอกเบี้ย **1.50%**\n- ค่างวด **฿195,708**\n\nข้อความปิดท้าย'} />,
    );
    expect(screen.getByRole('heading', { name: 'สรุป' })).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('strong')).toHaveLength(2);
    expect(screen.getByText('ข้อความปิดท้าย')).toBeTruthy();
  });

  it('รองรับรายการแบบมีหมายเลข', () => {
    const { container } = render(<Markdown text={'1. หนึ่ง\n2. สอง'} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('ไม่ใส่ HTML ดิบลง DOM', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
