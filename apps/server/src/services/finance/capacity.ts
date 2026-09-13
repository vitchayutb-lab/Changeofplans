/**
 * ต้นทุนหนี้ที่รับไหว — กลับด้านคำถามของหน้าจำลองสินเชื่อ
 *
 * หน้าจำลองถามว่า "กู้เท่านี้ที่อัตรานี้ ผ่อนเท่าไร" ซึ่งต้องรู้อัตราก่อนถึงจะเริ่มได้
 * ส่วนนี้ถามกลับจากกระแสเงินสดที่มีจริง: อัตราสูงสุดเท่าไรที่ยังผ่อนไหว และวงเงิน
 * สูงสุดเท่าไรที่รับได้ที่อัตราตลาดจริงของ ธปท.
 *
 * เป้าหมาย DSCR ที่ใช้มาจากเกณฑ์ชุดเดียวกับ ratios.ts (1.20 เฝ้าระวัง, 1.50 ดี)
 * หน้านี้จึงไม่มีทางบอกคนละระดับกับที่ระบบใช้ตัดสินในหน้าอื่น
 */

import type { BorrowingCapacity, DebtCapacity, RateCeiling, RatioVerdict } from '@sme/shared';
import { loadStatements } from './analysis.js';
import { getDebtOverview, loadReferenceRates } from './debt.js';
import { dscr, maxRateForPayment, payment, principalForPayment } from './loan.js';
import { derive } from './statement.js';

/**
 * ระดับ DSCR ที่ใช้เป็นเป้าหมาย เรียงจากผ่อนปรนไปเข้ม
 *
 * 1.00 ไม่ใช่เกณฑ์ของใคร แต่เป็นเส้นแบ่งทางคณิตศาสตร์ว่ากระแสเงินสดพอจ่ายหนี้พอดี
 * จึงใส่ไว้เพื่อให้เห็นว่า "จุดที่ขาดมือ" อยู่ตรงไหน ไม่ใช่เพื่อแนะนำให้กู้ถึงระดับนั้น
 */
const TARGETS: { value: number; labelTh: string }[] = [
  { value: 1.0, labelTh: 'จ่ายไหวพอดี (ไม่มีส่วนเผื่อ)' },
  { value: 1.2, labelTh: 'ระดับที่ผู้ให้กู้มักกำหนด' },
  { value: 1.5, labelTh: 'ระดับที่ถือว่าปลอดภัย' },
];

/** ส่วนต่างความเสี่ยงเริ่มต้นที่บวกจากอัตราอ้างอิง สำหรับกิจการที่มีงบการเงินแล้ว */
const DEFAULT_SPREAD_PCT = 1.5;

const DEFAULT_YEARS = 7;

/**
 * เพดานบนของการค้นหาอัตรา
 *
 * เกินระดับนี้ไม่มีใครเสนอจริง — อัตราผิดนัดชำระที่ ธปท. ประกาศยังอยู่ที่ราว 22.86%
 * การรายงานว่า "รับได้ถึง 100%" จึงเป็นตัวเลขที่ถูกทางคณิตศาสตร์แต่ไม่มีความหมาย
 * กรณีที่ชนเพดานนี้จึงรายงานว่ากระแสเงินสดไม่ใช่ข้อจำกัด แทนที่จะให้ตัวเลขลอย ๆ
 */
const RATE_SEARCH_MAX_PCT = 25;

export interface CapacityOptions {
  smeId: string;
  /** วงเงินที่อยากกู้เพิ่ม — ไม่ระบุจะใช้วงเงินสูงสุดที่รับไหวที่ DSCR 1.20 */
  amount?: number;
  years?: number;
  spreadPct?: number;
  fiscalYear?: number;
}

