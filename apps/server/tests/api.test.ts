/** เทสต์ REST API ผ่าน supertest — รวมข้อกำหนดสำคัญว่า API key ต้องไม่หลุดออกไป */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupApp } from './helpers.js';

let app: Express;

beforeEach(() => {
  app = setupApp();
});

describe('GET /api/health', () => {
  it('รายงานโหมดของแหล่งข้อมูลแต่ละตัว', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      modes: { bot: 'demo', llm: 'demo', database: 'ok' },
      demoMode: true,
    });
  });

  it('บอกเพียงว่ามี API key หรือไม่ ไม่เปิดเผยค่า', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.bot).toHaveProperty('apiKeyConfigured');
    expect(JSON.stringify(response.body)).not.toMatch(/apigw1|x-ibm-client-id/i);
  });
});

describe('GET /api/bot/*', () => {
  it('summary คืนสี่ตัวเลขหลักพร้อมที่มา', async () => {
    const response = await request(app).get('/api/bot/summary').expect(200);
    for (const key of ['policyRate', 'lendingRate', 'depositRate', 'usdThb']) {
      expect(response.body[key].provenance.source).toBe('demo');
      expect(response.body[key].provenance.sourceLabel).toBe('Demo Data');
      expect(typeof response.body[key].current).toBe('number');
    }
    expect(response.body.anyDemo).toBe(true);
  });

  it('series คืนรายการชุดข้อมูลพร้อม path และอายุแคช', async () => {
    const response = await request(app).get('/api/bot/series').expect(200);
    expect(response.body.series.length).toBeGreaterThanOrEqual(9);
    const policy = response.body.series.find((s: { seriesId: string }) => s.seriesId === 'policy_rate');
    expect(policy.path).toBe('/PolicyRate/v3/policy_rate');
    expect(policy.ttlSeconds).toBe(3600);
  });

  it('ปฏิเสธช่วงวันที่ที่รูปแบบผิด', async () => {
    const response = await request(app).get('/api/bot/policy-rate?start=29-08-2026').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ปฏิเสธสกุลเงินที่ยังไม่รองรับ', async () => {
    const response = await request(app).get('/api/bot/exchange-rate?currency=XYZ').expect(400);
    expect(response.body.error.message).toContain('XYZ');
  });

  it('ตอบ 404 พร้อมรายชื่อชุดข้อมูลที่มี เมื่อขอชุดที่ไม่รู้จัก', async () => {
    const response = await request(app).get('/api/bot/indicator/ไม่มีจริง').expect(404);
    expect(response.body.error.message).toContain('policy_rate');
  });

  it('POST /api/bot/probe รายงานทุกชุด และบอกว่าทดสอบจริงไม่ได้ในโหมดจำลอง', async () => {
    // เทสต์รันโดยไม่มี API key เครื่องมือจึงต้องบอกว่าทดสอบไม่ได้
    // ไม่ใช่ยิงใส่ข้อมูลจำลองแล้วรายงานว่าทุกชุดผ่าน
    const response = await request(app).post('/api/bot/probe').send({}).expect(200);
    expect(response.body.probes.length).toBeGreaterThanOrEqual(10);
    expect(response.body.probes.every((p: { ok: boolean }) => !p.ok)).toBe(true);
    expect(response.body.probes[0].error).toContain('DEMO MODE');
  });

  it('POST /api/bot/probe ทดสอบชุดเดียวได้ และปฏิเสธชุดที่ไม่รู้จัก', async () => {
    const one = await request(app).post('/api/bot/probe').send({ seriesId: 'bibor' }).expect(200);
    expect(one.body.probes).toHaveLength(1);
    expect(one.body.probes[0].seriesId).toBe('bibor');

    const bad = await request(app).post('/api/bot/probe').send({ seriesId: 'ไม่มีจริง' }).expect(400);
    expect(bad.body.error.message).toContain('ไม่มีจริง');
  });

  it('ล้างแคชได้', async () => {
    await request(app).get('/api/bot/policy-rate').expect(200);
    const response = await request(app)
      .post('/api/bot/cache/invalidate')
      .send({ seriesId: 'policy_rate' })
      .expect(200);
    expect(response.body.cleared).toBeGreaterThan(0);
  });
});

