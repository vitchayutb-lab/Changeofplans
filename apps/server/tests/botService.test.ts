/** เทสต์ชั้นบริการ BOT: แคช การถอยไปข้อมูลเก่า และการถอยไปข้อมูลจำลอง */

import { beforeEach, describe, expect, it } from 'vitest';
import type { BotObservation } from '@sme/shared';
import { BotService, buildCacheKey, metricFromSeries } from '../src/services/bot/botService.js';
import { MockBotClient, policyRateAt } from '../src/services/bot/botMockClient.js';
import { BOT_SERIES } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';
import type { BotApiClient, BotFetchResult } from '../src/services/bot/botTypes.js';
import { freshDb } from './helpers.js';
import * as botRepo from '../src/db/botRepo.js';

/** client จำลองที่ควบคุมได้ว่าจะสำเร็จหรือพัง */
class StubClient implements BotApiClient {
  readonly kind = 'live' as const;
  calls = 0;
  constructor(
    private readonly behaviour: () => BotFetchResult | never,
  ) {}
  async fetchSeries(): Promise<BotFetchResult> {
    this.calls += 1;
    return this.behaviour();
  }
}

function observations(value: number): BotObservation[] {
  return [
    { period: '2026-08-20', dimension: 'default', value: value - 0.25 },
    { period: '2026-08-27', dimension: 'default', value },
  ];
}

function okResult(value: number): BotFetchResult {
  return { observations: observations(value), lastUpdated: '2026-08-27T07:00:00.000Z', unit: 'percent_per_annum' };
}

beforeEach(() => {
  freshDb();
});

describe('buildCacheKey', () => {
  it('เรียงพารามิเตอร์ให้คงที่ เพื่อให้คำขอเดียวกันได้คีย์เดียวกันเสมอ', () => {
    expect(buildCacheKey('fx_average', { end: '2026-08-29', currency: 'USD', start: '2026-06-01' })).toBe(
      'fx_average|currency=USD&end=2026-08-29&start=2026-06-01',
    );
  });

  it('ตัดค่าที่ว่างทิ้ง', () => {
    expect(buildCacheKey('policy_rate', { start: undefined, end: '' })).toBe('policy_rate|');
  });
});

describe('BotService — โหมดข้อมูลจำลอง', () => {
  it('คืนข้อมูลจำลองพร้อมติดป้าย source = demo เมื่อไม่มี API key', async () => {
    const service = new BotService({ forceDemo: true });
    const series = await service.getSeries('policy_rate');

    expect(series.provenance.source).toBe('demo');
    expect(series.provenance.sourceLabel).toBe('Demo Data');
    expect(series.provenance.notice).toMatch(/DEMO MODE/);
    expect(series.observations.length).toBeGreaterThan(0);
    expect(service.mode()).toBe('demo');
  });

  it('บันทึกจุดข้อมูลลงคลังอนุกรมเวลาเพื่อให้กราฟย้อนหลังใช้ได้', async () => {
    const service = new BotService({ forceDemo: true });
    await service.getSeries('lending_rate');
    const stored = botRepo.readObservations('lending_rate', { start: '2000-01-01', end: '2999-01-01' });
    expect(stored.length).toBeGreaterThan(0);
  });
});

describe('BotService — แคช', () => {
  it('ไม่เรียก client ซ้ำเมื่อยังอยู่ในอายุแคช', async () => {
    const client = new StubClient(() => okResult(1.5));
    const service = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });

    const first = await service.getSeries('policy_rate', { start: '2026-06-01', end: '2026-08-29' });
    const second = await service.getSeries('policy_rate', { start: '2026-06-01', end: '2026-08-29' });

    expect(client.calls).toBe(1);
    expect(first.provenance.cache.hit).toBe(false);
    expect(second.provenance.cache.hit).toBe(true);
    expect(second.provenance.source).toBe('bot');
  });

  it('ล้างแคชแล้วดึงใหม่', async () => {
    const client = new StubClient(() => okResult(1.5));
    const service = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });

    await service.getSeries('policy_rate', { start: '2026-06-01', end: '2026-08-29' });
    service.invalidate('policy_rate');
    await service.getSeries('policy_rate', { start: '2026-06-01', end: '2026-08-29' });

    expect(client.calls).toBe(2);
  });
});

