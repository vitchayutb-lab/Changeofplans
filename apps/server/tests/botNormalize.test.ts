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
