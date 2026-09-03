/**
 * ต้นทุนของการผิดนัดชำระ
 *
 * ทุกตัวเลขในหน้าจำลองสินเชื่อคำนวณจากสมมติฐานว่าจ่ายไหว ซึ่งตอบคำถามได้ครึ่งเดียว
 * อีกครึ่งคือถ้าจ่ายไม่ไหวจะเป็นอย่างไร คำตอบไม่ใช่ "จ่ายอัตราเดิมต่อไป" แต่คือ
 * อัตราผิดนัดที่ธนาคารประกาศไว้ ซึ่งสูงกว่าอัตราสินเชื่อปกติหลายเท่า
 */

import type { LoanDownside } from '@sme/shared';
import { getBotService } from '../bot/botService.js';
import { annualInterest } from './loan.js';

const NOTE_TH =
  'อัตราผิดนัดใช้กับยอดที่ค้างชำระตามเงื่อนไขในสัญญาแต่ละฉบับ ' +
  'ตัวเลขนี้คิดจากยอดกู้เต็มจำนวนเพื่อให้เห็นขอบบนของความเสียหาย ไม่ใช่ยอดที่จะถูกเรียกเก็บแน่นอน';

/**
 * ประเมินขาลงของเงินกู้ก้อนหนึ่ง
 *
 * คืน null เมื่อดึงอัตราผิดนัดจาก ธปท. ไม่ได้ — ปล่อยว่างดีกว่าใส่ตัวเลขที่เดาเอา
 * เพราะทั้งส่วนนี้มีไว้เพื่อบอกความเสี่ยงให้ตรง
 */
export async function loanDownside(
  principal: number,
  contractAnnualInterest: number,
): Promise<LoanDownside | null> {
  const rate = await getBotService().getDefaultRate();
  if (rate.value === null) return null;

  const atDefault = annualInterest(principal, rate.value);
  return {
    defaultRatePct: rate.value,
    annualInterestAtDefault: atDefault,
    extraInterestPerYear: round2(atDefault - contractAnnualInterest),
    multipleOfContract:
      contractAnnualInterest > 0 ? round2(atDefault / contractAnnualInterest) : null,
    provenance: rate.provenance,
    noteTh: NOTE_TH,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
