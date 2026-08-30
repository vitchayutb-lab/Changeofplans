/** การอ่าน/เขียนฐานข้อมูลแหล่งเงินทุนและใบสมัคร */

import type {
  ApplicationStatus,
  FundingApplication,
  FundingProgram,
  FundingType,
} from '@sme/shared';
import { getDb } from './index.js';
import { newId } from '../util/ids.js';

interface ProgramRow {
  id: string;
  name_th: string;
  name_en: string;
  provider: string;
  type: string;
  min_amount: number;
  max_amount: number;
  rate_min: number | null;
  rate_max: number | null;
  rate_basis: string | null;
  max_term_months: number | null;
  eligible_industries: string;
  eligible_provinces: string;
  min_years_operating: number;
  max_employees: number | null;
  max_annual_revenue: number | null;
  requires_collateral: number;
  min_dscr: number | null;
  description_th: string;
  description_en: string;
  url: string | null;
  active: number;
}

function parseList(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.map(String) : ['*'];
  } catch {
    return ['*'];
  }
}

function mapProgram(row: ProgramRow): FundingProgram {
  return {
    id: row.id,
    nameTh: row.name_th,
    nameEn: row.name_en,
    provider: row.provider,
    type: row.type as FundingType,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    rateMin: row.rate_min,
    rateMax: row.rate_max,
    rateBasis: row.rate_basis as FundingProgram['rateBasis'],
    maxTermMonths: row.max_term_months,
    eligibleIndustries: parseList(row.eligible_industries),
    eligibleProvinces: parseList(row.eligible_provinces),
    minYearsOperating: row.min_years_operating,
    maxEmployees: row.max_employees,
    maxAnnualRevenue: row.max_annual_revenue,
    requiresCollateral: row.requires_collateral === 1,
    minDscr: row.min_dscr,
    descriptionTh: row.description_th,
    descriptionEn: row.description_en,
    url: row.url,
    active: row.active === 1,
  };
}

export function listPrograms(filter: { type?: FundingType } = {}): FundingProgram[] {
  const db = getDb();
  const rows = filter.type
    ? (db
        .prepare('SELECT * FROM funding_programs WHERE active = 1 AND type = ? ORDER BY name_en')
        .all(filter.type) as ProgramRow[])
    : (db
        .prepare('SELECT * FROM funding_programs WHERE active = 1 ORDER BY name_en')
        .all() as ProgramRow[]);
  return rows.map(mapProgram);
}

export function getProgram(id: string): FundingProgram | null {
  const row = getDb().prepare('SELECT * FROM funding_programs WHERE id = ?').get(id) as
    | ProgramRow
    | undefined;
  return row ? mapProgram(row) : null;
}

interface ApplicationRow {
  id: string;
  sme_id: string;
  program_id: string;
  amount_requested: number;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function mapApplication(row: ApplicationRow): FundingApplication {
  return {
    id: row.id,
    smeId: row.sme_id,
    programId: row.program_id,
    amountRequested: row.amount_requested,
    status: row.status as ApplicationStatus,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listApplications(smeId: string): FundingApplication[] {
  const rows = getDb()
    .prepare('SELECT * FROM funding_applications WHERE sme_id = ? ORDER BY updated_at DESC')
    .all(smeId) as ApplicationRow[];
  return rows.map(mapApplication);
}

export function upsertApplication(input: {
  smeId: string;
  programId: string;
  amountRequested: number;
  status: ApplicationStatus;
  note?: string | null;
}): FundingApplication {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, created_at FROM funding_applications WHERE sme_id = ? AND program_id = ?')
    .get(input.smeId, input.programId) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? newId('app');

  db.prepare(
    `INSERT INTO funding_applications
       (id, sme_id, program_id, amount_requested, status, note, created_at, updated_at)
     VALUES (@id, @smeId, @programId, @amountRequested, @status, @note, @createdAt, @updatedAt)
     ON CONFLICT(sme_id, program_id) DO UPDATE SET
       amount_requested = excluded.amount_requested,
       status = excluded.status,
       note = excluded.note,
       updated_at = excluded.updated_at`,
  ).run({
    id,
    smeId: input.smeId,
    programId: input.programId,
    amountRequested: input.amountRequested,
    status: input.status,
    note: input.note ?? null,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  });

  const row = db
    .prepare('SELECT * FROM funding_applications WHERE sme_id = ? AND program_id = ?')
    .get(input.smeId, input.programId) as ApplicationRow;
  return mapApplication(row);
}
