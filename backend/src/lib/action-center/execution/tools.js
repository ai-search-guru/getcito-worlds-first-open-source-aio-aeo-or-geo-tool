/**
 * The tool registry (#818, phase 7).
 *
 * A task that runs automatically does so through exactly one tool, and a tool
 * is the only way anything automated reaches data or a third-party system.
 * That is the point of having a registry rather than letting each task call
 * whatever it likes: what the engine can touch is enumerable, and what it can
 * touch *outside GetCito* is a property declared on the tool rather than a
 * fact discovered afterwards in a log.
 *
 * Each tool declares:
 *
 *  - `source` — the brand source it needs, the same vocabulary the definition
 *    registry and the planner already use. A brand without it never has the
 *    task planned, and the runner refuses anyway;
 *  - `writesExternally` — whether running it *changes* something outside
 *    GetCito. Reading a third-party system is not that: the brand
 *    authorised the analytics connection and we already read it nightly, and
 *    asking for approval before every read would teach people to approve
 *    without looking. What needs a person is a change they would have to
 *    undo. Neither tool here writes, so the flag is false on both — but the
 *    runner enforces it now, while there is nothing to gate, rather than
 *    leaving it to be written later under deadline;
 *  - `version` — bumped when what the tool does changes, recorded on every
 *    run so an old result stays readable against the rules it ran under.
 *
 * Arguments are built by the tool from the action's own payload. Nothing here
 * takes a query, a URL or a property id from anywhere a model could reach —
 * the same rule the GA sync already follows, and the reason this layer can be
 * audited at all.
 */

import supabaseAdmin from '../../../config/supabase.js';
import { brandConnection, composioTarget } from '../../brandIntegrations.js';
import { runGaReport } from '../../composio.js';
import { resolve } from '../../../config/actionEngine.js';
import { analyzeCompetitorPages } from '../competitorPages.js';
import { analyzeWinningPages } from '../winningPages.js';

const DAY_MS = 86_400_000;

const { validation } = resolve();

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

const tool = (id, spec) => Object.freeze({ id, version: 1, writesExternally: false, ...spec });

export const TOOLS = Object.freeze({
  /**
   * What the competitor pages AI answers cite for the action's prompts have
   * that the brand's page doesn't (learning C1): read free from the public
   * pages its own answers cited, through Site Audit's rule checks. Reading a
   * public page changes nothing, so no approval.
   */
  competitor_page_features: tool('competitor_page_features', {
    source: 'competitors',
    description:
      "What the competitor pages AI answers cite for the action's prompts have that the brand's page doesn't.",

    async run({ brandId, payload, now }) {
      return analyzeCompetitorPages({ brandId, payload, now });
    },
  }),

  /**
   * What the brand's winning pages have that its other pages don't (learning
   * C4): through Site Audit's rule checks, the other pages from their audits,
   * a winning page without one read free like a cited page. Reading changes
   * nothing, so no approval.
   */
  winning_page_features: tool('winning_page_features', {
    source: 'site_audits',
    description: "What the brand's winning pages have that its other audited pages don't.",

    async run({ brandId, payload, now }) {
      return analyzeWinningPages({ brandId, payload, now });
    },
  }),

  /**
   * The AI Visibility Score over the validation window and the one before it
   * — what `validate` asks for, read from the daily rollups rather than the
   * raw scan, for the reason #829 exists.
   */
  visibility_window: tool('visibility_window', {
    source: 'tracking',
    description: "The brand's AI Visibility over the last window and the one before it.",

    async run({ brandId, now }) {
      const length = validation.windowDays;
      const to = utcDay(now);
      const from = utcDay(new Date(now.getTime() - (length - 1) * DAY_MS));
      const previousTo = utcDay(new Date(Date.parse(from) - DAY_MS));
      const previousFrom = utcDay(new Date(Date.parse(from) - length * DAY_MS));

      const read = async (dayFrom, dayTo) => {
        const { data, error } = await supabaseAdmin.rpc('ai_visibility_aggregates_daily', {
          p_brand_id: brandId,
          p_day_from: dayFrom,
          p_day_to: dayTo,
        });
        if (error) throw new Error(error.message);
        return data ?? {};
      };

      const [current, previous] = await Promise.all([
        read(from, to),
        read(previousFrom, previousTo),
      ]);

      return {
        window: { from, to },
        previousWindow: { from: previousFrom, to: previousTo },
        answers: current.answers ?? 0,
        mentionAnswers: current.mention_answers ?? 0,
        citationAnswers: current.citation_answers ?? 0,
        previousAnswers: previous.answers ?? 0,
        previousMentionAnswers: previous.mention_answers ?? 0,
        previousCitationAnswers: previous.citation_answers ?? 0,
      };
    },
  }),

  /**
   * Sessions on the action's own pages, before and after, from the brand's
   * analytics property through the connection they authorised.
   *
   * Read live rather than from `ga_page_stats`: the sync stores the top pages
   * of each day and says so when it truncates, which is the right trade for a
   * dashboard and the wrong one for a measurement of *these* pages. A page
   * outside that day's ceiling is absent from the table but present in the
   * property, and reporting zero sessions for it would be a wrong answer
   * rather than a missing one.
   */
  ga_traffic_window: tool('ga_traffic_window', {
    source: 'analytics',
    description: "Sessions on the action's pages over the last window and the one before it.",

    async run({ brandId, payload, now }) {
      const { data: brand, error } = await supabaseAdmin
        .from('brands')
        .select('ga_property_id')
        .eq('id', brandId)
        .single();
      if (error) throw new Error(error.message);
      if (!brand?.ga_property_id) throw new Error('brand has no analytics property configured');
      // The Google sign-in the brand uses (00470).
      const connection = await brandConnection(brandId, 'google-analytics');
      if (!connection?.connected) throw new Error('brand has no analytics connection');

      const length = validation.windowDays;
      const startDate = utcDay(new Date(now.getTime() - (length - 1) * DAY_MS));
      const endDate = utcDay(now);
      const previousEnd = utcDay(new Date(Date.parse(startDate) - DAY_MS));
      const previousStart = utcDay(new Date(Date.parse(startDate) - length * DAY_MS));

      const report = await runGaReport(composioTarget(connection), brand.ga_property_id, {
        dateRanges: [
          { startDate, endDate, name: 'current' },
          { startDate: previousStart, endDate: previousEnd, name: 'previous' },
        ],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        limit: 200,
      });

      const sessions = { current: {}, previous: {} };
      for (const row of report?.rows ?? []) {
        const page = row.dimensionValues?.[0]?.value;
        const range = row.dimensionValues?.[1]?.value ?? 'current';
        const value = Number(row.metricValues?.[0]?.value ?? 0);
        if (page) sessions[range === 'previous' ? 'previous' : 'current'][page] = value;
      }

      // Only the pages this action is about. A page the action never named is
      // not evidence about it, however much traffic it has.
      const pages = Array.isArray(payload?.urls) ? payload.urls : [];
      const named = pages.length > 0 ? pages : Object.keys(sessions.current);
      const total = (bucket) => named.reduce((sum, page) => sum + (bucket[page] ?? 0), 0);

      return {
        window: { from: startDate, to: endDate },
        previousWindow: { from: previousStart, to: previousEnd },
        pages: named.length,
        sessions: total(sessions.current),
        previousSessions: total(sessions.previous),
      };
    },
  }),
});

export function getTool(id) {
  return TOOLS[id] ?? null;
}

export function listTools() {
  return Object.values(TOOLS);
}
