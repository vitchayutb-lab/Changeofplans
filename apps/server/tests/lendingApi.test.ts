/** เทสต์ REST API ของเงื่อนไขการกู้ */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupApp } from './helpers.js';

let app: Express;

beforeEach(() => {
  app = setupApp();
});

describe('GET /api/lending/overview', () => {
  it('อ่านได้โดยไม่ต้องส่งข้อมูลกิจการ', async () => {
    const response = await request(app).get('/api/lending/overview').expect(200);
    expect(response.body.industries).toHaveLength(7);
    expect(response.body.totalPrograms).toBeGreaterThan(0);
    expect(response.body.rules.length).toBeGreaterThan(0);
    expect(response.body.opennessFormulaTh).toContain('40%');
  });
});

describe('GET /api/lending/example', () => {
  it('ให้โปรไฟล์ตัวอย่างที่ส่งกลับเข้า /check ได้ทันที', async () => {
    const example = await request(app).get('/api/lending/example').expect(200);
    const checked = await request(app)
      .post('/api/lending/check')
      .send(example.body.profile)
      .expect(200);
    expect(checked.body.profile).toEqual(example.body.profile);
  });
});

describe('POST /api/lending/check', () => {
  const profile = {
    industry: 'services',
    province: 'กรุงเทพมหานคร',
    yearsOperating: 3,
    employees: 30,
    annualRevenue: 50_000_000,
    dscr: 1.3,
    hasCollateral: false,
    amountNeeded: 3_000_000,
  };

  it('ตอบผลครบทั้งเงื่อนไขที่ติด ตัวปลดล็อก และการเทียบประเภทธุรกิจ', async () => {
    const response = await request(app).post('/api/lending/check').send(profile).expect(200);
    expect(response.body.outcomes).toHaveLength(response.body.totalPrograms);
    expect(response.body.industrySwitches).toHaveLength(7);
    expect(response.body.levers.length).toBeGreaterThan(0);
    expect(response.body.summaryTh).toContain('ผ่านเงื่อนไข');
  });

  it('ปฏิเสธเมื่อไม่ได้ระบุวงเงิน', async () => {
    const { amountNeeded, ...withoutAmount } = profile;
    void amountNeeded;
    await request(app).post('/api/lending/check').send(withoutAmount).expect(400);
  });

  it('ปฏิเสธประเภทธุรกิจที่ไม่มีในระบบ', async () => {
    const response = await request(app)
      .post('/api/lending/check')
      .send({ ...profile, industry: 'crypto' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('industry');
  });

  it('แยก DSCR ที่ยังไม่ระบุออกจาก DSCR ที่เป็นศูนย์', async () => {
    const unknown = await request(app)
      .post('/api/lending/check')
      .send({ ...profile, dscr: undefined })
      .expect(200);
    expect(unknown.body.profile.dscr).toBeNull();

    const zero = await request(app)
      .post('/api/lending/check')
      .send({ ...profile, dscr: 0 })
      .expect(200);
    expect(zero.body.profile.dscr).toBe(0);
  });
});
