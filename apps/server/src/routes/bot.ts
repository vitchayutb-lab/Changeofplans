/**
 * เส้นทาง API ของข้อมูลธนาคารแห่งประเทศไทย
 *
 * เบราว์เซอร์เห็นเฉพาะ endpoint เหล่านี้ ไม่เคยเห็น URL ของ BOT และไม่เคยเห็น API key
 */

import { Router } from 'express';
import type { BotSeriesId } from '@sme/shared';
import { BOT_SERIES_IDS } from '@sme/shared';
import { getBotService } from '../services/bot/botService.js';
import { seriesCatalog } from '../services/bot/botSeries.js';
import { asyncRoute, badRequest, notFound } from '../middleware/errors.js';
import { queryDate, queryString } from '../middleware/security.js';

export const botRouter = Router();

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'];

/** ชุดตัวเลขสำหรับแดชบอร์ด Market & Economic Data */
botRouter.get(
  '/summary',
  asyncRoute(async (_req, res) => {
    res.json(await getBotService().getSummary());
  }),
);

botRouter.get(
  '/series',
  asyncRoute(async (_req, res) => {
    res.json({ series: seriesCatalog() });
  }),
);

botRouter.get(
  '/policy-rate',
  asyncRoute(async (req, res) => {
    res.json(await getBotService().getSeries('policy_rate', windowOf(req)));
  }),
);

botRouter.get(
  '/lending-rate',
  asyncRoute(async (req, res) => {
    res.json(await getBotService().getSeries('lending_rate', windowOf(req)));
  }),
);

botRouter.get(
  '/deposit-rate',
  asyncRoute(async (req, res) => {
    res.json(await getBotService().getSeries('deposit_rate', windowOf(req)));
  }),
);

botRouter.get(
  '/exchange-rate',
  asyncRoute(async (req, res) => {
    const currency = (queryString(req, 'currency') ?? 'USD').toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw badRequest(
        `ยังไม่รองรับสกุลเงิน "${currency}"`,
        `supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }
    res.json(await getBotService().getSeries('fx_average', { ...windowOf(req), currency }));
  }),
);

/** ตัวเลขตลาดเงินหลายชุดในคำขอเดียว */
botRouter.get(
  '/market',
  asyncRoute(async (_req, res) => {
    const bot = getBotService();
    const [interbank, bibor, reference] = await Promise.all([
      bot.getSeries('interbank_rate'),
      bot.getSeries('bibor'),
      bot.getSeries('fx_reference'),
    ]);
    res.json({ interbank, bibor, reference });
  }),
);

botRouter.get(
  '/indicator/:indicator',
  asyncRoute(async (req, res) => {
    const indicator = req.params.indicator as BotSeriesId;
    if (!BOT_SERIES_IDS.includes(indicator)) {
      throw notFound(
        `ไม่รู้จักชุดข้อมูล "${indicator}" — ที่รองรับ: ${BOT_SERIES_IDS.join(', ')}`,
      );
    }
    const currency = queryString(req, 'currency');
    res.json(
      await getBotService().getSeries(indicator, {
        ...windowOf(req),
        ...(currency ? { currency: currency.toUpperCase() } : {}),
      }),
    );
  }),
);

/**
 * ทดสอบว่าทะเบียนชุดข้อมูลตรงกับผลลัพธ์จริงของ ธปท. หรือยัง
 *
 * เส้นทางปกติออกแบบมาให้หน้าเว็บได้ตัวเลขเสมอ ดึงไม่ได้ก็ถอยไปข้อมูลจำลอง ซึ่งแปลว่า
 * ชุดที่ path หรือชื่อคอลัมน์ผิดจะดูเหมือนทำงานได้ตลอด เส้นทางนี้ไม่ถอยและไม่ใช้แคช
 * จึงบอกได้ว่าชุดไหนเรียกไม่ติด และชุดไหนเรียกติดแต่ไม่มีมิติใดได้ค่าเลย
 *
 * POST เพราะหนึ่งคำขอเท่ากับการเรียก ธปท. หนึ่งครั้งต่อชุด
 */
botRouter.post(
  '/probe',
  asyncRoute(async (req, res) => {
    const body = req.body as { seriesId?: string } | undefined;
    const seriesId = body?.seriesId;
    if (seriesId !== undefined && !BOT_SERIES_IDS.includes(seriesId as BotSeriesId)) {
      throw badRequest(
        `ไม่รู้จักชุดข้อมูล "${seriesId}"`,
        `supported: ${BOT_SERIES_IDS.join(', ')}`,
      );
    }
    const bot = getBotService();
    const probes = seriesId
      ? [await bot.probeSeries(seriesId as BotSeriesId)]
      : await bot.probeAll();
    res.json({ probes, checkedAt: new Date().toISOString() });
  }),
);

/** เครื่องมือสำหรับนักพัฒนา: ล้างแคชเพื่อบังคับให้ดึงข้อมูลใหม่ */
botRouter.post(
  '/cache/invalidate',
  asyncRoute(async (req, res) => {
    const body = req.body as { seriesId?: string } | undefined;
    const seriesId = body?.seriesId;
    if (seriesId && !BOT_SERIES_IDS.includes(seriesId as BotSeriesId)) {
      throw badRequest(`ไม่รู้จักชุดข้อมูล "${seriesId}"`);
    }
    const cleared = getBotService().invalidate(seriesId as BotSeriesId | undefined);
    res.json({ cleared, seriesId: seriesId ?? null });
  }),
);

function windowOf(req: Parameters<typeof queryDate>[0]): { start?: string; end?: string } {
  const start = queryDate(req, 'start');
  const end = queryDate(req, 'end');
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}