export async function debtCapacity(options: CapacityOptions): Promise<DebtCapacity> {
  const { current } = loadStatements(options.smeId, options.fiscalYear);
  const statement = derive(current);
  const debt = await getDebtOverview(options.smeId);
  const rates = await loadReferenceRates();

  const years = options.years ?? DEFAULT_YEARS;
  const spreadPct = options.spreadPct ?? DEFAULT_SPREAD_PCT;

  // MLR เป็นอัตราอ้างอิงของสินเชื่อธุรกิจ จึงใช้ตัวนี้เป็นฐานของ "อัตราตลาด"
  const reference = rates.MLR;
  const marketRatePct =
    reference.value === null ? null : round2(reference.value + spreadPct);

  const ocf = statement.operatingCashFlow;
  const existingDebtService = debt.totalAnnualDebtService;

  /** เงินที่เหลือจ่ายหนี้ก้อนใหม่ได้ต่อเดือน หลังกันส่วนเผื่อตามเป้าหมายแล้ว */
  const monthlyRoom = (target: number): number =>
    Math.max(0, (ocf / target - existingDebtService) / 12);

  const capacities: BorrowingCapacity[] = TARGETS.map((target) => {
    const room = monthlyRoom(target.value);
    const maxAmount =
      marketRatePct === null ? 0 : floorTo(principalForPayment(room, marketRatePct, years), 10_000);
    return {
      targetDscr: target.value,
      labelTh: target.labelTh,
      maxAmount,
      monthlyPayment:
        maxAmount > 0 && marketRatePct !== null
          ? payment(maxAmount, marketRatePct, years)
          : 0,
      coversRequest: false, // เติมหลังรู้วงเงินที่ขอ
    };
  });

  /*
   * ไม่ระบุวงเงินมา ให้ใช้วงเงินสูงสุดที่รับไหวที่ระดับ 1.20 เป็นค่าตั้งต้น
   * เพดานที่ได้จะเท่ากับอัตราตลาดพอดีโดยโครงสร้าง ซึ่งเป็นคำตอบที่ถูกต้องและอ่านง่าย:
   * "นี่คือขีดจำกัดของคุณพอดี" แล้วผู้ใช้ค่อยปรับวงเงินเพื่อดูว่าเพดานขยับไปทางไหน
   */
  const requestedAmount =
    options.amount ?? capacities.find((c) => c.targetDscr === 1.2)?.maxAmount ?? 0;

  for (const capacity of capacities) {
    capacity.coversRequest = capacity.maxAmount >= requestedAmount && requestedAmount > 0;
  }

  const ceilings: RateCeiling[] = TARGETS.map((target) => {
    const room = monthlyRoom(target.value);
    const maxRatePct =
      requestedAmount > 0
        ? maxRateForPayment(requestedAmount, room, years, { maxRatePct: RATE_SEARCH_MAX_PCT })
        : null;
    const unbounded = maxRatePct !== null && maxRatePct >= RATE_SEARCH_MAX_PCT;
    return {
      targetDscr: target.value,
      labelTh: target.labelTh,
      maxRatePct,
      unbounded,
      headroomPct:
        maxRatePct === null || marketRatePct === null
          ? null
          : round2(maxRatePct - marketRatePct),
      withinReach:
        maxRatePct !== null && marketRatePct !== null && marketRatePct <= maxRatePct,
    };
  });

  const blendedRateAfterPct = blendedRate(
    debt.totalOutstanding,
    debt.weightedAverageRatePct,
    requestedAmount,
    marketRatePct,
  );

  const verdict = judge(ceilings, marketRatePct, ocf);

  return {
    smeId: options.smeId,
    fiscalYear: statement.fiscalYear,
    basis: {
      operatingCashFlow: round2(ocf),
      existingAnnualDebtService: existingDebtService,
      existingOutstanding: debt.totalOutstanding,
      existingWeightedRatePct: debt.weightedAverageRatePct,
      currentDscr: dscr(ocf, existingDebtService),
    },
    request: { amount: requestedAmount, years },
    market: {
      referenceRateName: 'MLR',
      referenceRatePct: reference.value,
      spreadPct,
      estimatedRatePct: marketRatePct,
      provenance: reference.provenance,
    },
    ceilings,
    capacities,
    blendedRateAfterPct,
    verdict,
    summaryTh: summarize(
      ceilings,
      capacities,
      marketRatePct,
      requestedAmount,
      ocf,
      existingDebtService,
      dscr(ocf, existingDebtService),
    ),
    disclaimerTh:
      'เพดานอัตราดอกเบี้ยคำนวณจากกระแสเงินสดในงบล่าสุดโดยถือว่ากระแสเงินสดคงเดิม ' +
      'อัตราจริงที่ผู้ให้กู้เสนอขึ้นกับหลักประกัน ประวัติเครดิต และนโยบายของแต่ละราย',
  };
}

/** ต้นทุนหนี้รวมหลังกู้ก้อนใหม่ ถ่วงน้ำหนักตามยอดคงค้าง */
function blendedRate(
  existingOutstanding: number,
  existingRatePct: number | null,
  newAmount: number,
  newRatePct: number | null,
): number | null {
  if (newRatePct === null) return null;
  if (existingOutstanding <= 0 || existingRatePct === null) {
    return newAmount > 0 ? newRatePct : null;
  }
  const total = existingOutstanding + newAmount;
  if (total <= 0) return null;
  return round2((existingOutstanding * existingRatePct + newAmount * newRatePct) / total);
}

