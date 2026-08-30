/**
 * เครื่องมือดึงข้อมูลจากธนาคารแห่งประเทศไทย
 *
 * เครื่องมือเหล่านี้ไม่ได้ถือ API key เอง แต่เรียกผ่าน BotService ซึ่งเป็นชั้นเดียว
 * ที่รู้จักคีย์และกติกาการแคช/ถอยไปข้อมูลจำลอง
 */

import type { BotMetric, BotSeriesId } from '@sme/shared';
import { BOT_SERIES_IDS } from '@sme/shared';
import { getBotService } from '../../services/bot/botService.js';
import { getSeriesDescriptor, seriesCatalog } from '../../services/bot/botSeries.js';
import { defineSchema, field } from '../schema.js';
import type { ToolDefinition, ToolResult } from '../registry.js';

/** สรุปตัวเลขให้อยู่ในรูปที่โมเดลอ่านง่ายและอ้างที่มาได้ */
function metricPayload(metric: BotMetric): Record<string, unknown> {
  return {
    label: metric.label,
    labelTh: metric.labelTh,
    unit: metric.unit,
    current: metric.current,
    previous: metric.previous,
    change: metric.change,
    changePercent: metric.changePercent,
    asOf: metric.currentPeriod,
    previousAsOf: metric.previousPeriod,
    source: metric.provenance.sourceLabel,
    lastUpdated: metric.provenance.lastUpdated,
    isDemoData: metric.provenance.source === 'demo',
  };
}

function citationFor(metric: BotMetric, what: string): ToolResult['citation'] {
  return {
    label: `${metric.provenance.sourceLabel} — ${what}`,
    asOf: metric.currentPeriod ?? metric.provenance.lastUpdated,
  };
}

const policyRate: ToolDefinition = {
  name: 'get_bot_policy_rate',
  title: 'อัตราดอกเบี้ยนโยบาย (BOT)',
  description:
    'ดึงอัตราดอกเบี้ยนโยบายล่าสุดของธนาคารแห่งประเทศไทย พร้อมค่าก่อนหน้าและส่วนต่าง ' +
    'ใช้เมื่อผู้ใช้ถามว่าดอกเบี้ยตอนนี้สูงหรือต่ำ ทิศทางดอกเบี้ยเป็นอย่างไร ' +
    'หรือเมื่อจะประเมินต้นทุนการกู้ยืม',
  category: 'bot',
  readOnly: true,
  schema: defineSchema({}),
  async handler() {
    const metric = await getBotService().getMetric({
      seriesId: 'policy_rate',
      key: 'policy_rate',
      label: 'Policy Rate',
      labelTh: 'อัตราดอกเบี้ยนโยบาย',
    });
    return {
      data: metricPayload(metric),
      source: metric.provenance.source,
      notice: metric.provenance.notice,
      citation: citationFor(metric, 'Policy Rate'),
    };
  },
};

const lendingRate: ToolDefinition = {
  name: 'get_bot_lending_rate',
  title: 'อัตราดอกเบี้ยเงินกู้ธนาคารพาณิชย์ (BOT)',
  description:
    'ดึงอัตราดอกเบี้ยเงินกู้ประกาศของธนาคารพาณิชย์จาก ธปท. เลือกได้ว่าเป็น MLR, MOR, MRR ' +
    'หรือค่าเฉลี่ยของทั้งสาม ใช้เป็นฐานประมาณอัตราดอกเบี้ยที่ SME จะถูกคิดจริง',
  category: 'bot',
  readOnly: true,
  schema: defineSchema<{ type: string }>({
    type: field.enumOf('ประเภทอัตราดอกเบี้ยเงินกู้ที่ต้องการ', ['MLR', 'MOR', 'MRR', 'average'], {
      default: 'average',
    }),
  }),
  async handler(args: { type: string }) {
    const wanted = String(args.type ?? 'average');
    const isAverage = wanted.toLowerCase() === 'average';
    const dimension = isAverage ? undefined : wanted.toUpperCase();

    const metric = await getBotService().getMetric({
      seriesId: 'lending_rate',
      ...(dimension ? { dimension } : {}),
      key: isAverage ? 'lending_rate_avg' : `lending_${wanted.toLowerCase()}`,
      label: isAverage ? 'Average Lending Rate' : wanted.toUpperCase(),
      labelTh: isAverage ? 'อัตราดอกเบี้ยเงินกู้เฉลี่ย' : wanted.toUpperCase(),
      averageDimensions: isAverage,
    });

    return {
      data: {
        ...metricPayload(metric),
        rateType: isAverage ? 'average of MLR/MOR/MRR' : wanted.toUpperCase(),
      },
      source: metric.provenance.source,
      notice: metric.provenance.notice,
      citation: citationFor(metric, `Lending Rate (${isAverage ? 'average' : wanted.toUpperCase()})`),
    };
  },
};

