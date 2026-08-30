/**
 * หน้าสำหรับนักพัฒนา: ดูทะเบียนเครื่องมือทั้งหมด ลองเรียกเอง ตรวจสถานะระบบ
 * และคัดลอกการตั้งค่าเชื่อมต่อ MCP
 *
 * สิ่งที่เห็นในหน้านี้คือสิ่งเดียวกับที่ AI และโฮสต์ MCP เห็นทุกประการ
 */

import { useState } from 'react';
import type { JsonSchemaProperty, ToolDescriptor } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section } from '../components/primitives';
import { formatDateTime } from '../components/format';

const MCP_CONFIG = `{
  "mcpServers": {
    "sme-finance-copilot": {
      "command": "node",
      "args": ["apps/server/dist/mcp/server.js"],
      "env": { "MCP_API_BASE_URL": "http://localhost:8787" }
    }
  }
}`;

export function DeveloperPage() {
  const { selectedSmeId, refreshHealth } = useApp();
  const tools = useApi(() => api.tools.list(), []);
  const health = useApi(() => api.health(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const tool = tools.data?.tools.find((t) => t.name === selected) ?? null;

  async function run(): Promise<void> {
    if (!tool) return;
    setRunning(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(tool.inputSchema.properties)) {
        const raw = args[key];
        if (raw === undefined || raw === '') continue;
        payload[key] =
          property.type === 'number' || property.type === 'integer'
            ? Number(raw.replace(/,/g, ''))
            : property.type === 'boolean'
              ? raw === 'true'
              : raw;
      }
      const response = await api.tools.invoke(tool.name, payload, selectedSmeId ?? undefined);
      setOutput(JSON.stringify(response, null, 2));
    } catch (error) {
      setOutput(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <header className="page__header">
        <h1>เครื่องมือ &amp; MCP</h1>
        <p>ทะเบียนเครื่องมือชุดเดียวถูกใช้ทั้งโดยที่ปรึกษา AI, REST API และ MCP bridge</p>
      </header>

      <Section title="สถานะระบบ" actions={<button className="btn btn--sm" onClick={() => { health.reload(); refreshHealth(); }}>รีเฟรช</button>}>
        <AsyncBoundary state={health}>
          {(data) => (
            <div className="grid grid--3">
              <Card title="โหมดการทำงาน">
                <ul className="checklist">
                  <li>
                    <span>ข้อมูล ธปท.:</span> <strong>{data.modes.bot}</strong>
                  </li>
                  <li>
                    <span>ที่ปรึกษา AI:</span> <strong>{data.modes.llm}</strong>
                  </li>
                  <li>
                    <span>ฐานข้อมูล:</span> <strong>{data.modes.database}</strong>
                  </li>
                </ul>
              </Card>
              <Card title="การเชื่อมต่อ BOT API">
                <ul className="checklist">
                  <li>
                    <span>ตั้งค่า API key แล้ว:</span>{' '}
                    <strong>{data.bot.apiKeyConfigured ? 'ใช่' : 'ยังไม่ได้ตั้ง'}</strong>
                  </li>
                  <li>
                    <span>สำเร็จล่าสุด:</span> <strong>{formatDateTime(data.bot.lastSuccessAt)}</strong>
                  </li>
                  <li>
                    <span>ผิดพลาดล่าสุด:</span> <strong>{formatDateTime(data.bot.lastErrorAt)}</strong>
                  </li>
                  <li>
                    <span>ชุดข้อมูลในแคช:</span> <strong>{data.bot.cachedSeries}</strong>
                  </li>
                </ul>
                {data.bot.baseUrlError && (
                  <div className="banner banner--risk" style={{ marginTop: 10 }}>
                    <span>⚠️</span>
                    <div className="banner__body tiny">
                      <div className="banner__title">BOT_API_BASE_URL ตั้งค่าไม่ถูกต้อง</div>
                      <div>
                        {data.bot.baseUrlError} — แก้ตัวแปรนี้ให้เป็น URL เต็ม เช่น{' '}
                        <span className="mono">https://gateway.api.bot.or.th</span>{' '}
                        แล้วรีสตาร์ตเซิร์ฟเวอร์
                      </div>
                    </div>
                  </div>
                )}
                {data.bot.lastError && <p className="tiny muted">{data.bot.lastError}</p>}
                <button
                  className="btn btn--sm"
                  style={{ marginTop: 12 }}
                  onClick={() => void api.bot.invalidate().then(() => health.reload())}
                >
                  ล้างแคช BOT
                </button>
              </Card>
              <Card title="เชื่อมต่อผ่าน MCP" hint="กระบวนการ MCP ไม่ถือ API key ใด ๆ">
                <pre className="mono tiny" style={{ overflowX: 'auto', margin: 0 }}>
                  {MCP_CONFIG}
                </pre>
              </Card>
            </div>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="ทะเบียนเครื่องมือ">
        <AsyncBoundary state={tools}>
          {(data) => (
            <div className="grid grid--2">
              <Card title={`เครื่องมือทั้งหมด (${data.tools.length})`}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ชื่อ</th>
                        <th>หมวด</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.tools.map((entry) => (
                        <tr key={entry.name}>
                          <td className="mono tiny">{entry.name}</td>
                          <td className="tiny">{entry.category}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => {
                                setSelected(entry.name);
                                setArgs({});
                                setOutput(null);
                              }}
                            >
                              ลองเรียก
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card
                title={tool ? tool.title : 'เลือกเครื่องมือทางซ้าย'}
                hint={tool?.description}
              >
                {tool ? (
                  <>
                    <ToolForm tool={tool} args={args} setArgs={setArgs} />
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn btn--primary" onClick={() => void run()} disabled={running}>
                        {running ? 'กำลังเรียก…' : 'เรียกใช้'}
                      </button>
                      <span className="tiny muted">
                        POST /api/tools/{tool.name}/invoke
                      </span>
                    </div>
                    {output && (
                      <pre className="mono tiny" style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}>
                        {output}
                      </pre>
                    )}
                    <details style={{ marginTop: 12 }}>
                      <summary className="tiny muted">JSON Schema ที่ AI และ MCP เห็น</summary>
                      <pre className="mono tiny">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    </details>
                  </>
                ) : (
                  <p className="muted">
                    เลือกเครื่องมือเพื่อดูสคีมาและทดลองเรียกด้วยตัวเอง — ผลลัพธ์ที่ได้คือสิ่งเดียวกับที่ AI เห็น
                  </p>
                )}
              </Card>
            </div>
          )}
        </AsyncBoundary>
      </Section>
    </>
  );
}

function ToolForm({
  tool,
  args,
  setArgs,
}: {
  tool: ToolDescriptor;
  args: Record<string, string>;
  setArgs: (updater: (current: Record<string, string>) => Record<string, string>) => void;
}) {
  const entries = Object.entries(tool.inputSchema.properties) as [string, JsonSchemaProperty][];
  if (entries.length === 0) return <p className="tiny muted">เครื่องมือนี้ไม่ต้องใส่พารามิเตอร์</p>;

  const required = new Set(tool.inputSchema.required ?? []);

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {entries.map(([name, property]) => (
        <label key={name} className="field">
          <span className="field__label">
            {name}
            {required.has(name) ? ' *' : ''}
          </span>
          {property.enum ? (
            <select
              value={args[name] ?? String(property.default ?? '')}
              onChange={(event) => setArgs((current) => ({ ...current, [name]: event.target.value }))}
            >
              <option value="">— ไม่ระบุ —</option>
              {property.enum.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={args[name] ?? ''}
              placeholder={property.default !== undefined ? String(property.default) : property.type}
              onChange={(event) => setArgs((current) => ({ ...current, [name]: event.target.value }))}
            />
          )}
          {property.description && <span className="tiny muted">{property.description}</span>}
        </label>
      ))}
    </div>
  );
}
