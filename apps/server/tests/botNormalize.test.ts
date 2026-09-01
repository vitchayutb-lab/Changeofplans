import { describe, expect, it } from 'vitest';
import {
  extractDetail,
  extractLastUpdated,
  flattenRows,
  matchesRowFilter,
  normalizePeriod,
  normalizeSeries,
} from '../src/services/bot/botNormalize.js';
import { LOAN_RATE_RESPONSE } from './fixtures/botLoanRate.js';
import { BOT_SERIES } from '../src/services/bot/botSeries.js';
import { BotApiError } from '../src/services/bot/botTypes.js';

/** ตัวอย่างผลลัพธ์รูปแบบเดียวกับที่ BOT API ส่งกลับ */
function envelope(detail: unknown, header: Record<string, unknown> = {}): unknown {
  return {
    result: {
      success: 'true',
      api: 'test',
      timestamp: '2026-08-29 14:00:00',
      data: { data_header: header, data_detail: detail },
    },
  };
}

describe('extractDetail', () => {
  it('อ่าน data_detail จากโครงสร้างมาตรฐานของ BOT ได้', () => {
    const rows = extractDetail(envelope([{ period: '2026-08-01', rate: '1.50' }]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2026-08-01' });
  });

  it('รับกรณีที่ data_detail เป็นอ็อบเจ็กต์เดี่ยวได้', () => {
    expect(extractDetail(envelope({ period: '2026-08-01', rate: '1.5' }))).toHaveLength(1);
  });

  it('โยน BotApiError เมื่อรูปแบบไม่ตรง แทนที่จะเดาค่า', () => {
    expect(() => extractDetail({ unexpected: true })).toThrow(BotApiError);
    expect(() => extractDetail('not json')).toThrow(BotApiError);
  });
});

describe('extractLastUpdated', () => {
  it('อ่านเวลาอัปเดตจาก data_header', () => {
    const value = extractLastUpdated(envelope([], { last_updated: '2026-08-28 07:30:00' }));
    expect(value).toBe(new Date('2026-08-28T07:30:00').toISOString());
  });

  it('ถอยไปใช้ result.timestamp เมื่อไม่มีใน header', () => {
    expect(extractLastUpdated(envelope([]))).not.toBeNull();
  });

  it('คืน null เมื่อไม่มีข้อมูลเวลาเลย', () => {
    expect(extractLastUpdated({ result: { data: {} } })).toBeNull();
  });
});

describe('flattenRows', () => {
  it('คลี่ array ซ้อนพร้อมยกค่าของแถวแม่ลงไปด้วย', () => {
    const rows = flattenRows(
      [{ period: '2026-08-01', bank_series: [{ mlr: '5.8' }, { mlr: '6.0' }] }],
      ['bank_series'],
    );
    expect(rows).toEqual([
      { period: '2026-08-01', mlr: '5.8' },
      { period: '2026-08-01', mlr: '6.0' },
    ]);
  });

  it('ปล่อยแถวที่ไม่มี array ซ้อนไว้ตามเดิม', () => {
    const rows = flattenRows([{ period: '2026-08-01', rate: '1.5' }], ['bank_series']);
    expect(rows).toEqual([{ period: '2026-08-01', rate: '1.5' }]);
  });
});

describe('normalizePeriod', () => {
  it.each([
    ['2026-08-29', '2026-08-29'],
    ['2026-08', '2026-08-01'],
    ['2026', '2026-01-01'],
    ['29/08/2026', '2026-08-29'],
    ['29-08-2026', '2026-08-29'],
  ])('แปลง %s เป็น %s', (input, expected) => {
    expect(normalizePeriod(input)).toBe(expected);
  });

  it('คืน null เมื่ออ่านวันที่ไม่ออก', () => {
    expect(normalizePeriod('ไม่ใช่วันที่')).toBeNull();
  });
});

describe('normalizeSeries', () => {
  it('แปลงอัตราดอกเบี้ยนโยบายเป็นจุดข้อมูลมาตรฐาน', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.policy_rate,
      envelope([
        { period: '2026-06-24', rate: '1.50' },
        { period: '2026-04-30', rate: '1.75' },
      ]),
    );
    expect(observations).toEqual([
      { period: '2026-04-30', dimension: 'default', value: 1.75 },
      { period: '2026-06-24', dimension: 'default', value: 1.5 },
    ]);
  });

  it('เฉลี่ยอัตราดอกเบี้ยเงินกู้รายธนาคารให้เหลือค่าเดียวต่อวัน', () => {
    // ธปท. ส่งมาหนึ่งแถวต่อ (วัน, ธนาคาร) — ดูรูปแบบจริงได้ที่ tests/fixtures/botLoanRate.ts
    const bank = (name: string, mlr: string, mor: string, mrr: string) => ({
      period: '2026-08-24',
      bank_type_name_eng: 'Commercial Banks registered in Thailand',
      bank_name_eng: name,
      mlr,
      mor,
      mrr,
    });
    const { observations } = normalizeSeries(
      BOT_SERIES.lending_rate,
      envelope([bank('A', '5.80', '6.20', '6.00'), bank('B', '5.90', '6.40', '6.10')]),
    );
    const mlr = observations.find((o) => o.dimension === 'MLR');
    expect(mlr?.value).toBeCloseTo(5.85, 6);
    expect(observations.map((o) => o.dimension).sort()).toEqual(['MLR', 'MOR', 'MRR']);
  });

  it('ใช้คอลัมน์ currency_id เป็นชื่อมิติสำหรับอัตราแลกเปลี่ยน', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.fx_average,
      envelope([
        { period: '2026-08-28', currency_id: 'usd', mid_rate: '34.5120' },
        { period: '2026-08-28', currency_id: 'eur', mid_rate: '37.6000' },
      ]),
    );
    expect(observations.map((o) => o.dimension)).toEqual(['EUR', 'USD']);
    expect(observations.find((o) => o.dimension === 'USD')?.value).toBe(34.512);
  });

  it('อ่านตัวเลขที่มีเครื่องหมายจุลภาคได้', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.fx_average,
      envelope([{ period: '2026-08-28', currency_id: 'JPY', mid_rate: '1,234.5' }]),
    );
    expect(observations[0]?.value).toBe(1234.5);
  });

  it('โยน BotApiError เมื่อไม่พบคอลัมน์ค่าที่ต้องการ แทนที่จะคืนข้อมูลว่าง ๆ', () => {
    expect(() =>
      normalizeSeries(BOT_SERIES.policy_rate, envelope([{ period: '2026-08-01', unknown: '1' }])),
    ).toThrow(BotApiError);
  });

  it('บอกชื่อคอลัมน์ที่ได้มาจริง เพื่อให้แก้ทะเบียนได้ตรงจุด', () => {
    try {
      normalizeSeries(
        BOT_SERIES.policy_rate,
        envelope([{ period: '2026-08-01', unexpected_column: '1.5' }]),
      );
      expect.unreachable('ควรโยนข้อผิดพลาด');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('unexpected_column');
      expect(message).toContain('botSeries.ts');
    }
  });

  it('data_detail ที่เป็น array ว่าง = ไม่มีข้อมูลในช่วงที่ขอ ไม่ใช่ผลลัพธ์ที่อ่านไม่ออก', () => {
    // BOT ตอบแบบนี้เมื่อช่วงวันที่ที่ขอไม่มีวันทำการ เช่น ขอเฉพาะวันอาทิตย์
    const result = normalizeSeries(BOT_SERIES.lending_rate, envelope([]));
    expect(result.observations).toEqual([]);
    expect(result.lastUpdated).not.toBeUndefined();
  });
});

