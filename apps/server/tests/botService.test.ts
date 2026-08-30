/** เทสต์ชั้นบริการ BOT: แคช การถอยไปข้อมูลเก่า และการถอยไปข้อมูลจำลอง */

import { beforeEach, describe, expect, it } from 'vitest';
import type { BotObservation, BotSeriesId } from '@sme/shared';
import {
  BotService,
  buildCacheKey,
  metricFromSeries,
  SUMMARY_SERIES,
} from '../src/services/bot/botService.js';
import { MockBotClient, policyRateAt } from '../src/services/bot/botMockClient.js';
import { BOT_SERIES, listSeriesDescriptors } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';
import type { BotApiClient, BotFetchResult } from '../src/services/bot/botTypes.js';
import { clampRange } from '../src/util/dates.js';
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

describe('สถานะแยกรายชุดข้อมูล', () => {
  /** client ที่สำเร็จเฉพาะชุดที่ระบุ ชุดอื่นโยนข้อผิดพลาด */
  function partialClient(succeedFor: BotSeriesId[]): BotApiClient {
    return {
      kind: 'live',
      async fetchSeries(descriptor) {
        if (!succeedFor.includes(descriptor.id)) {
          throw new BotApiError(`BOT returned HTTP 400: Bad Request`, 'response', 400);
        }
        return {
          observations: [{ period: '2026-08-27', dimension: descriptor.dimensions[0]!, value: 1 }],
          lastUpdated: '2026-08-27T00:00:00.000Z',
          unit: descriptor.unit,
        };
      },
    };
  }

  it('แยกได้ว่าชุดไหนเรียกได้และชุดไหนไม่ได้', async () => {
    // ธปท. ให้สิทธิ์แยกรายชุด อาการจริงคือบางชุดผ่านบางชุดไม่ผ่านพร้อมกัน
    const service = new BotService({ liveClient: partialClient(['policy_rate']), liveEnabled: true });
    await service.getSeries('policy_rate');
    await service.getSeries('deposit_rate');

    const byId = new Map(service.healthSnapshot().series.map((s) => [s.seriesId, s]));
    expect(byId.get('policy_rate')?.ok).toBe(true);
    expect(byId.get('policy_rate')?.lastError).toBeNull();
    expect(byId.get('deposit_rate')?.ok).toBe(false);
    expect(byId.get('deposit_rate')?.lastError).toContain('400');
  });

  it('รายงานทุกชุดในทะเบียน แม้ชุดที่ยังไม่เคยถูกเรียก', () => {
    const service = new BotService({ liveClient: partialClient([]), liveEnabled: true });
    const { series } = service.healthSnapshot();
    expect(series).toHaveLength(listSeriesDescriptors().length);
    expect(series.every((s) => s.ok === false && s.lastErrorAt === null)).toBe(true);
  });

  it('ชุดที่พังไม่ลบสถานะสำเร็จของตัวเอง ทำให้เห็นว่าเคยได้ข้อมูลจริงมาก่อน', async () => {
    let fail = false;
    const flaky: BotApiClient = {
      kind: 'live',
      async fetchSeries(descriptor) {
        if (fail) throw new BotApiError('BOT returned HTTP 500', 'server', 500);
        return {
          observations: [{ period: '2026-08-27', dimension: descriptor.dimensions[0]!, value: 1 }],
          lastUpdated: null,
          unit: descriptor.unit,
        };
      },
    };
    const service = new BotService({ liveClient: flaky, liveEnabled: true });
    await service.getSeries('policy_rate');
    fail = true;
    service.invalidate();
    await service.getSeries('policy_rate');

    const state = service.healthSnapshot().series.find((s) => s.seriesId === 'policy_rate');
    expect(state?.ok).toBe(true);
    expect(state?.lastError).toContain('500');
  });
});

describe('เพดานความกว้างของช่วงวันที่', () => {
  it('หดช่วง 90 วันให้เหลือตามเพดาน โดยยึดวันสิ้นสุดไว้', () => {
    // ของจริง: ขอ 2026-06-01→08-30 (90 วัน) ได้ 400 · ขอ 2026-08-01→08-27 (27 วัน) ได้ 200
    expect(clampRange({ start: '2026-06-01', end: '2026-08-30' }, 31)).toEqual({
      start: '2026-07-30',
      end: '2026-08-30',
    });
  });

  it('ไม่แตะช่วงที่แคบกว่าเพดานอยู่แล้ว', () => {
    const narrow = { start: '2026-08-01', end: '2026-08-27' };
    expect(clampRange(narrow, 31)).toEqual(narrow);
  });

  it('ไม่แตะอะไรเลยเมื่อชุดข้อมูลไม่ได้กำหนดเพดาน', () => {
    const wide = { start: '2026-06-01', end: '2026-08-30' };
    expect(clampRange(wide, undefined)).toEqual(wide);
  });

  it('ส่งช่วงที่อยู่ในเพดานไปให้ ธปท. จริง สำหรับชุดที่เคยได้ 400', async () => {
    const seen: Array<{ start?: string; end?: string }> = [];
    const spy: BotApiClient = {
      kind: 'live',
      async fetchSeries(descriptor, params) {
        seen.push({ start: params.start, end: params.end });
        return {
          observations: [{ period: '2026-08-27', dimension: 'MLR', value: 7 }],
          lastUpdated: null,
          unit: descriptor.unit,
        };
      },
    };
    const service = new BotService({ liveClient: spy, liveEnabled: true });
    await service.getSeries('lending_rate');

    const span =
      (Date.parse(seen[0]!.end!) - Date.parse(seen[0]!.start!)) / 86_400_000;
    expect(span).toBeLessThanOrEqual(BOT_SERIES.lending_rate.maxRangeDays!);
  });
})

