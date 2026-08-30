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

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
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
  botApiBaseUrl: string;
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
  botApiBaseUrl: str('BOT_API_BASE_URL', 'https://apigw1.bot.or.th/bot/public'),
  botApiKeyHeader: str('BOT_API_KEY_HEADER', 'X-IBM-Client-Id'),
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
