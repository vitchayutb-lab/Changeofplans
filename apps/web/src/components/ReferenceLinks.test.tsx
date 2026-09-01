/**
 * ลิงก์อ้างอิงออกสู่เว็บภายนอก
 *
 * ปลายทางเป็นเว็บของคนอื่น เรื่องที่ต้องกันจึงไม่ใช่แค่ "ลิงก์ขึ้นไหม"
 * แต่คือเปิดแท็บใหม่อย่างปลอดภัย และผู้ให้บริการสมมติต้องไม่มีลิงก์
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderLink, ReferenceLinks } from './ReferenceLinks';

const LINKS = [
  { labelTh: 'คลังข้อมูลธุรกิจ', url: 'https://datawarehouse.dbd.go.th', noteTh: 'ค้นงบการเงินที่นำส่งไว้' },
  { labelTh: 'กรมพัฒนาธุรกิจการค้า', url: 'https://www.dbd.go.th', noteTh: 'ทะเบียนนิติบุคคล' },
];

describe('ReferenceLinks', () => {
  it('เปิดแท็บใหม่โดยไม่ให้หน้าปลายทางเข้าถึง window.opener กลับมา', () => {
    render(<ReferenceLinks links={LINKS} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('พาไปที่ url ที่บอกไว้จริง ไม่ใช่แค่ข้อความ', () => {
    render(<ReferenceLinks links={LINKS} />);
    expect(screen.getByRole('link', { name: /คลังข้อมูลธุรกิจ/ }).getAttribute('href')).toBe(
      'https://datawarehouse.dbd.go.th',
    );
  });

  it('บอกด้วยว่าลิงก์เปิดแท็บใหม่ สำหรับคนที่ฟังหน้าจอ', () => {
    render(<ReferenceLinks links={LINKS} />);
    expect(screen.getAllByRole('link', { name: /เปิดแท็บใหม่/ })).toHaveLength(LINKS.length);
  });

  it('มีคำอธิบายว่าลิงก์พาไปเจออะไร', () => {
    render(<ReferenceLinks links={LINKS} />);
    expect(screen.getByText('ค้นงบการเงินที่นำส่งไว้')).toBeTruthy();
  });

  it('ไม่มีลิงก์ก็ไม่ทิ้งรายการเปล่าไว้', () => {
    const { container } = render(<ReferenceLinks links={[]} />);
    expect(container.querySelector('.reference')).toBeNull();
  });
});

describe('ProviderLink', () => {
  it('ผู้ให้บริการสมมติไม่มีลิงก์ ก็ไม่ต้องมีปุ่มให้กด', () => {
    // แต่งลิงก์ให้หน่วยงานที่ไม่มีอยู่จริงคือการอ้างเท็จ ปล่อยว่างถูกกว่า
    const { container } = render(<ProviderLink url={null} provider="กองทุนร่วมลงทุนเพื่อ SME" />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('บอกชื่อผู้ให้บริการกับคนที่ฟังหน้าจอ ไม่ใช่แค่คำว่าเว็บไซต์ลอย ๆ', () => {
    // การ์ดหนึ่งหน้ามีลิงก์แบบนี้หลายอัน ถ้าอ่านออกเสียงเหมือนกันหมดก็เลือกไม่ถูก
    render(<ProviderLink url="https://www.tcg.or.th" provider="บสย." />);
    expect(screen.getByRole('link', { name: /บสย\./ }).getAttribute('href')).toBe('https://www.tcg.or.th');
  });
});
