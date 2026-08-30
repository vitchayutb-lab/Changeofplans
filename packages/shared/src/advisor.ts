/** DTOs ของที่ปรึกษา AI และร่องรอยการเรียก tool (tool trace) */

import type { DataSource, SourceMode } from './bot.js';

/** สคีมาแบบ JSON Schema ที่ใช้ร่วมกันทั้ง Anthropic tool-use และ MCP tools/list */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export type ToolCategory = 'bot' | 'finance' | 'funding' | 'explain';

/** รายละเอียด tool ที่ /api/tools ส่งออก และ MCP bridge นำไปประกาศต่อ */
export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  inputSchema: JsonSchemaObject;
  readOnly: boolean;
}

/** หนึ่งบรรทัดใน trace — ตอบได้ว่าตัวเลขในคำตอบมาจากการเรียกอะไร */
export interface ToolTraceEntry {
  seq: number;
  name: string;
  title: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: DataSource;
  durationMs: number;
  error: string | null;
  notice: string | null;
}

export interface Citation {
  label: string;
  asOf: string | null;
  source: DataSource;
}

export interface AdvisorAnswer {
  conversationId: string;
  messageId: string;
  answer: string;
  toolTrace: ToolTraceEntry[];
  citations: Citation[];
  /** ข้อความเตือนเมื่อคำตอบนี้อ้างอิงข้อมูลจำลองบางส่วน */
  demoNotice: string | null;
  llmMode: SourceMode;
  disclaimerTh: string;
}

export interface AdvisorMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  demoNotice: string | null;
  createdAt: string;
  toolTrace: ToolTraceEntry[];
}

export interface AdvisorConversation {
  id: string;
  smeId: string;
  title: string;
  createdAt: string;
}

export interface AdvisorSuggestion {
  th: string;
  en: string;
  focus: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: string;
  };
}
