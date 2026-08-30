/** เทสต์การค้นหากิจการ — ทั้งชั้นฐานข้อมูลและ HTTP */

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { countSmes, searchSmes, smeFacets } from '../src/db/smeRepo.js';
import { setupApp } from './helpers.js';

let app: Express;

// ใส่ชุดที่สร้างขึ้นด้วย เพราะการค้นหาจะมีความหมายก็ต่อเมื่อมีข้อมูลเยอะ
beforeAll(() => {
  app = setupApp({ generated: true, generatedCount: 300 });
});

describe('searchSmes', () => {
  it('คืนทุกกิจการเมื่อไม่ใส่คำค้น พร้อมจำนวนรวมที่ถูกต้อง', () => {
    const result = searchSmes({ limit: 10 });
    expect(result.smes).toHaveLength(10);
    expect(result.total).toBe(countSmes());
    expect(result.total).toBeGreaterThan(300);
  });

  it('ค้นด้วยชื่อไทยได้', () => {
    const all = searchSmes({ limit: 100 });
    const target = all.smes[0]!;
    const found = searchSmes({ q: target.nameTh });
    expect(found.smes.some((sme) => sme.id === target.id)).toBe(true);
  });

  it('ค้นด้วยจังหวัดได้', () => {
    const result = searchSmes({ q: 'เชียงใหม่', limit: 100 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.smes.every((sme) => sme.province.includes('เชียงใหม่'))).toBe(true);
  });

  it('ค้นด้วยรหัสกิจการได้', () => {
    const result = searchSmes({ q: 'sme-gen-0001' });
    expect(result.smes.map((sme) => sme.id)).toContain('sme-gen-0001');
  });

  it('กรองตามอุตสาหกรรม', () => {
    const result = searchSmes({ industry: 'food', limit: 50 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.smes.every((sme) => sme.industry === 'food')).toBe(true);
  });

  it('กรองสองเงื่อนไขพร้อมกันได้', () => {
    const province = searchSmes({ limit: 1 }).smes[0]!.province;
    const result = searchSmes({ industry: 'retail', province, limit: 50 });
    expect(result.smes.every((s) => s.industry === 'retail' && s.province === province)).toBe(true);
  });

  it('แบ่งหน้าโดยไม่ให้รายการซ้ำกันระหว่างหน้า', () => {
    const first = searchSmes({ limit: 10, offset: 0 });
    const second = searchSmes({ limit: 10, offset: 10 });
    const overlap = first.smes.filter((a) => second.smes.some((b) => b.id === a.id));
    expect(overlap).toHaveLength(0);
    expect(first.total).toBe(second.total);
  });

  it('จำกัดขนาดหน้าไม่ให้ดึงทั้งฐานข้อมูลในคำขอเดียว', () => {
    expect(searchSmes({ limit: 5000 }).smes.length).toBeLessThanOrEqual(100);
    expect(searchSmes({ limit: -5 }).smes.length).toBe(1);
  });

  it('แนบรายได้ปีล่าสุดมาด้วยเพื่อให้รายการบอกขนาดกิจการได้', () => {
    const result = searchSmes({ q: 'sme-gen-0001' });
    const sme = result.smes[0]!;
    expect(sme.latestRevenue).toBeGreaterThan(0);
    expect(sme.latestFiscalYear).toBeGreaterThan(2000);
  });

  it('คืนผลว่างอย่างสุภาพเมื่อไม่พบอะไรเลย', () => {
    const result = searchSmes({ q: 'ไม่มีกิจการชื่อนี้แน่นอน' });
    expect(result.smes).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('smeFacets', () => {
  it('คืนอุตสาหกรรมและจังหวัดที่มีอยู่จริงในฐานข้อมูล', () => {
    const facets = smeFacets();
    expect(facets.industries.length).toBeGreaterThan(3);
    expect(facets.provinces.length).toBeGreaterThan(10);
    expect(facets.industries).toContain('food');
  });
});

describe('GET /api/smes', () => {
  it('คืนผลค้นหาพร้อมจำนวนรวมและตัวเลือกตัวกรอง', async () => {
    const response = await request(app).get('/api/smes?limit=5').expect(200);
    expect(response.body.smes).toHaveLength(5);
    expect(response.body.total).toBeGreaterThan(300);
    expect(response.body.limit).toBe(5);
    expect(response.body.facets.industries.length).toBeGreaterThan(0);
  });

  it('ส่งคำค้นผ่าน query string ได้', async () => {
    const response = await request(app).get('/api/smes?q=เชียงใหม่&limit=5').expect(200);
    expect(response.body.total).toBeGreaterThan(0);
  });

  it('ปฏิเสธพารามิเตอร์ตัวเลขที่ไม่ใช่ตัวเลข', async () => {
    await request(app).get('/api/smes?limit=มากๆ').expect(400);
  });

  it('ยังใช้เส้นทางรายกิจการเดิมได้', async () => {
    const list = await request(app).get('/api/smes?limit=1').expect(200);
    const id = list.body.smes[0].id;
    const detail = await request(app).get(`/api/smes/${id}`).expect(200);
    expect(detail.body.sme.id).toBe(id);
  });
});
