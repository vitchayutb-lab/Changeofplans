/**
 * ตัวเชื่อมต่อ Bank of Thailand API ของจริง
 *
 * เป็นไฟล์เดียวในระบบที่ยิง HTTP ไปหา BOT และเป็นไฟล์เดียวที่แตะ env.botApiKey
 * ความรับผิดชอบ: authentication, timeout, retry, rate limit, ตรวจรูปแบบผลลัพธ์,
 * แปลงข้อมูล และ "ล้าง" ค่า secret ออกจากข้อความ error ก่อนส่งต่อ
 */

import {
  BOT_GATEWAY_URL,
  BOT_PORTAL_URL,
  env,
  redactSecrets,
  RETIRED_BOT_HOSTS,
  validateBotBaseUrl,
} from '../../config/env.js';
import { extractDetail, normalizeSeries } from './botNormalize.js';
import { BotApiError } from './botTypes.js';
import type { BotObservation } from '@sme/shared';
import type {
  BotApiClient,
  BotFetchParams,
  BotFetchResult,
  BotSeriesDescriptor,
} from './botTypes.js';

/**
 * ชื่อชุดย่อยที่ปรากฏในผลลัพธ์ ตามลำดับที่ ธปท. ส่งมา
 *
 * เมื่อ ธปท. ตอบสารบัญกลับมา นี่คือรายชื่อที่จะเอาไปถามต่อทีละชุด
 * อ่านจากผลลัพธ์จริงจึงไม่ต้องเดาชื่อ และไม่ค้างเมื่อ ธปท. เปลี่ยนรายการ
 */
