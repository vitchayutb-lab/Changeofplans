/**
 * เทสต์การอ่านและตรวจค่าตั้งค่า
 *
 * เหตุที่ต้องมี: ผู้ใช้ที่ตั้ง BOT_API_BASE_URL ผิดเคยได้ข้อความว่า "Invalid URL" เฉย ๆ
 * ซึ่งไม่บอกว่าต้องไปแก้ตรงไหน อาการที่เห็นคือเว็บแสดงข้อมูลจำลองทั้งที่ใส่ API key แล้ว
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_GATEWAY_URL, RETIRED_BOT_HOSTS, validateBotBaseUrl } from '../src/config/env.js';
import { LiveBotClient } from '../src/services/bot/botClient.js';
import { BOT_SERIES } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';

/** โฮสต์กลาง ๆ สำหรับทดสอบ — ไม่ใช่เกตเวย์ของ ธปท. ที่ถูกปิดไปแล้ว */
const NEUTRAL = 'https://gateway.example.test/bot/public';

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
    const env = await loadEnv({ BOT_API_BASE_URL: `"${NEUTRAL}"` });
    expect(env.botApiBaseUrl).toBe(NEUTRAL);
    expect(env.botApiBaseUrlError).toBeNull();
  });

  it('ตัดช่องว่างหัวท้ายของ API key ออก', async () => {
    const env = await loadEnv({ BOT_API_KEY: '  abc123def456  ' });
    expect(env.botApiKey).toBe('abc123def456');
  });

  it('ถอยไปใช้เกตเวย์ที่ตรวจแล้วว่าใช้ได้ เมื่อไม่ได้ตั้งที่อยู่เอง', async () => {
    // ตรวจกับการเรียกจริงแล้วว่าโฮสต์นี้ตอบ 200 พร้อม JSON ที่ถูกต้อง
    // (ระบบเดิม apigw1.bot.or.th ถูกปิดไปเมื่อ 31 ธ.ค. 2025)
    const env = await loadEnv({ BOT_API_BASE_URL: '   ' });
    expect(env.botApiBaseUrl).toBe('https://gateway.api.bot.or.th');
    expect(env.botApiBaseUrlError).toBeNull();
  });

  it('บอกได้ว่ายังขาดอะไรถึงจะเรียกข้อมูลจริงได้', async () => {
    vi.stubEnv('BOT_API_KEY', '');
    vi.stubEnv('BOT_API_BASE_URL', '');
    vi.resetModules();
    let mod = await import('../src/config/env.js');
    expect(mod.botConfigGap()).toContain('BOT_API_KEY');
    expect(mod.botLiveConfigured()).toBe(false);

    // มีแค่ API key ก็พอ เพราะที่อยู่เกตเวย์มีค่าเริ่มต้นที่ใช้งานได้อยู่แล้ว
    vi.stubEnv('BOT_API_KEY', 'key-that-looks-real-123456');
    vi.resetModules();
    mod = await import('../src/config/env.js');
    expect(mod.botConfigGap()).toBeNull();
    expect(mod.botLiveConfigured()).toBe(true);

    // แต่ถ้าตั้งที่อยู่เองแล้วตั้งผิด ต้องบอกว่าผิดตรงไหน ไม่ใช่เงียบแล้วใช้ข้อมูลจำลอง
    vi.stubEnv('BOT_API_BASE_URL', 'apigw1.bot.or.th/bot/public');
    vi.resetModules();
    mod = await import('../src/config/env.js');
    expect(mod.botConfigGap()).toContain('https://');
    expect(mod.botLiveConfigured()).toBe(false);

    vi.stubEnv('BOT_API_BASE_URL', NEUTRAL);
    vi.resetModules();
    mod = await import('../src/config/env.js');
    expect(mod.botConfigGap()).toBeNull();
    expect(mod.botLiveConfigured()).toBe(true);
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
    vi.stubEnv('BOT_API_BASE_URL', NEUTRAL);
    vi.resetModules();

    const { BotService } = await import('../src/services/bot/botService.js');
    expect(new BotService({ liveEnabled: true }).mode()).toBe('live');
  });
});

