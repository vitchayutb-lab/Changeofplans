/**
 * ลูปการทำงานของที่ปรึกษา AI
 *
 * หลักการ: โมเดลภาษาเป็นคนเรียบเรียง ไม่ใช่แหล่งข้อเท็จจริง ตัวเลขทุกตัวต้องมาจาก
 * การเรียกเครื่องมือจริง และผลการเรียกทุกครั้งจะถูกส่งกลับไปแสดงบนหน้าเว็บ (tool trace)
 * เพื่อให้ผู้ใช้ตรวจย้อนได้ว่าเลขแต่ละตัวมาจากไหน
 */

import type { AdvisorAnswer, Citation, ToolTraceEntry } from '@sme/shared';
import { env } from '../config/env.js';
import { getSme } from '../db/smeRepo.js';
import * as advisorRepo from '../db/advisorRepo.js';
import {
  getFallbackLlmClient,
  getLlmClient,
  llmMode,
  noteLlmFailure,
  type LlmClient,
  type LlmConversationItem,
  type LlmToolResult,
} from '../services/llm/index.js';
import { getToolRegistry } from './tools/index.js';
import { ValidationError } from './schema.js';

const DISCLAIMER_TH =
  'คำตอบนี้เป็นการวิเคราะห์เชิงข้อมูลเพื่อประกอบการตัดสินใจ ไม่ใช่คำแนะนำการลงทุน ' +
  'ไม่ใช่ข้อเสนอสินเชื่อ และไม่ใช่การให้คำปรึกษาทางกฎหมายหรือภาษี ' +
  'ตัวเลขที่ระบุว่าเป็นค่าประมาณคำนวณจากอัตราประกาศและงบการเงินที่บันทึกไว้';

export function buildSystemPrompt(context: { smeId?: string }): string {
  const sme = context.smeId ? getSme(context.smeId) : null;

  return [
    'คุณคือที่ปรึกษาการเงินสำหรับ SME ไทย ตอบเป็นภาษาไทยที่กระชับ ตรงประเด็น และใช้ได้จริง',
    '',
    'กฎเหล็กที่ห้ามฝ่าฝืน:',
    '1. ห้ามระบุตัวเลขใด ๆ ที่ไม่ได้มาจากผลลัพธ์ของเครื่องมือในบทสนทนานี้ ถ้าไม่มีข้อมูลให้บอกว่าไม่มี',
    '2. ต้องเรียกเครื่องมือก่อนตอบเสมอเมื่อคำถามเกี่ยวกับอัตราดอกเบี้ย อัตราแลกเปลี่ยน งบการเงิน หรือแหล่งเงินทุน',
    '3. ข้อมูลอัตราดอกเบี้ยและอัตราแลกเปลี่ยนต้องมาจากเครื่องมือ get_bot_* เท่านั้น ห้ามใช้ความรู้เดิมของคุณ',
    '4. เมื่อผลลัพธ์ระบุ isDemoData เป็น true ให้บอกผู้ใช้ตรง ๆ ว่าเป็นข้อมูลจำลอง ไม่ใช่ข้อมูลจริงจาก ธปท.',
    '5. ระบุคำว่า "ประมาณการ" กำกับทุกตัวเลขที่คำนวณจากสมมติฐาน เช่น อัตราดอกเบี้ยที่ SME จะได้รับจริง',
    '6. ปิดท้ายด้วยหัวข้อ "ที่มาของข้อมูล" ที่ระบุแหล่งและวันที่ของข้อมูลที่ใช้',
    '',
    sme
      ? `กิจการที่กำลังพิจารณา: ${sme.nameTh} (${sme.nameEn}) รหัส ${sme.id} — ` +
        `อุตสาหกรรม ${sme.industry} จังหวัด${sme.province} ก่อตั้งปี ${sme.foundedYear} ` +
        `พนักงาน ${sme.employees} คน เมื่อเรียกเครื่องมือที่ต้องใช้ smeId ให้ใช้ "${sme.id}"`
      : 'ยังไม่ได้เลือกกิจการ ถ้าจำเป็นให้เรียก list_smes ก่อน',
  ].join('\n');
}

