/**
 * Chat's notices to people (00441), for the web's Chat engine and the agents'
 * minute tick. Server to server: CRON_SECRET auth, as the other internal
 * endpoints; the web passes the workspace whose key it found failing.
 *
 * POST /api/internal/chat/notices/own-key { orgId, provider, since, reminder? }
 *   since: the key's failing_since, the episode it tells of.
 *   → 200 { notices, emails }: each Admin's Inbox notice and, by their
 *     "Notify me when an agent needs me", an e-mail (lib/chat-notices/ownKey.js).
 *     Once per episode, and once more as `reminder` 3 days in: a call for an
 *     episode already told, or a key that works again, answers 0 and 0.
 *
 * POST /api/internal/chat/notices/go-live-off { orgId, agentId, version, editor? }
 *   An edit made a new version of an agent allowed to go live on its own for
 *   `version` (AUTONOMOUS-GO-LIVE §7.2, 00446): the Admin who allowed it and
 *   its owner, but not the editor, are told, Inbox and e-mail, once per version
 *   (lib/chat-notices/goLive.js). An agent not allowed for it: 0 and 0.
 */

import { Router } from 'express';
import { z } from 'zod';
import { tellGoLiveOff } from '../lib/chat-notices/goLive.js';
import { notifyOwnKeyFailure } from '../lib/chat-notices/ownKey.js';
import logger from '../lib/logger.js';
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

const ownKeySchema = z.object({
  orgId: z.guid(),
  provider: z.enum(['anthropic', 'openai', 'google', 'azure', 'openrouter']),
  since: z.iso.datetime({ offset: true }),
  reminder: z.boolean().optional(),
});

router.post('/own-key', async (req, res) => {
  const parsed = ownKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  try {
    const told = await notifyOwnKeyFailure(parsed.data);
    return res.json({ success: true, ...told });
  } catch (err) {
    logger.error({ err, orgId: parsed.data.orgId }, 'own key notice failed');
    return res.status(500).json({ success: false, message: 'Could not tell the Admins' });
  }
});

const goLiveOffSchema = z.object({
  orgId: z.guid(),
  agentId: z.guid(),
  version: z.number().int().min(1),
  editor: z.guid().optional(),
});

router.post('/go-live-off', async (req, res) => {
  const parsed = goLiveOffSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  try {
    const told = await tellGoLiveOff(parsed.data);
    return res.json({ success: true, ...told });
  } catch (err) {
    logger.error({ err, agentId: parsed.data.agentId }, 'go-live off notice failed');
    return res.status(500).json({ success: false, message: 'Could not tell them' });
  }
});

export default router;
