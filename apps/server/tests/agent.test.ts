/** เทสต์ตัววางแผน/เรียบเรียงคำตอบ และลูปของที่ปรึกษา AI */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDemoNotice,
  collectCitations,
  runAdvisor,
  SUGGESTIONS,
} from '../src/agent/agent.js';
import {
  detectIntent,
  MockLlmClient,
  parseAmount,
  parseYears,
  planFor,
} from '../src/services/llm/mockClient.js';
import type { LlmClient, LlmRequest, LlmTurn } from '../src/services/llm/llmTypes.js';
import { setLlmClient } from '../src/services/llm/index.js';
import { demoBotService, freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
  demoBotService();
  setLlmClient(null);
});

describe('parseAmount', () => {
  it.each([
    ['กู้เงิน 10 ล้านบาท', 10_000_000],
    ['วงเงิน 5 แสนบาท', 500_000],
    ['ขอ 500,000 บาท', 500_000],
    ['borrow 2.5 million baht', 2_500_000],
    ['ต้องการ 3 หมื่นบาท', 30_000],
  ])('อ่าน "%s" ได้ %d', (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });

  it('ไม่เข้าใจผิดว่าจำนวนปีเป็นวงเงิน', () => {
    expect(parseAmount('ผ่อน 5 ปี')).toBeNull();
  });

  it('คืน null เมื่อไม่มีตัวเลขที่เป็นจำนวนเงิน', () => {
    expect(parseAmount('ดอกเบี้ยตอนนี้เป็นอย่างไร')).toBeNull();
  });
});

describe('parseYears', () => {
  it.each([
    ['ผ่อน 7 ปี', 7],
    ['over 10 years', 10],
  ])('อ่าน "%s" ได้ %d', (text, expected) => {
    expect(parseYears(text)).toBe(expected);
  });

  it('คืน null เมื่อไม่ระบุจำนวนปี', () => {
    expect(parseYears('ควรกู้ไหม')).toBeNull();
  });
});

describe('detectIntent', () => {
  it('คำถามตัวอย่างจากโจทย์ถูกจัดเป็นเรื่องการกู้ ไม่ใช่เรื่องแหล่งเงินทุน', () => {
    // "ต้นทุนทางการเงิน" มีคำว่า "ทุน" อยู่ข้างใน จึงเป็นกับดักที่ต้องไม่พลาด
    const parsed = detectIntent(
      'ตอนนี้ดอกเบี้ยสูงไหม และถ้าบริษัทกู้เงิน 10 ล้านบาทจะกระทบต้นทุนทางการเงินอย่างไร?',
    );
    expect(parsed.intent).toBe('borrow');
    expect(parsed.amount).toBe(10_000_000);
  });

  it.each([
    ['ควรกู้เงินตอนนี้ไหม?', 'borrow'],
    ['ตอนนี้ดอกเบี้ยนโยบายเท่าไร', 'rates'],
    ['มีแหล่งเงินทุนอะไรที่สมัครได้บ้าง', 'funding'],
    ['ถ้าเงินบาทอ่อนค่าจะกระทบอย่างไร', 'fx'],
    ['เงินสดพอใช้กี่เดือน', 'runway'],
    ['สุขภาพการเงินของบริษัทเป็นอย่างไร', 'health'],
  ])('"%s" → %s', (text, intent) => {
    expect(detectIntent(text).intent).toBe(intent);
  });

  it('อ่านสกุลเงินจากคำถามภาษาไทยได้', () => {
    expect(detectIntent('ดอลลาร์ตอนนี้เท่าไร').currency).toBe('USD');
  });
});

