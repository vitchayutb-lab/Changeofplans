/**
 * ประกอบแอป Express (แยกจากการ listen เพื่อให้เทสต์เรียกใช้ได้โดยตรง)
 */

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { backfillProgramUrls, seedDatabase, type SeedOptions } from './db/seed.js';
import { errorHandler } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { securityHeaders } from './middleware/security.js';
import { advisorRouter } from './routes/advisor.js';
import { botRouter } from './routes/bot.js';
import { fundingRouter } from './routes/funding.js';
import { healthRouter } from './routes/health.js';
import { ratiosRouter } from './routes/ratios.js';
import { smeRouter } from './routes/sme.js';
import { startupRouter } from './routes/startup.js';
import { toolsRouter } from './routes/tools.js';

export interface CreateAppOptions {
  /** ใส่ข้อมูลตั้งต้นให้อัตโนมัติเมื่อฐานข้อมูลยังว่าง */
  seed?: boolean;
  /** ตัวเลือกของข้อมูลตั้งต้น (เช่น ปิดชุดกิจการขนาดใหญ่ในเทสต์) */
  seedOptions?: SeedOptions;
  /** เสิร์ฟไฟล์หน้าเว็บที่ build แล้ว (ใช้ตอน production) */
  serveStatic?: boolean;
  /** ปิดตัวจำกัดอัตราคำขอ (ใช้ในเทสต์) */
  rateLimit?: boolean;
}

/**
 * หาโฟลเดอร์ของหน้าเว็บที่ build แล้ว
 *
 * ไม่พึ่ง process.cwd() อย่างเดียว เพราะแพลตฟอร์ม deploy แต่ละเจ้าเริ่มโปรเซสจาก
 * ไดเรกทอรีต่างกัน จึงไล่หาจากตำแหน่งของไฟล์ที่คอมไพล์แล้วด้วย
 */
export function findWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.webDistPath,
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), 'web/dist'),
    resolve(process.cwd(), 'dist/web'),
    // dist/app.js -> apps/server/dist -> apps/server -> apps -> apps/web/dist
    resolve(here, '../../web/dist'),
    resolve(here, '../../../apps/web/dist'),
  ].filter((path): path is string => Boolean(path));

  return candidates.find((path) => existsSync(resolve(path, 'index.html'))) ?? null;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  if (options.seed ?? true) {
    seedDatabase(getDb(), options.seedOptions ?? {});
    // ฐานข้อมูลที่มีข้อมูลอยู่แล้วข้าม seed ทั้งก้อน จึงต้องเติมคอลัมน์ที่เพิ่มทีหลังแยก
    backfillProgramUrls(getDb());
  }

  app.disable('x-powered-by');
  // อยู่หลัง reverse proxy ของแพลตฟอร์ม จึงต้องเชื่อ X-Forwarded-* เท่าที่จำเป็น
  // เพื่อให้ req.ip (ที่ตัวจำกัดอัตราใช้) เป็น IP ของผู้ใช้จริง ไม่ใช่ของ proxy
  if (env.trustProxy > 0) app.set('trust proxy', env.trustProxy);

  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));

  // ตอน production หน้าเว็บถูกเสิร์ฟจากโดเมนเดียวกัน จึงไม่ต้องเปิด CORS เลย
  if (env.corsOrigin.trim() !== '') {
    app.use(
      cors({
        origin:
          env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((origin) => origin.trim()),
      }),
    );
  }

  if (options.rateLimit ?? true) {
    app.use(
      '/api',
      rateLimit({ windowMs: env.rateLimitWindowMs, max: env.rateLimitMax, bucket: 'api' }),
    );
    // ที่ปรึกษาและการเรียกเครื่องมือแพงกว่าเส้นทางอื่นมาก จึงจำกัดแยกและเข้มกว่า
    const expensive = rateLimit({
      windowMs: env.rateLimitWindowMs,
      max: env.rateLimitExpensiveMax,
      bucket: 'expensive',
    });
    app.use('/api/advisor/chat', expensive);
    app.use('/api/startup/assess', expensive);
    app.use('/api/tools', expensive);
    // ทดสอบทีเดียวเท่ากับเรียก ธปท. หนึ่งครั้งต่อชุดข้อมูล แพงที่สุดในบรรดาเส้นทางทั้งหมด
    app.use('/api/bot/probe', expensive);
  }

  app.use('/api/health', healthRouter);
  app.use('/api/bot', botRouter);
  app.use('/api/smes', smeRouter);
  app.use('/api/ratios', ratiosRouter);
  app.use('/api/funding', fundingRouter);
  app.use('/api/startup', startupRouter);
  app.use('/api/advisor', advisorRouter);
  app.use('/api/tools', toolsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบเส้นทาง API นี้' } });
  });

  if (options.serveStatic ?? env.isProduction) {
    const webDist = findWebDist();
    if (webDist) {
      // ไฟล์ asset มีแฮชอยู่ในชื่อ จึงแคชได้ยาว ส่วน index.html ต้องไม่แคช
      app.use(
        express.static(webDist, {
          index: false,
          maxAge: '1y',
          setHeaders(res, path) {
            if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          },
        }),
      );
      // ให้ client-side routing ทำงานได้: เส้นทางที่ไม่ใช่ /api ส่ง index.html กลับไป
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(resolve(webDist, 'index.html'));
      });
    } else {
      // ล้มเหลวแบบเห็นชัด ดีกว่าเสิร์ฟ 404 เงียบ ๆ แล้วให้คนไล่หาสาเหตุเอง
      console.warn(
        '[web] ไม่พบหน้าเว็บที่ build แล้ว — รัน "npm run build" ก่อน ' +
          'หรือตั้ง WEB_DIST_PATH ให้ชี้ไปยังโฟลเดอร์ dist ของหน้าเว็บ',
      );
    }
  }

  app.use(errorHandler);
  return app;
}
