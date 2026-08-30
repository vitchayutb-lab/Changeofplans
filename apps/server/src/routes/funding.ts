/** เส้นทาง API ของแหล่งเงินทุนและการติดตามการยื่นขอ */

import { Router } from 'express';
import type { ApplicationStatus, FundingType } from '@sme/shared';
import { getProgram, listApplications, listPrograms, upsertApplication } from '../db/fundingRepo.js';
import { getSme } from '../db/smeRepo.js';
import { matchFundingPrograms } from '../services/funding/matcher.js';
import { asyncRoute, badRequest, notFound } from '../middleware/errors.js';
import { bodyNumber, bodyString, queryNumber, queryString } from '../middleware/security.js';

export const fundingRouter = Router();

const TYPES: FundingType[] = ['loan', 'grant', 'guarantee', 'equity', 'subsidy'];
const STATUSES: ApplicationStatus[] = [
  'interested',
  'preparing',
  'submitted',
  'approved',
  'rejected',
];

fundingRouter.get('/programs', (req, res) => {
  const type = queryString(req, 'type') as FundingType | undefined;
  if (type && !TYPES.includes(type)) {
    throw badRequest(`type ต้องเป็นหนึ่งใน: ${TYPES.join(', ')}`);
  }
  res.json({ programs: listPrograms(type ? { type } : {}) });
});

fundingRouter.get('/programs/:id', (req, res) => {
  const program = getProgram(req.params.id!);
  if (!program) throw notFound(`ไม่พบโครงการ "${req.params.id}"`);
  res.json({ program });
});

fundingRouter.get(
  '/match/:smeId',
  asyncRoute(async (req, res) => {
    const smeId = req.params.smeId!;
    if (!getSme(smeId)) throw notFound(`ไม่พบกิจการ "${smeId}"`);
    const amountNeeded = queryNumber(req, 'amount');
    res.json({
      smeId,
      matches: await matchFundingPrograms({
        smeId,
        ...(amountNeeded !== undefined ? { amountNeeded } : {}),
      }),
    });
  }),
);

fundingRouter.get('/applications/:smeId', (req, res) => {
  const smeId = req.params.smeId!;
  if (!getSme(smeId)) throw notFound(`ไม่พบกิจการ "${smeId}"`);
  res.json({ applications: listApplications(smeId) });
});

fundingRouter.post('/applications', (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const smeId = bodyString(body, 'smeId', { required: true })!;
  const programId = bodyString(body, 'programId', { required: true })!;
  const amountRequested = bodyNumber(body, 'amountRequested', { required: true })!;
  const status = (bodyString(body, 'status') ?? 'interested') as ApplicationStatus;

  if (!getSme(smeId)) throw notFound(`ไม่พบกิจการ "${smeId}"`);
  if (!getProgram(programId)) throw notFound(`ไม่พบโครงการ "${programId}"`);
  if (!STATUSES.includes(status)) {
    throw badRequest(`status ต้องเป็นหนึ่งใน: ${STATUSES.join(', ')}`);
  }
  if (amountRequested <= 0) throw badRequest('amountRequested ต้องมากกว่า 0');

  const note = bodyString(body, 'note');
  res.status(201).json({
    application: upsertApplication({
      smeId,
      programId,
      amountRequested,
      status,
      ...(note !== undefined ? { note } : {}),
    }),
  });
});
