/**
 * ช่องกรอกเงินต้องใส่ลูกคั่นหลักพันให้ระหว่างพิมพ์ ไม่ใช่แค่ตอนแสดงผลลัพธ์สุดท้าย
 *
 * ค่าที่ส่งกลับผ่าน onValueChange ต้องเป็นเลขล้วนเสมอ (ไม่มีคอมมา) เพราะโค้ดหน้าอื่น ๆ
 * ส่งค่านี้ตรงไปคำนวณ — ถ้าหลุดคอมมาไปด้วยจะกลายเป็น NaN ตอน parse
 */

import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThousandsInput, formatThousands } from './ThousandsInput';

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <ThousandsInput value={value} onValueChange={setValue} aria-label="จำนวนเงิน" />;
}

describe('formatThousands', () => {
  it('ใส่คอมมาให้เลขหลักพันขึ้นไป', () => {
    expect(formatThousands('100000')).toBe('100,000');
    expect(formatThousands('1000000')).toBe('1,000,000');
  });

  it('เลขต่ำกว่าพันไม่ต้องมีคอมมา', () => {
    expect(formatThousands('999')).toBe('999');
  });

  it('ค่าว่างคือค่าว่าง ไม่ใช่ 0', () => {
    expect(formatThousands('')).toBe('');
  });
});

describe('ThousandsInput', () => {
  it('พิมพ์เลขแล้วเห็นคอมมาทันทีบนจอ', () => {
    render(<Field />);
    const input = screen.getByLabelText('จำนวนเงิน');
    fireEvent.change(input, { target: { value: '100000' } });
    expect((input as HTMLInputElement).value).toBe('100,000');
  });

  it('ค่าที่ถือไว้จริงเป็นเลขล้วน ไม่มีคอมมาติดไปด้วย', () => {
    let seen = '';
    function Probe() {
      const [value, setValue] = useState('');
      return (
        <ThousandsInput
          value={value}
          onValueChange={(raw) => {
            seen = raw;
            setValue(raw);
          }}
          aria-label="จำนวนเงิน"
        />
      );
    }
    render(<Probe />);
    fireEvent.change(screen.getByLabelText('จำนวนเงิน'), { target: { value: '1,000,000' } });
    expect(seen).toBe('1000000');
  });

  it('แสดงค่าตั้งต้นที่มีคอมมาแล้วถูกต้อง', () => {
    render(<Field initial="1500000" />);
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveProperty('value', '1,500,000');
  });

  it('พิมพ์ตัวอักษรที่ไม่ใช่เลขถูกกรองออก', () => {
    render(<Field />);
    const input = screen.getByLabelText('จำนวนเงิน');
    fireEvent.change(input, { target: { value: 'abc123xyz' } });
    expect((input as HTMLInputElement).value).toBe('123');
  });
});
