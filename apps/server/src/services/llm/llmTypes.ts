/**
 * สัญญาของโมเดลภาษา
 *
 * ตัวจริง (Claude) และตัวสำรอง (กฎในระบบ) ใช้ interface เดียวกัน ทำให้เปลี่ยนกันได้
 * โดยที่ลูปของ agent ไม่ต้องรู้ว่ากำลังคุยกับอะไรอยู่
 */

import type { ToolDescriptor } from '@sme/shared';

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  name: string;
  /** ผลลัพธ์ในรูป JSON string */
  content: string;
  isError: boolean;
}

export type LlmConversationItem =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string; toolCalls: LlmToolCall[] }
  | { type: 'tool_results'; results: LlmToolResult[] };

export interface LlmRequest {
  system: string;
  messages: LlmConversationItem[];
  tools: ToolDescriptor[];
  maxTokens?: number;
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface LlmClient {
  readonly kind: 'anthropic' | 'mock';
  complete(request: LlmRequest): Promise<LlmTurn>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}
