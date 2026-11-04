/**
 * Reports routes (Simple Reports MVP).
 *
 *   POST /api/reports/summary   { brandId, snapshot, dateFrom, dateTo, template?, model? }
 *                               → { success, summary }
 *
 * Generates the AI executive summary for a report from the metric snapshot the
 * web action assembled (insights KPIs, share of voice, competitor comparison,
 * citations overview). The snapshot itself is saved to the `reports` table by
 * the Server Action — this endpoint only turns numbers into prose, following
 * the content.js brief-generation pattern (resolveModel + one LLM round-trip,
 * no retry loop: generation is user-triggered and re-runnable).
 */

import { Router } from 'express';
import { generateText } from 'ai';
import { resolveModel } from '../lib/aiProvider.js';
import { assertBrandAccess } from '../lib/access.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

const SUMMARY_SYSTEM_PROMPT = `You are an AI search visibility analyst writing the executive summary of a brand's AI visibility report.

You will receive a JSON snapshot of the brand's metrics for the report period. Depending on the report's sections it may include: overall visibility KPIs (with deltas vs the previous period), a daily visibility trend, share of voice, a competitor comparison, per-topic performance, best/weakest prompts, observed query fan-outs, AI-referred traffic, shopping visibility, a site audit score, and a citations overview. Every delta in the snapshot compares against the previous period of equal length.

The headline metric is the AI Visibility Score, a 0-100 blend (60% how often answers mention the brand, 25% how often they cite its site, 15% how early it is named). Where a "score" field is present — visibilityRate.score, promptPerformance[].score, topicPerformance[].score — that is the number to quote, written WITHOUT a % sign, and topicPerformance.change is a point change in that score. On older snapshots without "score": visibilityRate is the percentage of runs the brand appeared in (quote with %), and avgVisibility is a 0-100 intensity score (never a %).

For insights KPIs, mentionsChange and citationsChange are percentage changes, never raw counts. A null change with prevMentions or prevCitations equal to 0 means there is no meaningful percentage base: describe the current total as new growth from zero (for example, "354 new mentions"), not as a percentage. A null previous count means comparison data is unavailable. visibilityChange and sentimentChange are percentage-point changes.

Write a 1-2 paragraph executive summary in English for a marketing executive. It must tell the CHANGE STORY of the period, not describe a static snapshot:
- Open with the headline movement as an arc — e.g. "Visibility climbed from 42 to 48" — using the trend's first/last points or the KPI deltas. When the snapshot includes visibilityRate.ratePct, that — not insights.avgVisibilityScore — is the headline visibility number: the report's KPI section leads with it, so the summary must agree with it. visibilityRate has no previous-period value in the snapshot, so state its ratePct as a plain current fact and never invent a change or percentage-point delta for it — do not subtract or compare it against insights.avgVisibilityScore or insights.visibilityChange, which describe a different metric's history. Draw the period's change story from metrics that do carry real deltas: mentions, citations, sentiment, share of voice, competitor movement.
- Name the DRIVER behind that movement when the data shows one: the platform, topic or prompt that moved most (share-of-voice shifts, best/weakest prompts, topic deltas).
- Name the biggest RISK when the data shows one: a competitor gaining ground, a topic or platform sliding, or citation share concentrating away from the brand.
- Close with the single most consequential implication or next focus, in one sentence.
- Be concrete: use the numbers from the snapshot. Never invent metrics that are not present.
- Cover only what the snapshot contains — reports include different sections, so skip anything absent. If no previous-period data exists, say the period sets the baseline instead of inventing a change.
- No headings, no bullet points, no markdown — plain prose only.`;

/**
 * Per-template flavor appended to the system prompt. The snapshot already
 * contains only that template's sections; this just steers the prose focus.
 */
const TEMPLATE_FLAVOR = {
  weekly_visibility:
    'This is a WEEKLY visibility summary: keep it to one tight paragraph focused on week-over-week movement in visibility, mentions and share of voice.',
  executive_summary: '',
  competitor_benchmark:
    'This is a COMPETITOR BENCHMARK report: lead with where the brand stands versus each competitor, who gained and who lost, and where the largest gaps are.',
  citation_sources:
    'This is a CITATION & SOURCES report: focus on citation reach, which domains and source types dominate, and notable concentration or gaps in the source mix.',
};

router.post('/summary', async (req, res) => {
  const userId = req.user?.id;
  const { brandId, snapshot, dateFrom, dateTo, template, model } = req.body || {};

  if (!brandId || !snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({ success: false, message: 'brandId and snapshot are required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: brandRow } = await supabaseAdmin
      .from('brands')
      .select('name')
      .eq('id', brandId)
      .single();
    const brandName = brandRow?.name || 'the brand';

    const userPrompt = `Brand: ${brandName}
Report period: ${dateFrom || 'unknown'} to ${dateTo || 'unknown'}

Metric snapshot (JSON):
${JSON.stringify(snapshot, null, 2)}

Write the executive summary.`;

    const flavor = TEMPLATE_FLAVOR[template] || '';
    const { text: summary } = await generateText({
      model: resolveModel(model),
      system: flavor ? `${SUMMARY_SYSTEM_PROMPT}\n\n${flavor}` : SUMMARY_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    return res.json({ success: true, summary: summary.trim() });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'report summary generation failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
