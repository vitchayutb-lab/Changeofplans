/**
 * DTOs สำหรับข้อมูลจากธนาคารแห่งประเทศไทย (Bank of Thailand)
 *
 * ทุกค่าที่มาจาก BOT จะพก "ที่มา" (provenance) ติดมาด้วยเสมอ เพื่อให้หน้าเว็บ
 * แสดงป้าย Source / Updated ได้ตรงความจริง และแยกข้อมูลจริงกับข้อมูลจำลองออกจากกัน
 */

/** ที่มาของข้อมูลชุดหนึ่ง ๆ */
export type DataSource = 'bot' | 'demo' | 'local';

/** โหมดการทำงานของแหล่งข้อมูลภายนอกแต่ละตัว */
export type SourceMode = 'live' | 'demo' | 'degraded';

/** รหัสชุดข้อมูลที่ระบบรู้จัก — ใช้เป็นคีย์ทั้งใน registry, cache และ API */
export type BotSeriesId =
  | 'policy_rate'
  | 'lending_rate'
  | 'deposit_rate'
  | 'loan_ceiling_rate'
  | 'spot_rate'
  | 'fx_reference'
  | 'fx_average'
  | 'interbank_rate'
  | 'bibor'
  | 'thb_implied_rate'
  | 'external_rate';

export const BOT_SERIES_IDS: BotSeriesId[] = [
  'policy_rate',
  'lending_rate',
  'deposit_rate',
  'loan_ceiling_rate',
  'spot_rate',
  'fx_reference',
  'fx_average',
  'interbank_rate',
  'bibor',
  'thb_implied_rate',
  'external_rate',
];

/** หน่วยของค่าที่อ่านได้ */
export type BotUnit = 'percent_per_annum' | 'thb_per_unit' | 'index' | 'ratio';

/** ข้อมูลว่าค่านี้มาจากไหน อัปเดตเมื่อไร และเป็นข้อมูลค้างหรือไม่ */
export interface Provenance {
  source: DataSource;
  /** ป้ายที่แสดงบนหน้าเว็บ เช่น "Bank of Thailand" หรือ "Demo Data" */
  sourceLabel: string;
  /** เวลาที่ BOT ประกาศข้อมูลงวดล่าสุด (ISO-8601) */
  lastUpdated: string | null;
  /** เวลาที่เซิร์ฟเวอร์ดึงข้อมูลชุดนี้ (ISO-8601) */
  fetchedAt: string;
  /** true = เป็นข้อมูลจริงแต่หมดอายุ cache แล้ว และ BOT ตอบไม่ได้ในรอบนี้ */
  stale: boolean;
  cache: { hit: boolean; ageSeconds: number; ttlSeconds: number };
  /** ข้อความแจ้งผู้ใช้ เช่น "BOT data temporarily unavailable." */
  notice: string | null;
}

/** จุดข้อมูลหนึ่งจุดในอนุกรมเวลา */
export interface BotObservation {
  /** วันที่ของข้อมูล รูปแบบ YYYY-MM-DD */
  period: string;
  /** มิติย่อย เช่น "USD", "MLR", "12m" — ชุดที่มีมิติเดียวใช้ "default" */
  dimension: string;
  value: number;
}

/** อนุกรมข้อมูลหนึ่งชุดที่ผ่านการแปลงเป็นรูปแบบมาตรฐานแล้ว */
export interface BotSeries {
  seriesId: BotSeriesId;
  title: string;
  titleTh: string;
  unit: BotUnit;
  /** มิติทั้งหมดที่มีในชุดนี้ เช่น ["MLR","MOR","MRR"] */
  dimensions: string[];
  observations: BotObservation[];
  provenance: Provenance;
}

/** ค่าล่าสุดพร้อมค่าก่อนหน้าและส่วนต่าง — รูปแบบที่การ์ดบนหน้าเว็บใช้ */
export interface BotMetric {
  key: string;
  label: string;
  labelTh: string;
  unit: BotUnit;
  current: number | null;
  previous: number | null;
  /** current - previous */
  change: number | null;
  /** ส่วนต่างเป็นเปอร์เซ็นต์ของค่าเดิม (ใช้กับอัตราแลกเปลี่ยน) */
  changePercent: number | null;
  currentPeriod: string | null;
  previousPeriod: string | null;
  provenance: Provenance;
}

/** ชุดตัวเลขสำหรับแดชบอร์ด "Market & Economic Data" */
export interface BotSummary {
  policyRate: BotMetric;
  lendingRate: BotMetric;
  depositRate: BotMetric;
  usdThb: BotMetric;
  /** true เมื่อมีอย่างน้อยหนึ่งค่าที่เป็นข้อมูลจำลอง */
  anyDemo: boolean;
  notice: string | null;
}

