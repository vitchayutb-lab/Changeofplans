/** การอ่าน/เขียนข้อมูล SME งบการเงิน และสินเชื่อเดิม */

import type {
  ExistingLoan,
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
