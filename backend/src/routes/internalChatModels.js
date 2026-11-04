/**
 * Chat's model menu (lib/modelMenu.js; CHAT-16 §A–B, W4-01), for the web
 * (frontend/src/app/api/chat/models). Server to server: CRON_SECRET auth, as the
 * other internal endpoints; the web checks the person, their workspace and
 * their plan, and names the models it offers.
 *
 * GET /api/internal/chat/models?ids=a,b&selected=&q=
 *   ids: the models the web offers (catalog ids, at most 20); selected: the
 *   one a chat runs on, answered even when the catalog dropped it; q: a
 *   search of the catalog's chat models that can call tools.
 *   → 200 { success, auto, models, selected, results, catalogCount, updatedAt }:
 *     each model's multiplier label and tone, never a price.
 *   → 400 for a bad query.
 *
 * Calls with the secret aren't counted by the API's per-IP limiter
 * (rateLimiter.js), as the budget's.
 */

import { Router } from 'express';
import { z } from 'zod';
import { chatModelMenu } from '../lib/modelMenu.js';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';

const router = Router();

// The secret is compared in constant time (webhookSecretsMatch), as the rate limiter does.
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** A catalog id: provider/model, as OpenRouter writes it ("anthropic/claude-sonnet-5.5"). */
const modelId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._~:-]{1,100}\/[A-Za-z0-9._~:-]{1,100}$/);

const menuQuery = z.strictObject({
  ids: z
    .string()
    .max(4000)
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : []))
    .pipe(z.array(modelId).max(20)),
  selected: z.union([z.literal('auto'), modelId]).optional(),
  q: z.string().trim().max(100).optional(),
});

router.get('/', (req, res) => {
  const parsed = menuQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  const { ids, selected, q } = parsed.data;
  return res.json({ success: true, ...chatModelMenu({ ids, selected, q }) });
});

export default router;