/** รายการชุดข้อมูลที่ระบบรองรับ (ใช้ในหน้า Developer และเอกสาร) */
export interface BotSeriesCatalogEntry {
  seriesId: BotSeriesId;
  title: string;
  titleTh: string;
  /** path บน BOT API gateway — เปิดเผยได้ ไม่ใช่ความลับ (ความลับคือ API key) */
  path: string;
  unit: BotUnit;
  ttlSeconds: number;
  dimensions: string[];
  description: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  time: string;
  demoMode: boolean;
  modes: {
    bot: SourceMode;
    llm: SourceMode;
    database: 'ok' | 'error';
  };
  bot: {
    /** บอกเพียงว่ามีการตั้งค่า key ไว้หรือไม่ — ไม่เปิดเผยค่าหรือความยาวของ key */
    apiKeyConfigured: boolean;
    /**
     * อักขระที่ครอบคีย์มาแล้วระบบตัดออกให้ เช่น "<>" (null = ค่าสะอาด)
     * บอกแค่ชนิดของอักขระ ไม่เปิดเผยตัวคีย์หรือความยาว
     */
    apiKeyWrapper?: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    cachedSeries: number;
    /** ข้อความอธิบายเมื่อ BOT_API_BASE_URL ตั้งค่าไว้ผิด (null = ตั้งถูก) */
    baseUrlError: string | null;
    /**
     * สถานะแยกรายชุดข้อมูล
     *
     * ธปท. ให้สิทธิ์แยกรายชุด บางชุดจึงเรียกได้และบางชุดไม่ได้พร้อมกัน
     * ค่ารวมตัวเดียวจะบอกได้แค่ชุดที่พังล่าสุด ซึ่งซ่อนว่าอีกหกชุดเป็นอย่างไร
     */
    series?: BotSeriesHealth[];
  };
}

/**
 * ผลการทดสอบเรียกชุดข้อมูลหนึ่งชุดกับ ธปท. จริง โดยไม่ผ่านแคชและไม่ถอยไปข้อมูลจำลอง
 *
 * ทะเบียนชุดข้อมูลเก็บ path และชื่อคอลัมน์ที่คาดว่า ธปท. ใช้ ซึ่งบางชุดยังไม่เคยยืนยัน
 * กับผลลัพธ์จริง การรู้ว่า "เรียกติดแต่ไม่มีมิติไหนได้ค่าเลย" ต่างจาก "เรียกไม่ติด"
 * คนละเรื่อง และเป็นสิ่งที่บอกได้ว่าต้องแก้ตรงไหน
 */
export interface BotSeriesProbe {
  seriesId: BotSeriesId;
  titleTh: string;
  path: string;
  ok: boolean;
  /** ข้อความผิดพลาดตามจริงจากการเรียก (null เมื่อสำเร็จ) */
  error: string | null;
  /** จำนวนจุดข้อมูลที่แปลงออกมาได้ */
  observations: number;
  /**
   * จำนวนแถวที่ ธปท. ส่งมาก่อนแปลง
   *
   * ศูนย์จุดข้อมูลจากหลายสิบแถวคือคนละอาการกับศูนย์จุดข้อมูลจากศูนย์แถว
   * และเป็นสิ่งเดียวที่แยกสองกรณีนั้นออกจากกันได้จากภายนอก
   */
  rows: number;
  /** มิติที่ทะเบียนประกาศไว้ */
  declaredDimensions: string[];
  /**
   * มิติที่มีค่าออกมาจริง
   *
   * ต่างจากที่ประกาศเมื่อไร แปลว่าชื่อคอลัมน์ใน valueFields ไม่ตรงกับผลลัพธ์ของ ธปท.
   * ซึ่งเป็นคนละอาการกับเรียกไม่ติด และแก้คนละที่
   */
  dimensionsWithData: string[];
  /** ช่วงที่ขอไปจริง หลังตัดตาม maxRangeDays แล้ว */
  requested: { start: string; end: string };
  firstPeriod: string | null;
  lastPeriod: string | null;
  elapsedMs: number;
}

/** สถานะการเรียกของชุดข้อมูลหนึ่งชุด นับตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน */
export interface BotSeriesHealth {
  seriesId: BotSeriesId;
  titleTh: string;
  /** true = เคยดึงข้อมูลจริงสำเร็จอย่างน้อยหนึ่งครั้ง */
  ok: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}