describe('BotService — การถอยเมื่อ BOT ล่ม', () => {
  it('เสิร์ฟข้อมูลจริงที่หมดอายุแล้ว (stale) ดีกว่าข้อมูลจำลอง', async () => {
    let healthy = true;
    const client = new StubClient(() => {
      if (healthy) return okResult(1.5);
      throw new BotApiError('gateway down', 'server', 503);
    });
    const service = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });

    const params = { start: '2026-06-01', end: '2026-08-29' };
    const fresh = await service.getSeries('policy_rate', params);
    expect(fresh.provenance.source).toBe('bot');

    // ทำให้แคชหมดอายุด้วยการเขียนทับ TTL เป็นศูนย์ แล้วล้างแคชในหน่วยความจำ
    botRepo.writeCache({
      cacheKey: buildCacheKey('policy_rate', params),
      seriesId: 'policy_rate',
      series: fresh,
      source: 'bot',
      fetchedAt: new Date(Date.now() - 7_200_000).toISOString(),
      ttlSeconds: 1,
    });
    const rebuilt = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });
    healthy = false;

    const stale = await rebuilt.getSeries('policy_rate', params);
    expect(stale.provenance.source).toBe('bot');
    expect(stale.provenance.stale).toBe(true);
    expect(stale.provenance.notice).toMatch(/BOT data temporarily unavailable/);
    expect(stale.observations).toEqual(fresh.observations);
  });

  it('ถอยไปข้อมูลจำลองพร้อมข้อความแจ้ง เมื่อไม่มีแคชเลย', async () => {
    const client = new StubClient(() => {
      throw new BotApiError('connection reset', 'network');
    });
    const service = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });

    const series = await service.getSeries('policy_rate');
    expect(series.provenance.source).toBe('demo');
    expect(series.provenance.notice).toMatch(/BOT data temporarily unavailable/);
    expect(series.observations.length).toBeGreaterThan(0);
    expect(service.mode()).toBe('degraded');
    expect(service.healthSnapshot().lastError).toContain('connection reset');
  });

  it('ไม่โยนข้อผิดพลาดออกไปให้ผู้เรียก (ระบบต้องไม่ล่มทั้งระบบ)', async () => {
    const client = new StubClient(() => {
      throw new BotApiError('exploded', 'server', 500);
    });
    const service = new BotService({ liveClient: client, mockClient: new MockBotClient(), liveEnabled: true });
    await expect(service.getSummary()).resolves.toBeTruthy();
  });
});

describe('metricFromSeries', () => {
  it('เลือกค่าล่าสุดและค่าก่อนหน้าจากงวดที่มีข้อมูล', () => {
    const metric = metricFromSeries(
      {
        seriesId: 'policy_rate',
        title: 'Policy Rate',
        titleTh: 'อัตราดอกเบี้ยนโยบาย',
        unit: 'percent_per_annum',
        dimensions: ['default'],
        observations: observations(1.5),
        provenance: {
          source: 'bot',
          sourceLabel: 'Bank of Thailand',
          lastUpdated: null,
          fetchedAt: new Date().toISOString(),
          stale: false,
          cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
          notice: null,
        },
      },
      { key: 'policy_rate', label: 'Policy Rate', labelTh: 'นโยบาย' },
    );

    expect(metric.current).toBe(1.5);
    expect(metric.previous).toBe(1.25);
    expect(metric.change).toBe(0.25);
    expect(metric.currentPeriod).toBe('2026-08-27');
  });

  it('เฉลี่ยทุกมิติเมื่อสั่ง averageDimensions', () => {
    const metric = metricFromSeries(
      {
        seriesId: 'lending_rate',
        title: 'Loan Rate',
        titleTh: 'เงินกู้',
        unit: 'percent_per_annum',
        dimensions: ['MLR', 'MOR', 'MRR'],
        observations: [
          { period: '2026-08-27', dimension: 'MLR', value: 5.8 },
          { period: '2026-08-27', dimension: 'MOR', value: 6.3 },
          { period: '2026-08-27', dimension: 'MRR', value: 6.0 },
        ],
        provenance: {
          source: 'bot',
          sourceLabel: 'Bank of Thailand',
          lastUpdated: null,
          fetchedAt: new Date().toISOString(),
          stale: false,
          cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
          notice: null,
        },
      },
      { key: 'avg', label: 'Average', labelTh: 'เฉลี่ย', averageDimensions: true },
    );

    expect(metric.current).toBeCloseTo(6.033333, 5);
  });
});

describe('MockBotClient', () => {
  it('ให้ค่าเดิมเสมอสำหรับวันเดียวกัน (deterministic)', async () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const params = { start: '2026-08-01', end: '2026-08-28' };
    const a = await new MockBotClient({ now }).fetchSeries(BOT_SERIES.fx_average, params);
    const b = await new MockBotClient({ now }).fetchSeries(BOT_SERIES.fx_average, params);
    expect(a.observations).toEqual(b.observations);
  });

  it('อัตราดอกเบี้ยนโยบายเป็นขั้นบันได — วันที่เก่ากว่าได้อัตราที่สูงกว่า', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const recent = policyRateAt(new Date('2026-08-20T00:00:00.000Z'), now);
    const older = policyRateAt(new Date('2026-05-31T00:00:00.000Z'), now);
    expect(recent).toBe(1.5);
    expect(older).toBeGreaterThan(recent);
  });

  it('อัตราดอกเบี้ยเงินกู้ขยับตามดอกเบี้ยนโยบายแบบส่งผ่านไม่เต็มร้อย', async () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const result = await new MockBotClient({ now }).fetchSeries(BOT_SERIES.lending_rate, {
      start: '2026-04-01',
      end: '2026-08-28',
    });
    const mlr = result.observations.filter((o) => o.dimension === 'MLR');
    const earliest = mlr[0]!.value;
    const latest = mlr[mlr.length - 1]!.value;
    expect(earliest).toBeGreaterThan(latest);
  });

  it('กรองเฉพาะสกุลเงินที่ขอ', async () => {
    const result = await new MockBotClient().fetchSeries(BOT_SERIES.fx_average, { currency: 'EUR' });
    expect([...new Set(result.observations.map((o) => o.dimension))]).toEqual(['EUR']);
  });
});
