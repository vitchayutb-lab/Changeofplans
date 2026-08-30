/** ประกอบผลวิเคราะห์งบการเงินของ SME หนึ่งราย */

import type {
  FinancialAlert,
  FinancialAnalysis,
  FinancialStatement,
  RatioGroup,
} from '@sme/shared';
import { getStatement, listStatements } from '../../db/smeRepo.js';
import { getDebtOverview } from './debt.js';
import { calculateRatios, findRatio } from './ratios.js';
import { derive, yearOverYear } from './statement.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** งบปีที่ขอ พร้อมงบปีก่อนหน้าสำหรับเทียบ */
export function loadStatements(
  smeId: string,
  fiscalYear?: number,
): { current: FinancialStatement; previous: FinancialStatement | null } {
  const all = listStatements(smeId).filter((s) => s.period === 'FY');
  if (all.length === 0) {
    throw new NotFoundError(`ยังไม่มีงบการเงินของ ${smeId}`);
  }
  const current = fiscalYear
    ? all.find((s) => s.fiscalYear === fiscalYear) ?? null
    : all[all.length - 1]!;
  if (!current) {
    throw new NotFoundError(`ไม่พบงบการเงินปี ${fiscalYear} ของ ${smeId}`);
  }
  const previous = all.find((s) => s.fiscalYear === current.fiscalYear - 1) ?? null;
  return { current, previous };
}

export async function analyzeSme(smeId: string, fiscalYear?: number): Promise<FinancialAnalysis> {
  const { current, previous } = loadStatements(smeId, fiscalYear);
  const derived = derive(current);
  const derivedPrevious = previous ? derive(previous) : null;

  const debt = await getDebtOverview(smeId);
  const groups = calculateRatios(derived, { annualDebtService: debt.totalAnnualDebtService });

  return {
    smeId,
    fiscalYear: derived.fiscalYear,
    current: derived,
    previous: derivedPrevious,
    yoy: yearOverYear(derived, derivedPrevious),
    groups,
    alerts: buildAlerts(groups, derived.revenue, debt.notice),
  };
}

/** คำเตือนที่ได้จากค่าที่คำนวณจริง ไม่ใช่ข้อความตายตัว */
export function buildAlerts(
  groups: RatioGroup[],
  revenue: number,
  debtNotice: string | null,
): FinancialAlert[] {
  const alerts: FinancialAlert[] = [];

  const push = (
    level: FinancialAlert['level'],
    titleTh: string,
    titleEn: string,
    detailTh: string,
  ): void => {
    alerts.push({ level, titleTh, titleEn, detailTh });
  };

  const dscr = findRatio(groups, 'dscr');
  if (dscr?.value !== null && dscr !== null) {
    if (dscr.value < 1) {
      push(
        'risk',
        'กระแสเงินสดไม่พอชำระหนี้',
        'Debt service not covered',
        `DSCR อยู่ที่ ${dscr.value.toFixed(2)} เท่า ต่ำกว่า 1 เท่า แปลว่ากระแสเงินสดจากการดำเนินงานปีนี้ไม่พอจ่ายภาระหนี้ทั้งปี`,
      );
    } else if (dscr.value < 1.2) {
      push(
        'warn',
        'DSCR ต่ำกว่าเกณฑ์ที่ธนาคารมักใช้',
        'DSCR below common bank threshold',
        `DSCR ${dscr.value.toFixed(2)} เท่า ธนาคารส่วนใหญ่ต้องการอย่างน้อย 1.2 เท่าก่อนอนุมัติวงเงินเพิ่ม`,
      );
    }
  }

  const coverage = findRatio(groups, 'interest_coverage');
  if (coverage?.value !== null && coverage !== null && coverage.value < 2) {
    push(
      'warn',
      'ความสามารถจ่ายดอกเบี้ยตึงตัว',
      'Thin interest coverage',
      `EBIT จ่ายดอกเบี้ยได้ ${coverage.value.toFixed(2)} เท่า หากดอกเบี้ยขยับขึ้นอีกเล็กน้อยจะกระทบกำไรทันที`,
    );
  }

  const currentRatio = findRatio(groups, 'current_ratio');
  if (currentRatio?.value !== null && currentRatio !== null && currentRatio.value < 1) {
    push(
      'risk',
      'หนี้ระยะสั้นมากกว่าสินทรัพย์หมุนเวียน',
      'Current liabilities exceed current assets',
      `Current Ratio ${currentRatio.value.toFixed(2)} เท่า ต้องเตรียมแผนต่ออายุวงเงินหรือหาสภาพคล่องเพิ่ม`,
    );
  }

  const de = findRatio(groups, 'debt_to_equity');
  if (de?.value !== null && de !== null && de.value > 3) {
    push(
      'warn',
      'หนี้สินต่อทุนสูง',
      'High debt to equity',
      `D/E ${de.value.toFixed(2)} เท่า เกิน 3 เท่าที่ธนาคารส่วนใหญ่ใช้เป็นเพดาน การกู้เพิ่มจะยากขึ้น`,
    );
  }

  const receivable = findRatio(groups, 'receivable_days');
  const inventory = findRatio(groups, 'inventory_days');
  if (
    receivable?.value != null &&
    inventory?.value != null &&
    receivable.value + inventory.value > 180 &&
    revenue > 0
  ) {
    push(
      'info',
      'เงินจมในลูกหนี้และสต็อกนาน',
      'Long cash conversion cycle',
      `รวมกันประมาณ ${Math.round(receivable.value + inventory.value)} วัน การเร่งเก็บหนี้หรือลดสต็อกจะปลดเงินสดออกมาได้โดยไม่ต้องกู้`,
    );
  }

  if (debtNotice) {
    push('info', 'ที่มาของอัตราอ้างอิง', 'Reference rate source', debtNotice);
  }

  return alerts;
}

/** งบทุกปีในรูปแบบที่คำนวณแล้ว ใช้วาดกราฟแนวโน้ม */
export function statementHistory(smeId: string): ReturnType<typeof derive>[] {
  return listStatements(smeId)
    .filter((s) => s.period === 'FY')
    .map(derive);
}

export function latestFiscalYear(smeId: string): number | null {
  const statement = getStatement(smeId);
  return statement?.fiscalYear ?? null;
}
