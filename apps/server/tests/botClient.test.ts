/** เทสต์ตัวเชื่อม BOT API จริง โดยฉีด fetch ปลอมเข้าไป — ไม่มีการยิงเครือข่ายจริง */

import { describe, expect, it, vi } from 'vitest';
import { LiveBotClient, toBotError } from '../src/services/bot/botClient.js';
import { BOT_SERIES } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';

const API_KEY = 'test-client-id-0123456789';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function policyPayload() {
  return {
    result: {
      data: {
        data_header: { last_updated: '2026-08-28 07:00:00' },
        data_detail: [{ period: '2026-08-01', rate: '1.50' }],
      },
    },
  };
}

function client(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new LiveBotClient({
    baseUrl: 'https://apigw1.example.test/bot/public',
    apiKey: API_KEY,
    apiKeyHeader: 'X-IBM-Client-Id',
    timeoutMs: 500,
    maxRetries: 1,
    maxRps: 0,
    fetchImpl,
    ...overrides,
  });
}

describe('LiveBotClient.buildUrl', () => {
  it('ประกอบ URL พร้อมช่วงวันที่ และไม่ใส่ API key ลงใน query string', () => {
    const url = client(vi.fn() as unknown as typeof fetch).buildUrl(BOT_SERIES.policy_rate, {
      start: '2026-06-01',
      end: '2026-08-29',
    });
    expect(url).toBe(
      'https://apigw1.example.test/bot/public/PolicyRate/v3/policy_rate?start_period=2026-06-01&end_period=2026-08-29',
    );
    expect(url).not.toContain(API_KEY);
  });

  it('ใส่พารามิเตอร์ currency เฉพาะชุดข้อมูลที่รองรับ', () => {
    const instance = client(vi.fn() as unknown as typeof fetch);
    expect(instance.buildUrl(BOT_SERIES.fx_average, { currency: 'usd' })).toContain('currency=USD');
    expect(instance.buildUrl(BOT_SERIES.policy_rate, { currency: 'USD' })).not.toContain('currency');
  });
});

describe('LiveBotClient.fetchSeries', () => {
  it('ส่ง API key ผ่าน header ที่กำหนด แล้วแปลงผลลัพธ์ให้เรียบร้อย', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(policyPayload()));
    const result = await client(fetchImpl as unknown as typeof fetch).fetchSeries(
      BOT_SERIES.policy_rate,
      {},
    );

    expect(result.observations).toEqual([
      { period: '2026-08-01', dimension: 'default', value: 1.5 },
    ]);
    expect(result.lastUpdated).not.toBeNull();

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-IBM-Client-Id']).toBe(API_KEY);
    expect(headers.accept).toBe('application/json');
  });

  it('โยนข้อผิดพลาดชนิด auth เมื่อ BOT ตอบ 401 และไม่ลองซ้ำ', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'unauthorized' }, { status: 401 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).fetchSeries(BOT_SERIES.policy_rate, {}),
    ).rejects.toMatchObject({ reason: 'auth' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('รู้จักการถูกจำกัดอัตราเรียก (429)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: 'too many' }, { status: 429, headers: { 'retry-after': '0' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).fetchSeries(BOT_SERIES.policy_rate, {}),
    ).rejects.toMatchObject({ reason: 'rate_limit' });
  });

  it('ลองใหม่เมื่อเจอ 5xx แล้วสำเร็จในครั้งถัดไป', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ message: 'boom' }, { status: 503 })
        : jsonResponse(policyPayload());
    });
    const result = await client(fetchImpl as unknown as typeof fetch).fetchSeries(
      BOT_SERIES.policy_rate,
      {},
    );
    expect(result.observations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('โยนข้อผิดพลาดเมื่อ body ไม่ใช่ JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>error</html>', { status: 200 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).fetchSeries(BOT_SERIES.policy_rate, {}),
    ).rejects.toMatchObject({ reason: 'response' });
  });

  it('ปฏิเสธทันทีเมื่อยังไม่ได้ตั้งค่า API key', async () => {
    const fetchImpl = vi.fn();
    await expect(
      client(fetchImpl as unknown as typeof fetch, { apiKey: '' }).fetchSeries(
        BOT_SERIES.policy_rate,
        {},
      ),
    ).rejects.toMatchObject({ reason: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('หมดเวลาแล้วรายงานเป็น timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch, { timeoutMs: 30, maxRetries: 0 }).fetchSeries(
        BOT_SERIES.policy_rate,
        {},
      ),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('toBotError', () => {
  it('คงชนิดของ BotApiError เดิมไว้', () => {
    const error = toBotError(new BotApiError('nope', 'server', 502));
    expect(error.reason).toBe('server');
    expect(error.status).toBe(502);
  });

  it('แปลง error ทั่วไปเป็นชนิด network', () => {
    expect(toBotError(new Error('socket hang up')).reason).toBe('network');
    expect(toBotError('อะไรก็ไม่รู้').reason).toBe('network');
  });
});
