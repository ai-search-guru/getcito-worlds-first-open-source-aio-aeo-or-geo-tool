import { createFormatter, createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { mayUseBrand } from '@/lib/mcp/data';
import type { ActionDetail } from '@/lib/actions/actionCenter';
import type { ContentOpportunity, OpportunityBasket } from '@/types';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/promptPlaces';
import { OPEN_SIGNAL_STATUSES, type SignalStatus } from '@/lib/signals/registry';
import { UNCOUNTED_TASK_STATUSES } from '@/lib/action-center/registry';
import { affectedOf, affectedSignals, demandPromptIds } from '@/lib/action-center/affected';
import {
  currentTaskParams,
  readEntityCounts,
  readKeptEntities,
  withEntityCounts,
} from '@/lib/action-center/entityCounts';
import { actionStory } from '@/lib/action-center/story';
import { readPromptDemand } from '@/lib/action-center/promptDemand';
import { actionCsv, actionExportFileName, actionMarkdown } from '@/lib/action-center/export';
import {
  EXPORT_NAMESPACES,
  labelActionExport,
  sentFromOpportunityId,
  type ExportTranslators,
  type SentFromOpportunity,
} from '@/lib/action-center/exportLabels';
import {
  ACTION_COLUMNS,
  EVENT_COLUMNS,
  TASK_COLUMNS,
  actionItemFromRow,
  eventFromRow,
  kpiFromRow,
  taskFromRow,
  type ActionRow,
} from '@/lib/action-center/rows';

/**
 * One action as Markdown or CSV for the API and MCP (AC-005): the drawer's
 * Copy Data and Export CSV, read through an API key. The same labelling as the
 * drawer, with the Affected list, its prompts' demand, the Why and Goal and a
 * Content action's opportunity read here instead of by the browser. Dates are
 * in UTC, labels in English.
 */

export type ActionExportFormat = 'markdown' | 'csv';

/** The app's address, for the links the export carries. */
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

type PlainTranslator = ExportTranslators[keyof ExportTranslators];

/** A namespace of en.json behind the plain (key, values) shape the export's helpers take. */
function translator(namespace: string): PlainTranslator {
  const t = createTranslator({ locale: 'en', messages, namespace: namespace as never });
  const plain = (key: string, values?: Record<string, string | number>) =>
    t(key as never, values as never);
  return Object.assign(plain, { has: (key: string) => t.has(key as never) });
}

let built: { labels: ExportTranslators; story: PlainTranslator } | null = null;

/** Every label the export reads, from en.json as the drawer reads them; built once. */
function translators() {
  built ??= {
    labels: Object.fromEntries(
      Object.entries(EXPORT_NAMESPACES).map(([key, namespace]) => [key, translator(namespace)]),
    ) as ExportTranslators,
    story: translator('actionCenter.actionsPage.drawer.story'),
  };
  return built;
}

/**
 * A Content action's opportunity and the prompts and queries it answers, as
 * the Content API returns them for the drawer. 'unavailable' when it is gone.
 */
async function sentFromOpportunity(
  brandId: string,
  opportunityId: string,
): Promise<SentFromOpportunity> {
  const { data: row, error } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, title, decision, brief, source_data, cluster_id, related_cluster_ids, prompt_id')
    .eq('id', opportunityId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error || !row) return 'unavailable';

  const opportunity: Pick<
    ContentOpportunity,
    'id' | 'title' | 'decision' | 'brief' | 'sourceData'
  > = {
    id: row.id as string,
    title: row.title as string,
    decision: (row.decision ?? null) as ContentOpportunity['decision'],
    brief: (row.brief ?? null) as ContentOpportunity['brief'],
    sourceData: (row.source_data ?? {}) as ContentOpportunity['sourceData'],
  };
  const clusterIds = [
    row.cluster_id,
    ...((row.related_cluster_ids as string[] | null) ?? []),
  ].filter((id): id is string => typeof id === 'string');

  // One from the per-prompt generator rests on its one prompt.
  if (clusterIds.length === 0) {
    if (!row.prompt_id) return { opportunity, basket: { clusters: [], queries: [] } };
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, text')
      .eq('id', row.prompt_id)
      .maybeSingle();
    const basket: OpportunityBasket = {
      clusters: prompt
        ? [
            {
              id: `prompt:${prompt.id}`,
              label: prompt.text as string,
              need: '',
              topicName: null,
              prompts: [{ id: prompt.id as string, text: prompt.text as string }],
            },
          ]
        : [],
      queries: [],
    };
    return { opportunity, basket };
  }

  const [membersRes, queriesRes] = await Promise.all([
    supabaseAdmin
      .from('prompt_cluster_members')
      .select('cluster_id, prompts(id, text)')
      .in('cluster_id', clusterIds),
    supabaseAdmin
      .from('prompt_cluster_queries')
      .select('query, times_searched, included, reason')
      .in('cluster_id', clusterIds),
  ]);
  if (membersRes.error || queriesRes.error) return 'unavailable';

  // A query searched for several of its clusters is listed once, kept if any keeps it.
  const queries = new Map<string, OpportunityBasket['queries'][number]>();
  for (const q of queriesRes.data ?? []) {
    const prior = queries.get(q.query as string);
    queries.set(q.query as string, {
      query: q.query as string,
      timesSearched: (prior?.timesSearched ?? 0) + Number(q.times_searched ?? 0),
      included: Boolean(prior?.included || q.included),
      reason: prior?.included ? prior.reason : ((q.reason as string | null) ?? ''),
    });
  }
  const promptOf = (m: { prompts: unknown }) =>
    (Array.isArray(m.prompts) ? m.prompts[0] : m.prompts) as { id: string; text: string } | null;
  const basket: OpportunityBasket = {
    clusters: clusterIds.map((id) => ({
      id,
      label: '',
      need: '',
      topicName: null,
      prompts: (membersRes.data ?? [])
        .filter((m) => m.cluster_id === id)
        .map(promptOf)
        .filter((p): p is { id: string; text: string } => p !== null),
    })),
    queries: [...queries.values()].sort((a, b) => b.timesSearched - a.timesSearched),
  };
  return { opportunity, basket };
}

/**
 * The action as the drawer's Copy Data (Markdown) or Export CSV writes it, or
 * null when it isn't the caller's organization's.
 */
export async function exportActionFor(
  auth: McpAuthContext,
  actionId: string,
  format: ActionExportFormat,
): Promise<{ body: string; fileName: string } | null> {
  if (!auth.organizationId) return null;

  const { data: row, error } = await supabaseAdmin
    .from('actions')
    .select(`${ACTION_COLUMNS}, brand_id, brands!inner(organization_id)`)
    .eq('id', actionId)
    .eq('brands.organization_id', auth.organizationId)
    // A deleted action (00168) has nothing left to export.
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || !(await mayUseBrand(auth, row.brand_id as string))) return null;
  const brandId = row.brand_id as string;
  const opportunityId = sentFromOpportunityId({
    kind: row.kind as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  });

  const [
    tasksRes,
    signalsRes,
    eventsRes,
    kpisRes,
    places,
    assigneeRes,
    openRes,
    sentFrom,
    entityCounts,
    kept,
  ] = await Promise.all([
    supabaseAdmin
      .from('action_tasks')
      .select(TASK_COLUMNS)
      .eq('action_id', actionId)
      .order('position'),
    // Every signal the action has taken as evidence (AC-007), as the drawer reads them.
    supabaseAdmin
      .from('signals')
      .select(`${SIGNAL_ROW_COLUMNS}, action_signals!inner(action_id)`)
      .eq('brand_id', brandId)
      .eq('action_signals.action_id', actionId)
      .order('detected_at', { ascending: false }),
    supabaseAdmin
      .from('action_events')
      .select(EVENT_COLUMNS)
      .eq('action_id', actionId)
      .order('created_at'),
    supabaseAdmin
      .from('kpi_definitions')
      .select('kpi_key, target, timeframe')
      .eq('brand_id', brandId)
      .eq('is_active', true),
    readPromptPlaces(supabaseAdmin, brandId),
    row.assignee_id
      ? supabaseAdmin
          .from('profiles')
          .select('id, full_name, avatar_url')
          .eq('id', row.assignee_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The signals that support it now, as the list counts them (AC-007): its "n signals" tag.
    supabaseAdmin
      .from('signals')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('action_id', actionId)
      .in('status', OPEN_SIGNAL_STATUSES as SignalStatus[]),
    opportunityId ? sentFromOpportunity(brandId, opportunityId) : Promise.resolve(null),
    // Its list (AC-009): the count it shows, as on the page, and its rows.
    readEntityCounts(supabaseAdmin, [actionId]),
    readKeptEntities(supabaseAdmin, actionId),
  ]);
  for (const res of [tasksRes, signalsRes, eventsRes, kpisRes, assigneeRes, openRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const profile = assigneeRes.data as {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  const counts = entityCounts.get(actionId);
  const current = withEntityCounts((row.payload ?? {}) as Record<string, unknown>, counts);
  const tasks = (tasksRes.data ?? []).map(taskFromRow).map((task) => ({
    ...task,
    titleParams: currentTaskParams(task.titleParams, current) ?? task.titleParams,
  }));
  // Skipped and failed tasks leave the count, as on the list.
  const counted = tasks.filter(
    (task) => !(UNCOUNTED_TASK_STATUSES as readonly string[]).includes(task.status),
  );
  const action = actionItemFromRow(row as unknown as ActionRow, {
    assignee: profile
      ? { id: profile.id, fullName: profile.full_name, avatarUrl: profile.avatar_url }
      : null,
    taskTotal: counted.length,
    taskCompleted: counted.filter((task) => task.status === 'completed').length,
    signalCount: openRes.count ?? 0,
    entityCounts: counts,
  });
  const detail: ActionDetail = {
    tasks,
    signals: mapSignalRows((signalsRes.data ?? []) as unknown as SignalRow[], places),
    entities: kept,
    events: (eventsRes.data ?? []).map(eventFromRow),
    kpis: (kpisRes.data ?? []).map(kpiFromRow),
    // Not part of the export.
    positionOutcome: null,
  };

  // What the drawer works out from them: the Affected list, its prompts'
  // demand, and the Why and Goal in the action's own terms (AC-003).
  const evidence = affectedSignals(detail.signals, action.id);
  const affected = affectedOf(evidence, action.payload ?? {}, kept);
  // The rows' prompts and those the Why names from the signals, as in the drawer.
  const promptIds = demandPromptIds(affected, evidence, action.payload ?? {});
  // Best effort, as in the drawer: without it the Volume column is left out.
  const volumes = promptIds.length
    ? await readPromptDemand(supabaseAdmin, brandId, promptIds).catch(() => null)
    : null;
  const t = translators();
  const format_ = createFormatter({ locale: 'en', timeZone: 'UTC' });
  const story = actionStory(
    {
      signals: evidence,
      volumes,
      createdAt: action.createdAt,
      dueDate: action.dueDate,
      payload: action.payload ?? {},
    },
    t.story,
    {
      day: (date) => format_.dateTime(date, { month: 'short', day: 'numeric' }),
      list: (items) => format_.list(items, { type: 'conjunction' }),
    },
  );

  const data = labelActionExport(
    {
      action,
      detail,
      affected,
      volumes,
      story,
      sentFrom,
      origin: appOrigin(),
      timeZone: 'UTC',
    },
    t.labels,
  );
  return format === 'markdown'
    ? { body: actionMarkdown(data, t.labels.export), fileName: actionExportFileName(data, 'md') }
    : { body: actionCsv(data), fileName: actionExportFileName(data, 'csv') };
}
