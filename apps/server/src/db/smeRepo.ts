/** การอ่าน/เขียนข้อมูล SME งบการเงิน และสินเชื่อเดิม */

import type {
  ExistingLoan,
  SmeSummary,
  FinancialStatement,
  FinancialStatementInput,
  Industry,
  RateBasis,
  Sme,
  StatementPeriod,
} from '@sme/shared';
import { getDb } from './index.js';
import { newId } from '../util/ids.js';

interface SmeRow {
  id: string;
  name_th: string;
  name_en: string;
  registration_no: string | null;
  industry: string;
  province: string;
  founded_year: number;
  employees: number;
  currency: string;
  fx_exposure_currency: string | null;
  fx_annual_exposure: number;
  created_at: string;
}

function mapSme(row: SmeRow): Sme {
  return {
    id: row.id,
    nameTh: row.name_th,
    nameEn: row.name_en,
    registrationNo: row.registration_no,
    industry: row.industry as Industry,
    province: row.province,
    foundedYear: row.founded_year,
    employees: row.employees,
    currency: row.currency,
    fxExposureCurrency: row.fx_exposure_currency,
    fxAnnualExposure: row.fx_annual_exposure,
    createdAt: row.created_at,
  };
}

export function listSmes(): Sme[] {
  const rows = getDb().prepare('SELECT * FROM smes ORDER BY name_en').all() as SmeRow[];
  return rows.map(mapSme);
}

export function getSme(id: string): Sme | null {
  const row = getDb().prepare('SELECT * FROM smes WHERE id = ?').get(id) as SmeRow | undefined;
  return row ? mapSme(row) : null;
}

interface StatementRow {
  id: string;
  sme_id: string;
  fiscal_year: number;
  period: string;
  revenue: number;
  cogs: number;
  operating_expenses: number;
  depreciation: number;
  interest_expense: number;
  tax: number;
  cash: number;
  accounts_receivable: number;
  inventory: number;
  other_current_assets: number;
  fixed_assets: number;
  accounts_payable: number;
  short_term_debt: number;
  other_current_liabilities: number;
  long_term_debt: number;
  equity_paid_up: number;
  retained_earnings: number;
  source: string;
}

function mapStatement(row: StatementRow): FinancialStatement {
  return {
    id: row.id,
    smeId: row.sme_id,
    fiscalYear: row.fiscal_year,
    period: row.period as StatementPeriod,
    revenue: row.revenue,
    cogs: row.cogs,
    operatingExpenses: row.operating_expenses,
    depreciation: row.depreciation,
    interestExpense: row.interest_expense,
    tax: row.tax,
    cash: row.cash,
    accountsReceivable: row.accounts_receivable,
    inventory: row.inventory,
    otherCurrentAssets: row.other_current_assets,
    fixedAssets: row.fixed_assets,
    accountsPayable: row.accounts_payable,
    shortTermDebt: row.short_term_debt,
    otherCurrentLiabilities: row.other_current_liabilities,
    longTermDebt: row.long_term_debt,
    equityPaidUp: row.equity_paid_up,
    retainedEarnings: row.retained_earnings,
    source: row.source,
  };
}

