import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { ensureDemoBrand, setDemoHidden } from '../lib/demo/index.js';

/**
 * The organization's demo brand (00380): Brewline Coffee with sample data,
 * in the organization's own brands. Open whatever the plan
 * (middleware/subscription.js, DEMO_ROUTES): it costs nothing, and the
 * people it is for are the ones without a plan.
 */

const router = Router();

const MANAGERS = new Set(['admin', 'manager']);

async function readProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles read: ${error.message}`);
  return data;
}

const noOrganization = (res) =>
  res.status(409).json({ error: 'Set up your workspace first.', code: 'no_organization' });

// POST /api/demo — the demo brand, created on the first visit and rebuilt
// when the product moved on or its data grew old: { brandId, version,
// rebuilt }. Any member may open it. Whether it is hidden is left as it is.
router.post('/', async (req, res) => {
  try {
    const profile = await readProfile(req.user.id);
    if (!profile?.organization_id) return noOrganization(res);
    const result = await ensureDemoBrand({ organizationId: profile.organization_id });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'demo brand error');
    return res.status(500).json({ error: 'The demo brand could not be opened.', code: 'failed' });
  }
});

// PATCH /api/demo { hidden } — hides or shows the demo brand for the whole
// organization: { brandId, hidden }. Admins and managers, as for the
// organization's other brands. Never deletes it.
router.patch('/', async (req, res) => {
  const body = z.object({ hidden: z.boolean() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const profile = await readProfile(req.user.id);
    if (!profile?.organization_id) return noOrganization(res);
    if (!MANAGERS.has(profile.role)) {
      return res
        .status(403)
        .json({ error: 'Only admins and managers can hide the demo brand.', code: 'forbidden' });
    }
    const result = await setDemoHidden({
      organizationId: profile.organization_id,
      hidden: body.data.hidden,
    });
    if (!result) return res.status(404).json({ error: 'No demo brand yet.', code: 'no_demo' });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'demo brand hide error');
    return res.status(500).json({ error: 'The demo brand could not be changed.', code: 'failed' });
  }
});

export default router;
