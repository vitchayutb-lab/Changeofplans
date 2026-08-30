/**
 * จุดเดียวในระบบที่อ่านค่า secret จาก environment
 *
 * กฎ R3: BOT_API_KEY ต้องไม่หลุดออกไปนอกฝั่งเซิร์ฟเวอร์
 * - ไฟล์นี้เป็นที่เดียวที่อ่าน process.env.BOT_API_KEY
 * - โมดูลอื่นเรียกผ่าน env.botApiKey เท่านั้น
 * - ห้าม export ค่า key ออกไปใน API response ใด ๆ (มีเทสต์ตรวจข้อนี้)
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// โหลด .env จาก root ของ monorepo ก่อน แล้วค่อยทับด้วย .env ในโฟลเดอร์ปัจจุบัน (ถ้ามี)
const repoRoot = resolve(process.cwd(), findRepoRootOffset());
for (const candidate of [resolve(repoRoot, '.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false });
}

function findRepoRootOffset(): string {
  // เมื่อรันจาก apps/server ให้ถอยขึ้นไปสองระดับ; เมื่อรันจาก root ให้อยู่ที่เดิม
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'packages'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

/**
 * อ่านค่าสตริงจาก environment
 *
 * ตัดช่องว่างและเครื่องหมายคำพูดที่ครอบอยู่ออกด้วย เพราะช่องกรอกตัวแปรของแพลตฟอร์ม
 * อย่าง Render หรือ Fly ไม่ได้ตัดให้เหมือน dotenv — ผู้ใช้ที่วาง "https://..." ทั้งก้อน
 * จะได้ค่าที่มีเครื่องหมายคำพูดติดมาจริง ๆ แล้วพังตอนประกอบ URL
 */
function str(key: string, fallback = ''): string {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const { value } = unwrap(raw);
  return value === '' ? fallback : value;
}

/** คู่อักขระที่ครอบค่ามาโดยไม่ได้ตั้งใจ — ไม่มีคีย์หรือ URL จริงที่ขึ้นต้นและลงท้ายแบบนี้ */
const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  // เอกสารรุ่นแรกของโปรเจกต์นี้เขียนตัวอย่างเป็น <Client ID ของคุณ> คนจึงวางวงเล็บติดมาด้วย
  // แล้วได้ 403 ที่อ่านไม่ออก เพราะคีย์ที่ส่งไปมี < > ปนอยู่
  ['<', '>'],
];

/** ตัดอักขระที่ครอบค่าออก และบอกด้วยว่าได้ตัดอะไรไปหรือเปล่า */
export function unwrap(raw: string): { value: string; trimmed: string | null } {
  let value = raw.trim();
  let trimmed: string | null = null;

  // วนซ้ำเพราะครอบซ้อนกันได้ เช่น "<key>" ที่มาจากการวางทับกันสองรอบ
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of WRAPPERS) {
      if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
        value = value.slice(1, -1).trim();
        trimmed = trimmed === null ? `${open}${close}` : `${trimmed} ${open}${close}`;
        changed = true;
      }
    }
  }
  return { value, trimmed };
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * เกตเวย์เดิมของ BOT ที่ปิดให้บริการไปแล้ว
 *
 * ธปท. ย้ายระบบ BOT API ไปพอร์ทัลใหม่เมื่อ 17 ก.ย. 2025 และปิดระบบเดิมวันที่ 31 ธ.ค. 2025
 * โฮสต์เหล่านี้จึงไม่มีอยู่ใน DNS อีกแล้ว การชี้ไปที่นี่จะได้ ENOTFOUND เสมอ
 */
export const RETIRED_BOT_HOSTS = ['apigw1.bot.or.th', 'apiportal.bot.or.th'];

export const BOT_PORTAL_URL = 'https://portal.api.bot.or.th/';

/**
 * เกตเวย์ปัจจุบันของ BOT API
 *
 * ตรวจกับการเรียกจริงแล้วว่า https://gateway.api.bot.or.th/LoanRate/v2/loan_rate/ ตอบ 200
 * พร้อม JSON ที่ถูกต้อง จึงใช้เป็นค่าเริ่มต้นได้ ต่างจาก portal.api.bot.or.th ซึ่งเป็น
 * เว็บพอร์ทัลสำหรับสมัครใช้งาน (ตอบกลับเป็นหน้า HTML ไม่ใช่ข้อมูล)
 */
export const BOT_GATEWAY_URL = 'https://gateway.api.bot.or.th';

/**
 * ที่อยู่ของ BOT API ต้องเป็น URL เต็มรูปแบบที่ขึ้นต้นด้วย http หรือ https
 * คืนข้อความอธิบายเมื่อไม่ถูกต้อง และคืน null เมื่อใช้ได้ (รวมถึงกรณีที่ยังไม่ได้ตั้งค่า)
 */
