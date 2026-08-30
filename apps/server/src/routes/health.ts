/** สถานะระบบและโหมดของแหล่งข้อมูลแต่ละตัว */

import { Router } from 'express';
import type { HealthResponse } from '@sme/shared';
import { env } from '../config/env.js';
import { databaseHealthy } from '../db/index.js';
import { cacheStats } from '../db/botRepo.js';
import { getBotService } from '../services/bot/botService.js';
import { llmMode } from '../services/llm/index.js';
import { asyncRoute } from '../middleware/errors.js';

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    const bot = getBotService();
    const snapshot = bot.healthSnapshot();
    const botMode = bot.mode();
    const modeOfLlm = llmMode();

    const body: HealthResponse = {
      status: 'ok',
      version: env.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      demoMode: botMode !== 'live' || modeOfLlm !== 'live',
      modes: {
        bot: botMode,
        llm: modeOfLlm,
        database: databaseHealthy() ? 'ok' : 'error',
      },
      bot: {
        // บอกแค่ว่า "ตั้งค่าไว้หรือยัง" — ไม่เปิดเผยค่าหรือความยาวของคีย์
        apiKeyConfigured: snapshot.apiKeyConfigured,
        lastSuccessAt: snapshot.lastSuccessAt,
        lastErrorAt: snapshot.lastErrorAt,
        lastError: snapshot.lastError,
        cachedSeries: cacheStats().rows,
        baseUrlError: env.botApiBaseUrlError,
      },
    };

    res.json(body);
  }),
);
