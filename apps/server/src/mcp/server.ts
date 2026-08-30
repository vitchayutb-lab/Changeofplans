#!/usr/bin/env node
/**
 * สะพาน MCP: เปิดเครื่องมือชุดเดียวกับที่ที่ปรึกษา AI ใช้ ให้โฮสต์ MCP ภายนอกเรียกได้
 *
 * จุดสำคัญด้านความปลอดภัย: กระบวนการนี้ "ไม่ถือความลับใด ๆ"
 * ไม่มี BOT_API_KEY ไม่มี ANTHROPIC_API_KEY และไม่ต่อฐานข้อมูลเอง
 * ทุกคำสั่งถูกส่งต่อไปยัง backend ผ่าน HTTP (/api/tools) ซึ่งเป็นชั้นเดียวที่รู้จักคีย์
 *
 * รันด้วย:  npm run mcp   (ค่าเริ่มต้นชี้ไปที่ http://localhost:8787)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDescriptor } from '@sme/shared';

const API_BASE_URL = (process.env.MCP_API_BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 20000);

interface InvokeResponse {
  result: unknown;
  source: string;
  notice: string | null;
  durationMs: number;
}

async function callBackend<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`backend returned a non-JSON body (HTTP ${response.status})`);
    }
    if (!response.ok) {
      const error = (body as { error?: { message?: string } })?.error;
      throw new Error(error?.message ?? `backend returned HTTP ${response.status}`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalog(): Promise<ToolDescriptor[]> {
  const body = await callBackend<{ tools: ToolDescriptor[] }>('/api/tools');
  return body.tools;
}

export async function invokeTool(name: string, args: unknown): Promise<InvokeResponse> {
  return callBackend<InvokeResponse>(`/api/tools/${encodeURIComponent(name)}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ arguments: args ?? {} }),
  });
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'sme-finance-copilot', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await fetchCatalog();
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, title: tool.title },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const response = await invokeTool(name, args);
      const payload = {
        result: response.result,
        source: response.source,
        ...(response.notice ? { notice: response.notice } : {}),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as Record<string, unknown>,
      };
    } catch (error) {
      // ส่งกลับเป็นผลลัพธ์ที่ระบุว่าเป็น error ไม่ throw เพื่อให้โฮสต์ MCP แสดงให้ผู้ใช้เห็นได้
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `เรียกเครื่องมือ "${name}" ไม่สำเร็จ: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout สงวนไว้สำหรับโปรโตคอล JSON-RPC จึงเขียนข้อความสถานะลง stderr เท่านั้น
  process.stderr.write(`sme-finance-copilot MCP bridge → ${API_BASE_URL}\n`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('mcp/server.ts') || process.argv[1].endsWith('mcp/server.js'));

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`MCP bridge failed to start: ${String(error)}\n`);
    process.exit(1);
  });
}
