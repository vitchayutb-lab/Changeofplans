/**
 * เส้นทาง API ของเงื่อนไขการกู้
 *
 * /overview อ่านได้โดยไม่ต้องกรอกอะไร เพราะเป็นการนับเงื่อนไขในทะเบียนโครงการล้วน ๆ
 * ส่วน /check ต้องมีโปรไฟล์ จึงรับผ่าน POST เหมือนการประเมินของโหมด Startup
 */

import { Router } from 'express';
import { lendingConditions, lendingOverview } from '../services/funding/conditions.js';
import {
  EXAMPLE_LENDING_PROFILE,
  parseLendingProfile,
} from '../services/funding/parseLendingProfile.js';
import { asyncRoute } from '../middleware/errors.js';

export const lendingRouter = Router();

lendingRouter.get('/overview', (_req, res) => {
  res.json(lendingOverview());
});

lendingRouter.get('/example', (_req, res) => {
  res.json({ profile: EXAMPLE_LENDING_PROFILE });
});

lendingRouter.post(
  '/check',
  asyncRoute(async (req, res) => {
    res.json(lendingConditions(parseLendingProfile(req.body)));
  }),
);