describe('validateBotBaseUrl', () => {
  it('ยอมรับ URL ที่ถูกต้อง', () => {
    expect(validateBotBaseUrl(NEUTRAL)).toBeNull();
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

  it('ค่าว่างไม่ถือว่าผิด — เป็นสถานะ "ยังไม่ได้ตั้ง" ซึ่งรายงานแยกต่างหาก', () => {
    expect(validateBotBaseUrl('')).toBeNull();
    expect(validateBotBaseUrl('   ')).toBeNull();
  });

  it('ยอมรับที่อยู่เกตเวย์ที่ไม่มี path ต่อท้าย', () => {
    expect(validateBotBaseUrl('https://gateway.api.bot.or.th')).toBeNull();
    expect(validateBotBaseUrl('https://gateway.api.bot.or.th/')).toBeNull();
  });

  it('จับกรณีคัดลอก URL เต็มของ endpoint มาวางเป็น base URL', () => {
    // ผู้ใช้มักคัดลอกทั้งก้อนจากหน้าเอกสาร ซึ่งจะทำให้ path ซ้ำสองชั้นและได้ 404
    for (const endpoint of [
      'https://gateway.api.bot.or.th/LoanRate/v2/loan_rate/',
      'https://gateway.api.bot.or.th/PolicyRate/v3/policy_rate',
      'https://gateway.api.bot.or.th/DepositRate/v2/deposit_rate/',
      'https://gateway.api.bot.or.th/BIBOR/v2/bibor/',
      'https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/',
    ]) {
      const message = validateBotBaseUrl(endpoint);
      expect(message).toContain('endpoint');
      // ต้องบอกค่าที่ถูกต้องให้ด้วย ไม่ใช่แค่บอกว่าผิด
      expect(message).toContain('https://gateway.api.bot.or.th');
    }
  });

  it('บอกได้ว่าชี้ไปยังเกตเวย์เดิมที่ ธปท. ปิดไปแล้ว', () => {
    // สาเหตุจริงของอาการ "fetch failed" ที่ผู้ใช้เจอ — โฮสต์นี้ไม่มีใน DNS อีกแล้ว
    for (const host of RETIRED_BOT_HOSTS) {
      const message = validateBotBaseUrl(`https://${host}/bot/public`);
      expect(message).toContain('ปิดให้บริการ');
      expect(message).toContain('portal.api.bot.or.th');
    }
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
      // ตัวอย่างที่แนะนำต้องเป็นเกตเวย์ที่ยังเปิดอยู่ ไม่ใช่โฮสต์เดิมที่ ธปท. ปิดไปแล้ว
      expect(message).toContain(BOT_GATEWAY_URL);
      for (const retired of RETIRED_BOT_HOSTS) expect(message).not.toContain(`: https://${retired}`);
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
    const url = clientWith(NEUTRAL).buildUrl(BOT_SERIES.policy_rate, {
      start: '2026-06-01',
      end: '2026-08-30',
    });
    expect(url).toBe(
      `${NEUTRAL}/PolicyRate/v3/policy_rate?start_period=2026-06-01&end_period=2026-08-30`,
    );
  });

  it('รับ base URL ที่มีเครื่องหมายทับต่อท้ายได้', () => {
    const url = clientWith(`${NEUTRAL}///`).buildUrl(BOT_SERIES.policy_rate, {});
    expect(url).toContain('/bot/public/PolicyRate/v3/policy_rate');
  });

  it('ยังไม่ได้ตั้งที่อยู่เกตเวย์ → บอกให้ไปเอาจากพอร์ทัล ไม่ใช่ฟ้องว่าเน็ตมีปัญหา', async () => {
    const client = clientWith('');
    await expect(client.fetchSeries(BOT_SERIES.policy_rate, {})).rejects.toMatchObject({
      reason: 'config',
    });
    await expect(client.fetchSeries(BOT_SERIES.policy_rate, {})).rejects.toThrow(
      /BOT_API_BASE_URL/,
    );
  });
});
