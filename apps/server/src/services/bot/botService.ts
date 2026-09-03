/**
 * ชั้นบริการข้อมูล BOT: แคช → เรียก API จริง → ถอยไปข้อมูลเก่า → ถอยไปข้อมูลจำลอง
 *
 * โมดูลอื่นในระบบ (route, tool, ที่ปรึกษา AI) ใช้เฉพาะไฟล์นี้ ไม่เรียก client ตรง ๆ
 * เพื่อให้กติกาเรื่อง "ติดป้ายที่มาเสมอ" และ "ไม่ล่มทั้งระบบเมื่อ BOT ล่ม" อยู่ที่เดียว
 */

import type {
  BotMetric,
  BotSeries,
  BotSeriesHealth,
  BotSeriesId,
  BotSeriesProbe,
  BotSummary,
  BotUnit,
  DataSource,
  Provenance,
  SourceMode,
} from '@sme/shared';
import { botConfigGap, botLiveConfigured, env, hasBotApiKey } from '../../config/env.js';
import { clampRange, defaultWindow, secondsBetween } from '../../util/dates.js';
import * as botRepo from '../../db/botRepo.js';
import { LiveBotClient } from './botClient.js';
import { MockBotClient } from './botMockClient.js';
import { getSeriesDescriptor, listSeriesDescriptors } from './botSeries.js';
import type { BotApiClient, BotFetchParams, BotSeriesDescriptor } from './botTypes.js';
import { BotApiError } from './botTypes.js';

const SOURCE_LABEL_BOT = 'Bank of Thailand';
const SOURCE_LABEL_DEMO = 'Demo Data';
const NOTICE_UNAVAILABLE = 'BOT data temporarily unavailable.';

/**
 * ชุดข้อมูลที่หน้าภาพรวมแสดง — สถานะรวมของระบบสะท้อนเฉพาะกลุ่มนี้
 *
 * ต้องตรงกับที่ getSummary() เรียกจริง มีเทสต์ยืนยันไว้ เพราะถ้าหลุดจากกันเมื่อไร
 * สถานะที่รายงานจะไม่ตรงกับสิ่งที่ผู้ใช้เห็นบนหน้าจอ
 */
export const SUMMARY_SERIES: BotSeriesId[] = [
  'policy_rate',
  'lending_rate',
  'deposit_rate',
  'spot_rate',
];

/** ชุดนี้ดึงข้อมูลจริงได้ล่าสุดหรือไม่ (เคยสำเร็จ และไม่มีข้อผิดพลาดที่ใหม่กว่า) */
function isHealthy(state: HealthState): boolean {
  if (!state.lastSuccessAt) return state.lastErrorAt === null;
  if (!state.lastErrorAt) return true;
  return Date.parse(state.lastSuccessAt) >= Date.parse(state.lastErrorAt);
}

export interface BotServiceOptions {
  liveClient?: BotApiClient;
  mockClient?: BotApiClient;
  /** บังคับใช้ข้อมูลจำลอง (ใช้ในเทสต์) */
  forceDemo?: boolean;
  /**
   * ระบุเองว่าอนุญาตให้เรียก BOT API จริงหรือไม่
   * ปกติจะดูจากว่ามี BOT_API_KEY หรือเปล่า — ตัวเลือกนี้มีไว้ให้เทสต์กำหนดได้ตรง ๆ
   */
  liveEnabled?: boolean;
}

interface HealthState {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export class BotService {
  private readonly live: BotApiClient;
  private readonly mock: BotApiClient;
  private readonly forceDemo: boolean;
  private readonly liveEnabled: boolean | undefined;
  private readonly memory = new Map<string, { series: BotSeries; expiresAt: number }>();
  private health: HealthState = { lastSuccessAt: null, lastErrorAt: null, lastError: null };
  /** สถานะแยกรายชุด — ชุดที่พังชุดเดียวไม่ควรบังสถานะของชุดที่เหลือ */
  private readonly seriesHealth = new Map<BotSeriesId, HealthState>();

  constructor(options: BotServiceOptions = {}) {
    this.live = options.liveClient ?? new LiveBotClient();
    this.mock = options.mockClient ?? new MockBotClient();
    this.forceDemo = options.forceDemo ?? false;
    this.liveEnabled = options.liveEnabled;
  }

  /** มี API key และไม่ได้ถูกบังคับให้ใช้ข้อมูลจำลอง */
  private canUseLive(): boolean {
    if (this.forceDemo) return false;
    return this.liveEnabled ?? botLiveConfigured();
  }