describe('แหล่งอัตราแลกเปลี่ยนของแดชบอร์ด', () => {
  it('ขอ USD/THB จากชุดที่อยู่ในแพ็กเดียวกับอัตราดอกเบี้ย', async () => {
    // Stat-ExchangeRate เป็นคนละ product ที่ต้อง subscribe แยก จึงตอบ 403 ด้วยคีย์เดิม
    // ส่วน SPOT-RATE อยู่ใน Interest Rates Plan เดียวกัน ใช้คีย์เดิมได้เลย
    const asked: string[] = [];
    const spy: BotApiClient = {
      kind: 'live',
      async fetchSeries(descriptor) {
        asked.push(descriptor.id);
        return {
          observations: [{ period: '2026-08-27', dimension: descriptor.dimensions[0]!, value: 34.6 }],
          lastUpdated: null,
          unit: descriptor.unit,
        };
      },
    };
    const summary = await new BotService({ liveClient: spy, liveEnabled: true }).getSummary();

    expect(asked).toContain('spot_rate');
    expect(asked).not.toContain('fx_average');
    expect(summary.usdThb.provenance.source).toBe('bot');
  });

  it('ยังมีข้อมูลจำลองให้ เมื่อยังไม่ได้ตั้งคีย์', async () => {
    const summary = await new BotService({ forceDemo: true }).getSummary();
    expect(summary.usdThb.current).toBeGreaterThan(0);
    expect(summary.usdThb.provenance.source).toBe('demo');
  });

  it('คงชุด Stat-ExchangeRate ไว้ในทะเบียนสำหรับผู้ที่ subscribe แยก', () => {
    expect(BOT_SERIES.fx_average.dimensions).toContain('EUR');
    // path ตามบรรทัด GET ในแท็บ API specification ซึ่งมี slash ปิดท้าย
    expect(BOT_SERIES.spot_rate.path).toBe('/Stat-SpotRate/v2/SPOTRATE/');
  });
})

describe('สถานะรวมสะท้อนเฉพาะชุดที่แดชบอร์ดใช้', () => {
  /** สำเร็จเฉพาะชุดที่ระบุ ชุดอื่นโดนปฏิเสธสิทธิ์แบบเดียวกับที่ ธปท. ตอบจริง */
  function client(succeedFor: BotSeriesId[]): BotApiClient {
    return {
      kind: 'live',
      async fetchSeries(descriptor) {
        if (!succeedFor.includes(descriptor.id)) {
          throw new BotApiError('ธปท. ปฏิเสธคำขอ (HTTP 403)', 'auth', 403);
        }
        return {
          observations: [{ period: '2026-08-27', dimension: descriptor.dimensions[0]!, value: 1 }],
          lastUpdated: null,
          unit: descriptor.unit,
        };
      },
    };
  }

  it('ชุดเสริมที่ไม่ได้ subscribe ตอบ 403 ไม่ทำให้ทั้งระบบขึ้นว่าขัดข้อง', async () => {
    // อาการจริง: เปิดดูอัตราแลกเปลี่ยนบนหน้าข้อมูลตลาด แล้วทั้งเว็บพลิกเป็นข้อมูลจำลอง
    // ทั้งที่ชุดหลักสี่ชุดยังดึงข้อมูลจริงได้ครบ
    const service = new BotService({ liveClient: client(SUMMARY_SERIES), liveEnabled: true });
    for (const id of SUMMARY_SERIES) await service.getSeries(id);
    expect(service.mode()).toBe('live');

    await service.getSeries('fx_average');
    expect(service.mode()).toBe('live');
  });

  it('ชุดหลักพังเมื่อไร ถึงจะขึ้นว่าขัดข้อง', async () => {
    const service = new BotService({
      liveClient: client(SUMMARY_SERIES.filter((id) => id !== 'lending_rate')),
      liveEnabled: true,
    });
    for (const id of SUMMARY_SERIES) await service.getSeries(id);
    expect(service.mode()).toBe('degraded');
  });

  it('ยังไม่เคยเรียกอะไรเลย ถือว่าปกติ ไม่ใช่ขัดข้อง', () => {
    expect(new BotService({ liveClient: client([]), liveEnabled: true }).mode()).toBe('live');
  });

  it('รายการชุดหลักตรงกับที่ getSummary เรียกจริง', async () => {
    // ถ้าสองอย่างนี้หลุดจากกัน สถานะที่รายงานจะไม่ตรงกับสิ่งที่ผู้ใช้เห็น
    const asked: BotSeriesId[] = [];
    const spy: BotApiClient = {
      kind: 'live',
      async fetchSeries(descriptor) {
        asked.push(descriptor.id);
        return {
          observations: [{ period: '2026-08-27', dimension: descriptor.dimensions[0]!, value: 1 }],
          lastUpdated: null,
          unit: descriptor.unit,
        };
      },
    };
    await new BotService({ liveClient: spy, liveEnabled: true }).getSummary();
    expect([...asked].sort()).toEqual([...SUMMARY_SERIES].sort());
  });
});
