import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess } from '../lib/access.js';
import { MAX_MENTIONS, sendMentionsToActionCenter } from '../lib/action-center/fromMentions.js';

const router = Router();

const mentionActionSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  resultIds: z.array(z.guid()).min(1).max(MAX_MENTIONS),
  // The passage around each answer's mention, as the Mentions table shows it.
  excerpts: z.record(z.guid(), z.string().max(2000)).optional(),
});

/**
 * POST /api/mentions/action
 * Body: { brandId, resultIds, excerpts? }
 *
 * "Send to Action Center" on the Mentions tab (MS-08): the chosen answers
 * naming the brand as one action. Sending the same answers again returns the
 * action already open.
 */
router.post('/action', async (req, res) => {
  try {
    const parsed = mentionActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, resultIds, excerpts } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);

    const result = await sendMentionsToActionCenter(brandId, {
      resultIds,
      excerpts,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'mention action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
    });
  }
});

export default router;