function judge(
  ceilings: RateCeiling[],
  marketRatePct: number | null,
  operatingCashFlow: number,
): RatioVerdict {
  if (operatingCashFlow <= 0) return 'risk';
  if (marketRatePct === null) return 'na';

  const at = (target: number): RateCeiling | undefined =>
    ceilings.find((c) => c.targetDscr === target);

  if (at(1.5)?.withinReach) return 'good';
  if (at(1.2)?.withinReach) return 'watch';
  return 'risk';
}

function summarize(
  ceilings: RateCeiling[],
  capacities: BorrowingCapacity[],
  marketRatePct: number | null,
  requestedAmount: number,
  operatingCashFlow: number,
  existingAnnualDebtService: number,
  currentDscr: number | null,
): string {
  if (operatingCashFlow <= 0) {
    return 'กระแสเงินสดจากการดำเนินงานติดลบ จึงยังไม่มีกำลังรับภาระหนี้เพิ่มไม่ว่าอัตราดอกเบี้ยจะเป็นเท่าไร';
  }

  /*
   * ไม่มีวงเงินให้พูดถึง เพราะภาระเดิมกินกำลังไปหมดแล้ว
   * การบอกว่า "ที่วงเงิน ฿0 รับไม่ไหว" ถูกทางตัวเลขแต่ไม่ได้ความ — ต้องบอกสาเหตุจริง
   */
  if (requestedAmount <= 0) {
    const dscrText = currentDscr === null ? '' : ` (DSCR ${currentDscr.toFixed(2)})`;
    return (
      `ภาระผ่อนหนี้เดิม ${money(existingAnnualDebtService)} ต่อปี เทียบกับกระแสเงินสด ` +
      `${money(operatingCashFlow)} ต่อปี${dscrText} ยังไม่เหลือช่องให้รับหนี้เพิ่มที่ระดับใดเลย — ` +
      'ต้องลดภาระเดิมหรือเพิ่มกระแสเงินสดก่อน การลดอัตราดอกเบี้ยอย่างเดียวไม่พอ'
    );
  }

  const bank = ceilings.find((c) => c.targetDscr === 1.2);
  const capacity = capacities.find((c) => c.targetDscr === 1.2);
  const parts: string[] = [];

  if (bank?.maxRatePct === null) {
    parts.push(
      `ที่วงเงิน ${money(requestedAmount)} กระแสเงินสดรับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์ — เงินต้นอย่างเดียวก็เกินกำลังแล้ว`,
    );
  } else if (bank?.unbounded) {
    parts.push(
      `ที่วงเงิน ${money(requestedAmount)} กระแสเงินสดรับไหวเกิน ${RATE_SEARCH_MAX_PCT}% ที่ระดับ DSCR 1.20 — อัตราดอกเบี้ยไม่ใช่ข้อจำกัดของวงเงินนี้`,
    );
  } else if (bank) {
    parts.push(
      `ที่วงเงิน ${money(requestedAmount)} รับดอกเบี้ยได้สูงสุด ${bank.maxRatePct!.toFixed(2)}% ก่อน DSCR ตกถึง 1.20`,
    );
  }

  if (marketRatePct !== null && bank?.headroomPct !== null && bank?.headroomPct !== undefined) {
    parts.push(
      bank.headroomPct >= 0
        ? `อัตราตลาดตอนนี้ประมาณ ${marketRatePct.toFixed(2)}% จึงยังมีที่ว่างอีก ${bank.headroomPct.toFixed(2)} จุด`
        : `อัตราตลาดตอนนี้ประมาณ ${marketRatePct.toFixed(2)}% ซึ่งสูงกว่าเพดานอยู่ ${Math.abs(bank.headroomPct).toFixed(2)} จุด`,
    );
  }

  if (capacity) {
    parts.push(`ที่อัตราตลาด วงเงินที่รับไหวที่ระดับเดียวกันคือ ${money(capacity.maxAmount)}`);
  }

  return parts.join(' · ');
}

const money = (value: number): string => `฿${Math.round(value).toLocaleString('en-US')}`;

function floorTo(value: number, step: number): number {
  return Math.max(0, Math.floor(value / step) * step);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