export function validateBotBaseUrl(value: string): string | null {
  // ยังไม่ได้ตั้งค่าไม่ใช่ "ค่าผิด" — เป็นสถานะที่ระบบรู้ว่ายังเรียกจริงไม่ได้ และบอกผู้ใช้แยกต่างหาก
  if (value.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value.startsWith('http')
      ? 'รูปแบบ URL ไม่ถูกต้อง'
      : 'ขาด https:// นำหน้า (ต้องเป็น URL เต็ม ไม่ใช่แค่ชื่อโฮสต์)';
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `ใช้โปรโตคอล "${parsed.protocol}" ซึ่งไม่รองรับ — ต้องเป็น https://`;
  }

  if (RETIRED_BOT_HOSTS.includes(parsed.hostname)) {
    return (
      `โฮสต์ "${parsed.hostname}" เป็นเกตเวย์เดิมที่ ธปท. ปิดให้บริการแล้วเมื่อ 31 ธ.ค. 2025 ` +
      `จึงหาไม่เจอใน DNS — ต้องใช้ที่อยู่ของระบบใหม่จาก ${BOT_PORTAL_URL}`
    );
  }

  // ผู้ใช้มักคัดลอก URL เต็มของ endpoint จากหน้าเอกสารมาวางเป็น base URL
  // ซึ่งจะทำให้ path ซ้ำสองชั้น เช่น /LoanRate/v2/loan_rate/LoanRate/v2/loan_rate/
  const endpointMarker = parsed.pathname.match(ENDPOINT_PATH_PATTERN);
  if (endpointMarker) {
    const trimmed = `${parsed.protocol}//${parsed.host}${parsed.pathname.slice(
      0,
      endpointMarker.index,
    )}`.replace(/\/+$/, '');
    return (
      `ค่านี้เป็น URL ของ endpoint ไม่ใช่ base URL — มี "${endpointMarker[0]}" ต่อท้ายอยู่ ` +
      `ถ้าใช้ทั้งก้อน path จะซ้ำสองชั้นและได้ 404 ให้ตัดส่วนของ endpoint ออก เหลือแค่ "${trimmed}"`
    );
  }

  return null;
}

/**
 * ชิ้นส่วน path ที่บ่งบอกว่าเป็น endpoint ของชุดข้อมูล ไม่ใช่ base URL
 * (สอดคล้องกับ path ที่ลงทะเบียนไว้ใน botSeries.ts แต่ไม่ import เข้ามาเพราะ
 * env.ts เป็นชั้นล่างสุดที่ไม่ควรผูกกับโมดูลอื่น)
 */
const ENDPOINT_PATH_PATTERN =
  /\/(PolicyRate|LoanRate|DepositRate|BIBOR|Stat-[A-Za-z]+)\/v\d/i;

export interface AppEnv {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  /** ที่อยู่ที่เซิร์ฟเวอร์ผูก — ต้องเป็น 0.0.0.0 เมื่อรันในคอนเทนเนอร์ */
  host: string;
  /**
   * origin ที่อนุญาตให้เรียกข้ามโดเมน
   * ค่าว่าง = ไม่เปิด CORS เลย (หน้าเว็บถูกเสิร์ฟจากโดเมนเดียวกันอยู่แล้วตอน production)
   */
  corsOrigin: string;
  /** จำนวนชั้นของ reverse proxy ที่อยู่หน้าเซิร์ฟเวอร์ (Render/Fly/Cloud Run = 1) */
  trustProxy: number;
  sqlitePath: string;
  /** โฟลเดอร์ของหน้าเว็บที่ build แล้ว (ตั้งเองได้เมื่อ layout ต่างจากที่ repo ใช้) */
  webDistPath: string;

  /** จำกัดจำนวนคำขอต่อ IP ในหนึ่งช่วงเวลา — จำเป็นเมื่อเปิดให้เข้าถึงสาธารณะ */
  rateLimitWindowMs: number;
  rateLimitMax: number;
  /** เพดานแยกสำหรับเส้นทางที่แพง (ที่ปรึกษา AI และการเรียกเครื่องมือ) */
  rateLimitExpensiveMax: number;

  /** ความลับ — ห้ามส่งออกนอกเซิร์ฟเวอร์ */
  botApiKey: string;
  /** อักขระที่ครอบ BOT_API_KEY มาและถูกตัดออก (null = ค่าสะอาดอยู่แล้ว) */
  botApiKeyWrapper: string | null;
  botApiBaseUrl: string;
  /** ข้อความอธิบายเมื่อ BOT_API_BASE_URL ตั้งค่าไว้ไม่ถูก (null = ใช้ได้) */
  botApiBaseUrlError: string | null;
  botApiKeyHeader: string;
  botTimeoutMs: number;
  botMaxRetries: number;
  botMaxRps: number;
  /** true = บังคับใช้ข้อมูลจำลองแม้จะมี API key (ใช้ตอนทดสอบ) */
  botForceDemo: boolean;

