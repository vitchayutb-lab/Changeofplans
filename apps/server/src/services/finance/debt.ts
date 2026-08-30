/**
 * คิดต้นทุนหนี้ที่มีอยู่จริง โดยดึงอัตราอ้างอิง (MLR/MOR/MRR) จาก BOT มาใช้จริง
 *
 * สินเชื่อลอยตัวในฐานข้อมูลเก็บไว้เป็น "ส่วนต่าง" เท่านั้น อัตราที่แท้จริงจึงถูก
 * คำนวณใหม่ทุกครั้งจากอัตราอ้างอิงล่าสุด แทนที่จะเก็บตัวเลขนิ่ง ๆ ไว้
 */

import type { DebtOverview, ExistingLoan, Provenance, RateBasis, RepricedLoan } from '@sme/shared';
import { listLoans } from '../../db/smeRepo.js';
import { getBotService } from '../bot/botService.js';
import { annualDebtService, annualInterest, payment } from './loan.js';

const REFERENCE_BY_BASIS: Record<Exclude<RateBasis, 'fixed'>, 'MLR' | 'MOR' | 'MRR'> = {
  mlr_spread: 'MLR',
  mor_spread: 'MOR',
  mrr_spread: 'MRR',
};

export interface ReferenceRates {
  MLR: { value: number | null; provenance: Provenance };
  MOR: { value: number | null; provenance: Provenance };
  MRR: { value: number | null; provenance: Provenance };
}

/** ดึงอัตราอ้างอิงทั้งสามตัวพร้อมกัน (แคชอยู่แล้วในชั้น BotService) */
export async function loadReferenceRates(): Promise<ReferenceRates> {
  const bot = getBotService();
  const [mlr, mor, mrr] = await Promise.all([
    bot.getReferenceRate('MLR'),
    bot.getReferenceRate('MOR'),
    bot.getReferenceRate('MRR'),
  ]);
  return {
    MLR: { value: mlr.value, provenance: mlr.provenance },
    MOR: { value: mor.value, provenance: mor.provenance },
    MRR: { value: mrr.value, provenance: mrr.provenance },
  };
}

/** อัตราดอกเบี้ยที่แท้จริงของสินเชื่อหนึ่งก้อน ณ อัตราอ้างอิงปัจจุบัน */
export function effectiveRate(
  loan: Pick<ExistingLoan, 'rateType' | 'rateValue'>,
  rates: ReferenceRates,
): { ratePct: number | null; referenceName: string | null; referencePct: number | null; provenance: Provenance | null } {
  if (loan.rateType === 'fixed') {
    return { ratePct: loan.rateValue, referenceName: null, referencePct: null, provenance: null };
  }
  const name = REFERENCE_BY_BASIS[loan.rateType];
  const reference = rates[name];
  if (reference.value === null) {
    return {
      ratePct: null,
      referenceName: name,
      referencePct: null,
      provenance: reference.provenance,
    };
  }
  return {
    ratePct: round2(reference.value + loan.rateValue),
    referenceName: name,
    referencePct: reference.value,
    provenance: reference.provenance,
  };
}

export async function getDebtOverview(smeId: string): Promise<DebtOverview> {
  const loans = listLoans(smeId);
  const rates = await loadReferenceRates();

  const repriced: RepricedLoan[] = loans.map((loan) => {
    const rate = effectiveRate(loan, rates);
    const ratePct = rate.ratePct ?? 0;
    const months = Math.max(1, loan.remainingMonths);
    return {
      ...loan,
      effectiveRatePct: round2(ratePct),
      referenceRateName: rate.referenceName,
      referenceRatePct: rate.referencePct,
      annualInterest: annualInterest(loan.outstanding, ratePct),
      monthlyPayment:
        loan.product === 'od'
          ? // วงเงินเบิกเกินบัญชีจ่ายเฉพาะดอกเบี้ย ไม่มีการทยอยคืนเงินต้นตามตาราง
            round2((loan.outstanding * ratePct) / 100 / 12)
          : payment(loan.outstanding, ratePct, months / 12),
      provenance: rate.provenance,
    };
  });

  const totalOutstanding = round2(repriced.reduce((sum, l) => sum + l.outstanding, 0));
  const totalAnnualInterest = round2(repriced.reduce((sum, l) => sum + l.annualInterest, 0));
  const totalAnnualDebtService = round2(
    repriced.reduce(
      (sum, l) =>
        sum +
        (l.product === 'od'
          ? l.annualInterest
          : annualDebtService(l.outstanding, l.effectiveRatePct, Math.max(1, l.remainingMonths))),
      0,
    ),
  );

  const weighted =
    totalOutstanding > 0
      ? round2(
          repriced.reduce((sum, l) => sum + l.effectiveRatePct * l.outstanding, 0) / totalOutstanding,
        )
      : null;

  const notice =
    repriced.map((l) => l.provenance?.notice).find((n) => n) ??
    (repriced.some((l) => l.provenance?.source === 'demo')
      ? 'อัตราอ้างอิงบางส่วนเป็นข้อมูลจำลอง'
      : null);

  return {
    smeId,
    loans: repriced,
    totalOutstanding,
    totalAnnualInterest,
    totalAnnualDebtService,
    weightedAverageRatePct: weighted,
    notice,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
