/** เส้นทาง API ของที่ปรึกษา AI */

import { Router } from 'express';
import { getSme } from '../db/smeRepo.js';
import { getConversation, listConversations, listMessages } from '../db/advisorRepo.js';
import { runAdvisor, SUGGESTIONS } from '../agent/agent.js';
import { asyncRoute, badRequest, notFound } from '../middleware/errors.js';
import { bodyString } from '../middleware/security.js';

export const advisorRouter = Router();

const MAX_QUESTION_LENGTH = 2000;

advisorRouter.get('/suggestions', (_req, res) => {
  res.json({ suggestions: SUGGESTIONS });
});

advisorRouter.post(
  '/chat',
  asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const message = bodyString(body, 'message', { required: true })!.trim();
    if (message.length === 0) throw badRequest('message ต้องไม่ว่าง');
    if (message.length > MAX_QUESTION_LENGTH) {
      throw badRequest(`message ยาวเกินไป (สูงสุด ${MAX_QUESTION_LENGTH} ตัวอักษร)`);
    }

    const smeId = bodyString(body, 'smeId');
    if (smeId && !getSme(smeId)) throw notFound(`ไม่พบกิจการ "${smeId}"`);

    const conversationId = bodyString(body, 'conversationId');

    res.json(
      await runAdvisor({
        question: message,
        ...(smeId ? { smeId } : {}),
        ...(conversationId ? { conversationId } : {}),
      }),
    );
  }),
);

advisorRouter.get('/conversations/:smeId', (req, res) => {
  const smeId = req.params.smeId!;
  if (!getSme(smeId)) throw notFound(`ไม่พบกิจการ "${smeId}"`);
  res.json({ conversations: listConversations(smeId) });
});

advisorRouter.get('/conversation/:id', (req, res) => {
  const conversation = getConversation(req.params.id!);
  if (!conversation) throw notFound(`ไม่พบบทสนทนา "${req.params.id}"`);
  res.json({ conversation, messages: listMessages(conversation.id) });
});
