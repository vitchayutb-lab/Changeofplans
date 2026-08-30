/** ป้ายที่มาของข้อมูลคือจุดที่บังคับใช้กฎ R4 — ข้อมูลจำลองต้องเห็นชัดเสมอ */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Provenance } from '@sme/shared';
import { SourceBadge } from './SourceBadge';

function provenance(overrides: Partial<Provenance> = {}): Provenance {
  return {
    source: 'bot',
    sourceLabel: 'Bank of Thailand',
    lastUpdated: '2026-08-29T07:00:00.000Z',
    fetchedAt: '2026-08-29T09:14:22.104Z',
    stale: false,
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
    notice: null,
    ...overrides,
  };
}

describe('SourceBadge', () => {
  it('แสดง Source: Bank of Thailand เมื่อเป็นข้อมูลจริง', () => {
    render(<SourceBadge provenance={provenance()} />);
    expect(screen.getByText('Bank of Thailand')).toBeTruthy();
    expect(screen.getByText('Source: Bank of Thailand')).toBeTruthy();
    expect(screen.getByText(/Updated: 29 ส\.ค\. 2026/)).toBeTruthy();
  });

  it('แสดง Demo Data และบอกว่าไม่ใช่ข้อมูลจริงเมื่อเป็นข้อมูลจำลอง', () => {
    render(<SourceBadge provenance={provenance({ source: 'demo', sourceLabel: 'Demo Data' })} />);
    expect(screen.getByText('Demo Data')).toBeTruthy();
    expect(screen.getByText(/ไม่ใช่ข้อมูลจริงจากธนาคารแห่งประเทศไทย/)).toBeTruthy();
    expect(screen.queryByText('Source: Bank of Thailand')).toBeNull();
  });

  it('แสดงป้ายข้อมูลค้างเมื่อเสิร์ฟข้อมูลจริงที่หมดอายุ', () => {
    render(<SourceBadge provenance={provenance({ stale: true })} />);
    expect(screen.getByText('ข้อมูลค้าง')).toBeTruthy();
  });

  it('แสดงข้อความแจ้งเตือนเมื่อมี', () => {
    render(
      <SourceBadge provenance={provenance({ notice: 'BOT data temporarily unavailable.' })} />,
    );
    expect(screen.getByText('BOT data temporarily unavailable.')).toBeTruthy();
  });

  it('ไม่แสดงอะไรเลยเมื่อไม่มีข้อมูลที่มา', () => {
    const { container } = render(<SourceBadge provenance={null} />);
    expect(container.firstChild).toBeNull();
  });
});