describe('planFor', () => {
  it('แผนของคำถามเรื่องกู้เงินเรียก BOT ก่อนแล้วค่อยวิเคราะห์กิจการ', () => {
    const plan = planFor(detectIntent('ควรกู้ 10 ล้านบาทไหม'));
    const names = plan.map((step) => step.name);
    expect(names[0]).toBe('get_bot_policy_rate');
    expect(names).toContain('get_bot_lending_rate');
    expect(names).toContain('analyze_financial_statement');
    expect(names).toContain('assess_debt_capacity');
  });

  it('ส่งวงเงินที่ผู้ใช้ระบุเข้าไปในเครื่องมือ', () => {
    const plan = planFor(detectIntent('กู้ 7 ล้านบาท ผ่อน 8 ปี ได้ไหม'));
    const cost = plan.find((step) => step.name === 'estimate_financing_cost')!;
    expect(cost.arguments.principal).toBe(7_000_000);
    expect(cost.arguments.years).toBe(8);
  });
});

describe('MockLlmClient', () => {
  it('รอบแรกวางแผนเรียกเครื่องมือ ยังไม่ตอบเป็นข้อความ', async () => {
    const request: LlmRequest = {
      system: '',
      messages: [{ type: 'user', text: 'ควรกู้เงิน 10 ล้านบาทไหม' }],
      tools: [
        { name: 'get_bot_policy_rate', title: '', description: '', category: 'bot', inputSchema: { type: 'object', properties: {} }, readOnly: true },
      ],
    };
    const turn = await new MockLlmClient().complete(request);
    expect(turn.text).toBe('');
    expect(turn.toolCalls.map((c) => c.name)).toEqual(['get_bot_policy_rate']);
  });

  it('รอบที่สองเรียบเรียงคำตอบจากผลลัพธ์ที่ได้จริง', async () => {
    const request: LlmRequest = {
      system: '',
      messages: [
        { type: 'user', text: 'ตอนนี้ดอกเบี้ยเท่าไร' },
        { type: 'assistant', text: '', toolCalls: [{ id: '1', name: 'get_bot_policy_rate', arguments: {} }] },
        {
          type: 'tool_results',
          results: [
            {
              id: '1',
              name: 'get_bot_policy_rate',
              isError: false,
              content: JSON.stringify({
                current: 1.5,
                previous: 1.75,
                source: 'Bank of Thailand',
                asOf: '2026-06-24',
              }),
            },
          ],
        },
      ],
      tools: [],
    };
    const turn = await new MockLlmClient().complete(request);
    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.text).toContain('1.50%');
    expect(turn.text).toContain('Bank of Thailand');
  });
});

