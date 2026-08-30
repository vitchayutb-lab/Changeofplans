/**
 * คณิตศาสตร์สินเชื่อ: ค่างวด ตารางผ่อน ดอกเบี้ยรวม และความสามารถในการชำระหนี้
 *
 * ทุกฟังก์ชันเป็น pure function ตรวจสอบได้ด้วยเทสต์ ไม่มีการเรียกฐานข้อมูลหรือเครือข่าย
 */

import type { AmortizationRow, LoanQuote } from '@sme/shared';

/**
 * ค่างวดคงที่แบบผ่อนชำระเท่ากันทุกงวด (annuity)
 *   payment = P · i / (1 - (1 + i)^-n)
 * เมื่อ i = อัตราดอกเบี้ยต่องวด, n = จำนวนงวด
 */
export function payment(
  principal: number,
  annualRatePct: number,
  years: number,
  paymentsPerYear = 12,
): number {
  const n = Math.round(years * paymentsPerYear);
  if (n <= 0) throw new Error('ระยะเวลาผ่อนต้องมากกว่า 0');
  if (principal <= 0) return 0;

  const i = annualRatePct / 100 / paymentsPerYear;
  if (i === 0) return round2(principal / n);
  return round2((principal * i) / (1 - Math.pow(1 + i, -n)));
}

/** ตารางผ่อนชำระเต็มรูปแบบ — งวดสุดท้ายปรับให้ยอดคงเหลือเป็นศูนย์พอดี */
export function amortize(
  principal: number,
  annualRatePct: number,
  years: number,
  paymentsPerYear = 12,
): AmortizationRow[] {
  const n = Math.round(years * paymentsPerYear);
  const i = annualRatePct / 100 / paymentsPerYear;
  const fixedPayment = payment(principal, annualRatePct, years, paymentsPerYear);

  const rows: AmortizationRow[] = [];
  let balance = principal;

  for (let month = 1; month <= n; month += 1) {
    const interest = round2(balance * i);
    let principalPart = round2(fixedPayment - interest);
    let paid = fixedPayment;

    if (month === n || principalPart > balance) {
      // งวดสุดท้าย: ปิดยอดคงเหลือให้พอดี ไม่ให้ติดลบหรือเหลือเศษ
      principalPart = round2(balance);
      paid = round2(principalPart + interest);
    }

    const closing = round2(balance - principalPart);
    rows.push({
      month,
      openingBalance: round2(balance),
      payment: paid,
      interest,
      principal: principalPart,
      closingBalance: closing,
    });
    balance = closing;
    if (balance <= 0) break;
  }

  return rows;
}

export function quote(
  principal: number,
  annualRatePct: number,
  years: number,
  paymentsPerYear = 12,
): LoanQuote {
  const schedule = amortize(principal, annualRatePct, years, paymentsPerYear);
  const totalPayment = round2(schedule.reduce((sum, row) => sum + row.payment, 0));
  const totalInterest = round2(schedule.reduce((sum, row) => sum + row.interest, 0));
  const firstYearInterest = round2(
    schedule.slice(0, paymentsPerYear).reduce((sum, row) => sum + row.interest, 0),
  );

  return {
    principal,
    annualRatePct,
    years,
    paymentsPerYear,
    monthlyPayment: payment(principal, annualRatePct, years, paymentsPerYear),
    totalPayment,
    totalInterest,
    firstYearInterest,
    isEstimate: true,
    schedule,
  };
}

/**
 * DSCR (Debt Service Coverage Ratio) = กระแสเงินสดจากการดำเนินงาน / ภาระชำระหนี้ต่อปี
 * ต่ำกว่า 1 แปลว่ากระแสเงินสดไม่พอจ่ายหนี้ในปีนั้น
 */
export function dscr(operatingCashFlow: number, annualDebtService: number): number | null {
  if (annualDebtService <= 0) return null;
  return round4(operatingCashFlow / annualDebtService);
}

/** ภาระชำระหนี้ต่อปีของสินเชื่อหนึ่งก้อน (เงินต้น + ดอกเบี้ย) */
export function annualDebtService(
  outstanding: number,
  annualRatePct: number,
  remainingMonths: number,
): number {
  if (remainingMonths <= 0 || outstanding <= 0) return 0;
  const years = remainingMonths / 12;
  return round2(payment(outstanding, annualRatePct, years) * 12);
}

/** ดอกเบี้ยจ่ายต่อปีโดยประมาณจากยอดคงค้าง */
export function annualInterest(outstanding: number, annualRatePct: number): number {
  return round2((outstanding * annualRatePct) / 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
