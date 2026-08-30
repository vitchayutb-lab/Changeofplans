/** แปลงสกุลเงินด้วยอัตราแลกเปลี่ยนจริงจาก ธปท. และประเมินความเสี่ยงอัตราแลกเปลี่ยน */

import type { BotMetric, Provenance } from '@sme/shared';
import { getBotService } from '../bot/botService.js';

export interface ConversionResult {
  amount: number;
  from: string;
  to: string;
  converted: number;
  /** จำนวนบาทต่อ 1 หน่วยของสกุลเงินต่างประเทศที่ใช้คำนวณ */
  rateUsed: number;
  rateLabel: string;
  asOf: string | null;
  provenance: Provenance;
}

/** บาทต่อ 1 หน่วยของสกุลเงินที่ระบุ (THB คืนค่า 1 โดยไม่ต้องเรียก BOT) */
async function thbPerUnit(currency: string): Promise<{ rate: number; metric: BotMetric | null }> {
  const code = currency.toUpperCase();
  if (code === 'THB') {
    return { rate: 1, metric: null };
  }
  const metric = await getBotService().getExchangeRate(code);
  if (metric.current === null) {
    throw new Error(`ไม่พบอัตราแลกเปลี่ยนของสกุล ${code}`);
  }
  return { rate: metric.current, metric };
}

export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
): Promise<ConversionResult> {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();

  const source = await thbPerUnit(fromCode);
  const target = await thbPerUnit(toCode);

  const inThb = amount * source.rate;
  const converted = inThb / target.rate;

  const metric = source.metric ?? target.metric;
  if (!metric) {
    throw new Error('ต้องมีสกุลเงินต่างประเทศอย่างน้อยหนึ่งสกุลในการแปลงค่า');
  }

  return {
    amount,
    from: fromCode,
    to: toCode,
    converted: round4(converted),
    rateUsed: round4(source.rate / target.rate),
    rateLabel: `${fromCode}/${toCode}`,
    asOf: metric.currentPeriod,
    provenance: metric.provenance,
  };
}

/**
 * ผลกระทบต่อกำไรเมื่อค่าเงินบาทเปลี่ยนไปตามสัดส่วนที่กำหนด
 * ใช้กับ SME ที่มีรายรับหรือรายจ่ายเป็นเงินตราต่างประเทศ
 */
export function fxSensitivity(
  annualExposureThb: number,
  movePercent: number,
): { movePercent: number; impactThb: number } {
  return {
    movePercent,
    impactThb: Math.round(annualExposureThb * (movePercent / 100) * 100) / 100,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
