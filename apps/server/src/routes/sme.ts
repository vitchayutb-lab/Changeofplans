/** เส้นทาง API ของกิจการ งบการเงิน หนี้สิน และการจำลองสินเชื่อ */

import { Router } from 'express';
import type { FinancialStatementInput, RateBasis, StatementPeriod } from '@sme/shared';
import {
  getSme,
  listLoans,
  listStatements,
  searchSmes,
  smeFacets,
  upsertStatement,
} from '../db/smeRepo.js';
import { analyzeSme, statementHistory } from '../services/finance/analysis.js';
import { getDebtOverview } from '../services/finance/debt.js';
import { simulateLoan } from '../services/finance/simulation.js';
import { balanceCheck } from '../services/finance/statement.js';
import { asyncRoute, badRequest, notFound } from '../middleware/errors.js';
import { bodyNumber, bodyString, queryNumber, queryString } from '../middleware/security.js';

export const smeRouter = Router();

const RATE_BASES: RateBasis[] = ['fixed', 'mlr_spread', 'mor_spread', 'mrr_spread'];
const PERIODS: StatementPeriod[] = ['FY', 'H1', 'Q1', 'Q2', 'Q3', 'Q4'];

const STATEMENT_FIELDS: (keyof FinancialStatementInput)[] = [
  'revenue',
  'cogs',
  'operatingExpenses',
  'depreciation',
  'interestExpense',
  'tax',
  'cash',
  'accountsReceivable',
  'inventory',
  'otherCurrentAssets',
  'fixedAssets',
  'accountsPayable',
  'shortTermDebt',
  'otherCurrentLiabilities',
  'longTermDebt',
  'equityPaidUp',
  'retainedEarnings',
];

function requireSme(id: string) {
  const sme = getSme(id);
  if (!sme) throw notFound(`ไม่พบกิจการ "${id}"`);
  return sme;
}

/**
 * ค้นหากิจการ
 *
 * ฐานข้อมูลมีกิจการหลักพันราย จึงต้องค้นและแบ่งหน้าที่ฝั่งเซิร์ฟเวอร์
 * ไม่ส่งทั้งหมดไปให้เบราว์เซอร์กรองเอง
 */
smeRouter.get('/', (req, res) => {
  const q = queryString(req, 'q');
  const industry = queryString(req, 'industry');
  const province = queryString(req, 'province');
  const sort = queryString(req, 'sort');
  const limit = queryNumber(req, 'limit');
  const offset = queryNumber(req, 'offset');

  const result = searchSmes({
    ...(q ? { q } : {}),
    ...(industry ? { industry } : {}),
    ...(province ? { province } : {}),
    ...(sort ? { sort } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  });

  res.json({ ...result, facets: smeFacets() });
});

smeRouter.get('/:id', (req, res) => {
  const sme = requireSme(req.params.id!);
  res.json({
    sme,
    loans: listLoans(sme.id),
    statements: listStatements(sme.id).map((s) => ({
      id: s.id,
      fiscalYear: s.fiscalYear,
      period: s.period,
      revenue: s.revenue,
      source: s.source,
    })),
  });
});

smeRouter.get('/:id/statements', (req, res) => {
  const sme = requireSme(req.params.id!);
  res.json({ statements: listStatements(sme.id), history: statementHistory(sme.id) });
});

smeRouter.post('/:id/statements', (req, res) => {
  const sme = requireSme(req.params.id!);
  const body = req.body as Record<string, unknown> | undefined;

  const fiscalYear = bodyNumber(body, 'fiscalYear', { required: true })!;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || fiscalYear > 2100) {
    throw badRequest('fiscalYear ต้องเป็นปี ค.ศ. ที่สมเหตุสมผล');
  }
  const period = (bodyString(body, 'period') ?? 'FY') as StatementPeriod;
  if (!PERIODS.includes(period)) {
    throw badRequest(`period ต้องเป็นหนึ่งใน: ${PERIODS.join(', ')}`);
  }

  const input = { fiscalYear, period } as FinancialStatementInput;
  for (const key of STATEMENT_FIELDS) {
    (input[key] as number) = bodyNumber(body, key) ?? 0;
  }

  const saved = upsertStatement(sme.id, input, 'manual');
  const balance = balanceCheck(saved);

  res.status(201).json({
    statement: saved,
    balance,
    // ไม่ปฏิเสธงบที่ไม่สมดุล แต่บอกส่วนต่างให้ผู้ใช้เห็นและแก้ไขได้
    warning: balance.balanced
      ? null
      : `งบดุลไม่สมดุล ต่างกัน ${balance.difference.toLocaleString('en-US')} บาท ` +
        '(สินทรัพย์รวม ≠ หนี้สินรวม + ส่วนของผู้ถือหุ้น)',
  });
});

smeRouter.get(
  '/:id/analysis',
  asyncRoute(async (req, res) => {
    const sme = requireSme(req.params.id!);
    const fiscalYear = queryNumber(req, 'fiscalYear');
    res.json(await analyzeSme(sme.id, fiscalYear));
  }),
);

smeRouter.get(
  '/:id/debt',
  asyncRoute(async (req, res) => {
    const sme = requireSme(req.params.id!);
    res.json(await getDebtOverview(sme.id));
  }),
);

smeRouter.post(
  '/:id/loan-simulation',
  asyncRoute(async (req, res) => {
    const sme = requireSme(req.params.id!);
    const body = req.body as Record<string, unknown> | undefined;

    const amount = bodyNumber(body, 'amount', { required: true })!;
    if (amount <= 0) throw badRequest('amount ต้องมากกว่า 0');
    const years = bodyNumber(body, 'years') ?? 5;
    if (years <= 0 || years > 40) throw badRequest('years ต้องอยู่ระหว่าง 0 ถึง 40');

    const rateBasis = (bodyString(body, 'rateBasis') ?? 'mrr_spread') as RateBasis;
    if (!RATE_BASES.includes(rateBasis)) {
      throw badRequest(`rateBasis ต้องเป็นหนึ่งใน: ${RATE_BASES.join(', ')}`);
    }

    const spreadPct = bodyNumber(body, 'spreadPct');
    const fixedRatePct = bodyNumber(body, 'fixedRatePct');
    if (rateBasis === 'fixed' && fixedRatePct === undefined) {
      throw badRequest('เมื่อ rateBasis = fixed ต้องระบุ fixedRatePct');
    }

    res.json(
      await simulateLoan({
        smeId: sme.id,
        amount,
        years,
        rateBasis,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        ...(fixedRatePct !== undefined ? { fixedRatePct } : {}),
      }),
    );
  }),
);
