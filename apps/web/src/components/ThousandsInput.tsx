/**
 * ช่องกรอกจำนวนเงินที่ใส่ลูกคั่นหลักพันให้อัตโนมัติระหว่างพิมพ์ เช่น พิมพ์ 100000 แล้วเห็น 100,000 ทันที
 *
 * ค่าที่ถือไว้จริง (value/onValueChange) เป็นเลขล้วนไม่มีคอมมา ส่วนคอมมาเป็นแค่สิ่งที่แสดงบนจอ
 * ต้องคำนวณตำแหน่ง cursor ใหม่ทุกครั้งที่จัดรูปแบบ ไม่งั้นพิมพ์กลางเลขแล้ว cursor จะกระโดดไปท้ายบรรทัด
 */

import { useRef, type ChangeEvent, type InputHTMLAttributes } from 'react';

type Props = {
  value: string;
  onValueChange: (raw: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'ref'>;

/** นับตัวเลขล้วนก่อนตำแหน่งที่กำหนด — ใช้เทียบว่า cursor อยู่หลังตัวเลขตัวที่เท่าไร */
function digitsBefore(text: string, position: number): number {
  return text.slice(0, position).replace(/\D/g, '').length;
}

/** หาตำแหน่งในข้อความที่จัดรูปแบบแล้วซึ่งอยู่หลังตัวเลขลำดับที่ digitCount */
function positionAfterDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]!)) {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

export function formatThousands(rawDigits: string): string {
  if (rawDigits === '') return '';
  return Number(rawDigits).toLocaleString('en-US');
}

export function ThousandsInput({ value, onValueChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const display = formatThousands(value.replace(/\D/g, ''));

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const cursor = input.selectionStart ?? input.value.length;
    const digitCount = digitsBefore(input.value, cursor);
    const nextRaw = input.value.replace(/\D/g, '');

    onValueChange(nextRaw);

    const nextFormatted = formatThousands(nextRaw);
    const nextCursor = positionAfterDigits(nextFormatted, digitCount);
    // ต้องรอให้ React วาดค่าที่จัดรูปแบบใหม่ก่อน ไม่งั้น setSelectionRange จะทำงานกับ
    // ข้อความเก่าที่ยังไม่ทันอัปเดต
    requestAnimationFrame(() => ref.current?.setSelectionRange(nextCursor, nextCursor));
  }

  return (
    <input ref={ref} inputMode="numeric" value={display} onChange={handleChange} {...rest} />
  );
}