  /** โหมดปัจจุบันของแหล่งข้อมูล BOT สำหรับ /api/health */
  mode(): SourceMode {
    if (!this.canUseLive()) return 'demo';
    // ตั้งค่า base URL ผิด = เรียกไม่ได้แน่นอน ไม่ต้องรอให้ลองแล้วพังก่อนถึงจะบอก
    if (env.botApiBaseUrlError) return 'degraded';

    // ดูเฉพาะชุดที่แดชบอร์ดใช้จริง
    //
    // ธปท. ให้สิทธิ์เป็น product ชุดเสริมที่บัญชีไม่ได้ subscribe จึงตอบ 403 เป็นปกติ
    // เมื่อมีคนเปิดดู การนับ 403 นั้นเป็น "ระบบขัดข้อง" ทำให้ทั้งเว็บขึ้นว่าใช้ข้อมูลจำลอง
    // ทั้งที่ชุดหลักทุกชุดยังดึงข้อมูลจริงได้ครบ
    const core = SUMMARY_SERIES.map((id) => this.seriesHealth.get(id));
    if (core.every((state) => state === undefined)) return 'live';

    return core.some((state) => state !== undefined && !isHealthy(state)) ? 'degraded' : 'live';
  }

  healthSnapshot(): HealthState & {
    apiKeyConfigured: boolean;
    cachedSeries: number;
    series: BotSeriesHealth[];
  } {
    return {
      ...this.health,
      apiKeyConfigured: hasBotApiKey(),
      cachedSeries: botRepo.cacheStats().rows,
      series: listSeriesDescriptors().map((descriptor) => {
        const state = this.seriesHealth.get(descriptor.id);
        return {
          seriesId: descriptor.id,
          titleTh: descriptor.titleTh,
          ok: state?.lastSuccessAt != null,
          lastSuccessAt: state?.lastSuccessAt ?? null,
          lastErrorAt: state?.lastErrorAt ?? null,
          lastError: state?.lastError ?? null,
        };
      }),
    };
  }

  /** บันทึกผลการเรียกจริงของชุดหนึ่ง ทั้งในสถานะรวมและสถานะรายชุด */
  private record(seriesId: BotSeriesId, error: string | null): void {
    const now = new Date().toISOString();
    const previous = this.seriesHealth.get(seriesId) ?? {
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    };

    this.seriesHealth.set(
      seriesId,
      error === null
        ? { ...previous, lastSuccessAt: now }
        : { ...previous, lastErrorAt: now, lastError: error },
    );

    this.health =
      error === null
        ? { ...this.health, lastSuccessAt: now }
        : { ...this.health, lastErrorAt: now, lastError: error };
  }

  invalidate(seriesId?: BotSeriesId): number {
    if (seriesId) {
      for (const key of [...this.memory.keys()]) {
        if (key.startsWith(`${seriesId}|`)) this.memory.delete(key);
      }
    } else {
      this.memory.clear();
    }
    return botRepo.clearCache(seriesId);
  }

