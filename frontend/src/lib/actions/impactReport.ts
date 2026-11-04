'use server';

import { z } from 'zod';
import { readAssignees } from '@/lib/action-center/assignees';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  impactRow,
  impactSummary,
  pageKey,
  type ChangedPagesTraffic,
  type ImpactRow,
  type ImpactSummary,
} from '@/lib/impact/report';
import { createClient } from '@/lib/supabase/server';

/**
 * Reports › "What GetCito did for you" (CHAT-22 feature 2 item 5), behind
 * CHAT_AGENTIC: a brand's changes shipped in a month and what each did,
 * read through the person's session from the ledger W2-20's job writes
 * (ship_events, impact_measurements, 00421; brand access 00424, so an
 * Agency partner reads their shared brands only). The same record Action
 * Center › History reads: nothing is measured or judged here. AI traffic to
 * the changed pages comes from Google Analytics (ga_ai_traffic_stats), when
 * it is connected. Answers as a value, never thrown (#1777).
 */

export interface ImpactReport {
  rows: ImpactRow[];
  /** More changes shipped in the month than a read lists: the rows, and the counts, are its first ones. */
  capped: boolean;
  summary: ImpactSummary;
  /** Null without Google Analytics data for the brand. */
  traffic: ChangedPagesTraffic | null;
  generatedAt: string;
  /** The newest measurement among the month's rows; null before any. */
  dataAsOf: string | null;
}

export type ImpactReportResult =
  | { ok: true; report: ImpactReport }
  | { ok: false; failure: 'chat_off' | 'invalid' | 'failed' };

/**
 * Most changes a month lists: far past what a brand ships, and a bound on a
 * runaway read. A month with more says so on the page (capped).
 */
const MONTH_MAX = 500;
/** Most Google Analytics rows read for the changed pages, over two months. */
const TRAFFIC_MAX = 5000;

// guid, not uuid: the demo brand's id is made by hand.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const input = z.object({
  brandId: z.guid(),
  /** The month's start and end, and the month before's start, as instants (the browser's month). */
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  previousFrom: z.iso.datetime({ offset: true }),
  /** The same three as calendar days, YYYY-MM-DD: how Google Analytics dates its rows. */
  days: z.object({ from: day, to: day, previousFrom: day }),
});

/** The month a read covers: its instants and its calendar days (the browser's). */
export interface ImpactRange {
  from: string;
  to: string;
  previousFrom: string;
  days: { from: string; to: string; previousFrom: string };
}

interface ShipRow {
  id: string;
  title: string;
  kind: string;
  source: string;
  shipped_at: string;
  shipped_by: string | null;
  execution_mode: string;
  url: string | null;
  actions: { action_no: number | null } | null;
  impact_measurements: Record<string, unknown> | Record<string, unknown>[] | null;
}

function logFailure(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  console.error(`[impact-report] could not ${what}:`, message ?? error);
}

