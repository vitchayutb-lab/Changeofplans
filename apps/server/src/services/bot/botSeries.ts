/**
 * ทะเบียนชุดข้อมูลของ Bank of Thailand
 *
 * ทุกอย่างที่ระบบรู้เกี่ยวกับชุดข้อมูลหนึ่ง ๆ (path, พารามิเตอร์, ชื่อคอลัมน์, อายุแคช)
 * อยู่ในไฟล์นี้ไฟล์เดียว การเพิ่มชุดข้อมูลใหม่จึงไม่ต้องแก้ route หรือแก้ client
 *
 * หมายเหตุเรื่องชื่อคอลัมน์: BOT API แต่ละ endpoint ตั้งชื่อฟิลด์ไม่เหมือนกันและปรับได้
 * ตามเวอร์ชัน จึงเก็บเป็น "รายการชื่อที่เป็นไปได้" แล้วให้ตัวแปลงเลือกอันแรกที่เจอ
 * ถ้าไม่เจอเลยจะถือว่ารูปแบบผลลัพธ์ไม่ตรงและถอยไปใช้ข้อมูลสำรอง แทนที่จะเดาค่า
 */

import type { BotSeriesCatalogEntry, BotSeriesId } from '@sme/shared';
import type { BotSeriesDescriptor } from './botTypes.js';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const BOT_SERIES: Record<BotSeriesId, BotSeriesDescriptor> = {
  policy_rate: {
    id: 'policy_rate',
    title: 'Policy Interest Rate',
    titleTh: 'อัตราดอกเบี้ยนโยบาย',
    path: '/PolicyRate/v3/policy_rate',
    unit: 'percent_per_annum',
    ttlSeconds: 1 * HOUR,
    supportsDateRange: true,
    supportsCurrency: false,
    dimensions: ['default'],
    // v3 คืนค่าปัจจุบันค่าเดียว วันที่มีผลอยู่ที่ effective_datetime (ตรวจกับผลลัพธ์จริง)
    periodFields: ['period', 'effective_datetime', 'effective_date', 'announcement_date', 'date'],
    valueFields: {
      default: ['policy_rate', 'rate', 'value', 'interest_rate'],
    },
    nestedArrayKeys: ['policy_rate', 'detail', 'rate_detail'],
    description:
      'อัตราดอกเบี้ยนโยบายที่คณะกรรมการนโยบายการเงินกำหนด เป็นฐานของต้นทุนเงินทั้งระบบ',
  },

  lending_rate: {
    id: 'lending_rate',
    title: 'Loan Interest Rates of Commercial Banks',
    titleTh: 'อัตราดอกเบี้ยเงินให้กู้ยืมของธนาคารพาณิชย์',
    path: '/LoanRate/v2/loan_rate/',
    unit: 'percent_per_annum',
    ttlSeconds: 1 * HOUR,
    supportsDateRange: true,
    // ธปท. ตอบ 400 เมื่อขอ 90 วัน แต่รับ 27 วันได้ (ตรวจกับการเรียกจริง)
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['MLR', 'MOR', 'MRR'],
    periodFields: ['period', 'date', 'as_of_date'],
    valueFields: {
      MLR: ['mlr', 'MLR', 'rate_mlr', 'min_loan_rate'],
      MOR: ['mor', 'MOR', 'rate_mor', 'min_overdraft_rate'],
      MRR: ['mrr', 'MRR', 'rate_mrr', 'min_retail_rate'],
    },
    // ตรวจกับผลลัพธ์จริงแล้ว: data_detail แบน หนึ่งแถวต่อ (วัน, ธนาคาร) ไม่มี array ซ้อน
    nestedArrayKeys: [],
    // ชุดนี้รวมสาขาธนาคารต่างประเทศมาด้วย ซึ่งอัตรากระจายกว้างกว่ามาก (เช่น MLR 6.0–9.7)
    // และ SME ไทยไม่ได้กู้จากกลุ่มนั้น จึงเฉลี่ยเฉพาะธนาคารพาณิชย์ที่จดทะเบียนในประเทศ
    rowFilter: {
      field: ['bank_type_name_eng', 'bank_type_name_th', 'bank_type'],
      accept: ['Commercial Banks registered in Thailand', 'ธนาคารพาณิชย์จดทะเบียนในประเทศ'],
      label: 'กลุ่มธนาคารพาณิชย์ที่จดทะเบียนในประเทศ',
    },
    // ธนาคารที่ไม่ได้ประกาศอัตราส่งมาเป็นช่องว่างหรือ 0.0000 แล้วแต่ธนาคาร
    treatZeroAsMissing: true,
    description:
      'อัตราดอกเบี้ยเงินกู้ประกาศของธนาคารพาณิชย์ (MLR / MOR / MRR) ใช้เป็นฐานคิดต้นทุนสินเชื่อ SME',
  },

  loan_ceiling_rate: {
    id: 'loan_ceiling_rate',
    title: 'Ceiling and Default Rates of Commercial Banks',
    titleTh: 'เพดานดอกเบี้ยและอัตราผิดนัดชำระของธนาคารพาณิชย์',
    // endpoint เดียวกับ lending_rate แต่คนละคอลัมน์ — แยกชุดเพราะสเกลต่างกันหลายเท่า
    // (MLR ~7% เทียบกับเพดาน 12-35%) ถ้าอยู่ชุดเดียวกันจะทำให้กราฟอ่านไม่ได้
    // และการ์ด "ดอกเบี้ยเงินกู้เฉลี่ย" ซึ่งเฉลี่ยทุกมิติจะเพี้ยนไปเป็นเท่าตัว
    path: '/LoanRate/v2/loan_rate/',
    unit: 'percent_per_annum',
    ttlSeconds: 1 * HOUR,
    supportsDateRange: true,
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['ceiling', 'penalty'],
    periodFields: ['period', 'date', 'as_of_date'],
    valueFields: {
      ceiling: ['ceiling_rate'],
      penalty: ['default_rate'],
    },
    nestedArrayKeys: [],
    rowFilter: {
      field: ['bank_type_name_eng', 'bank_type_name_th', 'bank_type'],
      accept: ['Commercial Banks registered in Thailand', 'ธนาคารพาณิชย์จดทะเบียนในประเทศ'],
      label: 'กลุ่มธนาคารพาณิชย์ที่จดทะเบียนในประเทศ',
    },
    treatZeroAsMissing: true,
    description:
      'เพดานอัตราดอกเบี้ยสูงสุดที่ธนาคารเรียกเก็บได้ตามประกาศ และอัตราที่ใช้เมื่อผิดนัดชำระ ' +
      'ใช้ประเมินความเสี่ยงขาลง: ถ้าจ่ายไม่ไหว ต้นทุนจะขยับไปที่อัตราผิดนัด ไม่ใช่อัตราเดิม',
  },

  deposit_rate: {
    id: 'deposit_rate',
    title: 'Deposit Interest Rates of Commercial Banks',
    titleTh: 'อัตราดอกเบี้ยเงินฝากของธนาคารพาณิชย์',
    path: '/DepositRate/v2/deposit_rate/',
    unit: 'percent_per_annum',
    ttlSeconds: 1 * HOUR,
    supportsDateRange: true,
    // ธปท. ตอบ 400 เมื่อขอ 90 วัน แต่รับ 27 วันได้ (ตรวจกับการเรียกจริง)
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['savings', '3m', '6m', '12m', '24m'],
    periodFields: ['period', 'date', 'as_of_date'],
    // ตรวจกับผลลัพธ์จริงแล้ว: ธปท. ประกาศเป็นช่วง จึงมีทั้ง _min และ _max ต่อระยะฝาก
    valueFields: {
      savings: ['saving_min', 'saving_max'],
      '3m': ['fix_3_mths_min', 'fix_3_mths_max'],
      '6m': ['fix_6_mths_min', 'fix_6_mths_max'],
      '12m': ['fix_12_mths_min', 'fix_12_mths_max'],
      '24m': ['fix_24_mths_min', 'fix_24_mths_max'],
    },
    // ค่าที่รายงานคือจุดกึ่งกลางของช่วง ไม่ใช่ขอบใดขอบหนึ่ง
    averageValueFields: true,
    // ตรวจแล้วเช่นเดียวกับ LoanRate: data_detail แบน หนึ่งแถวต่อ (วัน, ธนาคาร)
    nestedArrayKeys: [],
    rowFilter: {
      field: ['bank_type_name_eng', 'bank_type_name_th', 'bank_type'],
      accept: ['Commercial Banks registered in Thailand', 'ธนาคารพาณิชย์จดทะเบียนในประเทศ'],
      label: 'กลุ่มธนาคารพาณิชย์ที่จดทะเบียนในประเทศ',
    },
    treatZeroAsMissing: true,
    description:
      'อัตราดอกเบี้ยเงินฝากออมทรัพย์และประจำของบุคคลธรรมดา ธปท. ประกาศเป็นช่วง ' +
      'ค่าที่แสดงคือจุดกึ่งกลางของช่วงเฉลี่ยข้ามธนาคารพาณิชย์ไทย ' +
      'ใช้เทียบผลตอบแทนของเงินสดที่ถืออยู่',
  },

  spot_rate: {
    id: 'spot_rate',
    title: 'Spot Rate USD/THB',
    titleTh: 'อัตราแลกเปลี่ยนทันที ดอลลาร์สหรัฐ/บาท',
    // อยู่ใน Interest Rates Plan เดียวกับชุดอัตราดอกเบี้ย จึงใช้ได้ด้วยคีย์เดิม
    // ต่างจาก Stat-ExchangeRate / Stat-ReferenceRate ที่อยู่คนละ product
    // เอกสาร API ระบุ GET .../SPOTRATE/ พร้อม slash ปิดท้าย ตรงกับชุดอื่นที่ใช้งานได้แล้ว
    // ค่าเดิมคัดลอกมาจาก "Listen path" ในหน้า Overview ซึ่งตัด slash ออก
    path: '/Stat-SpotRate/v2/SPOTRATE/',
    unit: 'thb_per_unit',
    ttlSeconds: 10 * MINUTE,
    supportsDateRange: true,
    // ยังไม่ทราบเพดานของ endpoint นี้ ตั้งเท่าที่ยืนยันแล้วว่า ธปท. รับได้ในชุดอื่น
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['USD'],
    periodFields: ['period', 'date', 'as_of_date'],
    // ตรวจกับผลลัพธ์จริงแล้ว: ธปท. ให้ราคาสองด้าน (bid_rate, offer_rate) ไม่ใช่ค่าเดียว
    valueFields: {
      USD: ['bid_rate', 'offer_rate'],
    },
    // ค่าที่รายงานคือ mid rate — จุดกึ่งกลางของราคาซื้อกับราคาขาย ตามธรรมเนียมตลาด
    averageValueFields: true,
    // ไม่มีอัตราแลกเปลี่ยนที่เป็นศูนย์จริง ค่า 0 จึงเป็นช่องว่างของวันที่ไม่มีการซื้อขาย
    treatZeroAsMissing: true,
    nestedArrayKeys: [],
    description:
      'อัตราแลกเปลี่ยนทันที USD/THB ที่ ธปท. เผยแพร่ ค่าที่แสดงคือ mid rate ' +
      '(กึ่งกลางราคาซื้อ-ขาย) ใช้ประเมินผลกระทบค่าเงินต่อรายได้และต้นทุนนำเข้า',
  },

  fx_reference: {
    id: 'fx_reference',
    title: 'Weighted-average Interbank Exchange Rate THB/USD',
    titleTh: 'อัตราแลกเปลี่ยนอ้างอิงเฉลี่ยระหว่างธนาคาร (บาท/ดอลลาร์)',
    path: '/Stat-ReferenceRate/v2/DAILY_REF_RATE/',
    unit: 'thb_per_unit',
    ttlSeconds: 10 * MINUTE,
    supportsDateRange: true,
    supportsCurrency: false,
    dimensions: ['USD'],
    periodFields: ['period', 'date'],
    valueFields: {
      USD: ['rate', 'mid_rate', 'value', 'usd_thb'],
    },
    nestedArrayKeys: ['detail', 'observation'],
    description: 'อัตราอ้างอิงรายวัน THB/USD ที่ ธปท. ประกาศ',
  },

  fx_average: {
    id: 'fx_average',
    title: 'Average Exchange Rate THB / Foreign Currency',
    titleTh: 'อัตราแลกเปลี่ยนเฉลี่ย บาทต่อเงินตราต่างประเทศ',
    path: '/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/',
    unit: 'thb_per_unit',
    ttlSeconds: 10 * MINUTE,
    supportsDateRange: true,
    supportsCurrency: true,
    dimensions: ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'],
    periodFields: ['period', 'date'],
    dimensionField: 'currency_id',
    valueFields: {
      default: ['mid_rate', 'selling', 'buying_transfer', 'buying_sight', 'rate'],
    },
    nestedArrayKeys: ['detail', 'observation'],
    description: 'อัตราแลกเปลี่ยนเฉลี่ยรายวันต่อสกุลเงินต่าง ๆ (ค่าเป็นบาทต่อ 1 หน่วย)',
  },

  interbank_rate: {
    id: 'interbank_rate',
    title: 'Interbank Transaction Rates',
    titleTh: 'อัตราดอกเบี้ยธุรกรรมระหว่างธนาคาร',
    path: '/Stat-InterbankTransactionRate/v2/INTRBNK_TXN_RATE/',
    unit: 'percent_per_annum',
    ttlSeconds: 30 * MINUTE,
    supportsDateRange: true,
    // ทุก endpoint ที่ยืนยันแล้วตอบ 400 เมื่อขอ 90 วัน และหน้าข้อมูลตลาดตั้งต้นที่ 90 วัน
    // ชุดนี้ยังไม่เคยยืนยันกับ ธปท. จริง จึงตั้งเท่าที่รู้ว่ารับได้ ไม่ปล่อยให้พังตั้งแต่คลิกแรก
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['overnight'],
    periodFields: ['period', 'date'],
    valueFields: {
      overnight: ['overnight', 'rate_overnight', 'rate', 'average', 'avg_rate'],
    },
    nestedArrayKeys: ['detail', 'observation', 'rate_detail'],
    description: 'อัตราดอกเบี้ยกู้ยืมระหว่างธนาคารระยะข้ามคืน สะท้อนสภาพคล่องในตลาดเงิน',
  },

  bibor: {
    id: 'bibor',
    title: 'Bangkok Interbank Offered Rate (BIBOR)',
    titleTh: 'อัตราดอกเบี้ยอ้างอิงระยะสั้นตลาดกรุงเทพ (BIBOR)',
    path: '/BIBOR/v2/bibor/',
    unit: 'percent_per_annum',
    ttlSeconds: 30 * MINUTE,
    supportsDateRange: true,
    // ทุก endpoint ที่ยืนยันแล้วตอบ 400 เมื่อขอ 90 วัน และหน้าข้อมูลตลาดตั้งต้นที่ 90 วัน
    // ชุดนี้ยังไม่เคยยืนยันกับ ธปท. จริง จึงตั้งเท่าที่รู้ว่ารับได้ ไม่ปล่อยให้พังตั้งแต่คลิกแรก
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['1m', '3m', '6m'],
    periodFields: ['period', 'date'],
    valueFields: {
      '1m': ['bibor_1m', 'rate_1m', '1m'],
      '3m': ['bibor_3m', 'rate_3m', '3m'],
      '6m': ['bibor_6m', 'rate_6m', '6m'],
    },
    nestedArrayKeys: ['detail', 'observation', 'rate_detail'],
    description: 'อัตราอ้างอิงระยะสั้นที่ธนาคารเสนอกู้ยืมกันเอง ใช้อ้างอิงสินเชื่อลอยตัวบางประเภท',
  },

  thb_implied_rate: {
    id: 'thb_implied_rate',
    title: 'Thai Baht Implied Interest Rate',
    titleTh: 'อัตราดอกเบี้ยเงินบาทโดยนัย',
    path: '/Stat-ThaiBahtImpliedInterestRate/v2/THB_IMPL_INT_RATE/',
    unit: 'percent_per_annum',
    ttlSeconds: 6 * HOUR,
    supportsDateRange: true,
    // ทุก endpoint ที่ยืนยันแล้วตอบ 400 เมื่อขอ 90 วัน และหน้าข้อมูลตลาดตั้งต้นที่ 90 วัน
    // ชุดนี้ยังไม่เคยยืนยันกับ ธปท. จริง จึงตั้งเท่าที่รู้ว่ารับได้ ไม่ปล่อยให้พังตั้งแต่คลิกแรก
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['1m', '3m', '6m'],
    periodFields: ['period', 'date'],
    valueFields: {
      '1m': ['rate_1m', 'implied_1m', '1m'],
      '3m': ['rate_3m', 'implied_3m', '3m'],
      '6m': ['rate_6m', 'implied_6m', '6m'],
    },
    nestedArrayKeys: ['detail', 'observation'],
    description: 'อัตราดอกเบี้ยเงินบาทที่คำนวณย้อนจากธุรกรรมสวอปเงินตราต่างประเทศ',
  },

  external_rate: {
    id: 'external_rate',
    title: 'External Interest Rates',
    titleTh: 'อัตราดอกเบี้ยต่างประเทศ',
    path: '/Stat-ExternalInterestRate/v2/EXT_INT_RATE/',
    unit: 'percent_per_annum',
    ttlSeconds: 6 * HOUR,
    supportsDateRange: true,
    // ทุก endpoint ที่ยืนยันแล้วตอบ 400 เมื่อขอ 90 วัน และหน้าข้อมูลตลาดตั้งต้นที่ 90 วัน
    // ชุดนี้ยังไม่เคยยืนยันกับ ธปท. จริง จึงตั้งเท่าที่รู้ว่ารับได้ ไม่ปล่อยให้พังตั้งแต่คลิกแรก
    maxRangeDays: 31,
    supportsCurrency: false,
    dimensions: ['fed_funds', 'sofr', 'ecb'],
    periodFields: ['period', 'date'],
    valueFields: {
      fed_funds: ['fed_fund_rate', 'fed_funds', 'us_rate'],
      sofr: ['sofr', 'sofr_rate'],
      ecb: ['ecb_rate', 'euro_rate', 'ecb'],
    },
    nestedArrayKeys: ['detail', 'observation'],
    description: 'อัตราดอกเบี้ยอ้างอิงของต่างประเทศ ใช้เทียบทิศทางดอกเบี้ยโลกกับไทย',
  },
};

export function getSeriesDescriptor(id: string): BotSeriesDescriptor | null {
  return (BOT_SERIES as Record<string, BotSeriesDescriptor>)[id] ?? null;
}

export function listSeriesDescriptors(): BotSeriesDescriptor[] {
  return Object.values(BOT_SERIES);
}

/** รายการชุดข้อมูลสำหรับแสดงในหน้า Developer และเอกสาร */
export function seriesCatalog(): BotSeriesCatalogEntry[] {
  return listSeriesDescriptors().map((d) => ({
    seriesId: d.id,
    title: d.title,
    titleTh: d.titleTh,
    path: d.path,
    unit: d.unit,
    ttlSeconds: d.ttlSeconds,
    dimensions: d.dimensions,
    description: d.description,
  }));
}