  /** ดึงอนุกรมข้อมูลหนึ่งชุด พร้อมข้อมูลที่มา */
  async getSeries(seriesId: BotSeriesId, params: BotFetchParams = {}): Promise<BotSeries> {
    const descriptor = getSeriesDescriptor(seriesId);
    if (!descriptor) {
      throw new BotApiError(`Unknown BOT series "${seriesId}"`, 'response');
    }

    const window = defaultWindow(Math.min(90, descriptor.maxRangeDays ?? 90));
    const requested = { start: params.start ?? window.start, end: params.end ?? window.end };
    const resolved: BotFetchParams = {
      ...clampRange(requested, descriptor.maxRangeDays),
      ...(descriptor.supportsCurrency && params.currency
        ? { currency: params.currency.toUpperCase() }
        : {}),
    };
    // ธปท. ตอบ 400 เมื่อช่วงยาวเกินที่ endpoint รับได้ ระบบจึงตัดให้สั้นลงเอง
    // แต่การตัดเงียบ ๆ ทำให้คนกด "1 ปี" แล้วได้กราฟเดือนเดียวโดยไม่รู้ว่าทำไม
    const clampNotice =
      resolved.start !== requested.start
        ? `ธปท. รับช่วงข้อมูลของชุดนี้ได้ครั้งละไม่เกิน ${descriptor.maxRangeDays} วัน ` +
          `จึงแสดงตั้งแต่ ${resolved.start} ถึง ${resolved.end} แทนช่วงที่เลือกไว้`
        : null;

    const cacheKey = buildCacheKey(seriesId, resolved);
    const now = new Date();

    // 1) แคชในหน่วยความจำ
    const hot = this.memory.get(cacheKey);
    if (hot && hot.expiresAt > now.getTime()) {
      return withCacheInfo(hot.series, {
        hit: true,
        ageSeconds: secondsBetween(hot.series.provenance.fetchedAt, now.toISOString()),
        ttlSeconds: descriptor.ttlSeconds,
      });
    }

    // 2) แคชในฐานข้อมูล (อยู่รอดข้ามการรีสตาร์ต)
    const cached = botRepo.readCache(cacheKey, now);
    if (cached && !cached.expired) {
      this.memory.set(cacheKey, {
        series: cached.series,
        expiresAt: Date.parse(cached.expiresAt),
      });
      return withCacheInfo(cached.series, {
        hit: true,
        ageSeconds: secondsBetween(cached.fetchedAt, now.toISOString()),
        ttlSeconds: descriptor.ttlSeconds,
      });
    }

    // 3) เรียก BOT API จริง
    if (this.canUseLive()) {
      try {
        const series = await this.fetchAndStore(
          this.live,
          descriptor,
          resolved,
          'bot',
          cacheKey,
          clampNotice,
        );
        this.record(descriptor.id, null);
        return series;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.record(descriptor.id, message);

        // 4) ข้อมูลจริงที่หมดอายุแล้ว ยังดีกว่าข้อมูลที่แต่งขึ้น — แต่ต้องเป็นของจริงเท่านั้น
        //
        // ขั้นที่ 5 เขียนผลของข้อมูลจำลองลงแคชด้วยคีย์เดียวกัน ถ้าไม่ตรวจแหล่งที่มา
        // รอบถัดไปจะหยิบข้อมูลจำลองนั้นมาแล้วติดป้ายว่า "ข้อมูลจริงที่ดึงไว้ล่าสุด"
        // ซึ่งขัดกับหลักของระบบที่ทุกตัวเลขต้องบอกที่มาตามจริง
        if (cached && cached.series.provenance.source === 'bot') {
          const stale = markStale(cached.series, message, cached.fetchedAt, descriptor.ttlSeconds);
          this.memory.set(cacheKey, { series: stale, expiresAt: now.getTime() + 60_000 });
          return stale;
        }

        // 5) ถอยไปข้อมูลจำลอง และติดป้ายให้ชัด
        return this.fetchAndStore(
          this.mock,
          descriptor,
          resolved,
          'demo',
          cacheKey,
          `${NOTICE_UNAVAILABLE} แสดงข้อมูลจำลองแทน (${message})`,
        );
      }
    }

    // ไม่มี API key → DEMO MODE ตั้งแต่ต้น
    return this.fetchAndStore(
      this.mock,
      descriptor,
      resolved,
      'demo',
      cacheKey,
      `DEMO MODE: ${botConfigGap() ?? 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ BOT'} จึงแสดงข้อมูลจำลอง`,
    );
  }

