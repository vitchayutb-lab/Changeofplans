/**
 * หน้า HTTP ของทะเบียนเครื่องมือ
 *
 * ทั้ง MCP bridge และหน้า Developer ใช้สองเส้นทางนี้ ทำให้สิ่งที่ AI เห็น
 * กับสิ่งที่คนกดทดสอบเองเป็นชุดเดียวกันเป๊ะ
 */

import { Router } from 'express';
import { getToolRegistry } from '../agent/tools/index.js';
import { asyncRoute, notFound } from '../middleware/errors.js';
import { bodyString } from '../middleware/security.js';

export const toolsRouter = Router();

toolsRouter.get('/', (_req, res) => {
  res.json({ tools: getToolRegistry().catalog() });
});

toolsRouter.post(
  '/:name/invoke',
  asyncRoute(async (req, res) => {
    const registry = getToolRegistry();
    const name = req.params.name!;
    if (!registry.has(name)) {
      throw notFound(`ไม่รู้จักเครื่องมือ "${name}" — ที่มี: ${registry.names().join(', ')}`);
    }

    const body = req.body as { arguments?: unknown; smeId?: unknown } | undefined;
    const smeId = bodyString(body, 'smeId');

    const outcome = await registry.invoke(name, body?.arguments ?? {}, {
      ...(smeId ? { smeId } : {}),
    });

    res.json({
      tool: name,
      arguments: outcome.arguments,
      result: outcome.data,
      source: outcome.source,
      notice: outcome.notice,
      citation: outcome.citation,
      durationMs: outcome.durationMs,
    });
  }),
);
