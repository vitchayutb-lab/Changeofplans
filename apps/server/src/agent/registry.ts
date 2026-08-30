/**
 * ทะเบียนเครื่องมือ (tool registry) — แหล่งความจริงเดียวของทั้งระบบ
 *
 * ผู้ใช้ทะเบียนนี้มีสามทาง และทั้งสามทางเห็นสคีมาชุดเดียวกัน:
 *   1) ที่ปรึกษา AI ในเซิร์ฟเวอร์ (เรียก handler ตรง ๆ)
 *   2) HTTP: GET /api/tools และ POST /api/tools/:name/invoke
 *   3) MCP: tools/list และ tools/call ผ่าน bridge ที่เรียก HTTP ข้างต้น
 */

import type { DataSource, ToolCategory, ToolDescriptor } from '@sme/shared';
import type { ToolSchema } from './schema.js';
import { ValidationError } from './schema.js';

export interface ToolContext {
  /** กิจการที่กำลังพิจารณาอยู่ (บาง tool ใช้เป็นค่าเริ่มต้นเมื่อไม่ระบุ smeId) */
  smeId?: string;
}

export interface ToolResult<R = unknown> {
  data: R;
  source: DataSource;
  notice?: string | null;
  citation?: { label: string; asOf?: string | null } | null;
}

export interface ToolDefinition<A = any, R = unknown> {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  schema: ToolSchema<A>;
  readOnly: boolean;
  handler(args: A, ctx: ToolContext): Promise<ToolResult<R>>;
}

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`ไม่รู้จักเครื่องมือชื่อ "${name}"`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(...definitions: ToolDefinition<any, any>[]): this {
    for (const definition of definitions) {
      if (this.tools.has(definition.name)) {
        throw new Error(`เครื่องมือชื่อ "${definition.name}" ถูกลงทะเบียนไว้แล้ว`);
      }
      this.tools.set(definition.name, definition as ToolDefinition);
    }
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);
    return tool;
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** รายละเอียดสำหรับ /api/tools, MCP tools/list และ Anthropic tool-use */
  catalog(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      category: tool.category,
      inputSchema: tool.schema.json,
      readOnly: tool.readOnly,
    }));
  }

  /** เรียกใช้เครื่องมือหนึ่งตัว: ตรวจ argument แล้วส่งต่อให้ handler */
  async invoke(
    name: string,
    rawArgs: unknown,
    ctx: ToolContext = {},
  ): Promise<ToolResult & { durationMs: number; arguments: Record<string, unknown> }> {
    const tool = this.get(name);
    const args = tool.schema.parse(rawArgs) as Record<string, unknown>;
    const started = Date.now();
    const result = await tool.handler(args, ctx);
    return {
      ...result,
      notice: result.notice ?? null,
      citation: result.citation ?? null,
      durationMs: Date.now() - started,
      arguments: args,
    };
  }
}

export { ValidationError };
