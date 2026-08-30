/**
 * เทสต์สะพาน MCP
 *
 * จุดที่ต้องพิสูจน์: สะพานคุยกับ backend ผ่าน HTTP อย่างเดียว จึงไม่ต้องมี API key
 * และรายการเครื่องมือที่ MCP เห็นต้องเหมือนกับที่ REST API และที่ปรึกษา AI เห็น
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupApp } from './helpers.js';
import { getToolRegistry } from '../src/agent/tools/index.js';

let server: Server;
let bridge: typeof import('../src/mcp/server.js');

beforeAll(async () => {
  const app = setupApp();
  server = createServer(app);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as AddressInfo;
  // ต้องตั้งค่าที่อยู่ backend ก่อนโหลดโมดูล เพราะสะพานอ่านค่านี้ตอนถูกโหลด
  process.env.MCP_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  bridge = await import('../src/mcp/server.js');
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

describe('MCP bridge', () => {
  it('ดึงทะเบียนเครื่องมือชุดเดียวกับที่ระบบใช้', async () => {
    const tools = await bridge.fetchCatalog();
    const expected = getToolRegistry().names().sort();
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(expected);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('เรียกเครื่องมือผ่าน backend แล้วได้ผลลัพธ์พร้อมที่มา', async () => {
    const response = await bridge.invokeTool('get_bot_policy_rate', {});
    expect(response.source).toBe('demo');
    expect((response.result as { current: number }).current).toBeGreaterThan(0);
  });

  it('รายงานข้อผิดพลาดที่อ่านเข้าใจได้เมื่อเรียกเครื่องมือที่ไม่มี', async () => {
    await expect(bridge.invokeTool('ไม่มีเครื่องมือนี้', {})).rejects.toThrow(/ไม่รู้จักเครื่องมือ/);
  });

  it('สร้าง MCP server ได้โดยไม่ต้องมี credential ใด ๆ', async () => {
    expect(() => bridge.createMcpServer()).not.toThrow();
  });
});

describe('ความปลอดภัยของสะพาน MCP', () => {
  it('สะพานอ่านเฉพาะตัวแปร MCP_* ไม่แตะ secret ใด ๆ', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/mcp/server.ts', import.meta.url)),
      'utf-8',
    );

    // เก็บชื่อตัวแปร environment ทุกตัวที่โค้ดนี้อ่าน
    const read = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(0);
    for (const name of read) {
      expect(name, `สะพาน MCP ไม่ควรอ่าน ${name}`).toMatch(/^MCP_/);
    }
    expect(read).toContain('MCP_API_BASE_URL');
  });

  it('สะพานไม่ import ฐานข้อมูลหรือโมดูลที่ถือ secret', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/mcp/server.ts', import.meta.url)),
      'utf-8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      expect(specifier, `ไม่ควร import ${specifier}`).not.toMatch(
        /config\/env|better-sqlite3|services\/bot|db\//,
      );
    }
  });
});
