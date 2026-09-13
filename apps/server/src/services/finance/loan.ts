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

/**
 * เงินต้นสูงสุดที่ค่างวดต่อเดือนเท่านี้รองรับได้ — ด้านกลับของ payment()
 *   P = PMT × (1 − (1 + i)^−n) ÷ i
 *
 * ใช้ตอบคำถาม "กู้ได้เท่าไร" จากเงินที่เหลือจ่ายจริง แทนที่จะเดาวงเงินแล้วลองผ่อนดู
 */
export function principalForPayment(
  monthlyPayment: number,
  annualRatePct: number,
  years: number,
  paymentsPerYear = 12,
): number {
  const n = Math.round(years * paymentsPerYear);
  if (n <= 0 || monthlyPayment <= 0) return 0;

  const i = annualRatePct / 100 / paymentsPerYear;
  const principal = i === 0 ? monthlyPayment * n : (monthlyPayment * (1 - Math.pow(1 + i, -n))) / i;
  return round2(Math.max(0, principal));
}

/**
 * อัตราดอกเบี้ยสูงสุดที่ค่างวดยังไม่เกินเพดานที่จ่ายไหว
 *
 * ค่างวดเพิ่มตามอัตราเสมอ ความสัมพันธ์จึงเป็นทางเดียว และการแบ่งครึ่งช่วงให้คำตอบที่
 * ตรวจสอบได้ ไม่ต้องพึ่งสูตรปิดซึ่งไม่มีสำหรับสมการนี้ (อัตราอยู่ทั้งตัวตั้งและตัวหาร)
 *
 * คืน null เมื่อแม้ดอกเบี้ยศูนย์ก็ยังจ่ายไม่ไหว — กรณีนั้นเงินต้นอย่างเดียวก็เกินกำลังแล้ว
 * ซึ่งต้องไม่รายงานเป็นเพดาน 0% เพราะคนละความหมายกัน
 */
export function maxRateForPayment(
  principal: number,
  maxMonthlyPayment: number,
  years: number,
  options: { maxRatePct?: number } = {},
): number | null {
  const ceiling = options.maxRatePct ?? 100;
  if (principal <= 0) return ceiling;
  if (maxMonthlyPayment <= 0) return null;
  if (payment(principal, 0, years) > maxMonthlyPayment) return null;
  if (payment(principal, ceiling, years) <= maxMonthlyPayment) return ceiling;

  let low = 0;
  let high = ceiling;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (payment(principal, mid, years) <= maxMonthlyPayment) low = mid;
    else high = mid;
  }

  // ปัดลงเพื่อให้อัตราที่รายงานผ่านเพดานจริง ไม่ใช่พลาดเพราะการปัดเศษ
  return Math.floor(low * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
