/**
 * เทสต์พฤติกรรมที่จำเป็นเมื่อเปิดให้เข้าถึงจากอินเทอร์เน็ตจริง
 * (ไม่ใช่แค่รันบนเครื่องตัวเอง)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { existsSync } from 'node:fs';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { demoBotService, freshDb } from './helpers.js';

async function buildApp(options: Parameters<typeof import('../src/app.js').createApp>[0] = {}) {
  const { createApp } = await import('../src/app.js');
  freshDb();
  demoBotService();
  return createApp({ seed: false, serveStatic: false, ...options });
}

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('การจำกัดอัตราคำขอ', () => {
  let app: Express;

  beforeEach(async () => {
    vi.stubEnv('RATE_LIMIT_MAX', '3');
    vi.stubEnv('RATE_LIMIT_EXPENSIVE_MAX', '2');
    vi.resetModules();
    app = await buildApp();
  });

  it('ปล่อยผ่านจนถึงเพดาน แล้วตอบ 429 พร้อมบอกให้รอ', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app).get('/api/health').expect(200);
    }
    const blocked = await request(app).get('/api/health').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('ส่ง header บอกโควตาที่เหลือ', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['ratelimit-limit']).toBe('3');
    expect(response.headers['ratelimit-remaining']).toBe('2');
  });

  it('เส้นทางที่แพงมีเพดานเข้มกว่าเส้นทางทั่วไป', async () => {
    // เพดานของ /api/tools คือ 2 ทั้งที่เพดานรวมคือ 3
    await request(app).get('/api/tools').expect(200);
    await request(app).get('/api/tools').expect(200);
    await request(app).get('/api/tools').expect(429);
  });

  it('ปิดได้เมื่อสั่ง (ใช้ในเทสต์อื่น ๆ)', async () => {
    const open = await buildApp({ rateLimit: false });
    for (let i = 0; i < 6; i += 1) {
      await request(open).get('/api/health').expect(200);
    }
  });
});

describe('CORS', () => {
  it('ไม่เปิด CORS ตอน production เพราะหน้าเว็บอยู่โดเมนเดียวกัน', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const app = await buildApp();
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('เปิดให้ origin ที่ตั้งไว้เท่านั้นเมื่อกำหนด CORS_ORIGIN', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
    vi.resetModules();
    const app = await buildApp();
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.example.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });
});

describe('การเสิร์ฟหน้าเว็บที่ build แล้ว', () => {
  it('หาโฟลเดอร์ dist เจอโดยไม่ขึ้นกับไดเรกทอรีที่เริ่มโปรเซส', async () => {
    const { findWebDist } = await import('../src/app.js');
    const found = findWebDist();
    // เทสต์ชุดนี้รันหลัง build ใน CI; ถ้ายังไม่ได้ build ให้ข้ามการยืนยันเส้นทาง
    if (found === null) {
      expect(existsSync('apps/web/dist/index.html')).toBe(false);
      return;
    }
    expect(existsSync(`${found}/index.html`)).toBe(true);
  });

  it('เส้นทางที่ไม่ใช่ /api ส่ง index.html กลับไปเพื่อให้ client-side routing ทำงาน', async () => {
    const { findWebDist } = await import('../src/app.js');
    if (findWebDist() === null) return; // ยังไม่ได้ build หน้าเว็บ

    const app = await buildApp({ serveStatic: true });
    const response = await request(app).get('/market').expect(200);
    expect(response.text).toContain('<div id="root">');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('เส้นทาง /api ที่ไม่มีอยู่ยังตอบ 404 แบบ JSON ไม่ใช่ index.html', async () => {
    const app = await buildApp({ serveStatic: true });
    const response = await request(app).get('/api/ไม่มี').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('การตั้งค่าสำหรับคอนเทนเนอร์', () => {
  it('ผูกกับ 0.0.0.0 เป็นค่าเริ่มต้น เพื่อให้ load balancer ต่อเข้ามาได้', async () => {
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.host).toBe('0.0.0.0');
  });

  it('เชื่อ reverse proxy หนึ่งชั้นตอน production เพื่อให้ req.ip เป็น IP ผู้ใช้จริง', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.trustProxy).toBe(1);
  });

  it('ไม่เชื่อ proxy ตอนพัฒนา', async () => {
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.trustProxy).toBe(0);
  });
});
