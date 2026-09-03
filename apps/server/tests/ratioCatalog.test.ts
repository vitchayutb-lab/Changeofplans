/**
 * ทะเบียนอัตราส่วนสำหรับหน้าอธิบายเกณฑ์
 *
 * หน้าที่หลักคือ "ต้องตรงกับที่ระบบใช้คำนวณจริง" — หน้าอธิบายที่บอกเกณฑ์คนละค่า
 * กับที่ใช้ตัดสินแย่กว่าไม่มีหน้าอธิบายเลย
 */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { calculateRatios, ratioCatalog, verdictFor } from '../src/services/finance/ratios.js';
import { derive } from '../src/services/finance/statement.js';
import { loadStatements } from '../src/services/finance/analysis.js';
import { setupApp } from './helpers.js';

let app: Express;
beforeEach(() => {
  app = setupApp();
});

function computedRatios() {
  const { current } = loadStatements('sme-siam-textile');
  return calculateRatios(derive(current), { annualDebtService: 1_000_000 });
}

describe('ratioCatalog', () => {
  it('มีตัวชี้วัดชุดเดียวกับที่คำนวณจริง ทั้งกลุ่มและลำดับ', () => {
    const catalogKeys = ratioCatalog().map((g) => [g.key, g.ratios.map((r) => r.key)]);
    const computedKeys = computedRatios().map((g) => [g.key, g.ratios.map((r) => r.key)]);
    expect(catalogKeys).toEqual(computedKeys);
  });

  it('เกณฑ์ในทะเบียนเป็นค่าเดียวกับที่ใช้ตัดสิน', () => {
    // ถ้าสองอันหลุดจากกัน หน้าจออธิบายจะโกหกโดยที่เทสต์อื่นไม่จับได้
    const computed = new Map(
      computedRatios().flatMap((g) => g.ratios.map((r) => [r.key, r.benchmark] as const)),
    );
    for (const group of ratioCatalog()) {
      for (const ratio of group.ratios) {
        expect(ratio.benchmark, ratio.key).toEqual(computed.get(ratio.key));
      }
    }
  });

  it('ทุกตัวมีสูตรและคำอธิบาย ไม่ปล่อยว่าง', () => {
    for (const group of ratioCatalog()) {
      expect(group.ratios.length).toBeGreaterThan(0);
      for (const ratio of group.ratios) {
        expect(ratio.formula.trim(), ratio.key).not.toBe('');
        expect(ratio.explanationTh.trim(), ratio.key).not.toBe('');
      }
    }
  });

  it('เกณฑ์ที่ประกาศไว้ตัดสินได้ตามทิศทางที่บอก', () => {
    // higherIsBetter ไม่ใช่แค่ป้าย มันเปลี่ยนความหมายของตัวเลขทั้งคู่
    for (const group of ratioCatalog()) {
      for (const ratio of group.ratios) {
        expect(verdictFor(ratio.benchmark.good, ratio.benchmark), ratio.key).toBe('good');
        const beyondRisk = ratio.benchmark.higherIsBetter
          ? ratio.benchmark.watch - 1
          : ratio.benchmark.watch + 1;
        expect(verdictFor(beyondRisk, ratio.benchmark), ratio.key).toBe('risk');
      }
    }
  });
});

describe('GET /api/ratios', () => {
  it('อ่านได้โดยไม่ต้องเลือกกิจการ', async () => {
    const response = await request(app).get('/api/ratios').expect(200);
    expect(response.body.groups).toHaveLength(5);
    expect(response.body.groups[0].ratios[0]).toMatchObject({
      key: expect.any(String),
      formula: expect.any(String),
      explanationTh: expect.any(String),
      benchmark: { good: expect.any(Number), higherIsBetter: expect.any(Boolean) },
    });
  });

  it('ไม่ส่งค่าของกิจการใดติดมาด้วย', async () => {
    // เป็นเอกสารอ้างอิง ไม่ใช่ผลวิเคราะห์ — ถ้ามี value ปนมาแปลว่าใช้ผิดชุด
    const response = await request(app).get('/api/ratios').expect(200);
    for (const group of response.body.groups) {
      for (const ratio of group.ratios) {
        expect(ratio).not.toHaveProperty('value');
        expect(ratio).not.toHaveProperty('verdict');
      }
    }
  });
});
