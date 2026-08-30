/**
 * สัญญา (interface) ของอะแดปเตอร์ Bank of Thailand
 *
 * ทุกอย่างที่คุยกับ BOT API ต้องผ่าน BotApiClient ตัวนี้ ทำให้สลับระหว่าง
 * ตัวจริง (LiveBotClient) กับตัวจำลอง (MockBotClient) ได้โดยไม่แตะโค้ดส่วนอื่น
 */

import type { BotObservation, BotSeriesId, BotUnit } from '@sme/shared';

/** พารามิเตอร์ที่ส่งเข้า BOT API ได้ */
export interface BotFetchParams {
  /** YYYY-MM-DD */
  start?: string;
  /** YYYY-MM-DD */
  end?: string;
  /** สกุลเงิน เช่น USD (เฉพาะชุดข้อมูลอัตราแลกเปลี่ยน) */
  currency?: string;
}

/** คำอธิบายชุดข้อมูลหนึ่งชุด — เพิ่มชุดใหม่ = เพิ่มรายการเดียวในตารางนี้ */
export interface BotSeriesDescriptor {
  id: BotSeriesId;
  title: string;
  titleTh: string;
  /** path ต่อท้าย BOT_API_BASE_URL (ไม่ใช่ความลับ — ความลับคือ API key เท่านั้น) */
  path: string;
  unit: BotUnit;
  /** อายุแคชเป็นวินาที */
  ttlSeconds: number;
  supportsDateRange: boolean;
  supportsCurrency: boolean;
  /** มิติที่ชุดนี้ควรมี เช่น ["MLR","MOR","MRR"] หรือ ["default"] */
  dimensions: string[];
  /** ชื่อคอลัมน์ที่อาจใช้เก็บวันที่ในผลลัพธ์ของ BOT */
  periodFields: string[];
  /**
   * map จากชื่อมิติ -> รายชื่อคอลัมน์ที่อาจเก็บค่านั้น
   * เขียนเป็นรายการตัวเลือกเพราะแต่ละ endpoint ของ BOT ตั้งชื่อคอลัมน์ไม่เหมือนกัน
   * และเปลี่ยนได้ตามเวอร์ชันของ API
   */
  valueFields: Record<string, string[]>;
  /** คีย์ของ array ซ้อนที่ต้องคลี่ออกก่อนอ่านค่า (เช่น รายธนาคาร) — [] ถ้า data_detail แบนอยู่แล้ว */
  nestedArrayKeys: string[];
  /**
   * คัดเฉพาะแถวที่ต้องการก่อนเฉลี่ยค่า
   *
   * ชุดอัตราดอกเบี้ยของ ธปท. ส่งมาทุกธนาคารรวมกันในชุดเดียว ทั้งธนาคารพาณิชย์ไทย
   * และสาขาธนาคารต่างประเทศ ซึ่งอัตราต่างกันมากและกลุ่มหลังไม่ใช่แหล่งกู้ของ SME ไทย
   * ถ้าเฉลี่ยรวมกันจะได้ตัวเลขที่ไม่ตรงกับที่ผู้กู้เจอจริง
   */
  rowFilter?: {
    /** ชื่อคอลัมน์ที่อาจเก็บกลุ่มของแถว (ลองตามลำดับ) */
    field: string[];
    /** ค่าที่ยอมรับ (เทียบแบบไม่สนตัวพิมพ์) */
    accept: string[];
    /** ใช้ในข้อความผิดพลาดเมื่อคัดแล้วไม่เหลือแถวเลย */
    label: string;
  };
  /**
   * ถือค่า 0 เป็น "ไม่ได้ประกาศ" แทนที่จะเป็นอัตราศูนย์
   *
   * ธนาคารบางแห่งส่ง 0.0000 มาทุกคอลัมน์แทนการเว้นว่าง การนับรวมจะดึงค่าเฉลี่ยลง
   * ทั้งชุด — และไม่มีธนาคารไหนปล่อยกู้ที่ 0% จริง
   */
  treatZeroAsMissing?: boolean;
  /** ถ้ากำหนด จะใช้ค่าในคอลัมน์นี้เป็นชื่อมิติ (เช่น currency_id -> "USD") */
  dimensionField?: string;
  description: string;
}

/** ผลลัพธ์ดิบที่ client ส่งกลับ ก่อนถูกห่อด้วยข้อมูล provenance */
export interface BotFetchResult {
  observations: BotObservation[];
  /** เวลาที่ BOT ระบุว่าอัปเดตข้อมูลล่าสุด (ถ้ามี) */
  lastUpdated: string | null;
  unit: BotUnit;
}

export interface BotApiClient {
  /** ชื่อไว้แสดงใน log และหน้า Developer */
  readonly kind: 'live' | 'mock';
  fetchSeries(descriptor: BotSeriesDescriptor, params: BotFetchParams): Promise<BotFetchResult>;
}

/** ความผิดพลาดจากฝั่ง BOT ที่แยกประเภทได้ เพื่อให้ชั้นบนตัดสินใจถอยได้ถูก */
export type BotErrorCause =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'response'
  /** ตั้งค่าผิด เช่น BOT_API_BASE_URL ไม่ใช่ URL — ลองใหม่กี่ครั้งก็ไม่หาย */
  | 'config';

export class BotApiError extends Error {
  readonly reason: BotErrorCause;
  readonly status: number | undefined;

  constructor(message: string, reason: BotErrorCause, status?: number) {
    super(message);
    this.name = 'BotApiError';
    this.reason = reason;
    this.status = status;
  }

  /** ควรลองใหม่ไหม */
  get retryable(): boolean {
    return this.reason === 'network' || this.reason === 'timeout' || this.reason === 'server';
  }
}
