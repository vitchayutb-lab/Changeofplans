/**
 * ตัวเชื่อมต่อ Bank of Thailand API ของจริง
 *
 * เป็นไฟล์เดียวในระบบที่ยิง HTTP ไปหา BOT และเป็นไฟล์เดียวที่แตะ env.botApiKey
 * ความรับผิดชอบ: authentication, timeout, retry, rate limit, ตรวจรูปแบบผลลัพธ์,
 * แปลงข้อมูล และ "ล้าง" ค่า secret ออกจากข้อความ error ก่อนส่งต่อ
 */

import { env, redactSecrets, validateBotBaseUrl } from '../../config/env.js';
import { normalizeSeries } from './botNormalize.js';
import { BotApiError } from './botTypes.js';
import type {
  BotApiClient,
  BotFetchParams,
  BotFetchResult,
  BotSeriesDescriptor,
} from './botTypes.js';

/** ถังโทเคนแบบง่าย จำกัดจำนวนคำขอต่อวินาทีที่ยิงออกไปหา BOT */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly ratePerSecond: number) {
    this.tokens = ratePerSecond;
  }

  async acquire(): Promise<void> {
    if (this.ratePerSecond <= 0) return;
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(1000 / this.ratePerSecond);
      await sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.ratePerSecond, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LiveBotClientOptions {
  baseUrl?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxRps?: number;
  /** ฉีด fetch เข้ามาเองได้ในเทสต์ */
  fetchImpl?: typeof fetch;
}

export class LiveBotClient implements BotApiClient {
  readonly kind = 'live' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiKeyHeader: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LiveBotClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.botApiBaseUrl).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? env.botApiKey;
    this.apiKeyHeader = options.apiKeyHeader ?? env.botApiKeyHeader;
    this.timeoutMs = options.timeoutMs ?? env.botTimeoutMs;
    this.maxRetries = options.maxRetries ?? env.botMaxRetries;
    this.limiter = new RateLimiter(options.maxRps ?? env.botMaxRps);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** ประกอบ URL ของ endpoint — ไม่ใส่ API key ลงใน query string เด็ดขาด */
  buildUrl(descriptor: BotSeriesDescriptor, params: BotFetchParams): string {
    const path = descriptor.path.startsWith('/') ? descriptor.path : `/${descriptor.path}`;

    let url: URL;
    try {
      url = new URL(this.baseUrl + path);
    } catch {
      // "Invalid URL" เปล่า ๆ ไม่บอกว่าต้องไปแก้ตรงไหน จึงต้องระบุตัวแปรและค่าที่ผิดให้ชัด
      // (ค่านี้ไม่ใช่ความลับ — ความลับคือ API key ซึ่งไม่เคยอยู่ใน URL)
      throw new BotApiError(
        `ตั้งค่า BOT_API_BASE_URL ไม่ถูกต้อง: "${this.baseUrl}" — ` +
          `${validateBotBaseUrl(this.baseUrl) ?? 'ประกอบเป็น URL ไม่ได้'} ` +
          'ตัวอย่างที่ถูก: https://apigw1.bot.or.th/bot/public',
        'config',
      );
    }
    if (descriptor.supportsDateRange) {
      if (params.start) url.searchParams.set('start_period', params.start);
      if (params.end) url.searchParams.set('end_period', params.end);
    }
    if (descriptor.supportsCurrency && params.currency) {
      url.searchParams.set('currency', params.currency.toUpperCase());
    }
    return url.toString();
  }

  async fetchSeries(
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
  ): Promise<BotFetchResult> {
    if (!this.apiKey) {
      throw new BotApiError('BOT_API_KEY is not configured', 'auth');
    }

    const url = this.buildUrl(descriptor, params);
    let lastError: BotApiError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        // ถอยแบบทวีคูณพร้อมสุ่มเล็กน้อย กันการยิงพร้อมกันเป็นชุด
        await sleep(Math.min(4000, 2 ** attempt * 250) + Math.random() * 150);
      }
      try {
        const payload = await this.request(url);
        const { observations, lastUpdated } = normalizeSeries(descriptor, payload);
        return { observations, lastUpdated, unit: descriptor.unit };
      } catch (error) {
        const botError = toBotError(error);
        lastError = botError;
        if (!botError.retryable) break;
      }
    }

    throw lastError ?? new BotApiError('BOT request failed', 'network');
  }

  private async request(url: string): Promise<unknown> {
    await this.limiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          [this.apiKeyHeader]: this.apiKey,
          accept: 'application/json',
          'user-agent': 'sme-finance-copilot/1.0',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new BotApiError(
          `BOT rejected the API key (HTTP ${response.status})`,
          'auth',
          response.status,
        );
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          await sleep(Math.min(5000, retryAfter * 1000));
        }
        throw new BotApiError('BOT rate limit reached (HTTP 429)', 'rate_limit', 429);
      }
      if (response.status >= 500) {
        throw new BotApiError(`BOT server error (HTTP ${response.status})`, 'server', response.status);
      }
      if (!response.ok) {
        throw new BotApiError(`BOT returned HTTP ${response.status}`, 'response', response.status);
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new BotApiError('BOT returned a body that is not valid JSON', 'response');
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * แปลง error ใด ๆ ให้เป็น BotApiError และล้างค่า secret ออกจากข้อความ
 * (error ของ fetch บางกรณีแนบ URL หรือ header กลับมาด้วย)
 */
export function toBotError(error: unknown): BotApiError {
  if (error instanceof BotApiError) {
    return new BotApiError(redactSecrets(error.message), error.reason, error.status);
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted|timeout/i.test(error.message)) {
      return new BotApiError('BOT request timed out', 'timeout');
    }
    return new BotApiError(redactSecrets(`BOT request failed: ${error.message}`), 'network');
  }
  return new BotApiError('BOT request failed for an unknown reason', 'network');
}