const depositRate: ToolDefinition = {
  name: 'get_bot_deposit_rate',
  title: 'อัตราดอกเบี้ยเงินฝาก (BOT)',
  description:
    'ดึงอัตราดอกเบี้ยเงินฝากของธนาคารพาณิชย์จาก ธปท. ตามประเภทที่ระบุ ' +
    'ใช้เทียบว่าการเก็บเงินสดไว้ได้ผลตอบแทนเท่าไรเทียบกับต้นทุนการกู้',
  category: 'bot',
  readOnly: true,
  schema: defineSchema<{ tenor: string }>({
    tenor: field.enumOf('ประเภท/อายุเงินฝาก', ['savings', '3m', '6m', '12m', '24m'], {
      default: '12m',
    }),
  }),
  async handler(args: { tenor: string }) {
    const tenor = String(args.tenor ?? '12m').toLowerCase();
    const metric = await getBotService().getMetric({
      seriesId: 'deposit_rate',
      dimension: tenor,
      key: `deposit_${tenor}`,
      label: `Deposit Rate (${tenor})`,
      labelTh: `อัตราดอกเบี้ยเงินฝาก (${tenor})`,
    });
    return {
      data: { ...metricPayload(metric), tenor },
      source: metric.provenance.source,
      notice: metric.provenance.notice,
      citation: citationFor(metric, `Deposit Rate (${tenor})`),
    };
  },
};

const exchangeRate: ToolDefinition = {
  name: 'get_bot_exchange_rate',
  title: 'อัตราแลกเปลี่ยน (BOT)',
  description:
    'ดึงอัตราแลกเปลี่ยนล่าสุดจาก ธปท. เป็นจำนวนบาทต่อ 1 หน่วยของสกุลเงินที่ระบุ ' +
    'ใช้เมื่อผู้ใช้ถามเรื่องค่าเงิน การนำเข้า/ส่งออก หรือความเสี่ยงอัตราแลกเปลี่ยน',
  category: 'bot',
  readOnly: true,
  schema: defineSchema<{ currency: string }>({
    currency: field.enumOf('รหัสสกุลเงิน 3 ตัวอักษร', ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'], {
      required: true,
    }),
  }),
  async handler(args: { currency: string }) {
    const code = String(args.currency).toUpperCase();
    const metric = await getBotService().getExchangeRate(code);
    return {
      data: { ...metricPayload(metric), currency: code, quote: `THB per 1 ${code}` },
      source: metric.provenance.source,
      notice: metric.provenance.notice,
      citation: citationFor(metric, `${code}/THB`),
    };
  },
};

const marketData: ToolDefinition = {
  name: 'get_bot_market_data',
  title: 'ภาพรวมตลาดการเงินไทย (BOT)',
  description:
    'ดึงชุดตัวเลขภาพรวมจาก ธปท. ในครั้งเดียว: ดอกเบี้ยนโยบาย ดอกเบี้ยเงินกู้เฉลี่ย ' +
    'ดอกเบี้ยเงินฝาก 12 เดือน อัตราแลกเปลี่ยน USD/THB และอัตราดอกเบี้ยระหว่างธนาคาร ' +
    'ใช้เมื่อผู้ใช้ถามภาพรวมสภาวะการเงินโดยไม่เจาะจงตัวใดตัวหนึ่ง',
  category: 'bot',
  readOnly: true,
  schema: defineSchema({}),
  async handler() {
    const bot = getBotService();
    const [summary, interbank] = await Promise.all([
      bot.getSummary(),
      bot
        .getMetric({
          seriesId: 'interbank_rate',
          dimension: 'overnight',
          key: 'interbank_overnight',
          label: 'Interbank Overnight Rate',
          labelTh: 'ดอกเบี้ยกู้ยืมระหว่างธนาคารข้ามคืน',
        })
        .catch(() => null),
    ]);

    const anyDemo =
      summary.anyDemo || (interbank !== null && interbank.provenance.source === 'demo');

    return {
      data: {
        policyRate: metricPayload(summary.policyRate),
        averageLendingRate: metricPayload(summary.lendingRate),
        depositRate12m: metricPayload(summary.depositRate),
        usdThb: metricPayload(summary.usdThb),
        interbankOvernight: interbank ? metricPayload(interbank) : null,
      },
      source: anyDemo ? 'demo' : 'bot',
      notice: summary.notice,
      citation: {
        label: anyDemo ? 'Demo Data — Thai market snapshot' : 'Bank of Thailand — market snapshot',
        asOf: summary.policyRate.currentPeriod,
      },
    };
  },
};