describe('GET /api/smes/*', () => {
  it('คืนรายชื่อกิจการทั้งหมด', async () => {
    const response = await request(app).get('/api/smes').expect(200);
    expect(response.body.smes).toHaveLength(3);
  });

  it('analysis คืนอัตราส่วนครบทุกกลุ่ม', async () => {
    const response = await request(app).get('/api/smes/sme-siam-textile/analysis').expect(200);
    expect(response.body.groups.map((g: { key: string }) => g.key)).toEqual([
      'liquidity',
      'leverage',
      'profitability',
      'efficiency',
      'coverage',
    ]);
    expect(response.body.current.revenue).toBe(185_000_000);
  });

  it('debt คิดอัตราสินเชื่อลอยตัวใหม่จากอัตราอ้างอิงของ ธปท.', async () => {
    const response = await request(app).get('/api/smes/sme-siam-textile/debt').expect(200);
    const floating = response.body.loans.find((l: { rateType: string }) => l.rateType === 'mlr_spread');
    expect(floating.referenceRateName).toBe('MLR');
    expect(floating.effectiveRatePct).toBeGreaterThan(floating.referenceRatePct);
    expect(response.body.totalOutstanding).toBe(66_000_000);
  });

  it('ตอบ 404 เมื่อไม่มีกิจการนั้น', async () => {
    const response = await request(app).get('/api/smes/ไม่มีจริง').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('บันทึกงบใหม่แล้วเตือนเมื่องบดุลไม่สมดุล', async () => {
    const response = await request(app)
      .post('/api/smes/sme-siam-textile/statements')
      .send({ fiscalYear: 2026, period: 'FY', revenue: 100, cash: 50 })
      .expect(201);
    expect(response.body.balance.balanced).toBe(false);
    expect(response.body.warning).toContain('งบดุลไม่สมดุล');
  });

  it('ปฏิเสธปีบัญชีที่ไม่สมเหตุสมผล', async () => {
    await request(app)
      .post('/api/smes/sme-siam-textile/statements')
      .send({ fiscalYear: 1200 })
      .expect(400);
  });

  it('จำลองสินเชื่อโดยใช้อัตราอ้างอิงจริง', async () => {
    const response = await request(app)
      .post('/api/smes/sme-siam-textile/loan-simulation')
      .send({ amount: 10_000_000, years: 5, rateBasis: 'mrr_spread', spreadPct: 0.5 })
      .expect(200);

    expect(response.body.rate.referenceRateName).toBe('MRR');
    expect(response.body.rate.effectiveRatePct).toBeCloseTo(
      response.body.rate.referenceRatePct + 0.5,
      6,
    );
    expect(response.body.quote.schedule).toHaveLength(60);
    expect(response.body.impact.dscrAfter).toBeLessThan(response.body.impact.dscrBefore);
    expect(response.body.disclaimerTh).toContain('ไม่ใช่ข้อเสนอสินเชื่อ');
  });

  it('บังคับให้ระบุอัตราคงที่เมื่อเลือก rateBasis = fixed', async () => {
    const response = await request(app)
      .post('/api/smes/sme-siam-textile/loan-simulation')
      .send({ amount: 1_000_000, years: 3, rateBasis: 'fixed' })
      .expect(400);
    expect(response.body.error.message).toContain('fixedRatePct');
  });
});

describe('GET /api/funding/*', () => {
  it('คืนโครงการทั้งหมด', async () => {
    const response = await request(app).get('/api/funding/programs').expect(200);
    expect(response.body.programs.length).toBeGreaterThanOrEqual(10);
  });

  it('จับคู่พร้อมเหตุผลรายเงื่อนไข', async () => {
    const response = await request(app)
      .get('/api/funding/match/sme-siam-textile?amount=10000000')
      .expect(200);
    expect(response.body.matches[0].checks.length).toBe(7);
  });

  it('บันทึกการยื่นขอ', async () => {
    const response = await request(app)
      .post('/api/funding/applications')
      .send({
        smeId: 'sme-siam-textile',
        programId: 'fp-smed-transform',
        amountRequested: 5_000_000,
        status: 'preparing',
      })
      .expect(201);
    expect(response.body.application.status).toBe('preparing');
  });

  it('ปฏิเสธสถานะที่ไม่รู้จัก', async () => {
    await request(app)
      .post('/api/funding/applications')
      .send({
        smeId: 'sme-siam-textile',
        programId: 'fp-smed-transform',
        amountRequested: 1000,
        status: 'ไม่รู้จัก',
      })
      .expect(400);
  });
});

describe('POST /api/advisor/chat', () => {
  it('ตอบพร้อม trace และแหล่งข้อมูล', async () => {
    const response = await request(app)
      .post('/api/advisor/chat')
      .send({ smeId: 'sme-siam-textile', message: 'ควรกู้เงิน 10 ล้านบาทไหม' })
      .expect(200);

    expect(response.body.answer.length).toBeGreaterThan(80);
    expect(response.body.toolTrace.length).toBeGreaterThan(0);
    expect(response.body.citations.length).toBeGreaterThan(0);
    expect(response.body.demoNotice).not.toBeNull();
  }, 20000);

  it('สานต่อบทสนทนาเดิมเมื่อส่ง conversationId', async () => {
    const first = await request(app)
      .post('/api/advisor/chat')
      .send({ smeId: 'sme-siam-textile', message: 'สุขภาพการเงินเป็นอย่างไร' })
      .expect(200);

    const second = await request(app)
      .post('/api/advisor/chat')
      .send({
        smeId: 'sme-siam-textile',
        message: 'แล้วหนี้ล่ะ',
        conversationId: first.body.conversationId,
      })
      .expect(200);

    expect(second.body.conversationId).toBe(first.body.conversationId);

    const conversation = await request(app)
      .get(`/api/advisor/conversation/${first.body.conversationId}`)
      .expect(200);
    expect(conversation.body.messages).toHaveLength(4);
  }, 20000);

  it('ปฏิเสธข้อความว่าง', async () => {
    await request(app).post('/api/advisor/chat').send({ message: '   ' }).expect(400);
  });

  it('ตอบ 404 เมื่อ smeId ไม่มีจริง', async () => {
    await request(app)
      .post('/api/advisor/chat')
      .send({ smeId: 'ไม่มีจริง', message: 'สวัสดี' })
      .expect(404);
  });

  it('คืนคำถามตั้งต้น', async () => {
    const response = await request(app).get('/api/advisor/suggestions').expect(200);
    expect(response.body.suggestions.length).toBeGreaterThan(3);
  });
});

describe('/api/tools', () => {
  it('คืนทะเบียนเครื่องมือพร้อม JSON Schema', async () => {
    const response = await request(app).get('/api/tools').expect(200);
    const policy = response.body.tools.find((t: { name: string }) => t.name === 'get_bot_policy_rate');
    expect(policy.inputSchema.type).toBe('object');
    expect(policy.category).toBe('bot');
  });

  it('เรียกเครื่องมือผ่าน HTTP ได้', async () => {
    const response = await request(app)
      .post('/api/tools/estimate_financing_cost/invoke')
      .send({ smeId: 'sme-siam-textile', arguments: { principal: 10_000_000, years: 5 } })
      .expect(200);

    expect(response.body.tool).toBe('estimate_financing_cost');
    expect(response.body.result.estimatedAnnualInterest).toBeGreaterThan(0);
    expect(response.body.source).toBe('demo');
    expect(typeof response.body.durationMs).toBe('number');
  });

  it('ตอบ 400 พร้อมบอกว่าอาร์กิวเมนต์ไหนผิด', async () => {
    const response = await request(app)
      .post('/api/tools/calculate_loan_payment/invoke')
      .send({ arguments: { principal: 'ไม่ใช่ตัวเลข', annualRatePct: 6, years: 5 } })
      .expect(400);
    expect(response.body.error.message).toContain('principal');
  });

  it('ตอบ 404 พร้อมรายชื่อเครื่องมือที่มี', async () => {
    const response = await request(app).post('/api/tools/ไม่มี/invoke').send({}).expect(404);
    expect(response.body.error.message).toContain('get_bot_policy_rate');
  });
});

describe('เส้นทางที่ไม่มีอยู่', () => {
  it('ตอบ 404 ในรูปแบบ error envelope เดียวกัน', async () => {
    const response = await request(app).get('/api/ไม่มีเส้นทางนี้').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('ความปลอดภัยของ API key (กฎ R3)', () => {
  it('ไม่มี endpoint ใดคืนค่า BOT_API_KEY ออกไป', async () => {
    // ตั้งค่า key ปลอมที่หาเจอง่าย แล้วสร้างแอปใหม่เพื่อให้ค่าถูกอ่านเข้าไป
    const secret = 'SUPER-SECRET-BOT-KEY-9f3a2b';
    vi.stubEnv('BOT_API_KEY', secret);
    vi.resetModules();

    const { setupApp: freshSetup } = await import('./helpers.js');
    const freshApp = freshSetup();

    const paths = [
      '/api/health',
      '/api/bot/summary',
      '/api/bot/series',
      '/api/smes',
      '/api/smes/sme-siam-textile/analysis',
      '/api/smes/sme-siam-textile/debt',
      '/api/funding/programs',
      '/api/funding/match/sme-siam-textile',
      '/api/tools',
    ];

    for (const path of paths) {
      const response = await request(freshApp).get(path);
      expect(JSON.stringify(response.body), `${path} เปิดเผย API key`).not.toContain(secret);
    }

    vi.unstubAllEnvs();
    vi.resetModules();
  }, 30000);

  it('ส่ง header ความปลอดภัยพื้นฐานและไม่บอกว่าใช้ Express', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