  /**
   * ทดสอบเรียกชุดข้อมูลจริงหนึ่งชุด โดยไม่ผ่านแคชและไม่ถอยไปข้อมูลจำลอง
   *
   * getSeries ถูกออกแบบให้ผู้ใช้ได้ตัวเลขเสมอ พังแล้วก็ยังคืนข้อมูลจำลองให้ ซึ่งถูก
   * สำหรับหน้าเว็บ แต่ใช้ตรวจว่าทะเบียนชุดข้อมูลตรงกับ ธปท. จริงไหมไม่ได้เลย เพราะ
   * มันสำเร็จทุกครั้ง ตัวนี้จึงหยุดที่ผลลัพธ์จริงและรายงานตามที่เกิดขึ้น
   */
  async probeSeries(seriesId: BotSeriesId): Promise<BotSeriesProbe> {
    const descriptor = getSeriesDescriptor(seriesId);
    if (!descriptor) {
      throw new BotApiError(`Unknown BOT series "${seriesId}"`, 'response');
    }

    const window = defaultWindow(Math.min(90, descriptor.maxRangeDays ?? 90));
    const requested = clampRange(window, descriptor.maxRangeDays);
    const base = {
      seriesId: descriptor.id,
      titleTh: descriptor.titleTh,
      path: descriptor.path,
      declaredDimensions: descriptor.dimensions,
      requested,
    };

    if (!this.canUseLive()) {
      // ยิงใส่ข้อมูลจำลองแล้วรายงานว่า "ผ่าน" คือคำตอบที่ไร้ประโยชน์ที่สุดของเครื่องมือนี้
      return {
        ...base,
        ok: false,
        error: `DEMO MODE: ${botConfigGap() ?? 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ BOT'} — ทดสอบกับ ธปท. จริงไม่ได้`,
        observations: 0,
        rows: 0,
        dimensionsWithData: [],
        firstPeriod: null,
        lastPeriod: null,
        elapsedMs: 0,
      };
    }

    const startedAt = Date.now();
    try {
      const result = await this.live.fetchSeries(descriptor, requested);
      this.record(descriptor.id, null);

      const periods = result.observations.map((o) => o.period).sort();
      return {
        ...base,
        ok: true,
        error: null,
        observations: result.observations.length,
        rows: result.rowCount,
        dimensionsWithData: [...new Set(result.observations.map((o) => o.dimension))].sort(),
        firstPeriod: periods[0] ?? null,
        lastPeriod: periods[periods.length - 1] ?? null,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record(descriptor.id, message);
      return {
        ...base,
        ok: false,
        error: message,
        observations: 0,
        rows: 0,
        dimensionsWithData: [],
        firstPeriod: null,
        lastPeriod: null,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  /** ทดสอบทุกชุดในทะเบียน — ทีละชุด ไม่ยิงพร้อมกัน เพื่อไม่ให้ ธปท. เห็นเป็นการถล่ม */
  async probeAll(): Promise<BotSeriesProbe[]> {
    const results: BotSeriesProbe[] = [];
    for (const descriptor of listSeriesDescriptors()) {
      results.push(await this.probeSeries(descriptor.id));
    }
    return results;
  }

  private async fetchAndStore(
    client: BotApiClient,
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
    source: DataSource,
    cacheKey: string,
    notice: string | null = null,
  ): Promise<BotSeries> {
    const result = await client.fetchSeries(descriptor, params);
    const fetchedAt = new Date().toISOString();

    // ดึงสำเร็จแต่ไม่มีข้อมูลในช่วงที่ขอ — ต้องบอกให้ชัด ไม่งั้นหน้าเว็บจะขึ้นขีดว่างเปล่า
    // โดยผู้ใช้ไม่รู้ว่าเรียกไม่ติดหรือ ธปท. ไม่มีข้อมูลกันแน่
    // ดึงสำเร็จแต่ไม่มีตัวเลข — บอกเท่าที่รู้จริง ไม่สรุปสาเหตุแทน ธปท.
    //
    // เคยเขียนว่า "ธปท. อัปเดตรายงานนี้ล่าสุด <วันที่>" ต่อท้ายเหมือนเป็นคำอธิบาย
    // ซึ่งอ่านแล้วเข้าใจว่าชุดข้อมูลหยุดเผยแพร่ แต่ last_updated ในส่วนหัวอยู่ปนกับ
    // ฟิลด์ที่เป็นคำอธิบายรายงาน (แหล่งที่มา หมายเหตุ) จึงอาจเป็นวันที่แก้ตัวรายงาน
    // ไม่ใช่วันที่ของข้อมูล — เอกสารของบางชุดระบุว่าเผยแพร่ทุกวันทำการด้วยซ้ำ
    //
    // จำนวนแถวคือสิ่งที่แยกสองกรณีออกจากกันจริง ๆ:
    //   ศูนย์แถว   = ธปท. ไม่มีอะไรจะส่งในช่วงนี้
    //   มีแถวแต่ว่าง = ส่งโครงรายงานมา แต่ไม่มีตัวเลขในช่วงที่ขอ
    const emptyNotice =
      result.observations.length === 0 && source === 'bot'
        ? `ดึงข้อมูลจาก ธปท. สำเร็จ แต่ไม่มีตัวเลขของ "${descriptor.titleTh}" ในช่วง ` +
          `${params.start ?? '-'} ถึง ${params.end ?? '-'} ` +
          (result.rowCount === 0
            ? '(ธปท. ไม่ได้ส่งแถวข้อมูลมาเลย)'
            : `(ธปท. ส่งโครงรายงานมา ${result.rowCount} แถว แต่ทุกแถวไม่มีค่า)`) +
          (result.lastUpdated
            ? ` · ส่วนหัวระบุ last_updated ${result.lastUpdated.slice(0, 10)}`
            : '')
        : null;

    const series: BotSeries = {
      seriesId: descriptor.id,
      title: descriptor.title,
      titleTh: descriptor.titleTh,
      unit: descriptor.unit,
      dimensions: [...new Set(result.observations.map((o) => o.dimension))].sort(),
      observations: result.observations,
      provenance: {
        source,
        sourceLabel: source === 'bot' ? SOURCE_LABEL_BOT : SOURCE_LABEL_DEMO,
        lastUpdated: result.lastUpdated,
        fetchedAt,
        stale: false,
        cache: { hit: false, ageSeconds: 0, ttlSeconds: descriptor.ttlSeconds },
        notice: [notice, emptyNotice].filter(Boolean).join(' · ') || null,
      },
    };

    botRepo.writeCache({
      cacheKey,
      seriesId: descriptor.id,
      series,
      source,
      fetchedAt,
      ttlSeconds: descriptor.ttlSeconds,
    });
    botRepo.upsertObservations({
      seriesId: descriptor.id,
      unit: descriptor.unit,
      source,
      observations: result.observations,
    });
    this.memory.set(cacheKey, {
      series,
      expiresAt: Date.parse(fetchedAt) + descriptor.ttlSeconds * 1000,
    });

    return series;
  }

  /** ค่าล่าสุด + ค่าก่อนหน้า + ส่วนต่าง ของมิติหนึ่งในชุดข้อมูล */
  async getMetric(input: {
    seriesId: BotSeriesId;
    dimension?: string;
    key: string;
    label: string;
    labelTh: string;
    params?: BotFetchParams;
    /** true = เฉลี่ยทุกมิติในงวดล่าสุด (ใช้กับ "อัตราดอกเบี้ยเงินกู้เฉลี่ย") */
    averageDimensions?: boolean;
  }): Promise<BotMetric> {
    const series = await this.getSeries(input.seriesId, input.params ?? {});
    return metricFromSeries(series, input);
  }

  /** ชุดตัวเลขสำหรับแดชบอร์ด Market & Economic Data */
  async getSummary(): Promise<BotSummary> {
    const [policyRate, lendingRate, depositRate, usdThb] = await Promise.all([
      this.getMetric({
        seriesId: 'policy_rate',
        key: 'policy_rate',
        label: 'Policy Rate',
        labelTh: 'อัตราดอกเบี้ยนโยบาย',
      }),
      this.getMetric({
        seriesId: 'lending_rate',
        key: 'lending_rate_avg',
        label: 'Average Lending Rate',
        labelTh: 'อัตราดอกเบี้ยเงินกู้เฉลี่ย',
        averageDimensions: true,
      }),
      this.getMetric({
        seriesId: 'deposit_rate',
        dimension: '12m',
        key: 'deposit_rate_12m',
        label: 'Deposit Rate (12M)',
        labelTh: 'อัตราดอกเบี้ยเงินฝากประจำ 12 เดือน',
      }),
      // ใช้ SPOT-RATE เพราะอยู่ในแพ็กเดียวกับชุดอัตราดอกเบี้ย ส่วน Stat-ExchangeRate
      // เป็นคนละ product ที่ต้อง subscribe แยก — ชุดนั้นยังอยู่ในทะเบียนสำหรับผู้ที่ subscribe ไว้
      this.getMetric({
        seriesId: 'spot_rate',
        dimension: 'USD',
        key: 'usd_thb',
        label: 'USD/THB',
        labelTh: 'ดอลลาร์สหรัฐ/บาท',
      }),
    ]);

    const metrics = [policyRate, lendingRate, depositRate, usdThb];
    const anyDemo = metrics.some((m) => m.provenance.source === 'demo');
    const notice = metrics.map((m) => m.provenance.notice).find((n) => n) ?? null;

    return { policyRate, lendingRate, depositRate, usdThb, anyDemo, notice };
  }

  /**
   * อัตราอ้างอิงสำหรับสินเชื่อลอยตัว เช่น MLR / MOR / MRR
   * ใช้ตอนคิดต้นทุนสินเชื่อจริง จึงต้องดึงจาก BOT ไม่ใช่ค่าคงที่ในโค้ด
   */
  async getReferenceRate(
    name: 'MLR' | 'MOR' | 'MRR',
  ): Promise<{ name: string; value: number | null; provenance: Provenance }> {
    const metric = await this.getMetric({
      seriesId: 'lending_rate',
      dimension: name,
      key: `lending_${name.toLowerCase()}`,
      label: name,
      labelTh: name,
    });
    return { name, value: metric.current, provenance: metric.provenance };
  }

  /**
   * อัตราดอกเบี้ยผิดนัดชำระที่ธนาคารพาณิชย์ประกาศ
   *
   * ตัวเลขนี้คือขาลงของการกู้ ถ้าจ่ายไม่ไหวต้นทุนไม่ได้อยู่ที่อัตราเดิม แต่ขยับมาที่นี่
   */
  async getDefaultRate(): Promise<{ value: number | null; provenance: Provenance }> {
    const metric = await this.getMetric({
      seriesId: 'loan_ceiling_rate',
      dimension: 'penalty',
      key: 'default_rate',
      label: 'Default rate',
      labelTh: 'อัตราผิดนัดชำระ',
    });
    return { value: metric.current, provenance: metric.provenance };
  }

  /** อัตราแลกเปลี่ยนล่าสุดของสกุลเงินหนึ่ง (บาทต่อ 1 หน่วย) */
  async getExchangeRate(currency: string): Promise<BotMetric> {
    const code = currency.toUpperCase();
    return this.getMetric({
      seriesId: 'fx_average',
      dimension: code,
      key: `fx_${code.toLowerCase()}`,
      label: `${code}/THB`,
      labelTh: `${code}/บาท`,
      params: { currency: code },
    });
  }
}

/** สร้างคีย์แคชจากรหัสชุดข้อมูลและพารามิเตอร์ที่เรียงแล้ว */
export function buildCacheKey(seriesId: string, params: BotFetchParams): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return `${seriesId}|${parts.join('&')}`;
}

function withCacheInfo(series: BotSeries, cache: Provenance['cache']): BotSeries {
  return { ...series, provenance: { ...series.provenance, cache } };
}

function markStale(
  series: BotSeries,
  reason: string,
  fetchedAt: string,
  ttlSeconds: number,
): BotSeries {
  return {
    ...series,
    provenance: {
      ...series.provenance,
      stale: true,
      cache: {
        hit: true,
        ageSeconds: secondsBetween(fetchedAt, new Date().toISOString()),
        ttlSeconds,
      },
      notice: `${NOTICE_UNAVAILABLE} กำลังแสดงข้อมูลจริงที่ดึงไว้ล่าสุด (${reason})`,
    },
  };
}

/** ดึงค่าล่าสุด/ก่อนหน้าออกจากอนุกรมข้อมูล */
export function metricFromSeries(
  series: BotSeries,
  input: { key: string; label: string; labelTh: string; dimension?: string; averageDimensions?: boolean },
): BotMetric {
  const periods = [...new Set(series.observations.map((o) => o.period))].sort();
  const valueAt = (period: string): number | null => {
    const rows = series.observations.filter((o) => o.period === period);
    const selected = input.averageDimensions
      ? rows
      : rows.filter((o) => o.dimension === (input.dimension ?? rows[0]?.dimension));
    if (selected.length === 0) return null;
    const sum = selected.reduce((acc, o) => acc + o.value, 0);
    return round(sum / selected.length);
  };

  // มองย้อนจากงวดล่าสุด เก็บสองงวดที่อ่านค่าได้จริง
  const found: { period: string; value: number }[] = [];
  for (let i = periods.length - 1; i >= 0 && found.length < 2; i -= 1) {
    const period = periods[i]!;
    const value = valueAt(period);
    if (value !== null) found.push({ period, value });
  }

  const current = found[0] ?? null;
  const previous = found[1] ?? null;
  const change = current && previous ? round(current.value - previous.value) : null;

  return {
    key: input.key,
    label: input.label,
    labelTh: input.labelTh,
    unit: series.unit as BotUnit,
    current: current?.value ?? null,
    previous: previous?.value ?? null,
    change,
    changePercent:
      current && previous && previous.value !== 0
        ? round(((current.value - previous.value) / previous.value) * 100)
        : null,
    currentPeriod: current?.period ?? null,
    previousPeriod: previous?.period ?? null,
    provenance: series.provenance,
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

let singleton: BotService | null = null;

export function getBotService(): BotService {
  if (!singleton) {
    singleton = new BotService({ forceDemo: env.botForceDemo });
  }
  return singleton;
}

export function setBotService(service: BotService | null): void {
  singleton = service;
}