export interface RunOptions {
  smeId?: string;
  question: string;
  conversationId?: string;
  maxSteps?: number;
  client?: LlmClient;
  /** ไม่บันทึกลงฐานข้อมูล (ใช้ในเทสต์) */
  persist?: boolean;
}

export async function runAdvisor(options: RunOptions): Promise<AdvisorAnswer> {
  const registry = getToolRegistry();
  const tools = registry.catalog();
  const maxSteps = options.maxSteps ?? env.advisorMaxSteps;
  const persist = options.persist ?? true;

  const messages: LlmConversationItem[] = [{ type: 'user', text: options.question }];
  const trace: ToolTraceEntry[] = [];

  let client = options.client ?? getLlmClient();
  let usedFallback = false;
  let finalText = '';

  for (let step = 0; step < maxSteps; step += 1) {
    let turn;
    try {
      turn = await client.complete({
        system: buildSystemPrompt({ ...(options.smeId ? { smeId: options.smeId } : {}) }),
        messages,
        tools,
      });
    } catch (error) {
      // เรียก Claude ไม่สำเร็จ → ถอยไปใช้ตัวเรียบเรียงแบบกฎ แล้วเดินลูปต่อ
      if (usedFallback) throw error;
      noteLlmFailure();
      usedFallback = true;
      client = getFallbackLlmClient();
      continue;
    }

    if (turn.toolCalls.length === 0) {
      finalText = turn.text;
      break;
    }

    messages.push({ type: 'assistant', text: turn.text, toolCalls: turn.toolCalls });

    const results: LlmToolResult[] = [];
    for (const call of turn.toolCalls) {
      const entry = await executeTool(registry, call, options.smeId, trace.length + 1);
      trace.push(entry);
      results.push({
        id: call.id,
        name: call.name,
        content: JSON.stringify(entry.error ? { error: entry.error } : entry.result),
        isError: entry.error !== null,
      });
    }
    messages.push({ type: 'tool_results', results });
  }

  if (finalText.trim() === '') {
    // โมเดลใช้ขั้นตอนครบแล้วยังไม่สรุป → ให้ตัวเรียบเรียงแบบกฎสรุปจาก trace ที่มี
    const fallback = getFallbackLlmClient();
    const turn = await fallback.complete({
      system: buildSystemPrompt({ ...(options.smeId ? { smeId: options.smeId } : {}) }),
      messages,
      tools,
    });
    finalText = turn.text;
    usedFallback = true;
  }

  const citations = collectCitations(trace);
  const demoNotice = buildDemoNotice(trace);

  const conversationId = persist
    ? resolveConversation(options.conversationId, options.smeId, options.question)
    : 'conv_ephemeral';

  let messageId = 'msg_ephemeral';
  if (persist) {
    advisorRepo.addMessage({
      conversationId,
      role: 'user',
      content: options.question,
    });
    messageId = advisorRepo.addMessage({
      conversationId,
      role: 'assistant',
      content: finalText,
      demoNotice,
      toolTrace: trace,
    }).id;
  }

  return {
    conversationId,
    messageId,
    answer: finalText,
    toolTrace: trace,
    citations,
    demoNotice,
    llmMode: usedFallback ? 'demo' : llmMode(),
    disclaimerTh: DISCLAIMER_TH,
  };
}

