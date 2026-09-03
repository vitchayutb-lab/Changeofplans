/**
 * ทะเบียนอัตราส่วนที่ระบบใช้วัดกิจการ พร้อมสูตรและเกณฑ์
 *
 * ไม่ผูกกับกิจการใด จึงเปิดอ่านได้ก่อนเลือกกิจการ และมาจากทะเบียนเดียวกับที่ใช้
 * คำนวณจริง — หน้าอธิบายเกณฑ์จึงบอกค่าคนละอย่างกับที่ระบบตัดสินไม่ได้
 */

import { Router } from 'express';
import { ratioCatalog } from '../services/finance/ratios.js';
import { asyncRoute } from '../middleware/errors.js';

export const ratiosRouter = Router();

ratiosRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    res.json({ groups: ratioCatalog() });
  }),
);
