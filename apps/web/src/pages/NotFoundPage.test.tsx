/**
 * ที่อยู่ที่ไม่ตรงกับหน้าใดต้องได้หน้าของเราเอง
 *
 * ก่อนหน้านี้ผู้ใช้ที่พิมพ์ URL ผิดบนเว็บจริงเจอหน้าข้อผิดพลาดของ react-router
 * ที่เขียนว่า "Hey developer 👋 You can provide a way better UX than this"
 * ซึ่งพูดกับนักพัฒนา ไม่มีทางกลับ และไม่บอกว่าเกิดอะไรขึ้น
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div>หน้าแรก</div> },
      { path: '*', element: <NotFoundPage /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('NotFoundPage', () => {
  it('บอกผู้ใช้ว่าไม่พบหน้า พร้อมที่อยู่ที่เปิดมา', () => {
    renderAt('/ไม่มีหน้านี้');
    expect(screen.getByText('ไม่พบหน้านี้')).toBeTruthy();
    expect(screen.getByText(/ไม่ตรงกับหน้าใดในระบบ/)).toBeTruthy();
  });

  it('ไม่แสดงข้อความที่พูดกับนักพัฒนาแทนผู้ใช้', () => {
    const { container } = renderAt('/typo');
    expect(container.textContent).not.toMatch(/Hey developer|ErrorBoundary|errorElement/);
  });

  it('มีทางกลับไปหน้าหลักและหน้าที่ใช้บ่อย', () => {
    renderAt('/typo');
    expect(screen.getByText('ภาพรวม').getAttribute('href')).toBe('/');
    expect(screen.getByText('ที่ปรึกษา AI').getAttribute('href')).toBe('/advisor');
  });

  it('อธิบายเพิ่มเมื่อผู้ใช้เปิดที่อยู่ของ API เหมือนเป็นหน้าเว็บ', () => {
    // /api/health เปิดตรง ๆ ได้ แต่ /health ไม่ใช่ทั้งหน้าเว็บและ API
    renderAt('/api/health');
    expect(screen.getByText(/เป็นของ API ไม่ใช่หน้าเว็บ/)).toBeTruthy();
  });

  it('ไม่ขึ้นคำอธิบายเรื่อง API เมื่อเป็นที่อยู่ธรรมดา', () => {
    const { container } = renderAt('/typo');
    expect(container.textContent).not.toMatch(/เป็นของ API/);
  });
});