describe('normalizeSeries กับผลลัพธ์จริงของ /LoanRate/v2/loan_rate/', () => {
  const { observations, lastUpdated } = normalizeSeries(BOT_SERIES.lending_rate, LOAN_RATE_RESPONSE);
  const at = (period: string, dimension: string): number | undefined =>
    observations.find((o) => o.period === period && o.dimension === dimension)?.value;

  it('เฉลี่ยเฉพาะธนาคารพาณิชย์ไทย ไม่รวมสาขาธนาคารต่างประเทศ', () => {
    // ธนาคารพาณิชย์ไทยที่ประกาศ MLR มี 17 แห่ง เฉลี่ยได้ 7.002647
    // ถ้ารวมสาขาต่างประเทศเข้าไปด้วยจะได้ราว 6.87 ซึ่งต่ำกว่าที่ผู้กู้ไทยเจอจริง
    expect(at('2026-08-03', 'MLR')).toBeCloseTo(7.002647, 6);
    expect(at('2026-08-03', 'MOR')).toBeCloseTo(6.953824, 6);
  });

  it('ข้ามธนาคารที่ไม่ได้ประกาศอัตรา ทั้งแบบช่องว่างและแบบ 0.0000', () => {
    // MRR มีผู้ประกาศ 15 แห่ง (สแตนดาร์ดชาร์เตอร์ด กับ ซูมิโตโม มิตซุย ทรัสต์ เว้นว่าง,
    // คลิกซ์ยังไม่ประกาศเลย) — ถ้านับช่องว่างเป็น 0 ค่าเฉลี่ยจะเพี้ยนลงทันที
    expect(at('2026-08-03', 'MRR')).toBeCloseTo(7.383667, 6);
    expect(at('2026-08-03', 'MRR')).toBeGreaterThan(at('2026-08-03', 'MLR') as number);
  });

  it('แยกค่าเฉลี่ยรายวัน ไม่ยุบทุกวันเข้าด้วยกัน', () => {
    // วันที่ 4 ในไฟล์ตัวอย่างมีธนาคารไทย 4 แห่ง: (6.35 + 6.30 + 6.52 + 6.35) / 4
    expect(at('2026-08-04', 'MLR')).toBeCloseTo(6.38, 6);
    expect([...new Set(observations.map((o) => o.period))]).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('อ่านครบทั้งสามมิติที่ทะเบียนประกาศไว้', () => {
    const dimensions = [...new Set(observations.map((o) => o.dimension))].sort();
    expect(dimensions).toEqual(['MLR', 'MOR', 'MRR']);
  });

  it('อ่านเวลาอัปเดตจาก result.timestamp ของผลลัพธ์จริง', () => {
    expect(lastUpdated).toBe(new Date('2026-08-31T00:20:49').toISOString());
  });

  it('data_detail ของ endpoint นี้แบนอยู่แล้ว จึงไม่ต้องคลี่ array ซ้อน', () => {
    expect(BOT_SERIES.lending_rate.nestedArrayKeys).toEqual([]);
  });
});

describe('ตัวคัดกรองแถว', () => {
  const filter = BOT_SERIES.lending_rate.rowFilter;

  it('รับแถวที่อยู่ในกลุ่มที่ระบุ ทั้งชื่อภาษาไทยและอังกฤษ', () => {
    expect(matchesRowFilter({ bank_type_name_eng: 'Commercial Banks registered in Thailand' }, filter)).toBe(true);
    expect(matchesRowFilter({ bank_type_name_th: 'ธนาคารพาณิชย์จดทะเบียนในประเทศ' }, filter)).toBe(true);
    expect(matchesRowFilter({ bank_type_name_eng: 'Foreign Bank Branches' }, filter)).toBe(false);
  });

  it('รับแถวไว้ทั้งหมดเมื่อผลลัพธ์ไม่มีคอลัมน์กลุ่ม แทนที่จะทิ้งข้อมูลทิ้ง', () => {
    expect(matchesRowFilter({ period: '2026-08-03', mlr: '6.35' }, filter)).toBe(true);
    expect(matchesRowFilter({ anything: 1 }, undefined)).toBe(true);
  });

  it('บอกให้ชัดเมื่อ ธปท. ส่งข้อมูลมาแต่ไม่มีแถวไหนผ่านตัวคัดกรองเลย', () => {
    const foreignOnly = {
      result: {
        data: {
          data_detail: [
            { period: '2026-08-03', bank_type_name_eng: 'Foreign Bank Branches', mlr: '7.75' },
          ],
        },
      },
    };
    expect(() => normalizeSeries(BOT_SERIES.lending_rate, foreignOnly)).toThrow(
      /Foreign Bank Branches/,
    );
  });
});

describe('รูปแบบผลลัพธ์ที่ยังไม่รู้จัก', () => {
  it('รับกรณีที่แถวข้อมูลอยู่ใน result.data ตรง ๆ ไม่มีชั้น data_detail', () => {
    const rows = extractDetail({ result: { data: [{ period: '2026-08-01', rate: '1.50' }] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2026-08-01' });
  });

  it('บอกคีย์ที่ได้มาจริง เมื่อไม่รู้จักรูปแบบ แทนที่จะบอกแค่ว่าไม่มี data_detail', () => {
    // ผลลัพธ์จริงของ PolicyRate/v3 ไม่มี data_detail และข้อความเดิมไม่บอกว่ามีอะไรแทน
    // จึงต้องเดารูปแบบใหม่ทุกครั้ง แทนที่จะแก้ได้จบในรอบเดียว
    expect(() =>
      extractDetail({ result: { timestamp: 'x', api: 'y', data: { observations: [] } } }),
    ).toThrow(/timestamp, api, data.*observations/s);
  });
})

describe('รูปแบบจริงของ PolicyRate/v3 และ DepositRate/v2', () => {
  it('อ่านอัตราดอกเบี้ยนโยบายที่ ธปท. คืนมาเป็นค่าเดียวที่ result.data', () => {
    // คีย์ที่ได้จากการเรียกจริง: result{timestamp, api, data, announcement_date,
    // news_text_en, news_text_th, effective_datetime} — data เป็นค่าเดี่ยว ไม่ใช่ array
    const { observations } = normalizeSeries(BOT_SERIES.policy_rate, {
      result: {
        timestamp: '2026-08-31 00:20:49',
        api: 'Policy Rate',
        data: '1.50',
        announcement_date: '2026-06-18',
        news_text_th: 'กนง. มีมติ…',
        effective_datetime: '2026-06-24 00:00:00',
      },
    });
    expect(observations).toEqual([{ period: '2026-06-24', dimension: 'default', value: 1.5 }]);
  });

  it('รายงานเงินฝากเป็นจุดกึ่งกลางของช่วงที่ ธปท. ประกาศ', () => {
    // ธปท. ให้มาเป็นช่วง _min/_max ต่อระยะฝาก การหยิบขอบเดียวจะสูงหรือต่ำเกินจริง
    const bank = (name: string, min: string, max: string) => ({
      period: '2026-08-27',
      bank_type_name_eng: 'Commercial Banks registered in Thailand',
      bank_name_eng: name,
      fix_12_mths_min: min,
      fix_12_mths_max: max,
    });
    const { observations } = normalizeSeries(
      BOT_SERIES.deposit_rate,
      envelope([bank('A', '1.00', '1.50'), bank('B', '1.20', '1.70')]),
    );
    const twelve = observations.find((o) => o.dimension === '12m');
    // (1.00 + 1.50 + 1.20 + 1.70) / 4
    expect(twelve?.value).toBeCloseTo(1.35, 6);
  });

  it('ข้ามขอบที่ธนาคารไม่ได้ประกาศ แทนที่จะดึงกึ่งกลางให้ต่ำลง', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.deposit_rate,
      envelope([
        {
          period: '2026-08-27',
          bank_type_name_eng: 'Commercial Banks registered in Thailand',
          fix_12_mths_min: '2.00',
          fix_12_mths_max: '',
        },
      ]),
    );
    expect(observations.find((o) => o.dimension === '12m')?.value).toBeCloseTo(2.0, 6);
  });

  it('ยังคัดเฉพาะธนาคารพาณิชย์ไทยเหมือนชุดอัตราดอกเบี้ยเงินกู้', () => {
    expect(BOT_SERIES.deposit_rate.rowFilter?.accept).toContain(
      'Commercial Banks registered in Thailand',
    );
    expect(BOT_SERIES.deposit_rate.nestedArrayKeys).toEqual([]);
  });
})

describe('รูปแบบจริงของ Stat-SpotRate/v2', () => {
  it('คิด mid rate จากราคาซื้อและราคาขายที่ ธปท. ให้มา', () => {
    // คอลัมน์จริงจากการเรียก: period, bid_rate, offer_rate — ไม่มีค่ากลางให้อ่านตรง ๆ
    const { observations } = normalizeSeries(
      BOT_SERIES.spot_rate,
      envelope([
        { period: '2026-08-27', bid_rate: '34.5800', offer_rate: '34.6400' },
        { period: '2026-08-28', bid_rate: '34.6000', offer_rate: '34.6202' },
      ]),
    );
    expect(observations).toEqual([
      { period: '2026-08-27', dimension: 'USD', value: 34.61 },
      { period: '2026-08-28', dimension: 'USD', value: 34.6101 },
    ]);
  });

  it('ข้ามวันที่ไม่มีการซื้อขาย แทนที่จะรายงานอัตราศูนย์', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.spot_rate,
      envelope([
        { period: '2026-08-29', bid_rate: '0.0000', offer_rate: '0.0000' },
        { period: '2026-08-28', bid_rate: '34.6000', offer_rate: '34.6202' },
      ]),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]?.period).toBe('2026-08-28');
  });
})