function readSliceNames(descriptor: BotSeriesDescriptor, payload: unknown): string[] {
  if (!descriptor.dimensionParam) return [];
  const key = descriptor.dimensionParam.from.toLowerCase();
  const seen = new Set<string>();
  for (const row of extractDetail(payload)) {
    for (const [name, value] of Object.entries(row)) {
      if (name.toLowerCase() !== key) continue;
      const text = typeof value === 'string' ? value.trim() : '';
      if (text !== '') seen.add(text);
    }
  }
  return [...seen];
}

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
          `ตัวอย่างที่ถูก: ${BOT_GATEWAY_URL}`,
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
    if (descriptor.dimensionParam && params.dimensionValue) {
      url.searchParams.set(descriptor.dimensionParam.name, params.dimensionValue);
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
    if (this.baseUrl.trim() === '') {
      throw new BotApiError(
        'ยังไม่ได้ตั้ง BOT_API_BASE_URL — ' +
          `ดูที่อยู่ของเกตเวย์ได้จากเอกสาร API ในพอร์ทัลของคุณที่ ${BOT_PORTAL_URL}`,
        'config',
      );
    }

    const first = await this.fetchOnce(descriptor, params);

    // ชุดที่ต้องบอกชื่อชุดย่อย: คำขอแรกได้สารบัญมา ไม่ใช่ข้อมูล จึงต้องถามต่อทีละชุด
    if (descriptor.dimensionParam && first.observations.length === 0 && first.rowCount > 0) {
      const slices = first.sliceNames.slice(0, descriptor.dimensionParam.maxValues);
      if (slices.length > 0) return this.fetchSlices(descriptor, params, slices);
    }

    return {
      observations: first.observations,
      lastUpdated: first.lastUpdated,
      rowCount: first.rowCount,
      unit: descriptor.unit,
    };
  }

  /**
   * ถามทีละชุดย่อยแล้วรวมผล
   *
   * ชุดใดพังถือว่าพังทั้งหมด กราฟที่ขาดไปหนึ่งเส้นโดยไม่บอกอะไรเลย
   * แย่กว่ากราฟที่ไม่ขึ้นพร้อมเหตุผล
   */
  private async fetchSlices(
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
    slices: string[],
  ): Promise<BotFetchResult> {
    const observations: BotObservation[] = [];
    let lastUpdated: string | null = null;
    let rowCount = 0;

    for (const slice of slices) {
      const result = await this.fetchOnce(descriptor, { ...params, dimensionValue: slice });
      observations.push(...result.observations);
      rowCount += result.rowCount;
      lastUpdated ??= result.lastUpdated;
    }

    return { observations, lastUpdated, rowCount, unit: descriptor.unit };
  }

  /** หนึ่งคำขอพร้อมการลองใหม่ — คืนชื่อชุดย่อยที่เห็นในผลลัพธ์มาด้วย */
  private async fetchOnce(
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
  ): Promise<{
    observations: BotObservation[];
    lastUpdated: string | null;
    rowCount: number;
    sliceNames: string[];
  }> {
    const url = this.buildUrl(descriptor, params);
    let lastError: BotApiError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        // ถอยแบบทวีคูณพร้อมสุ่มเล็กน้อย กันการยิงพร้อมกันเป็นชุด
        await sleep(Math.min(4000, 2 ** attempt * 250) + Math.random() * 150);
      }
      try {
        const payload = await this.request(url);
        const { observations, lastUpdated, rowCount } = normalizeSeries(descriptor, payload);
        return {
          observations,
          lastUpdated,
          rowCount,
          sliceNames: readSliceNames(descriptor, payload),
        };
      } catch (error) {
        const botError = toBotError(error);
        lastError = botError;
        if (!botError.retryable) break;
      }
    }

    throw withSeriesContext(
      lastError ?? new BotApiError('BOT request failed', 'network'),
      descriptor,
    );
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

      // อ่าน body ครั้งเดียวแล้วใช้ได้ทั้งเส้นทางสำเร็จและเส้นทางผิดพลาด
      // ข้อความที่ ธปท. ส่งมาในตัว body คือสิ่งที่บอกสาเหตุได้ดีที่สุด ทิ้งไปไม่ได้
      const text = await response.text();

      if (response.status === 401 || response.status === 403) {
        throw new BotApiError(
          `ธปท. ปฏิเสธคำขอ (HTTP ${response.status})${upstreamDetail(text)}` +
            ' — ตรวจว่าคีย์ถูกต้อง ไม่มีอักขระเกินติดมา (เช่น < > หรือเครื่องหมายคำพูด)' +
            ' และบัญชีของคุณ subscribe ชุดข้อมูลนี้ไว้แล้วในพอร์ทัล',
          'auth',
          response.status,
        );
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          await sleep(Math.min(5000, retryAfter * 1000));
        }
        throw new BotApiError(
          `BOT rate limit reached (HTTP 429)${upstreamDetail(text)}`,
          'rate_limit',
          429,
        );
      }
      if (response.status >= 500) {
        throw new BotApiError(
          `BOT server error (HTTP ${response.status})${upstreamDetail(text)}`,
          'server',
          response.status,
        );
      }
      if (!response.ok) {
        // 400 มักแปลว่า path หรือพารามิเตอร์ไม่ตรงกับที่ ธปท. รับ และ ธปท. มักตอบแค่
        // "Bad Request" เฉย ๆ คำขอที่ส่งไปจึงเป็นข้อมูลชิ้นเดียวที่ใช้หาสาเหตุได้
        // (URL ไม่มีความลับ — คีย์เดินทางใน header เสมอ)
        throw new BotApiError(
          `BOT returned HTTP ${response.status}${upstreamDetail(text)} — URL ที่เรียก: ${url}`,
          'response',
          response.status,
        );
      }

      try {
        return JSON.parse(text) as unknown;
      } catch {
        // ตอบ 200 แต่ไม่ใช่ JSON แปลว่าต่อถึงเซิร์ฟเวอร์แล้ว แต่ไม่ใช่ endpoint ของ API
        // ต้องบอกว่าได้อะไรกลับมา ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าชี้ผิดที่ตรงไหน
        throw new BotApiError(describeNonJson(url, response.headers.get('content-type'), text), 'response');
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
/**
 * ดึงข้อความอธิบายจาก body ของคำตอบที่เป็นข้อผิดพลาด
 *
 * เกตเวย์ของ ธปท. ส่งเหตุผลจริงมาใน body เช่น {"error":"Access to this API has been
 * disallowed"} ซึ่งแยกแยะได้ว่า "คีย์ผิด" หรือ "คีย์ถูกแต่ยังไม่ได้ subscribe ชุดนี้"
 * ต่างจากสถานะ 403 เปล่า ๆ ที่บอกไม่ได้
 */
/**
 * เติมชื่อชุดข้อมูลและ path ลงในข้อผิดพลาด
 *
 * ธปท. ให้ subscribe แยกทีละชุด คีย์ใบเดียวจึงเรียกบางชุดได้และโดน 403 กับชุดอื่น
 * หน้าเว็บโหลดหลายชุดพร้อมกัน ถ้าไม่บอกว่าเป็นชุดไหนก็ไม่รู้ว่าต้องไป subscribe อะไรเพิ่ม
 */
export function withSeriesContext(
  error: BotApiError,
  descriptor: BotSeriesDescriptor,
): BotApiError {
  // บางข้อความมี URL ที่เรียกอยู่แล้ว (เช่นกรณีตอบไม่ใช่ JSON) ไม่ต้องบอกซ้ำ
  if (error.message.includes(descriptor.path)) return error;

  // 401/403 คือปัญหาสิทธิ์ของชุดนั้นโดยเฉพาะ จึงบอกชื่อที่ใช้ค้นในแค็ตตาล็อกให้ด้วย
  const catalogue =
    error.reason === 'auth' ? ` ชื่อชุดข้อมูลนี้ในแค็ตตาล็อกคือ "${descriptor.title}"` : '';

  return new BotApiError(
    `[${descriptor.titleTh} · ${descriptor.path}] ${error.message}${catalogue}`,
    error.reason,
    error.status,
  );
}

export function upstreamDetail(body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') return '';

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['error', 'message', 'moreInformation', 'httpMessage', 'description']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return `: ${value.trim().slice(0, 200)}`;
      }
    }
  } catch {
    // ไม่ใช่ JSON — ยกข้อความดิบมาแบบสั้น ๆ
  }

  return `: ${trimmed.replace(/\s+/g, ' ').slice(0, 200)}`;
}