const economicIndicator: ToolDefinition = {
  name: 'get_bot_economic_indicator',
  title: 'ตัวชี้วัดเศรษฐกิจการเงินอื่นจาก BOT',
  description:
    'ดึงชุดข้อมูลใด ๆ ที่ระบบลงทะเบียนไว้จาก ธปท. เช่น bibor, interbank_rate, ' +
    'thb_implied_rate, external_rate, fx_reference ระบุช่วงวันที่ได้ ' +
    'ใช้เมื่อคำถามต้องการข้อมูลเชิงลึกกว่าชุดหลัก',
  category: 'bot',
  readOnly: true,
  schema: defineSchema<{ indicator: string; start?: string; end?: string }>({
    indicator: field.enumOf('รหัสชุดข้อมูลที่ต้องการ', BOT_SERIES_IDS, { required: true }),
    start: field.string('วันเริ่มต้น รูปแบบ YYYY-MM-DD'),
    end: field.string('วันสิ้นสุด รูปแบบ YYYY-MM-DD'),
  }),
  async handler(args: { indicator: string; start?: string; end?: string }) {
    const seriesId = args.indicator as BotSeriesId;
    const descriptor = getSeriesDescriptor(seriesId);
    if (!descriptor) {
      throw new Error(
        `ไม่รู้จักชุดข้อมูล "${args.indicator}" — ที่รองรับ: ${BOT_SERIES_IDS.join(', ')}`,
      );
    }

    const series = await getBotService().getSeries(seriesId, {
      ...(args.start ? { start: args.start } : {}),
      ...(args.end ? { end: args.end } : {}),
    });

    // ส่งค่าล่าสุดของแต่ละมิติให้โมเดล และแนบจำนวนจุดข้อมูลไว้เป็นบริบท
    const latestByDimension: Record<string, { period: string; value: number }> = {};
    for (const observation of series.observations) {
      const existing = latestByDimension[observation.dimension];
      if (!existing || observation.period > existing.period) {
        latestByDimension[observation.dimension] = {
          period: observation.period,
          value: observation.value,
        };
      }
    }

    return {
      data: {
        seriesId,
        title: series.title,
        titleTh: series.titleTh,
        unit: series.unit,
        latest: latestByDimension,
        observationCount: series.observations.length,
        source: series.provenance.sourceLabel,
        lastUpdated: series.provenance.lastUpdated,
        isDemoData: series.provenance.source === 'demo',
      },
      source: series.provenance.source,
      notice: series.provenance.notice,
      citation: {
        label: `${series.provenance.sourceLabel} — ${series.title}`,
        asOf: series.provenance.lastUpdated,
      },
    };
  },
};

const listSeries: ToolDefinition = {
  name: 'list_bot_series',
  title: 'รายการชุดข้อมูล BOT ที่ระบบรองรับ',
  description:
    'แสดงรายการชุดข้อมูลทั้งหมดที่ระบบดึงจาก ธปท. ได้ พร้อมหน่วยและอายุแคช ' +
    'ใช้เมื่อไม่แน่ใจว่าควรเรียกชุดข้อมูลไหน',
  category: 'bot',
  readOnly: true,
  schema: defineSchema({}),
  async handler() {
    return {
      data: { series: seriesCatalog() },
      source: 'local' as const,
      citation: { label: 'SME Finance Copilot — BOT series registry', asOf: null },
    };
  },
};

export const botTools: ToolDefinition[] = [
  policyRate,
  lendingRate,
  depositRate,
  exchangeRate,
  marketData,
  economicIndicator,
  listSeries,
];