/** งบทั้งหมดของ SME เรียงจากปีเก่าไปใหม่ */
export function listStatements(smeId: string): FinancialStatement[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM financial_statements
        WHERE sme_id = ?
        ORDER BY fiscal_year ASC,
                 CASE period WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 2 WHEN 'H1' THEN 2
                             WHEN 'Q3' THEN 3 WHEN 'Q4' THEN 4 ELSE 5 END ASC`,
    )
    .all(smeId) as StatementRow[];
  return rows.map(mapStatement);
}

/** งบปีล่าสุดแบบ full-year; ถ้าไม่ระบุปีจะเลือกปีที่ใหม่ที่สุด */
export function getStatement(
  smeId: string,
  fiscalYear?: number,
  period: StatementPeriod = 'FY',
): FinancialStatement | null {
  const db = getDb();
  const row = fiscalYear
    ? (db
        .prepare(
          'SELECT * FROM financial_statements WHERE sme_id = ? AND fiscal_year = ? AND period = ?',
        )
        .get(smeId, fiscalYear, period) as StatementRow | undefined)
    : (db
        .prepare(
          `SELECT * FROM financial_statements WHERE sme_id = ? AND period = ?
            ORDER BY fiscal_year DESC LIMIT 1`,
        )
        .get(smeId, period) as StatementRow | undefined);
  return row ? mapStatement(row) : null;
}

export function upsertStatement(
  smeId: string,
  input: FinancialStatementInput,
  source = 'manual',
): FinancialStatement {
  const db = getDb();
  const existing = db
    .prepare(
      'SELECT id FROM financial_statements WHERE sme_id = ? AND fiscal_year = ? AND period = ?',
    )
    .get(smeId, input.fiscalYear, input.period) as { id: string } | undefined;
  const id = existing?.id ?? newId('fs');

  db.prepare(
    `INSERT INTO financial_statements (
       id, sme_id, fiscal_year, period, revenue, cogs, operating_expenses, depreciation,
       interest_expense, tax, cash, accounts_receivable, inventory, other_current_assets,
       fixed_assets, accounts_payable, short_term_debt, other_current_liabilities,
       long_term_debt, equity_paid_up, retained_earnings, source
     ) VALUES (
       @id, @smeId, @fiscalYear, @period, @revenue, @cogs, @operatingExpenses, @depreciation,
       @interestExpense, @tax, @cash, @accountsReceivable, @inventory, @otherCurrentAssets,
       @fixedAssets, @accountsPayable, @shortTermDebt, @otherCurrentLiabilities,
       @longTermDebt, @equityPaidUp, @retainedEarnings, @source
     )
     ON CONFLICT(sme_id, fiscal_year, period) DO UPDATE SET
       revenue = excluded.revenue, cogs = excluded.cogs,
       operating_expenses = excluded.operating_expenses, depreciation = excluded.depreciation,
       interest_expense = excluded.interest_expense, tax = excluded.tax,
       cash = excluded.cash, accounts_receivable = excluded.accounts_receivable,
       inventory = excluded.inventory, other_current_assets = excluded.other_current_assets,
       fixed_assets = excluded.fixed_assets, accounts_payable = excluded.accounts_payable,
       short_term_debt = excluded.short_term_debt,
       other_current_liabilities = excluded.other_current_liabilities,
       long_term_debt = excluded.long_term_debt, equity_paid_up = excluded.equity_paid_up,
       retained_earnings = excluded.retained_earnings, source = excluded.source`,
  ).run({ id, smeId, source, ...input });

  return getStatement(smeId, input.fiscalYear, input.period)!;
}

interface LoanRow {
  id: string;
  sme_id: string;
  lender: string;
  product: string;
  principal: number;
  outstanding: number;
  rate_type: string;
  rate_value: number;
  term_months: number;
  remaining_months: number;
  start_date: string;
}

export function listLoans(smeId: string): ExistingLoan[] {
  const rows = getDb()
    .prepare('SELECT * FROM existing_loans WHERE sme_id = ? ORDER BY outstanding DESC')
    .all(smeId) as LoanRow[];
  return rows.map((row) => ({
    id: row.id,
    smeId: row.sme_id,
    lender: row.lender,
    product: row.product as ExistingLoan['product'],
    principal: row.principal,
    outstanding: row.outstanding,
    rateType: row.rate_type as RateBasis,
    rateValue: row.rate_value,
    termMonths: row.term_months,
    remainingMonths: row.remaining_months,
    startDate: row.start_date,
  }));
}

// ── การค้นหากิจการ ──────────────────────────────────────────────────────────

export interface SmeSearchParams {
  /** คำค้น: ชื่อไทย/อังกฤษ รหัสกิจการ เลขทะเบียน หรือจังหวัด */
  q?: string;
  industry?: string;
  province?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

/**
 * แปลงชื่อการเรียงลำดับเป็น ORDER BY
 *
 * เป็นตารางค่าคงที่ ไม่ใช่การประกอบข้อความจากค่าที่ผู้ใช้ส่งมา — ตรงนี้คือจุดเดียว
 * ในระบบที่ค่าจากภายนอกจะกลายเป็นโครงสร้าง SQL ได้ถ้าเผลอ
 *
 * กิจการที่ยังไม่มีงบการเงินให้อยู่ท้ายเสมอ ไม่ว่าจะเรียงจากมากหรือน้อย
 * เพราะ "ไม่มีข้อมูล" ไม่ใช่ "รายได้ศูนย์" การให้ขึ้นหัวตารางรายได้สูงสุดคือคำตอบที่ผิด
 */
const SORT_SQL: Record<string, string> = {
  name: 's.name_th ASC',
  revenue_desc: 'latest_revenue IS NULL, latest_revenue DESC, s.name_th ASC',
  revenue_asc: 'latest_revenue IS NULL, latest_revenue ASC, s.name_th ASC',
  employees_desc: 's.employees DESC, s.name_th ASC',
  employees_asc: 's.employees ASC, s.name_th ASC',
  founded_desc: 's.founded_year DESC, s.name_th ASC',
  founded_asc: 's.founded_year ASC, s.name_th ASC',
};

/** ค่าที่ไม่รู้จักถอยไปใช้การเรียงตามชื่อ แทนที่จะปฏิเสธคำขอทั้งคำขอ */
export function resolveSort(value: string | undefined): string {
  return value !== undefined && value in SORT_SQL ? value : 'name';
}

interface SummaryRow {
  id: string;
  name_th: string;
  name_en: string;
  industry: string;
  province: string;
  founded_year: number;
  employees: number;
  latest_revenue: number | null;
  latest_fiscal_year: number | null;
}

/**
 * ค้นหากิจการพร้อมนับจำนวนทั้งหมด
 *
 * ดึงรายได้ปีล่าสุดมาด้วยเพื่อให้รายการผลลัพธ์บอกขนาดกิจการได้ทันที
 * โดยไม่ต้องยิงคำขอเพิ่มทีละราย
 */
export function searchSmes(params: SmeSearchParams = {}): {
  smes: SmeSummary[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
} {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const sort = resolveSort(params.sort);

  const where: string[] = [];
  const args: Record<string, unknown> = {};

  const term = params.q?.trim();
  if (term) {
    where.push(
      `(s.name_th LIKE @term OR s.name_en LIKE @term OR s.id LIKE @term
        OR s.registration_no LIKE @term OR s.province LIKE @term)`,
    );
    args.term = `%${term}%`;
  }
  if (params.industry) {
    where.push('s.industry = @industry');
    args.industry = params.industry;
  }
  if (params.province) {
    where.push('s.province = @province');
    args.province = params.province;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM smes s ${whereSql}`).get(args) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT s.id, s.name_th, s.name_en, s.industry, s.province, s.founded_year, s.employees,
              f.revenue AS latest_revenue, f.fiscal_year AS latest_fiscal_year
         FROM smes s
         LEFT JOIN financial_statements f
           ON f.id = (
             SELECT id FROM financial_statements
              WHERE sme_id = s.id AND period = 'FY'
              ORDER BY fiscal_year DESC LIMIT 1
           )
         ${whereSql}
         ORDER BY ${SORT_SQL[sort]}
         LIMIT @limit OFFSET @offset`,
    )
    .all({ ...args, limit, offset }) as SummaryRow[];

  return {
    smes: rows.map((row) => ({
      id: row.id,
      nameTh: row.name_th,
      nameEn: row.name_en,
      industry: row.industry as Industry,
      province: row.province,
      foundedYear: row.founded_year,
      employees: row.employees,
      latestRevenue: row.latest_revenue,
      latestFiscalYear: row.latest_fiscal_year,
    })),
    total,
    limit,
    offset,
    sort,
  };
}

/** ค่าที่มีจริงในฐานข้อมูล ใช้สร้างตัวเลือกของตัวกรองโดยไม่ต้องฮาร์ดโค้ด */
export function smeFacets(): { industries: string[]; provinces: string[] } {
  const db = getDb();
  const industries = (
    db.prepare('SELECT DISTINCT industry FROM smes ORDER BY industry').all() as {
      industry: string;
    }[]
  ).map((row) => row.industry);
  const provinces = (
    db.prepare('SELECT DISTINCT province FROM smes ORDER BY province').all() as {
      province: string;
    }[]
  ).map((row) => row.province);
  return { industries, provinces };
}

export function countSmes(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM smes').get() as { n: number }).n;
}