/**
 * อธิบายว่าปลายทางตอบอะไรกลับมาเมื่อไม่ใช่ JSON
 *
 * กรณีที่พบบ่อยที่สุดคือ BOT_API_BASE_URL ชี้ไปที่ "เว็บพอร์ทัล" แทนที่จะเป็น
 * "เกตเวย์ของ API" ซึ่งจะตอบหน้า HTML กลับมาพร้อมสถานะ 200 ทำให้ดูเหมือนเรียกสำเร็จ
 */
export function describeNonJson(
  url: string,
  contentType: string | null,
  body: string,
): string {
  // ตัดช่องว่างซ้อนออกและจำกัดความยาว เพื่อให้ข้อความยังอ่านได้ในแบนเนอร์
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 160);
  const looksHtml = /^\s*<(!doctype|html|\?xml)/i.test(body) || /text\/html/i.test(contentType ?? '');

  const parts = [
    'ปลายทางตอบกลับมาแต่ไม่ใช่ JSON',
    `(content-type: ${contentType ?? 'ไม่ระบุ'})`,
  ];

  if (looksHtml) {
    parts.push(
      '— ได้หน้าเว็บ (HTML) กลับมา ซึ่งแปลว่า BOT_API_BASE_URL ชี้ไปที่หน้าเว็บพอร์ทัล ' +
        'ไม่ใช่ที่อยู่ของเกตเวย์ API ให้ดู base URL ที่ระบุไว้ในเอกสาร API ของชุดข้อมูลที่คุณ subscribe',
    );
    if (/login|sign\s*in|เข้าสู่ระบบ/i.test(snippet)) {
      parts.push('(หน้าที่ได้มาดูเหมือนหน้าเข้าสู่ระบบ)');
    }
  } else {
    parts.push('— ตรวจว่า base URL และ path ตรงกับเอกสารของพอร์ทัลหรือไม่');
  }

  parts.push(`URL ที่เรียก: ${url}`);
  if (snippet) parts.push(`สิ่งที่ได้กลับมา: ${snippet}${body.length > 160 ? '…' : ''}`);

  return parts.join(' ');
}

