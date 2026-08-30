/**
 * ตัวจำลอง BOT API สำหรับ DEMO MODE
 *
 * ใช้เมื่อไม่มี BOT_API_KEY หรือเมื่อเรียก BOT API ไม่สำเร็จ ข้อมูลที่ได้จะถูกติดป้าย
 * source = "demo" ตลอดทาง ทำให้หน้าเว็บแสดงคำว่า "Demo Data" ได้ตรงความจริง
 *
 * ค่าที่สร้างขึ้นเป็นค่า deterministic (วันเดียวกันได้ค่าเดิมเสมอ) จึงทดสอบได้
 * และหน้าเว็บไม่กระพริบเปลี่ยนตัวเลขไปมาระหว่างรีเฟรช
 *
 * รูปทรงของข้อมูลอิงโครงสร้างจริง: อัตราดอกเบี้ยนโยบายเป็นขั้นบันได อัตราเงินกู้/เงินฝาก
 * ขยับตามดอกเบี้ยนโยบายแบบส่งผ่านไม่เต็มร้อย ส่วนอัตราแลกเปลี่ยนเดินแบบรายวัน
 */

import type { BotObservation } from '@sme/shared';
import type {
  BotApiClient,
  BotFetchParams,
  BotFetchResult,
  BotSeriesDescriptor,
} from './botTypes.js';
import { defaultWindow, toIsoDate } from '../../util/dates.js';

const DAY_MS = 86_400_000;

/** ขั้นบันไดอัตราดอกเบี้ยนโยบาย นับถอยหลังจากวันนี้ (จำนวนวัน, อัตรา) */
const POLICY_STEPS: { daysAgo: number; rate: number }[] = [
  { daysAgo: 66, rate: 1.5 },
  { daysAgo: 150, rate: 1.75 },
  { daysAgo: 240, rate: 2.0 },
  { daysAgo: 330, rate: 2.25 },
  { daysAgo: 450, rate: 2.5 },
];

/** ระดับฐานของแต่ละมิติในแต่ละชุดข้อมูล ณ อัตรานโยบาย 1.50% */
const BASE_LEVELS: Record<string, Record<string, number>> = {
  lending_rate: { MLR: 5.85, MOR: 6.3, MRR: 6.0 },
  deposit_rate: { savings: 0.45, '3m': 1.05, '6m': 1.2, '12m': 1.45, '24m': 1.75 },
  fx_reference: { USD: 34.5 },
  fx_average: { USD: 34.5, EUR: 37.6, JPY: 0.235, CNY: 4.82, GBP: 44.2, SGD: 26.1 },
  interbank_rate: { overnight: 1.48 },
  bibor: { '1m': 1.52, '3m': 1.58, '6m': 1.66 },
  thb_implied_rate: { '1m': 1.45, '3m': 1.5, '6m': 1.56 },
  external_rate: { fed_funds: 4.25, sofr: 4.3, ecb: 2.15 },
};

/** สัดส่วนการส่งผ่านดอกเบี้ยนโยบายไปยังอัตราอื่น */
const PASS_THROUGH: Record<string, number> = {
  lending_rate: 0.6,
  deposit_rate: 0.5,
  interbank_rate: 1.0,
  bibor: 0.95,
  thb_implied_rate: 0.9,
  external_rate: 0,
};

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** เลขสุ่มคงที่ในช่วง [0,1) จากข้อความ — ค่าเดิมเสมอสำหรับ input เดิม */
function unitNoise(seed: string): number {
  return hash32(seed) / 4294967296;
}

function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * อัตราดอกเบี้ยนโยบายที่มีผล ณ วันที่กำหนด
 *
 * ขั้นบันไดเรียงจากใหม่ไปเก่า (daysAgo น้อย = เพิ่งเกิด) อัตราที่มีผล ณ วันหนึ่ง ๆ คือ
 * การปรับครั้งล่าสุดที่เกิดขึ้น "ก่อนหรือตรงกับ" วันนั้น = ขั้นที่ daysAgo น้อยที่สุด
 * ในบรรดาขั้นที่เก่ากว่าหรือเท่ากับวันนั้น
 */
export function policyRateAt(date: Date, now: Date = new Date()): number {
  const age = (now.getTime() - date.getTime()) / DAY_MS;
  let applicable = POLICY_STEPS[POLICY_STEPS.length - 1]!;
  for (const step of POLICY_STEPS) {
    if (step.daysAgo >= age && step.daysAgo < applicable.daysAgo) applicable = step;
  }
  return applicable.daysAgo >= age ? applicable.rate : POLICY_STEPS[POLICY_STEPS.length - 1]!.rate;
}