async function executeTool(
  registry: ReturnType<typeof getToolRegistry>,
  call: { id: string; name: string; arguments: Record<string, unknown> },
  smeId: string | undefined,
  seq: number,
): Promise<ToolTraceEntry> {
  const started = Date.now();
  const title = registry.has(call.name) ? registry.get(call.name).title : call.name;

  try {
    const outcome = await registry.invoke(call.name, call.arguments, {
      ...(smeId ? { smeId } : {}),
    });
    return {
      seq,
      name: call.name,
      title,
      arguments: outcome.arguments,
      result: outcome.data,
      source: outcome.source,
      durationMs: outcome.durationMs,
      error: null,
      notice: outcome.notice ?? null,
    };
  } catch (error) {
    // ส่ง error กลับให้โมเดลเป็นข้อความ เพื่อให้แก้ argument แล้วลองใหม่ได้ แทนที่จะล้มทั้งคำขอ
    const message =
      error instanceof ValidationError
        ? `อาร์กิวเมนต์ไม่ถูกต้อง: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      seq,
      name: call.name,
      title,
      arguments: call.arguments,
      result: null,
      source: 'local',
      durationMs: Date.now() - started,
      error: message,
      notice: null,
    };
  }
}

export function collectCitations(trace: ToolTraceEntry[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const entry of trace) {
    if (entry.error) continue;
    const result = entry.result as { source?: string; asOf?: string; lastUpdated?: string } | null;
    const label =
      typeof result?.source === 'string'
        ? result.source
        : entry.source === 'bot'
          ? 'Bank of Thailand'
          : entry.source === 'demo'
            ? 'Demo Data'
            : 'ข้อมูลภายในระบบ';
    const asOf = result?.asOf ?? result?.lastUpdated ?? null;
    const key = `${label}|${asOf ?? ''}`;
    if (!seen.has(key)) seen.set(key, { label, asOf, source: entry.source });
  }
  return [...seen.values()];
}

export function buildDemoNotice(trace: ToolTraceEntry[]): string | null {
  const demoTools = trace.filter((entry) => entry.source === 'demo' && !entry.error);
  if (demoTools.length === 0) return null;
  const explicit = demoTools.map((entry) => entry.notice).find((notice) => notice);
  return (
    explicit ??
    `คำตอบนี้ใช้ข้อมูลจำลองบางส่วน (${demoTools.map((t) => t.name).join(', ')}) — ไม่ใช่ข้อมูลจริงจาก ธปท.`
  );
}

function resolveConversation(
  conversationId: string | undefined,
  smeId: string | undefined,
  question: string,
): string {
  if (conversationId) {
    const existing = advisorRepo.getConversation(conversationId);
    if (existing) return existing.id;
  }
  const owner = smeId ?? 'unknown';
  return advisorRepo.createConversation(owner, question).id;
}

/** คำถามตั้งต้นที่แสดงบนหน้าแชต */
export const SUGGESTIONS = [
  {
    th: 'ตอนนี้ดอกเบี้ยสูงไหม และถ้าบริษัทกู้เงิน 10 ล้านบาทจะกระทบต้นทุนทางการเงินอย่างไร?',
    en: 'Are rates high now, and how would a ฿10M loan affect our financing cost?',
    focus: 'borrow',
  },
  {
    th: 'ควรกู้เงินตอนนี้ไหม?',
    en: 'Should we borrow right now?',
    focus: 'borrow',
  },
  {
    th: 'เพิ่งเปิดธุรกิจใหม่ อยากกู้ 800,000 บาท ธนาคารจะให้กู้ไหม',
    en: 'We just opened — would a bank lend us ฿800,000?',
    focus: 'startup',
  },
  {
    th: 'สุขภาพการเงินของบริษัทตอนนี้เป็นอย่างไร',
    en: 'How healthy are our financials?',
    focus: 'health',
  },
  {
    th: 'มีแหล่งเงินทุนอะไรที่บริษัทเราสมัครได้บ้าง',
    en: 'Which funding programs are we eligible for?',
    focus: 'funding',
  },
  {
    th: 'ถ้าเงินบาทอ่อนค่า 5% จะกระทบกำไรเราแค่ไหน',
    en: 'What if the baht weakens by 5%?',
    focus: 'fx',
  },
  {
    th: 'เงินสดที่มีอยู่พอใช้กี่เดือน',
    en: 'How many months of cash runway do we have?',
    focus: 'runway',
  },
];