describe('runAdvisor', () => {
  it('ตอบคำถามตัวอย่างจากโจทย์ด้วยตัวเลขที่มาจากเครื่องมือจริง', async () => {
    const answer = await runAdvisor({
      smeId: 'sme-siam-textile',
      question: 'ตอนนี้ดอกเบี้ยสูงไหม และถ้าบริษัทกู้เงิน 10 ล้านบาทจะกระทบต้นทุนทางการเงินอย่างไร?',
      persist: false,
    });

    const names = answer.toolTrace.map((entry) => entry.name);
    expect(names).toContain('get_bot_policy_rate');
    expect(names).toContain('estimate_financing_cost');
    expect(answer.toolTrace.every((entry) => entry.error === null)).toBe(true);

    // ตัวเลขในคำตอบต้องตรงกับผลลัพธ์ของเครื่องมือ ไม่ใช่ตัวเลขที่แต่งขึ้น
    const cost = answer.toolTrace.find((entry) => entry.name === 'estimate_financing_cost')!
      .result as { estimatedRatePct: number; monthlyPayment: number };
    expect(answer.answer).toContain(cost.estimatedRatePct.toFixed(2));
    expect(answer.answer).toContain('฿10,000,000');
    expect(answer.answer).toContain('ที่มาของข้อมูล');
  });

  it('ติดป้ายว่าใช้ข้อมูลจำลองเมื่ออยู่ในโหมดสาธิต', async () => {
    const answer = await runAdvisor({
      smeId: 'sme-siam-textile',
      question: 'ตอนนี้ดอกเบี้ยนโยบายเท่าไร',
      persist: false,
    });
    expect(answer.demoNotice).not.toBeNull();
    expect(answer.citations.some((c) => c.source === 'demo')).toBe(true);
    expect(answer.llmMode).toBe('demo');
  });

  it('บันทึกบทสนทนาและ trace ลงฐานข้อมูลเมื่อสั่งให้บันทึก', async () => {
    const answer = await runAdvisor({
      smeId: 'sme-kruathai-foods',
      question: 'สุขภาพการเงินเป็นอย่างไร',
    });
    const { listMessages } = await import('../src/db/advisorRepo.js');
    const messages = listMessages(answer.conversationId);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.toolTrace.length).toBe(answer.toolTrace.length);
  });

  it('ถอยไปใช้ตัวเรียบเรียงแบบกฎเมื่อ LLM ล้มเหลว แทนที่จะคืนข้อผิดพลาด', async () => {
    const failing: LlmClient = {
      kind: 'anthropic',
      async complete(): Promise<LlmTurn> {
        throw new Error('upstream 529 overloaded');
      },
    };
    setLlmClient(failing);

    const answer = await runAdvisor({
      smeId: 'sme-siam-textile',
      question: 'ควรกู้เงิน 5 ล้านบาทไหม',
      persist: false,
    });

    expect(answer.answer.length).toBeGreaterThan(50);
    expect(answer.toolTrace.length).toBeGreaterThan(0);
    expect(answer.llmMode).toBe('demo');
  });

  it('บันทึกข้อผิดพลาดของเครื่องมือไว้ใน trace โดยไม่ทำให้ทั้งคำขอล้ม', async () => {
    const badPlanner: LlmClient = {
      kind: 'mock',
      async complete(request): Promise<LlmTurn> {
        const called = request.messages.some((m) => m.type === 'tool_results');
        return called
          ? { text: 'สรุปแล้ว', toolCalls: [] }
          : { text: '', toolCalls: [{ id: '1', name: 'analyze_financial_statement', arguments: { smeId: 'ไม่มีจริง' } }] };
      },
    };
    setLlmClient(badPlanner);

    const answer = await runAdvisor({ question: 'ทดสอบ', persist: false });
    expect(answer.toolTrace[0]!.error).toContain('ไม่พบกิจการ');
    expect(answer.answer).toBe('สรุปแล้ว');
  });
});

describe('collectCitations / buildDemoNotice', () => {
  it('รวมแหล่งข้อมูลซ้ำให้เหลือรายการเดียว', () => {
    const citations = collectCitations([
      { seq: 1, name: 'a', title: 'a', arguments: {}, result: { source: 'Bank of Thailand', asOf: '2026-08-01' }, source: 'bot', durationMs: 1, error: null, notice: null },
      { seq: 2, name: 'b', title: 'b', arguments: {}, result: { source: 'Bank of Thailand', asOf: '2026-08-01' }, source: 'bot', durationMs: 1, error: null, notice: null },
    ]);
    expect(citations).toHaveLength(1);
  });

  it('ข้ามเครื่องมือที่ผิดพลาด', () => {
    expect(
      collectCitations([
        { seq: 1, name: 'a', title: 'a', arguments: {}, result: null, source: 'local', durationMs: 1, error: 'พัง', notice: null },
      ]),
    ).toHaveLength(0);
  });

  it('ไม่แจ้งเรื่องข้อมูลจำลองเมื่อทุกอย่างเป็นข้อมูลจริง', () => {
    expect(
      buildDemoNotice([
        { seq: 1, name: 'a', title: 'a', arguments: {}, result: {}, source: 'bot', durationMs: 1, error: null, notice: null },
      ]),
    ).toBeNull();
  });
});

describe('คำถามตั้งต้น', () => {
  it('มีคำถามตัวอย่างจากโจทย์อยู่ในรายการ', () => {
    expect(SUGGESTIONS.some((s) => s.th.includes('10 ล้านบาท'))).toBe(true);
    expect(SUGGESTIONS.some((s) => s.th === 'ควรกู้เงินตอนนี้ไหม?')).toBe(true);
  });
});