export async function readImpactReport(
  brandId: string,
  range: ImpactRange,
): Promise<ImpactReportResult> {
  try {
    const parsed = input.safeParse({ brandId, ...range });
    if (!parsed.success) return { ok: false, failure: 'invalid' };
    const { from, to, previousFrom, days } = parsed.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, failure: 'chat_off' };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!chatAgenticEnabled(profile?.organization_id ?? null)) {
      return { ok: false, failure: 'chat_off' };
    }

    const [ships, previous] = await Promise.all([
      supabase
        .from('ship_events')
        .select(
          'id, title, kind, source, shipped_at, shipped_by, execution_mode, url, actions!ship_events_action_id_fkey(action_no), impact_measurements!impact_measurements_ship_event_id_fkey(targets, window_json, metrics, outcome, confidence, checkpoint, checkpoints_json, not_measurable_reason, concurrent_changes, next_check_at, measured_at)',
        )
        .eq('brand_id', parsed.data.brandId)
        .gte('shipped_at', from)
        .lt('shipped_at', to)
        .order('shipped_at', { ascending: true })
        // One more than it lists, to tell a month that has more.
        .limit(MONTH_MAX + 1),
      supabase
        .from('ship_events')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', parsed.data.brandId)
        .gte('shipped_at', previousFrom)
        .lt('shipped_at', from),
    ]);
    if (ships.error) {
      logFailure('read the shipped changes', ships.error);
      return { ok: false, failure: 'failed' };
    }
    const read = (ships.data ?? []) as unknown as ShipRow[];
    const shipRows = read.slice(0, MONTH_MAX);
    const teammates = [
      ...new Set(
        shipRows.map((row) => row.shipped_by).filter((id): id is string => !!id && id !== user.id),
      ),
    ];
    const assignees = await readAssignees(supabase, parsed.data.brandId, teammates).catch(
      (error: unknown) => {
        // Unnamed, a teammate reads as "a teammate": the page still opens.
        logFailure('name who shipped', error);
        return new Map();
      },
    );
    const names = new Map(
      teammates.map((id) => [id, assignees.get(id)?.fullName ?? assignees.get(id)?.email ?? null]),
    );
    const rows = shipRows.map((row, i) =>
      impactRow(
        {
          key: `r${i + 1}`,
          title: row.title,
          kind: row.kind,
          source: row.source,
          shipped_at: row.shipped_at,
          shipped_by: row.shipped_by,
          execution_mode: row.execution_mode,
          url: row.url,
          actionNo: row.actions?.action_no ?? null,
          measurement: Array.isArray(row.impact_measurements)
            ? (row.impact_measurements[0] ?? null)
            : row.impact_measurements,
        },
        user.id,
        names,
      ),
    );
    const measured = shipRows
      .map((row) => {
        const m = Array.isArray(row.impact_measurements)
          ? row.impact_measurements[0]
          : row.impact_measurements;
        return typeof m?.measured_at === 'string' ? m.measured_at : null;
      })
      .filter((at): at is string => !!at)
      .sort();
    if (previous.error) logFailure('count the month before', previous.error);
    return {
      ok: true,
      report: {
        rows,
        capped: read.length > MONTH_MAX,
        summary: impactSummary(rows, previous.error ? null : (previous.count ?? 0)),
        traffic: await changedPagesTraffic(supabase, parsed.data.brandId, rows, days),
        generatedAt: new Date().toISOString(),
        dataAsOf: measured.at(-1) ?? null,
      },
    };
  } catch (error) {
    logFailure('read the report', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * AI traffic to the month's changed pages (item 5: Google Analytics only,
 * not adjusted for other changes): the AI sessions their landing pages had
 * this month and the month before. Null without any Google Analytics data
 * for the brand, or when it can't be read: the card asks to connect it.
 */
async function changedPagesTraffic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  rows: readonly ImpactRow[],
  days: ImpactRange['days'],
): Promise<ChangedPagesTraffic | null> {
  const { data: seen, error: seenError } = await supabase
    .from('ga_ai_traffic_stats')
    .select('id')
    .eq('brand_id', brandId)
    .limit(1);
  if (seenError) {
    logFailure('read Google Analytics', seenError);
    return null;
  }
  if (!seen?.length) return null;
  const keys = new Set(
    rows.flatMap((row) => row.pages.map(pageKey)).filter((key): key is string => !!key),
  );
  if (keys.size === 0) return { current: 0, previous: 0, pages: 0 };
  // Each path as Analytics may keep it: with and without its trailing slash.
  const variants = [...keys].flatMap((key) => (key === '/' ? ['/', ''] : [key, `${key}/`]));
  const { data, error } = await supabase
    .from('ga_ai_traffic_stats')
    .select('date, landing_page, sessions')
    .eq('brand_id', brandId)
    .gte('date', days.previousFrom)
    .lt('date', days.to)
    .in('landing_page', variants)
    .limit(TRAFFIC_MAX);
  if (error) {
    logFailure('read AI traffic to the changed pages', error);
    return null;
  }
  let current = 0;
  let previous = 0;
  for (const row of (data ?? []) as { date: string; landing_page: string; sessions: number }[]) {
    if (!keys.has(pageKey(row.landing_page || '/') ?? '')) continue;
    if (row.date >= days.from) current += row.sessions ?? 0;
    else previous += row.sessions ?? 0;
  }
  return { current, previous, pages: keys.size };
}