  /** ความลับ — ห้ามส่งออกนอกเซิร์ฟเวอร์ */
  anthropicApiKey: string;
  anthropicModel: string;
  advisorMaxSteps: number;

  version: string;
}

const nodeEnv = str('NODE_ENV', 'development');

export const env: AppEnv = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: num('PORT', 8787),
  host: str('HOST', '0.0.0.0'),
  // ตอนพัฒนา หน้าเว็บอยู่คนละพอร์ตจึงต้องเปิด CORS; ตอน production เสิร์ฟจากโดเมนเดียวกัน
  // จึงไม่ต้องเปิด เว้นแต่ผู้ใช้ตั้ง CORS_ORIGIN เอง
  corsOrigin: str('CORS_ORIGIN', nodeEnv === 'production' ? '' : 'http://localhost:5173'),
  trustProxy: num('TRUST_PROXY', nodeEnv === 'production' ? 1 : 0),
  sqlitePath: str('SQLITE_PATH', resolve(repoRoot, 'apps/server/data/app.db')),
  webDistPath: str('WEB_DIST_PATH'),

  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: num('RATE_LIMIT_MAX', 240),
  rateLimitExpensiveMax: num('RATE_LIMIT_EXPENSIVE_MAX', 20),

  botApiKey: str('BOT_API_KEY'),
  botApiKeyWrapper: unwrap(process.env.BOT_API_KEY ?? '').trimmed,
  botApiBaseUrl: str('BOT_API_BASE_URL', BOT_GATEWAY_URL),
  botApiBaseUrlError: validateBotBaseUrl(str('BOT_API_BASE_URL', BOT_GATEWAY_URL)),
  // เกตเวย์ใหม่ใช้ header ชื่อ Authorization โดยส่งโทเคนดิบ ไม่มีคำว่า Bearer นำหน้า
  // (ระบบเดิมที่ปิดไปแล้วใช้ X-IBM-Client-Id — ยังเปลี่ยนกลับได้ผ่านตัวแปรนี้)
  botApiKeyHeader: str('BOT_API_KEY_HEADER', 'Authorization'),
  botTimeoutMs: num('BOT_TIMEOUT_MS', 8000),
  botMaxRetries: num('BOT_MAX_RETRIES', 2),
  botMaxRps: num('BOT_MAX_RPS', 5),
  botForceDemo: bool('BOT_FORCE_DEMO', false),

  anthropicApiKey: str('ANTHROPIC_API_KEY'),
  anthropicModel: str('ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
  advisorMaxSteps: num('ADVISOR_MAX_STEPS', 8),

  version: str('APP_VERSION', '1.0.0'),
};

/** มี API key ของ BOT ตั้งไว้หรือไม่ (ใช้ตอบ /api/health โดยไม่เปิดเผยค่า) */
export function hasBotApiKey(): boolean {
  return env.botApiKey.trim().length > 0 && !env.botForceDemo;
}

/**
 * ตั้งค่าครบพอที่จะเรียก BOT API จริงได้หรือยัง
 * ต้องมีทั้ง API key และที่อยู่ของเกตเวย์ที่ใช้งานได้
 */
export function botLiveConfigured(): boolean {
  return hasBotApiKey() && env.botApiBaseUrl.trim() !== '' && env.botApiBaseUrlError === null;
}

/** อธิบายว่ายังขาดอะไรถึงจะเรียกข้อมูลจริงได้ (null = ครบแล้ว) */
export function botConfigGap(): string | null {
  if (env.botForceDemo) return 'ถูกบังคับให้ใช้ข้อมูลจำลองด้วย BOT_FORCE_DEMO';
  if (env.botApiKey.trim() === '') return 'ยังไม่ได้ตั้ง BOT_API_KEY';
  // ปกติจะถอยไปใช้ค่าเริ่มต้นเสมอ จะว่างได้ก็ต่อเมื่อโค้ดที่เรียกใช้ล้างค่าทิ้งเอง
  if (env.botApiBaseUrl.trim() === '') {
    return (
      `BOT_API_BASE_URL ถูกตั้งเป็นค่าว่าง — ปล่อยว่างไว้เพื่อใช้ ${BOT_GATEWAY_URL} ` +
      `หรือดูที่อยู่เกตเวย์ของคุณได้จากเอกสาร API ในพอร์ทัลที่ ${BOT_PORTAL_URL}`
    );
  }
  return env.botApiBaseUrlError;
}

export function hasAnthropicKey(): boolean {
  return env.anthropicApiKey.trim().length > 0;
}

/**
 * ลบค่า secret ออกจากข้อความก่อนบันทึก log หรือส่งกลับให้ผู้ใช้
 * ป้องกันกรณี error object ของ fetch แนบ header หรือ URL ที่มี key ติดมาด้วย
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of [env.botApiKey, env.anthropicApiKey]) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join('***redacted***');
    }
  }
  return out;
}