describe('ข้อความเมื่อไม่เหลือค่าให้อ่าน', () => {
  it('แยกได้ว่าตกเพราะวันที่ ไม่ใช่เพราะค่า', () => {
    // อาการจริงของ spot_rate: คอลัมน์ค่าตรงแล้ว แต่ยังขึ้นว่า "อ่านค่าไม่ได้"
    // ทำให้ไล่หาผิดจุด ทั้งที่แถวถูกทิ้งตั้งแต่ตอนอ่านวันที่
    expect(() =>
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([{ period: 'ไม่ใช่วันที่', bid_rate: '34.58', offer_rate: '34.64' }]),
      ),
    ).toThrow(/อ่านวันที่ไม่ได้ทั้ง 1 แถว/);
  });

  it('บอกว่าอ่านค่าไม่ได้ เมื่อวันที่ใช้ได้แต่ค่าไม่มี', () => {
    expect(() =>
      normalizeSeries(BOT_SERIES.spot_rate, envelope([{ period: '2026-08-27', bid_rate: '', offer_rate: '' }])),
    ).toThrow(/อ่านค่าไม่ได้จาก 1 แถว/);
  });

  it('เตือนว่าค่า 0 ถูกนับเป็นไม่มีข้อมูล เมื่อชุดนั้นตั้งไว้แบบนั้น', () => {
    expect(() =>
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([{ period: '2026-08-27', bid_rate: '0.0000', offer_rate: '0.0000' }]),
      ),
    ).toThrow(/ค่า 0 ถือว่าไม่มีข้อมูล/);
  });

  it('แนบแถวจริงหนึ่งแถวมาด้วย เพื่อให้เห็นค่าที่ ธปท. ส่งมาจริง', () => {
    let message = '';
    try {
      normalizeSeries(BOT_SERIES.spot_rate, envelope([{ period: '2026-08-27', bid_rate: '-', offer_rate: '-' }]));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('bid_rate="-"');
  });

  it('ยกแถวที่มีค่ามากที่สุดมาโชว์ ไม่ใช่แถวแรกที่บังเอิญว่าง', () => {
    // เคสจริงจาก Stat-ExternalInterestRate: แถวแรกมีแต่ชื่อประเภท ไม่มีทั้งวันที่และค่า
    // การโชว์แถวแรกทำให้ตัวอย่างไม่บอกอะไรเลย และเสียเวลาไปหนึ่งรอบเต็ม
    let message = '';
    try {
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([
          { period: '', bid_rate: '', offer_rate: '', note: 'หัวตาราง' },
          { period: '2026-08-27', bid_rate: '-', offer_rate: '-', note: 'ของจริง' },
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('2026-08-27');
    expect(message).toContain('ของจริง');
  });

  it('อ่านวันที่ไม่ได้ทั้งหมด แนบส่วนหัวมาด้วย เพราะวันที่ต้องไปอยู่ที่อื่น', () => {
    let message = '';
    try {
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([{ period: '', bid_rate: '1.5', offer_rate: '1.6' }], {
          as_of_date: '2026-08-29',
        }),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('ส่วนหัว');
    expect(message).toContain('as_of_date');
    expect(message).toContain('2026-08-29');
  });

  it('บอกจำนวนแถวที่ว่างทั้งแถว เพื่อแยกออกจากแถวที่อ่านไม่ออก', () => {
    let message = '';
    try {
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([
          { period: '', bid_rate: '', offer_rate: '' },
          { period: '2026-08-27', bid_rate: '-', offer_rate: '-' },
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('1/2');
  });
});

describe('แถวเปล่าที่ ธปท. ส่งมาแทนคำว่า "ไม่มีข้อมูล"', () => {
  it('ถือว่าไม่มีข้อมูล ไม่ใช่ข้อผิดพลาด', () => {
    // ของจริงจาก /Stat-SpotRate/v2/SPOTRATE: หนึ่งแถว ทุกช่องเป็นสตริงว่าง
    const { observations } = normalizeSeries(
      BOT_SERIES.spot_rate,
      envelope([{ period: '', bid_rate: '', offer_rate: '' }]),
    );
    expect(observations).toEqual([]);
  });

  it('ยังดังเหมือนเดิมเมื่อแถวมีค่าอยู่จริงแต่อ่านไม่ได้', () => {
    // ต่างกันตรงนี้: มีข้อมูลมาจริง แต่เราตีความไม่ออก = ยังเป็นบั๊กที่ต้องรู้
    expect(() =>
      normalizeSeries(
        BOT_SERIES.spot_rate,
        envelope([{ period: '2026-08-27', bid_rate: 'ไม่ใช่ตัวเลข', offer_rate: 'ไม่ใช่ตัวเลข' }]),
      ),
    ).toThrow(/อ่านค่าไม่ได้/);
  });

  it('แถวเปล่าปนกับแถวที่มีข้อมูล ยังอ่านแถวที่มีข้อมูลได้ตามปกติ', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.spot_rate,
      envelope([
        { period: '', bid_rate: '', offer_rate: '' },
        { period: '2026-08-27', bid_rate: '34.58', offer_rate: '34.64' },
      ]),
    );
    expect(observations).toEqual([{ period: '2026-08-27', dimension: 'USD', value: 34.61 }]);
  });
});

describe('เพดานดอกเบี้ยและอัตราผิดนัด อ่านจาก payload จริงชุดเดียวกับดอกเบี้ยเงินกู้', () => {
  const { observations } = normalizeSeries(BOT_SERIES.loan_ceiling_rate, LOAN_RATE_RESPONSE);
  const at = (dimension: string) =>
    observations.find((o) => o.period === '2026-08-03' && o.dimension === dimension)?.value;

  it('เฉลี่ยเฉพาะธนาคารพาณิชย์ไทย เหมือนชุดดอกเบี้ยเงินกู้', () => {
    expect(at('ceiling')).toBeCloseTo(20.708529, 6);
    expect(at('penalty')).toBeCloseTo(22.857647, 6);
  });

  it('อัตราผิดนัดสูงกว่าเพดานปกติ ซึ่งสูงกว่า MLR อีกทอด', () => {
    // เหตุผลที่ต้องแยกชุด: สเกลห่างจาก MLR ราวสามเท่า
    const { observations: lending } = normalizeSeries(BOT_SERIES.lending_rate, LOAN_RATE_RESPONSE);
    const mlr = lending.find((o) => o.period === '2026-08-03' && o.dimension === 'MLR')?.value;
    expect(mlr).toBeCloseTo(7.002647, 6);
    expect(at('ceiling')).toBeGreaterThan(mlr as number);
    expect(at('penalty')).toBeGreaterThan(at('ceiling') as number);
  });

  it('ข้ามธนาคารที่ยังไม่ประกาศ เหมือนกัน', () => {
    // คลิกซ์ส่งช่องว่าง ซิตี้แบงก์ส่ง 0.0000 และเป็นสาขาต่างประเทศจึงถูกกรองอยู่แล้ว
    expect(observations.filter((o) => o.period === '2026-08-03')).toHaveLength(2);
  });
});

describe('ชุดดอกเบี้ยเงินกู้ต้องไม่ปนเพดานเข้ามา', () => {
  it('lending_rate ยังมีแค่ MLR/MOR/MRR', () => {
    // การ์ด "ดอกเบี้ยเงินกู้เฉลี่ย" เฉลี่ยทุกมิติของชุดนี้ ถ้าเพดานหลุดเข้ามา
    // ตัวเลขจะกระโดดจาก ~7% เป็น ~15% โดยไม่มีอะไรฟ้อง
    expect(Object.keys(BOT_SERIES.lending_rate.valueFields).sort()).toEqual(['MLR', 'MOR', 'MRR']);
    const { observations } = normalizeSeries(BOT_SERIES.lending_rate, LOAN_RATE_RESPONSE);
    expect([...new Set(observations.map((o) => o.dimension))].sort()).toEqual(['MLR', 'MOR', 'MRR']);
  });
});

describe('ชุดข้อมูลที่แก้ตามผลลัพธ์จริงของ ธปท.', () => {
  it('interbank_rate: อ่านค่าเฉลี่ยถ่วงน้ำหนัก และแยกมิติตามช่วงอายุ', () => {
    // แถวจริงจาก /Stat-InterbankTransactionRate/v2/INTRBNK_TXN_RATE/
    const { observations } = normalizeSeries(
      BOT_SERIES.interbank_rate,
      envelope([
        {
          period: '2026-08-28',
          term_type_name_th: 'O/N',
          term_type_name_eng: 'O/N',
          min_interest_rate: '0.90000',
          max_interest_rate: '1.00500',
          mode_interest_rate: '0.90000',
          weighted_average_interest_rate: '0.95790',
        },
      ]),
    );

    expect(observations).toEqual([{ period: '2026-08-28', dimension: 'O/N', value: 0.9579 }]);
  });

  it('interbank_rate: ช่วงอายุที่ไม่ได้ประกาศไว้ล่วงหน้าก็ยังได้ค่า', () => {
    // ธปท. ส่งมาสิบกว่าช่วงอายุ การประกาศไว้ไม่ครบต้องไม่ทำให้ข้อมูลหาย
    const { observations } = normalizeSeries(
      BOT_SERIES.interbank_rate,
      envelope([
        { period: '2026-08-28', term_type_name_eng: '1W', weighted_average_interest_rate: '1.05' },
      ]),
    );
    expect(observations).toEqual([{ period: '2026-08-28', dimension: '1W', value: 1.05 }]);
  });

  it('interbank_rate: ไม่หยิบขอบของช่วงมาแทนค่าเฉลี่ย', () => {
    // min/max/mode อยู่ในแถวเดียวกัน ถ้าหลุดเข้าไปใน valueFields ตัวเลขจะเพี้ยนแบบเงียบ ๆ
    // ไม่มีค่าเฉลี่ยถ่วงน้ำหนักให้อ่านต้องดัง ไม่ใช่เอาขอบล่างมาแทนแล้วเงียบ
    expect(() =>
      normalizeSeries(
        BOT_SERIES.interbank_rate,
        envelope([
          {
            period: '2026-08-28',
            term_type_name_eng: 'O/N',
            min_interest_rate: '0.90000',
            max_interest_rate: '1.00500',
          },
        ]),
      ),
    ).toThrow(/คอลัมน์ค่าที่รองรับ: weighted_average_interest_rate ·/);
  });

  for (const id of ['thb_implied_rate', 'external_rate'] as const) {
    it(`${id}: อ่าน interest_rate และแยกมิติตามประเภทอัตรา`, () => {
      // คอลัมน์ยืนยันแล้วจากผลลัพธ์จริง ที่ยังไม่รู้คือวันที่ไปอยู่ที่ไหน
      // เทสต์นี้จึงใส่วันที่ให้ เพื่อตรวจเฉพาะส่วนที่รู้แล้วว่าถูก
      const { observations } = normalizeSeries(
        BOT_SERIES[id],
        envelope([
          {
            period: '2026-08-28',
            rate_type_name_th: 'ONSHORE : T/N',
            rate_type_name_eng: 'ONSHORE : T/N',
            interest_rate: '1.4500',
          },
        ]),
      );
      expect(observations).toEqual([
        { period: '2026-08-28', dimension: 'ONSHORE : T/N', value: 1.45 },
      ]);
    });
  }
});

describe('โครงรายงานที่ ธปท. ส่งมาเมื่อช่วงที่ขอไม่มีข้อมูล', () => {
  // ของจริงจาก Stat-ThaiBahtImpliedInterestRate เมื่อขอช่วงปี 2026
  // ส่วนหัวบอกว่ารายงานอัปเดตล่าสุด 2024-12-27 แถวจึงมีแต่ชื่อประเภทอัตรา ไม่มีตัวเลข
  const SKELETON = [
    { period: '', rate_type_name_th: 'ONSHORE : T/N', rate_type_name_eng: 'ONSHORE : T/N', interest_rate: '' },
    { period: '', rate_type_name_th: 'ONSHORE : 1M', rate_type_name_eng: 'ONSHORE : 1M', interest_rate: '' },
  ];

  it('ถือว่าไม่มีข้อมูล ไม่ใช่ข้อผิดพลาด', () => {
    const { observations } = normalizeSeries(
      BOT_SERIES.thb_implied_rate,
      envelope(SKELETON, { last_updated: '2024-12-27' }),
    );
    expect(observations).toEqual([]);
  });

  it('ยังบอกวันที่ ธปท. อัปเดตล่าสุด เพื่อให้รู้ว่าทำไมถึงว่าง', () => {
    const { lastUpdated } = normalizeSeries(
      BOT_SERIES.thb_implied_rate,
      envelope(SKELETON, { last_updated: '2024-12-27' }),
    );
    expect(lastUpdated).toContain('2024-12-27');
  });

  it('ชื่อคอลัมน์ผิดยังต้องดังเหมือนเดิม — คนละอาการกับไม่มีข้อมูล', () => {
    // ต่างกันที่คอลัมน์ "ไม่มีอยู่" ไม่ใช่ "มีอยู่แต่ว่าง"
    expect(() =>
      normalizeSeries(
        BOT_SERIES.thb_implied_rate,
        envelope([{ วันที่: '2026-08-28', rate_type_name_eng: 'ONSHORE : T/N', อัตรา: '1.45' }]),
      ),
    ).toThrow(/ปรับ periodFields\/valueFields/);
  });

  it('คอลัมน์วันที่ตรงแต่คอลัมน์ค่าไม่มีเลย ต้องยังดัง', () => {
    // เจอตอนรันจริง: เช็คแค่ "มีคอลัมน์สักช่องแล้วว่าง" ไม่พอ — spot_rate อ่าน period ได้
    // แต่ bid_rate/offer_rate ไม่มีอยู่ในแถวเลย ซึ่งคือชื่อคอลัมน์ผิด ไม่ใช่ไม่มีข้อมูล
    expect(() => normalizeSeries(BOT_SERIES.spot_rate, envelope(SKELETON))).toThrow(
      /ปรับ periodFields\/valueFields/,
    );
  });

  it('มีค่าอยู่จริงแต่อ่านไม่ออกก็ยังดัง', () => {
    // '-' ไม่ใช่ค่าว่าง มันคือค่าที่เราอ่านไม่ได้ ซึ่งเป็นบั๊ก ไม่ใช่คำตอบว่าไม่มีข้อมูล
    expect(() =>
      normalizeSeries(
        BOT_SERIES.thb_implied_rate,
        envelope([{ period: '2026-08-28', rate_type_name_eng: 'ONSHORE : T/N', interest_rate: '-' }]),
      ),
    ).toThrow(/อ่านค่าไม่ได้/);
  });

  it('บางแถวมีค่าจริงก็ต้องอ่านให้ได้ ไม่ใช่ทิ้งทั้งชุด', () => {
    // ถ้าเผลอถือว่า "มีแถวว่างปน = ไม่มีข้อมูล" ข้อมูลจริงจะหายไปเงียบ ๆ
    const { observations } = normalizeSeries(
      BOT_SERIES.thb_implied_rate,
      envelope([
        ...SKELETON,
        { period: '2024-12-27', rate_type_name_eng: 'ONSHORE : 1M', interest_rate: '1.4500' },
      ]),
    );
    expect(observations).toEqual([
      { period: '2024-12-27', dimension: 'ONSHORE : 1M', value: 1.45 },
    ]);
  });
});

describe('bibor — รูปแบบจริงจาก /BIBOR/v2/bibor_rate/', () => {
  // หนึ่งแถวต่อ (วัน, ธนาคาร) แล้วกางช่วงอายุออกเป็นคอลัมน์ เหมือน LoanRate/DepositRate
  const ROW = {
    period: '2026-08-03',
    bankname_th: 'ธนาคารกรุงเทพ จำกัด (มหาชน)',
    bankname_eng: 'Bangkok Bank',
    bibor_o_n: '1.01000',
    bibor_1_week: '1.02000',
    bibor_1_month: '1.05000',
    bibor_2_month: '1.10000',
    bibor_3_month: '1.15000',
    bibor_6_month: '1.22000',
    bibor_9_month: '',
    bibor_1_year: '1.35000',
  };

  it('อ่านครบทุกช่วงอายุที่ธนาคารเสนอ', () => {
    const { observations } = normalizeSeries(BOT_SERIES.bibor, envelope([ROW]));
    expect(observations).toEqual([
      { period: '2026-08-03', dimension: '1M', value: 1.05 },
      { period: '2026-08-03', dimension: '1W', value: 1.02 },
      { period: '2026-08-03', dimension: '1Y', value: 1.35 },
      { period: '2026-08-03', dimension: '2M', value: 1.1 },
      { period: '2026-08-03', dimension: '3M', value: 1.15 },
      { period: '2026-08-03', dimension: '6M', value: 1.22 },
      { period: '2026-08-03', dimension: 'O/N', value: 1.01 },
    ]);
  });

  it('ช่วงอายุที่ธนาคารไม่ได้เสนอไม่กลายเป็นศูนย์', () => {
    // bibor_9_month ว่างในแถวจริง ถ้านับเป็น 0 กราฟจะดิ่งลงทั้งที่ไม่มีใครเสนอราคา
    const { observations } = normalizeSeries(BOT_SERIES.bibor, envelope([ROW]));
    expect(observations.some((o) => o.dimension === '9M')).toBe(false);
  });

  it('เฉลี่ยข้ามธนาคารในวันเดียวกัน', () => {
    // ธปท. ส่งราคาที่แต่ละธนาคารเสนอมาทีละราย ค่าที่แสดงคือค่าเฉลี่ยของวันนั้น
    const { observations } = normalizeSeries(
      BOT_SERIES.bibor,
      envelope([
        { period: '2026-08-03', bankname_eng: 'A', bibor_o_n: '1.00000' },
        { period: '2026-08-03', bankname_eng: 'B', bibor_o_n: '1.20000' },
      ]),
    );
    expect(observations).toEqual([{ period: '2026-08-03', dimension: 'O/N', value: 1.1 }]);
  });
});
