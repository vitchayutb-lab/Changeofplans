import { describe, expect, it } from 'vitest';
import {
  extractDetail,
  extractLastUpdated,
  flattenRows,
  normalizePeriod,
  normalizeSeries,
} from '../src/services/bot/botNormalize.js';
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
    const { observations } = normalizeSeries(
      BOT_SERIES.lending_rate,
      envelope([
        {
          period: '2026-08-24',
          bank_series: [
            { mlr: '5.80', mor: '6.20', mrr: '6.00' },
            { mlr: '5.90', mor: '6.40', mrr: '6.10' },
          ],
        },
      ]),
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
});
