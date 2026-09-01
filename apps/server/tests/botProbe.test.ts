/**
 * การทดสอบชุดข้อมูลกับ ธปท. จริง
 *
 * เส้นทางปกติถอยไปข้อมูลจำลองเมื่อพัง ชุดที่ path หรือชื่อคอลัมน์ผิดจึงดูเหมือน
 * ใช้ได้ตลอด เครื่องมือนี้มีไว้ให้เห็นความจริง มันจึงต้องไม่ถอยเด็ดขาด
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { BotSeriesId } from '@sme/shared';
import { BotService } from '../src/services/bot/botService.js';
import { MockBotClient } from '../src/services/bot/botMockClient.js';
import { BOT_SERIES, listSeriesDescriptors } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';
import type { BotApiClient, BotFetchResult } from '../src/services/bot/botTypes.js';
import { freshDb } from './helpers.js';
import * as botRepo from '../src/db/botRepo.js';

class StubClient implements BotApiClient {
  readonly kind = 'live' as const;
  calls = 0;
  constructor(private readonly behaviour: () => BotFetchResult | never) {}
  async fetchSeries(): Promise<BotFetchResult> {
    this.calls += 1;
    return this.behaviour();
  }
}

function live(behaviour: () => BotFetchResult | never): BotService {
  return new BotService({
    liveClient: new StubClient(behaviour),
    mockClient: new MockBotClient(),
    liveEnabled: true,
  });
}

const OK: BotFetchResult = {
  observations: [
    { period: '2026-08-20', dimension: '1m', value: 1.7 },
    { period: '2026-08-27', dimension: '1m', value: 1.75 },
  ],
  lastUpdated: '2026-08-27T07:00:00.000Z',
  rowCount: 2,
  unit: 'percent_per_annum',
};

beforeEach(() => {
  freshDb();
});

describe('probeSeries', () => {
  it('รายงานว่าเรียกได้ พร้อมช่วงวันที่ที่ได้จริง', async () => {
    const probe = await live(() => OK).probeSeries('bibor');
    expect(probe.ok).toBe(true);
    expect(probe.error).toBeNull();
    expect(probe.observations).toBe(2);
    expect(probe.firstPeriod).toBe('2026-08-20');
    expect(probe.lastPeriod).toBe('2026-08-27');
  });

  it('พังแล้วรายงานว่าพัง ไม่ใช่ถอยไปข้อมูลจำลองแล้วบอกว่าผ่าน', async () => {
    // นี่คือเหตุผลทั้งหมดที่เครื่องมือนี้มีอยู่
    const service = live(() => {
      throw new BotApiError('HTTP 404 Not Found', 'transport');
    });
    const probe = await service.probeSeries('interbank_rate');

    expect(probe.ok).toBe(false);
    expect(probe.error).toContain('404');
    expect(probe.observations).toBe(0);
    // ต้องไม่มีข้อมูลจำลองไหลลงแคชระหว่างทาง
    expect(botRepo.cacheStats().rows).toBe(0);
  });

  it('เรียกติดแต่ไม่มีมิติใดได้ค่า — คนละอาการกับเรียกไม่ติด', async () => {
    // ชื่อคอลัมน์ใน valueFields ไม่ตรงกับผลลัพธ์จริงจะออกมาหน้าตาแบบนี้
    const probe = await live(() => ({
      observations: [],
      lastUpdated: null,
      rowCount: 16,
      unit: 'percent_per_annum',
    })).probeSeries('thb_implied_rate');

    expect(probe.ok).toBe(true);
    expect(probe.dimensionsWithData).toEqual([]);
    expect(probe.declaredDimensions.length).toBeGreaterThan(0);
  });

  it('รายงานจำนวนแถวดิบที่ ธปท. ส่งมา', async () => {
    const empty = await live(() => ({
      observations: [],
      lastUpdated: null,
      rowCount: 16,
      unit: 'percent_per_annum' as const,
    })).probeSeries('thb_implied_rate');
    expect(empty.observations).toBe(0);
    expect(empty.rows).toBe(16);

    const nothing = await live(() => ({
      observations: [],
      lastUpdated: null,
      rowCount: 0,
      unit: 'percent_per_annum' as const,
    })).probeSeries('thb_implied_rate');
    expect(nothing.rows).toBe(0);
  });

  it('บอกว่ามิติไหนได้ค่าจริง เทียบกับที่ทะเบียนประกาศไว้', async () => {
    const probe = await live(() => OK).probeSeries('bibor');
    expect(probe.declaredDimensions).toEqual(BOT_SERIES.bibor.dimensions);
    expect(probe.dimensionsWithData).toEqual(['1m']);
  });

  it('ไม่ใช้แคช — ชุดที่เพิ่งดึงสำเร็จก็ยังต้องยิงจริงอีกครั้ง', async () => {
    const client = new StubClient(() => OK);
    const service = new BotService({
      liveClient: client,
      mockClient: new MockBotClient(),
      liveEnabled: true,
    });

    await service.getSeries('bibor');
    const before = client.calls;
    await service.probeSeries('bibor');
    expect(client.calls).toBe(before + 1);
  });

  it('ไม่มี API key ก็บอกตรง ๆ ว่าทดสอบไม่ได้ ไม่ใช่ยิงใส่ข้อมูลจำลองแล้วบอกว่าผ่าน', async () => {
    const service = new BotService({ mockClient: new MockBotClient(), liveEnabled: false });
    const probe = await service.probeSeries('bibor');
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain('DEMO MODE');
  });

  it('ชุดที่ไม่รู้จักต้องโยนข้อผิดพลาด ไม่ใช่คืนผลว่าง', async () => {
    await expect(live(() => OK).probeSeries('nope' as BotSeriesId)).rejects.toThrow(/Unknown/);
  });

  it('ขอช่วงไม่เกินที่ endpoint รับได้', async () => {
    const probe = await live(() => OK).probeSeries('bibor');
    const span =
      (Date.parse(probe.requested.end) - Date.parse(probe.requested.start)) / 86_400_000;
    expect(span).toBeLessThanOrEqual(BOT_SERIES.bibor.maxRangeDays!);
  });
});

describe('probeAll', () => {
  it('ทดสอบครบทุกชุดในทะเบียน', async () => {
    const probes = await live(() => OK).probeAll();
    expect(probes.map((p) => p.seriesId).sort()).toEqual(
      listSeriesDescriptors().map((d) => d.id).sort(),
    );
  });

  it('ชุดหนึ่งพังไม่ทำให้ชุดที่เหลือหายไปจากรายงาน', async () => {
    let n = 0;
    const probes = await live(() => {
      n += 1;
      if (n === 2) throw new BotApiError('HTTP 403 Forbidden', 'auth');
      return OK;
    }).probeAll();

    expect(probes).toHaveLength(listSeriesDescriptors().length);
    expect(probes.filter((p) => !p.ok)).toHaveLength(1);
    expect(probes.find((p) => !p.ok)?.error).toContain('403');
  });
});

describe('เพดานช่วงข้อมูลของชุดที่ยังไม่เคยยืนยัน', () => {
  it('สี่ชุดที่ยังไม่เคยเรียกจริงมีเพดานกำกับ', () => {
    // ทุก endpoint ที่ยืนยันแล้วตอบ 400 เมื่อขอ 90 วัน และหน้าข้อมูลตลาดตั้งต้นที่ 90 วัน
    // ชุดที่ไม่มีเพดานจะพังตั้งแต่คลิกแรก ด้วยสาเหตุที่รู้อยู่ก่อนแล้ว
    for (const id of ['interbank_rate', 'bibor', 'thb_implied_rate', 'external_rate'] as const) {
      expect(BOT_SERIES[id].maxRangeDays, id).toBe(31);
    }
  });

  it('policy_rate ไม่ถูกตัดช่วง เพราะยืนยันแล้วว่าใช้ได้ที่ 90 วัน', () => {
    // ใส่เพดานให้ชุดที่ใช้งานได้อยู่แล้วคือการลดข้อมูลที่ผู้ใช้เห็นโดยไม่มีเหตุ
    expect(BOT_SERIES.policy_rate.maxRangeDays).toBeUndefined();
  });
});

describe('บอกผู้ใช้เมื่อช่วงข้อมูลถูกตัด', () => {
  it('ขอเกินเพดานแล้วมีข้อความอธิบาย ไม่ใช่ตัดเงียบ ๆ', async () => {
    // กด "1 ปี" แล้วได้กราฟเดือนเดียวโดยไม่บอกอะไรเลย คือหน้าจอที่โกหกโดยไม่ตั้งใจ
    const series = await live(() => OK).getSeries('bibor', {
      start: '2026-01-01',
      end: '2026-08-29',
    });
    expect(series.provenance.notice).toContain('31 วัน');
    // ต้องบอกช่วงที่ได้จริง ไม่ใช่แค่บอกว่าถูกตัด
    expect(series.provenance.notice).toContain('2026-07-29');
    expect(series.provenance.notice).toContain('2026-08-29');
  });

  it('ขอไม่เกินเพดานก็ไม่ต้องมีข้อความรบกวน', async () => {
    const series = await live(() => OK).getSeries('bibor', {
      start: '2026-08-20',
      end: '2026-08-29',
    });
    expect(series.provenance.notice).toBeNull();
  });
});

describe('ผลการทดสอบต้องไม่พา API key ออกไป', () => {
  it('ข้อความผิดพลาดที่มี URL อยู่ด้วย ก็ยังต้องไม่มีคีย์', async () => {
    // ข้อความผิดพลาดจงใจใส่ URL ที่เรียกไว้ เพราะเป็นสิ่งที่บอกได้ว่า path ผิดตรงไหน
    // URL ไม่ใช่ความลับ แต่คีย์เป็น และคีย์เดินทางอยู่ใน header ซึ่งต้องไม่ไหลมาถึงตรงนี้
    const key = 'super-secret-client-id-value';
    const probe = await live(() => {
      throw new BotApiError(
        `BOT returned HTTP 404 — URL ที่เรียก: https://gateway.api.bot.or.th/BIBOR/v2/bibor/?start_period=2026-08-01`,
        'transport',
      );
    }).probeSeries('bibor');

    expect(probe.error).toContain('gateway.api.bot.or.th');
    expect(JSON.stringify(probe)).not.toContain(key);
    expect(JSON.stringify(probe).toLowerCase()).not.toContain('x-ibm-client-id');
  });
});

describe('ข้อความเมื่อ ธปท. ตอบสำเร็จแต่ไม่มีตัวเลข', () => {
  it('แถวว่างหลายสิบแถว บอกจำนวนแถวไว้ด้วย', async () => {
    // ธปท. ส่งโครงรายงานมา กับ ธปท. ไม่ส่งอะไรมาเลย ให้ observations = 0 เท่ากัน
    // จำนวนแถวคือสิ่งเดียวที่แยกสองอย่างนี้ออกจากกันได้จากภายนอก
    const series = await live(() => ({
      observations: [],
      lastUpdated: '2024-12-27T00:00:00.000Z',
      rowCount: 16,
      unit: 'percent_per_annum' as const,
    })).getSeries('thb_implied_rate');

    expect(series.provenance.source).toBe('bot');
    expect(series.provenance.notice).toContain('16 แถว');
  });

  it('ไม่มีแถวเลยก็บอกแบบนั้น', async () => {
    const series = await live(() => ({
      observations: [],
      lastUpdated: null,
      rowCount: 0,
      unit: 'percent_per_annum' as const,
    })).getSeries('thb_implied_rate');

    expect(series.provenance.notice).toContain('ไม่ได้ส่งแถวข้อมูลมาเลย');
  });

  it('ไม่สรุปแทน ธปท. ว่ารายงานหยุดอัปเดตแล้ว', async () => {
    // last_updated อยู่ปนกับฟิลด์คำอธิบายรายงาน จึงอาจเป็นวันที่แก้ตัวรายงาน
    // ไม่ใช่วันที่ของข้อมูล — เอกสารของชุดนี้ระบุว่าเผยแพร่ทุกวันทำการ
    const series = await live(() => ({
      observations: [],
      lastUpdated: '2024-12-27T00:00:00.000Z',
      rowCount: 16,
      unit: 'percent_per_annum' as const,
    })).getSeries('thb_implied_rate');

    expect(series.provenance.notice).toContain('last_updated 2024-12-27');
    expect(series.provenance.notice).not.toContain('อัปเดตรายงานนี้ล่าสุด');
  });
});
