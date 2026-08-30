/** เส้นทาง API ของโหมด Startup — ประเมินความพร้อมกู้ของกิจการที่ยังไม่มีงบการเงิน */

import { Router } from 'express';
import { assessStartup } from '../services/startup/assessment.js';
import { EXAMPLE_PROFILE, parseStartupProfile } from '../services/startup/parseProfile.js';
import { asyncRoute } from '../middleware/errors.js';

export const startupRouter = Router();

/** ตัวอย่างข้อมูลสำหรับเติมฟอร์มให้ผู้ใช้เห็นผลลัพธ์ได้ทันที */
startupRouter.get('/example', (_req, res) => {
  res.json({ profile: EXAMPLE_PROFILE });
});

startupRouter.post(
  '/assess',
  asyncRoute(async (req, res) => {
    const profile = parseStartupProfile(req.body);
    res.json(await assessStartup(profile));
  }),
);
