/**
 * แปลงตัวเลขดิบในงบการเงินเป็นค่าที่ใช้วิเคราะห์ต่อ
 *
 * ค่าทุกตัวคำนวณสดจากข้อมูลดิบ ไม่มีการเก็บผลลัพธ์ลงฐานข้อมูล จึงไม่มีทางที่ตัวเลข
 * ที่แสดงจะไม่ตรงกับงบที่กรอกไว้
 */

import type { DerivedStatement, FinancialStatement } from '@sme/shared';

export function derive(statement: FinancialStatement): DerivedStatement {
  const grossProfit = statement.revenue - statement.cogs;
  const ebitda = grossProfit - statement.operatingExpenses;
  const ebit = ebitda - statement.depreciation;
  const ebt = ebit - statement.interestExpense;
  const netProfit = ebt - statement.tax;

  const currentAssets =
    statement.cash +
    statement.accountsReceivable +
    statement.inventory +
    statement.otherCurrentAssets;
  const totalAssets = currentAssets + statement.fixedAssets;

  const currentLiabilities =
    statement.accountsPayable + statement.shortTermDebt + statement.otherCurrentLiabilities;
  const totalDebt = statement.shortTermDebt + statement.longTermDebt;
  const totalLiabilities = currentLiabilities + statement.longTermDebt;
  const equity = statement.equityPaidUp + statement.retainedEarnings;

  return {
    fiscalYear: statement.fiscalYear,
    period: statement.period,
    revenue: statement.revenue,
    cogs: statement.cogs,
    grossProfit,
    operatingExpenses: statement.operatingExpenses,
    depreciation: statement.depreciation,
    ebitda,
    ebit,
    interestExpense: statement.interestExpense,
    ebt,
    tax: statement.tax,
    netProfit,
    cash: statement.cash,
    accountsReceivable: statement.accountsReceivable,
    inventory: statement.inventory,
    currentAssets,
    totalAssets,
    currentLiabilities,
    totalDebt,
    totalLiabilities,
    equity,
    workingCapital: currentAssets - currentLiabilities,
    // ประมาณกระแสเงินสดจากการดำเนินงาน: กำไรก่อนดอกเบี้ย ภาษี และค่าเสื่อม หักดอกเบี้ยกับภาษีจริง
    operatingCashFlow: ebitda - statement.interestExpense - statement.tax,
  };
}

/** ตรวจว่างบดุลสมดุลหรือไม่ (ใช้ตอน validate ข้อมูลที่ผู้ใช้กรอก) */
export function balanceCheck(statement: FinancialStatement): {
  balanced: boolean;
  difference: number;
} {
  const d = derive(statement);
  const difference = d.totalAssets - (d.totalLiabilities + d.equity);
  // ยอมให้คลาดเคลื่อนได้เล็กน้อยจากการปัดเศษ
  return { balanced: Math.abs(difference) < 1, difference: round(difference) };
}

/** อัตราการเปลี่ยนแปลงเทียบปีก่อน เป็นสัดส่วน (0.12 = +12%) */
export function yearOverYear(
  current: DerivedStatement,
  previous: DerivedStatement | null,
): Record<string, number | null> {
  const keys: (keyof DerivedStatement)[] = [
    'revenue',
    'grossProfit',
    'ebitda',
    'ebit',
    'netProfit',
    'totalAssets',
    'totalDebt',
    'equity',
    'operatingCashFlow',
  ];
  const out: Record<string, number | null> = {};
  for (const key of keys) {
    const now = current[key] as number;
    const before = previous ? (previous[key] as number) : null;
    out[key] =
      before === null || before === 0 ? null : round(((now - before) / Math.abs(before)) * 100) / 100;
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
