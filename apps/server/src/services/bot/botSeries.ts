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
    periodFields: ['period', 'effective_date', 'date', 'as_of_date'],
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
    supportsCurrency: false,
    dimensions: ['MLR', 'MOR', 'MRR'],
    periodFields: ['period', 'date', 'as_of_date'],
    valueFields: {
      MLR: ['mlr', 'MLR', 'rate_mlr', 'min_loan_rate'],
      MOR: ['mor', 'MOR', 'rate_mor', 'min_overdraft_rate'],
      MRR: ['mrr', 'MRR', 'rate_mrr', 'min_retail_rate'],
    },
    // ผลลัพธ์อาจแยกเป็นรายธนาคาร — คลี่ออกแล้วเฉลี่ยต่อวัน
    nestedArrayKeys: ['bank_series', 'bank_list', 'detail', 'rate_detail', 'observation'],
    description:
      'อัตราดอกเบี้ยเงินกู้ประกาศของธนาคารพาณิชย์ (MLR / MOR / MRR) ใช้เป็นฐานคิดต้นทุนสินเชื่อ SME',
  },

  deposit_rate: {
    id: 'deposit_rate',
    title: 'Deposit Interest Rates of Commercial Banks',
    titleTh: 'อัตราดอกเบี้ยเงินฝากของธนาคารพาณิชย์',
    path: '/DepositRate/v2/deposit_rate/',
    unit: 'percent_per_annum',
    ttlSeconds: 1 * HOUR,
    supportsDateRange: true,
    supportsCurrency: false,
    dimensions: ['savings', '3m', '6m', '12m', '24m'],
    periodFields: ['period', 'date', 'as_of_date'],
    valueFields: {
      savings: ['saving', 'savings', 'saving_rate', 'rate_saving'],
      '3m': ['fixed_3m', 'deposit_3m', 'rate_3m', '3m', 'time_3m'],
      '6m': ['fixed_6m', 'deposit_6m', 'rate_6m', '6m', 'time_6m'],
      '12m': ['fixed_12m', 'deposit_12m', 'rate_12m', '12m', 'time_12m'],
      '24m': ['fixed_24m', 'deposit_24m', 'rate_24m', '24m', 'time_24m'],
    },
    nestedArrayKeys: ['bank_series', 'bank_list', 'detail', 'rate_detail', 'observation'],
    description: 'อัตราดอกเบี้ยเงินฝากออมทรัพย์และประจำ ใช้เทียบผลตอบแทนของเงินสดที่ถืออยู่',
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
