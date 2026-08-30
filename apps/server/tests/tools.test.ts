/** เทสต์สคีมา ทะเบียนเครื่องมือ และการเรียกเครื่องมือทุกตัว */

import { beforeEach, describe, expect, it } from 'vitest';
import { defineSchema, field, ValidationError } from '../src/agent/schema.js';
import { getToolRegistry } from '../src/agent/tools/index.js';
import { ToolNotFoundError } from '../src/agent/registry.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
});

describe('defineSchema', () => {
  const schema = defineSchema<{ amount: number; mode: string; flag?: boolean }>({
    amount: field.number('จำนวนเงิน', { required: true, minimum: 0, maximum: 1000 }),
    mode: field.enumOf('โหมด', ['fast', 'slow'], { default: 'fast' }),
    flag: field.boolean('ธง'),
  });

  it('สร้าง JSON Schema ที่ทั้ง Anthropic และ MCP ใช้ได้', () => {
    expect(schema.json).toMatchObject({
      type: 'object',
      required: ['amount'],
      additionalProperties: false,
    });
    expect(schema.json.properties.mode?.enum).toEqual(['fast', 'slow']);
  });

  it('เติมค่าเริ่มต้นให้ฟิลด์ที่ไม่ได้ส่งมา', () => {
    expect(schema.parse({ amount: 5 })).toEqual({ amount: 5, mode: 'fast' });
  });

  it('แปลงสตริงตัวเลขที่มีจุลภาคให้เป็นตัวเลข', () => {
    expect(schema.parse({ amount: '1,000' }).amount).toBe(1000);
  });

  it('บังคับฟิลด์ที่จำเป็น', () => {
    expect(() => schema.parse({})).toThrow(ValidationError);
  });

  it('ตรวจขอบเขตของตัวเลข', () => {
    expect(() => schema.parse({ amount: -1 })).toThrow(/at least 0/);
    expect(() => schema.parse({ amount: 5000 })).toThrow(/at most 1000/);
  });

  it('ปฏิเสธค่าที่ไม่อยู่ใน enum', () => {
    expect(() => schema.parse({ amount: 1, mode: 'turbo' })).toThrow(/must be one of/);
  });

  it('รับ enum แบบไม่สนตัวพิมพ์เล็กใหญ่', () => {
    expect(schema.parse({ amount: 1, mode: 'SLOW' }).mode).toBe('SLOW');
  });

  it('แปลงค่า boolean จากสตริง', () => {
    expect(schema.parse({ amount: 1, flag: 'true' }).flag).toBe(true);
    expect(schema.parse({ amount: 1, flag: 'no' }).flag).toBe(false);
  });

  it('ปฏิเสธ argument ที่ไม่ใช่อ็อบเจ็กต์', () => {
    expect(() => schema.parse('ข้อความ')).toThrow(ValidationError);
    expect(() => schema.parse([1, 2])).toThrow(ValidationError);
  });
});

describe('ทะเบียนเครื่องมือ', () => {
  it('ทุกเครื่องมือมีชื่อ คำอธิบาย และสคีมาครบ', () => {
    const catalog = getToolRegistry().catalog();
    expect(catalog.length).toBeGreaterThanOrEqual(15);
    for (const tool of catalog) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.readOnly).toBe(true);
    }
  });

  it('มีเครื่องมือ BOT ครบตามที่โจทย์กำหนด', () => {
    const names = getToolRegistry().names();
    for (const required of [
      'get_bot_policy_rate',
      'get_bot_lending_rate',
      'get_bot_deposit_rate',
      'get_bot_exchange_rate',
      'get_bot_market_data',
      'get_bot_economic_indicator',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('ชื่อเครื่องมือไม่ซ้ำกัน', () => {
    const names = getToolRegistry().names();
    expect(new Set(names).size).toBe(names.length);
  });

  it('โยน ToolNotFoundError เมื่อเรียกเครื่องมือที่ไม่มี', async () => {
    await expect(getToolRegistry().invoke('ไม่มีเครื่องมือนี้', {})).rejects.toThrow(ToolNotFoundError);
  });
});

describe('การเรียกเครื่องมือจริง', () => {
  it('เครื่องมือ BOT คืนค่าพร้อมที่มา', async () => {
    const outcome = await getToolRegistry().invoke('get_bot_policy_rate', {});
    const data = outcome.data as { current: number; source: string; isDemoData: boolean };
    expect(typeof data.current).toBe('number');
    expect(outcome.source).toBe('demo');
    expect(data.isDemoData).toBe(true);
    expect(outcome.citation?.label).toContain('Demo Data');
  });

  it('estimate_financing_cost ใช้อัตราอ้างอิงจาก BOT บวกส่วนต่าง', async () => {
    const outcome = await getToolRegistry().invoke(
      'estimate_financing_cost',
      { principal: 10_000_000, years: 5, rateBasis: 'MRR', spreadPct: 0.5 },
      { smeId: 'sme-siam-textile' },
    );
    const data = outcome.data as {
      referenceRatePct: number;
      spreadPct: number;
      estimatedRatePct: number;
      estimatedAnnualInterest: number;
      isEstimate: boolean;
      smeContext: { dscrBefore: number; dscrAfter: number };
    };

    expect(data.estimatedRatePct).toBeCloseTo(data.referenceRatePct + data.spreadPct, 6);
    expect(data.estimatedAnnualInterest).toBeCloseTo((10_000_000 * data.estimatedRatePct) / 100, 0);
    expect(data.isEstimate).toBe(true);
    // การกู้เพิ่มต้องทำให้ DSCR ลดลงเสมอ
    expect(data.smeContext.dscrAfter).toBeLessThan(data.smeContext.dscrBefore);
  });

  it('calculate_loan_payment ให้ผลตรงกับสูตร annuity', async () => {
    const outcome = await getToolRegistry().invoke('calculate_loan_payment', {
      principal: 1_000_000,
      annualRatePct: 6,
      years: 5,
    });
    expect((outcome.data as { monthlyPayment: number }).monthlyPayment).toBeCloseTo(19332.8, 1);
  });

  it('เครื่องมือที่ต้องใช้ smeId อ่านจาก context ได้', async () => {
    const outcome = await getToolRegistry().invoke(
      'analyze_financial_statement',
      {},
      { smeId: 'sme-kruathai-foods' },
    );
    expect((outcome.data as { sme: { id: string } }).sme.id).toBe('sme-kruathai-foods');
  });

  it('รายงานข้อผิดพลาดที่อ่านเข้าใจได้เมื่อ smeId ไม่มีจริง', async () => {
    await expect(
      getToolRegistry().invoke('analyze_financial_statement', { smeId: 'ไม่มี' }),
    ).rejects.toThrow(/ไม่พบกิจการ/);
  });

  it('convert_currency แปลงค่าด้วยอัตราของ ธปท.', async () => {
    const outcome = await getToolRegistry().invoke('convert_currency', {
      amount: 1000,
      from: 'USD',
      to: 'THB',
    });
    const data = outcome.data as { converted: number; rateUsed: number };
    expect(data.converted).toBeCloseTo(1000 * data.rateUsed, 2);
  });

  it('เครื่องมือทุกตัวที่ไม่ต้องใส่พารามิเตอร์บังคับ เรียกได้โดยไม่ล้ม', async () => {
    const registry = getToolRegistry();
    const failures: string[] = [];

    for (const tool of registry.catalog()) {
      if ((tool.inputSchema.required ?? []).length > 0) continue;
      try {
        await registry.invoke(tool.name, {}, { smeId: 'sme-siam-textile' });
      } catch (error) {
        failures.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