/**
 * คำอธิบายภาษาคนของรหัสข้อผิดพลาดระดับเครือข่าย
 * fetch ของ Node คืนแค่ "fetch failed" ซึ่งไม่ช่วยอะไรเลย สาเหตุจริงอยู่ใน error.cause
 */
const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: 'หาที่อยู่เซิร์ฟเวอร์ไม่เจอ (DNS) — ตรวจว่าชื่อโฮสต์ใน BOT_API_BASE_URL ถูกต้องและยังเปิดให้บริการอยู่',
  EAI_AGAIN: 'ค้นหา DNS ไม่สำเร็จชั่วคราว — ลองใหม่อีกครั้ง หรือตรวจการตั้งค่า DNS ของเครื่องที่รัน',
  ECONNREFUSED: 'เซิร์ฟเวอร์ปฏิเสธการเชื่อมต่อ — ตรวจพอร์ตและว่าปลายทางเปิดให้เข้าถึงจากที่นี่หรือไม่',
  ECONNRESET: 'การเชื่อมต่อถูกตัดกลางคัน — อาจติดไฟร์วอลล์หรือพร็อกซีระหว่างทาง',
  ETIMEDOUT: 'เชื่อมต่อไม่ทันเวลา — ปลายทางอาจไม่เปิดให้เข้าถึงจากเครือข่ายนี้',
  UND_ERR_CONNECT_TIMEOUT: 'เชื่อมต่อไม่ทันเวลา — ปลายทางอาจไม่เปิดให้เข้าถึงจากเครือข่ายนี้',
  CERT_HAS_EXPIRED: 'ใบรับรอง TLS ของปลายทางหมดอายุ',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'ตรวจสอบใบรับรอง TLS ไม่ผ่าน — อาจมีพร็อกซีคั่นกลาง',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'ปลายทางใช้ใบรับรองที่เซ็นเอง',
};

/** ไล่หาสาเหตุที่ซ้อนอยู่ชั้นในสุดของ error */
function rootCause(error: Error): { code: string | null; message: string } {
  let current: unknown = error;
  let depth = 0;
  let code: string | null = null;
  let message = error.message;

  while (current instanceof Error && depth < 5) {
    const candidate = (current as Error & { code?: string }).code;
    if (typeof candidate === 'string') code = candidate;
    if (current.message && current.message !== 'fetch failed') message = current.message;
    current = (current as Error & { cause?: unknown }).cause;
    depth += 1;
  }

  return { code, message };
}

export function toBotError(error: unknown): BotApiError {
  if (error instanceof BotApiError) {
    return new BotApiError(redactSecrets(error.message), error.reason, error.status);
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted|timeout/i.test(error.message)) {
      return new BotApiError('BOT request timed out', 'timeout');
    }

    const { code, message } = rootCause(error);
    const hint = code ? NETWORK_HINTS[code] : undefined;

    // ชี้ให้ตรงจุดเมื่อผู้ใช้ยังชี้ไปที่เกตเวย์เดิมที่ถูกปิดไปแล้ว
    let retiredNote = '';
    if (code === 'ENOTFOUND') {
      const host = RETIRED_BOT_HOSTS.find((candidate) => message.includes(candidate));
      if (host) {
        retiredNote =
          ` — "${host}" เป็นเกตเวย์เดิมที่ ธปท. ปิดให้บริการแล้วเมื่อ 31 ธ.ค. 2025 ` +
          `ต้องใช้ที่อยู่ของระบบใหม่จาก ${BOT_PORTAL_URL}`;
      }
    }

    const detail = [code ? `${code}: ${message}` : message, hint].filter(Boolean).join(' — ');
    return new BotApiError(
      redactSecrets(`เรียก BOT API ไม่สำเร็จ (${detail}${retiredNote})`),
      'network',
    );
  }

  return new BotApiError('BOT request failed for an unknown reason', 'network');
}
