/**
 * เทสต์การอ่านและตรวจค่าตั้งค่า
 *
 * เหตุที่ต้องมี: ผู้ใช้ที่ตั้ง BOT_API_BASE_URL ผิดเคยได้ข้อความว่า "Invalid URL" เฉย ๆ
 * ซึ่งไม่บอกว่าต้องไปแก้ตรงไหน อาการที่เห็นคือเว็บแสดงข้อมูลจำลองทั้งที่ใส่ API key แล้ว
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateBotBaseUrl } from '../src/config/env.js';
import { LiveBotClient } from '../src/services/bot/botClient.js';
import { BOT_SERIES } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';

/** โหลดโมดูล env ใหม่เพื่อให้อ่านค่าที่เพิ่ง stub ไว้ */
async function loadEnv(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import('../src/config/env.js')).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('การอ่านค่าจาก environment', () => {
  it('ตัดเครื่องหมายคำพูดที่ครอบค่าออก', async () => {
    // ช่องกรอกของ Render/Fly ไม่ตัดให้เหมือน dotenv — ผู้ใช้ที่วางทั้งก้อนพร้อมคำพูดจะพัง
    const env = await loadEnv({ BOT_API_BASE_URL: '"https://apigw1.bot.or.th/bot/public"' });
    expect(env.botApiBaseUrl).toBe('https://apigw1.bot.or.th/bot/public');
    expect(env.botApiBaseUrlError).toBeNull();
  });

  it('ตัดช่องว่างหัวท้ายของ API key ออก', async () => {
    const env = await loadEnv({ BOT_API_KEY: '  abc123def456  ' });
    expect(env.botApiKey).toBe('abc123def456');
  });

  it('ใช้ค่าเริ่มต้นเมื่อตั้งเป็นค่าว่าง', async () => {
    const env = await loadEnv({ BOT_API_BASE_URL: '   ' });
    expect(env.botApiBaseUrl).toBe('https://apigw1.bot.or.th/bot/public');
    expect(env.botApiBaseUrlError).toBeNull();
  });

  it('รายงานข้อผิดพลาดเมื่อ base URL ผิดรูปแบบ', async () => {
    const env = await loadEnv({ BOT_API_BASE_URL: 'apigw1.bot.or.th/bot/public' });
    expect(env.botApiBaseUrlError).toContain('https://');
  });
});

describe('โหมดของแหล่งข้อมูลเมื่อตั้งค่าผิด', () => {
  it('รายงานว่าขัดข้องทันที ไม่ต้องรอให้เรียกพลาดก่อน', async () => {
    vi.stubEnv('BOT_API_KEY', 'key-that-looks-real-123456');
    vi.stubEnv('BOT_API_BASE_URL', 'apigw1.bot.or.th/bot/public');
    vi.resetModules();

    const { BotService } = await import('../src/services/bot/botService.js');
    expect(new BotService({ liveEnabled: true }).mode()).toBe('degraded');
  });

  it('ตั้งค่าถูกต้องยังรายงานว่าใช้งานได้', async () => {
    vi.stubEnv('BOT_API_KEY', 'key-that-looks-real-123456');
    vi.stubEnv('BOT_API_BASE_URL', 'https://apigw1.bot.or.th/bot/public');
    vi.resetModules();

    const { BotService } = await import('../src/services/bot/botService.js');
    expect(new BotService({ liveEnabled: true }).mode()).toBe('live');
  });
});

describe('validateBotBaseUrl', () => {
  it('ยอมรับ URL ที่ถูกต้อง', () => {
    expect(validateBotBaseUrl('https://apigw1.bot.or.th/bot/public')).toBeNull();
    expect(validateBotBaseUrl('http://localhost:9000/bot/public')).toBeNull();
  });

  it('บอกได้ว่าขาด https:// นำหน้า', () => {
    expect(validateBotBaseUrl('apigw1.bot.or.th/bot/public')).toContain('https://');
    expect(validateBotBaseUrl('apigw1.bot.or.th')).toContain('https://');
  });

  it('จับกรณีที่เผลอวางค่าอื่นลงในช่องนี้', () => {
    // เช่น วาง API key ลงช่อง BASE_URL โดยไม่ตั้งใจ
    expect(validateBotBaseUrl('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).not.toBeNull();
  });

  it('ปฏิเสธค่าว่าง', () => {
    expect(validateBotBaseUrl('')).toBe('ค่าว่าง');
    expect(validateBotBaseUrl('   ')).toBe('ค่าว่าง');
  });

  it('ปฏิเสธโปรโตคอลที่ไม่รองรับ', () => {
    expect(validateBotBaseUrl('ftp://apigw1.bot.or.th')).toContain('ftp:');
  });
});

describe('LiveBotClient.buildUrl เมื่อตั้งค่า base URL ผิด', () => {
  function clientWith(baseUrl: string): LiveBotClient {
    return new LiveBotClient({ baseUrl, apiKey: 'x'.repeat(20) });
  }

  it('บอกชื่อตัวแปรที่ต้องแก้ ไม่ใช่แค่ "Invalid URL"', () => {
    try {
      clientWith('apigw1.bot.or.th/bot/public').buildUrl(BOT_SERIES.policy_rate, {});
      expect.unreachable('ควรโยนข้อผิดพลาด');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('BOT_API_BASE_URL');
      expect(message).toContain('https://apigw1.bot.or.th/bot/public');
      expect(message).not.toBe('Invalid URL');
    }
  });

  it('จัดเป็นข้อผิดพลาดด้านการตั้งค่า จึงไม่ลองใหม่ให้เสียเวลา', () => {
    try {
      clientWith('ไม่ใช่ url').buildUrl(BOT_SERIES.policy_rate, {});
      expect.unreachable('ควรโยนข้อผิดพลาด');
    } catch (error) {
      expect(error).toBeInstanceOf(BotApiError);
      expect((error as BotApiError).reason).toBe('config');
      expect((error as BotApiError).retryable).toBe(false);
    }
  });

  it('ไม่เปิดเผย API key ในข้อความ (URL ไม่เคยมีคีย์อยู่แล้ว)', () => {
    try {
      clientWith('apigw1.bot.or.th').buildUrl(BOT_SERIES.policy_rate, {});
      expect.unreachable('ควรโยนข้อผิดพลาด');
    } catch (error) {
      expect((error as Error).message).not.toContain('xxxx');
    }
  });

  it('base URL ที่ถูกต้องยังทำงานตามเดิม', () => {
    const url = clientWith('https://apigw1.bot.or.th/bot/public').buildUrl(
      BOT_SERIES.policy_rate,
      { start: '2026-06-01', end: '2026-08-30' },
    );
    expect(url).toBe(
      'https://apigw1.bot.or.th/bot/public/PolicyRate/v3/policy_rate' +
        '?start_period=2026-06-01&end_period=2026-08-30',
    );
  });

  it('รับ base URL ที่มีเครื่องหมายทับต่อท้ายได้', () => {
    const url = clientWith('https://apigw1.bot.or.th/bot/public///').buildUrl(
      BOT_SERIES.policy_rate,
      {},
    );
    expect(url).toContain('/bot/public/PolicyRate/v3/policy_rate');
  });
});
