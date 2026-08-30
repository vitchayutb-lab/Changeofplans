/**
 * ประกอบแอป Express (แยกจากการ listen เพื่อให้เทสต์เรียกใช้ได้โดยตรง)
 */

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { errorHandler } from './middleware/errors.js';
import { securityHeaders } from './middleware/security.js';
import { advisorRouter } from './routes/advisor.js';
import { botRouter } from './routes/bot.js';
import { fundingRouter } from './routes/funding.js';
import { healthRouter } from './routes/health.js';
import { smeRouter } from './routes/sme.js';
import { toolsRouter } from './routes/tools.js';

export interface CreateAppOptions {
  /** ใส่ข้อมูลตั้งต้นให้อัตโนมัติเมื่อฐานข้อมูลยังว่าง */
  seed?: boolean;
  /** เสิร์ฟไฟล์หน้าเว็บที่ build แล้ว (ใช้ตอน production) */
  serveStatic?: boolean;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  if (options.seed ?? true) {
    seedDatabase(getDb());
  }

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/bot', botRouter);
  app.use('/api/smes', smeRouter);
  app.use('/api/funding', fundingRouter);
  app.use('/api/advisor', advisorRouter);
  app.use('/api/tools', toolsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบเส้นทาง API นี้' } });
  });

  if (options.serveStatic ?? env.isProduction) {
    const webDist = resolve(process.cwd(), 'apps/web/dist');
    if (existsSync(webDist)) {
      app.use(express.static(webDist));
      // ให้ client-side routing ทำงานได้: เส้นทางที่ไม่ใช่ /api ส่ง index.html กลับไป
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(resolve(webDist, 'index.html'));
      });
    }
  }

  app.use(errorHandler);
  return app;
}
