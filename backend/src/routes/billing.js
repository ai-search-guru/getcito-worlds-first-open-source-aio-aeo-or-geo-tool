/**
 * Billing answers that go to the team (the plan itself is changed by the web
 * app, through Stripe).
 *
 * POST /api/billing/cancel-feedback — { reasons, message, choice } → kept and
 *                                     e-mailed to CANCEL_FEEDBACK_EMAILS, with
 *                                     replies going to the customer
 * GET  /api/billing/ai-usage        — this period's AI usage (getAiUsage), for
 *                                     the Billing page's meter, with what
 *                                     Write this typically takes
 * GET  /api/billing/ai-usage/draft/:draftId
 *                                   — a Content Editor page's share of it
 *                                     (getDraftAiUsage), for the editor meter
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { aiEstimateCosts } from '../lib/aiEstimates.js';
import { deliverEmail } from '../lib/email.js';
import { PlanLimitError, getAiUsage, getDraftAiUsage, getOrgIdForUser } from '../lib/planGuard.js';
import {
  DAILY_LIMIT,
  SUBSCRIBED_STATUSES,
  buildCancelFeedbackEmail,
  canWait,
  cancelFeedbackSchema,
  feedbackRecipients,
} from '../lib/cancelFeedback.js';

const router = Router();

router.get('/ai-usage', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user.id);
    // Self-hosted single-user setups may have no org row: no budget applies.
    if (!orgId) {
      return res.json({
        plan: 'self_hosted',
        planName: null,
        trial: false,
        periodStart: null,
        periodEnd: null,
        unlimited: true,
        percentUsed: null,
        features: [],
      });
    }
    // With what Write this and a draft's AI checks typically take, for the
    // pages that say so (customer priorities item 9).
    return res.json(await getAiUsage(orgId, { estimates: aiEstimateCosts() }));
  } catch (error) {
    // No active plan (a new workspace, past due, canceled): no allowance to meter.
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, '[billing] AI usage read failed');
    return res.status(500).json({ error: 'Failed to read AI usage' });
  }
});

router.get('/ai-usage/draft/:draftId', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  if (!draftId.success) return res.status(400).json({ error: 'Invalid request' });
  try {
    const orgId = await getOrgIdForUser(req.user.id);
    // As /ai-usage: without an org row there is no budget to share.
    if (!orgId) return res.json({ unlimited: true, percent: null });
    // The page's share is its brand's: read only by someone who reaches it.
    const { data: draft, error: draftError } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id')
      .eq('id', draftId.data)
      .maybeSingle();
    if (draftError) throw new Error(draftError.message);
    if (draft) await assertBrandAccess(draft.brand_id, req.user.id);
    return res.json(await getDraftAiUsage(orgId, draftId.data));
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, '[billing] page AI usage read failed');
    return res.status(500).json({ error: 'Failed to read AI usage' });
  }
});

router.post('/cancel-feedback', async (req, res) => {
  try {
    const parsed = cancelFeedbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const feedback = parsed.data;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, role, full_name')
      .eq('id', req.user.id)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) return res.status(403).json({ error: 'No organization' });
    // Cancelling is the admins', as the web's DELETE is: no one else can
    // tell the team the plan was cancelled, or ask for three days.
    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can cancel the plan', code: 'admin_only' });
    }

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, plan, subscription_status, subscription_ends_at, stripe_subscription_id')
      .eq('id', orgId)
      .single();
    // The browser's checks, again here: a direct request can't report a
    // plan that isn't there, or promise an answer after it renews.
    if (!org?.stripe_subscription_id || !SUBSCRIBED_STATUSES.includes(org.subscription_status)) {
      return res.status(400).json({ error: 'No subscription to cancel', code: 'no_subscription' });
    }
    // Only a period end the DB knows, still ahead and too close, refuses
    // waiting. A missing or past one means the DB is behind Stripe (only a
    // subscription update writes it), and the dialog checked Stripe's date.
    const endsAt = org.subscription_ends_at ? new Date(org.subscription_ends_at) : null;
    if (feedback.choice === 'wait' && endsAt && endsAt > new Date() && !canWait(endsAt)) {
      return res
        .status(400)
        .json({ error: 'The plan renews before we could answer', code: 'too_late' });
    }

    const { count } = await supabaseAdmin
      .from('cancellation_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) {
      return res
        .status(429)
        .json({ error: 'Too many messages today. Please write to support.', code: 'too_many' });
    }

    // Kept before the e-mail goes, so a failed send loses nothing.
    const { data: row, error } = await supabaseAdmin
      .from('cancellation_feedback')
      .insert({
        organization_id: orgId,
        created_by: req.user.id,
        reasons: feedback.reasons,
        message: feedback.message,
        choice: feedback.choice,
        plan: org?.plan ?? null,
        subscription_status: org?.subscription_status ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user: { name: profile.full_name, email: req.user.email, role: profile.role },
      feedback,
    });
    const emailStatus = await deliverEmail({
      to: feedbackRecipients(),
      subject,
      html,
      replyTo: req.user.email || undefined,
    });
    if (emailStatus !== 'sent') {
      req.log.warn({ emailStatus, feedbackId: row.id }, '[billing] cancel feedback not e-mailed');
    }
    await supabaseAdmin
      .from('cancellation_feedback')
      .update({ email_status: emailStatus })
      .eq('id', row.id);
    // A wait is a promise to answer: when the team surely wasn't told, say so
    // rather than "we're on it". A cancel is done anyway; 'unknown' may have
    // gone out.
    if (feedback.choice === 'wait' && (emailStatus === 'skipped' || emailStatus === 'refused')) {
      return res
        .status(503)
        .json({ error: "Your message didn't reach the team", code: 'not_sent' });
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, '[billing] cancel feedback failed');
    return res.status(500).json({ error: 'Could not send your message' });
  }
});

export default router;