function stepObservations(now: Date, start: Date, end: Date): BotObservation[] {
  const out: BotObservation[] = [];
  // เรียงจากเก่าไปใหม่
  const steps = [...POLICY_STEPS].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const step of steps) {
    const when = new Date(now.getTime() - step.daysAgo * DAY_MS);
    if (when >= start && when <= end) {
      out.push({ period: toIsoDate(when), dimension: 'default', value: step.rate });
    }
  }
  // ถ้าไม่มีการเปลี่ยนอัตราในช่วงที่ขอ ให้ใส่ค่าที่มีผลอยู่ ณ วันเริ่มช่วง
  if (out.length === 0 || out[0]!.period !== toIsoDate(start)) {
    out.unshift({
      period: toIsoDate(start),
      dimension: 'default',
      value: policyRateAt(start, now),
    });
  }
  return out;
}

/** ค่าอัตราแลกเปลี่ยนแบบเดินรายวัน: ผสมคลื่นช้าสองลูกกับสัญญาณรบกวนเล็กน้อย */
function fxValue(base: number, dimension: string, date: Date): number {
  const t = dayIndex(date);
  const wave =
    0.012 * Math.sin(t / 37 + hash32(dimension) % 100 / 100) +
    0.006 * Math.sin(t / 11 + 1.3) +
    0.0025 * (unitNoise(`${dimension}:${t}`) - 0.5) * 2;
  const value = base * (1 + wave);
  return base >= 1 ? Math.round(value * 10000) / 10000 : Math.round(value * 1e6) / 1e6;
}

function rateValue(
  seriesId: string,
  base: number,
  dimension: string,
  date: Date,
  now: Date,
): number {
  const pass = PASS_THROUGH[seriesId] ?? 0;
  const delta = (policyRateAt(date, now) - 1.5) * pass;
  const jitter = (unitNoise(`${seriesId}:${dimension}:${Math.floor(dayIndex(date) / 7)}`) - 0.5) * 0.02;
  return Math.round((base + delta + jitter) * 100) / 100;
}

export interface MockBotClientOptions {
  /** ตรึงเวลา "ปัจจุบัน" ในเทสต์ */
  now?: Date;
}

export class MockBotClient implements BotApiClient {
  readonly kind = 'mock' as const;
  private readonly now: Date;

  constructor(options: MockBotClientOptions = {}) {
    this.now = options.now ?? new Date();
  }

  async fetchSeries(
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
  ): Promise<BotFetchResult> {
    const window = defaultWindow(90);
    const start = new Date(`${params.start ?? window.start}T00:00:00.000Z`);
    const end = new Date(`${params.end ?? window.end}T00:00:00.000Z`);

    const observations =
      descriptor.id === 'policy_rate'
        ? stepObservations(this.now, start, end)
        : this.buildObservations(descriptor, params, start, end);

    const lastUpdated =
      observations.length > 0
        ? new Date(`${observations[observations.length - 1]!.period}T07:00:00.000Z`).toISOString()
        : null;

    return { observations, lastUpdated, unit: descriptor.unit };
  }

  private buildObservations(
    descriptor: BotSeriesDescriptor,
    params: BotFetchParams,
    start: Date,
    end: Date,
  ): BotObservation[] {
    const levels = BASE_LEVELS[descriptor.id] ?? {};
    let dimensions = descriptor.dimensions.filter((d) => levels[d] !== undefined);
    if (descriptor.supportsCurrency && params.currency) {
      const wanted = params.currency.toUpperCase();
      dimensions = dimensions.filter((d) => d === wanted);
      if (dimensions.length === 0) dimensions = [wanted];
    }

    const isFx = descriptor.unit === 'thb_per_unit';
    // อัตราดอกเบี้ยประกาศเปลี่ยนไม่บ่อย จึงจำลองเป็นรายสัปดาห์; FX เป็นรายวันทำการ
    const stepDays = isFx ? 1 : 7;

    const out: BotObservation[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += stepDays * DAY_MS) {
      const date = new Date(t);
      if (isFx && isWeekend(date)) continue;
      const period = toIsoDate(date);
      for (const dimension of dimensions) {
        const base = levels[dimension] ?? 1;
        const value = isFx
          ? fxValue(base, dimension, date)
          : rateValue(descriptor.id, base, dimension, date, this.now);
        out.push({ period, dimension, value });
      }
    }

    // รับประกันว่ามีข้อมูลของวันล่าสุดเสมอ แม้ช่วงที่ขอจะสั้นมาก
    if (out.length === 0) {
      const period = toIsoDate(end);
      for (const dimension of dimensions) {
        const base = levels[dimension] ?? 1;
        out.push({
          period,
          dimension,
          value: isFx
            ? fxValue(base, dimension, end)
            : rateValue(descriptor.id, base, dimension, end, this.now),
        });
      }
    }

    return out;
  }
}
