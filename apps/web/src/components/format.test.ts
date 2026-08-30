import { describe, expect, it } from 'vitest';
import {
  formatByUnit,
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatPercent,
  formatRatio,
  formatTimes,
} from './format';

describe('formatMoney', () => {
  it('จัดรูปแบบเงินบาทพร้อมตัวคั่นหลักพัน', () => {
    expect(formatMoney(1234567)).toBe('฿1,234,567');
    expect(formatMoney(650000)).toBe('฿650,000');
  });

  it('แสดงขีดกลางเมื่อไม่มีค่า', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
  });
});

describe('formatMoneyShort', () => {
  it('ย่อหน่วยให้อ่านง่าย', () => {
    expect(formatMoneyShort(185_000_000)).toBe('฿185.00 ล้าน');
    expect(formatMoneyShort(2_500_000_000)).toBe('฿2.50 พันล้าน');
    expect(formatMoneyShort(45_000)).toBe('฿45.0k');
    expect(formatMoneyShort(850)).toBe('฿850');
  });
});

describe('formatPercent / formatTimes', () => {
  it('แสดงทศนิยมสองตำแหน่ง', () => {
    expect(formatPercent(6.5)).toBe('6.50%');
    expect(formatTimes(1.4275)).toBe('1.43×');
  });
});

describe('formatByUnit', () => {
  it('เลือกรูปแบบตามหน่วยของชุดข้อมูล', () => {
    expect(formatByUnit(1.5, 'percent_per_annum')).toBe('1.50%');
    expect(formatByUnit(34.512, 'thb_per_unit')).toBe('34.5120');
    // ค่าที่น้อยกว่า 1 เช่น เยน ต้องเห็นทศนิยมมากพอ
    expect(formatByUnit(0.2354, 'thb_per_unit')).toBe('0.235400');
  });
});

describe('formatRatio', () => {
  it('ใช้หน่วยของอัตราส่วนแต่ละตัว', () => {
    expect(formatRatio(1.63, 'x')).toBe('1.63×');
    expect(formatRatio(30.81, 'percent')).toBe('30.8%');
    expect(formatRatio(75.96, 'days')).toBe('76 วัน');
    expect(formatRatio(null, 'x')).toBe('—');
  });
});

describe('formatDate', () => {
  it('แปลงเป็นวันที่แบบไทยย่อ', () => {
    expect(formatDate('2026-08-29')).toBe('29 ส.ค. 2026');
    expect(formatDate('2026-01-05')).toBe('5 ม.ค. 2026');
  });

  it('รับ ISO datetime ได้', () => {
    expect(formatDate('2026-06-24T07:00:00.000Z')).toBe('24 มิ.ย. 2026');
  });

  it('คืนขีดกลางเมื่อไม่มีค่า', () => {
    expect(formatDate(null)).toBe('—');
  });
});
