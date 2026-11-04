import type { ActionDetail, ActionItem } from '@/lib/actions/actionCenter';
import { removedTargets } from '@/lib/action-center/entityCounts';
import type { ContentOpportunity, OpportunityBasket } from '@/types';
import {
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  taskText,
} from '@/lib/action-center/display';
import {
  buildActionExport,
  type ActionExport,
  type ExportAffected,
  type ExportFact,
} from '@/lib/action-center/export';
import { leaderText, type Affected } from '@/lib/action-center/affected';
import type { ActionStory } from '@/lib/action-center/story';
import { priorityReasonText } from '@/lib/action-center/priority';
import { opportunityLists } from '@/lib/content/opportunityLists';
import { isKpiKey } from '@/lib/kpis/registry';
import { isSuperseded, signalAffected, signalTexts, signalTypeLabel } from '@/lib/signals/display';
import { platformName } from '@/lib/signals/names';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { formatEstimateRange, type VolumeEstimate } from '@/lib/volumeEstimate';

/**
 * An action's export, labelled (AC-005): what the drawer's Copy Data, Export
 * CSV and Export Excel show, and what the API and MCP return as Markdown or
 * CSV. Both read the same labels from en.json, so the two always say the same
 * thing; only where the data comes from differs.
 */

type Translator = ((key: string, values?: Record<string, string | number>) => string) & {
  has?: (key: string) => boolean;
};

/** The en.json namespaces the export's labels come from. */
export const EXPORT_NAMESPACES = {
  page: 'actionCenter.actionsPage',
  export: 'actionCenter.actionsPage.export',
  improve: 'actionCenter.actionsPage.drawer.improve',
  opportunity: 'actionCenter.actionsPage.drawer.opportunity',
  content: 'content',
  texts: 'actionCenter.actionTexts',
  categories: 'actionCenter.actionCategories',
  registry: 'actionCenter.registry',
  tasks: 'actionCenter.actionTasks',
  taskStatus: 'actionCenter.taskStatus',
  taskTypes: 'actionCenter.taskTypes',
  taskChecks: 'actionCenter.taskChecks',
  taskDoneWhen: 'actionCenter.taskDoneWhen',
  signals: 'actionCenter.signalsPage',
  signalTexts: 'actionCenter.signalTexts',
  signalCategories: 'actionCenter.signalCategories',
  priority: 'actionCenter.actionsPage.priority',
  affected: 'actionCenter.actionsPage.drawer.affected',
  estimate: 'volumeEstimate',
} as const;

export type ExportTranslators = Record<keyof typeof EXPORT_NAMESPACES, Translator>;

/** A Content action's opportunity and its basket, or that they couldn't be read. */
export type SentFromOpportunity =
  | {
      opportunity: Pick<ContentOpportunity, 'id' | 'title' | 'decision' | 'brief' | 'sourceData'>;
      basket: OpportunityBasket;
    }
  | 'unavailable';

const IMPROVE_STATES = ['not_mentioned', 'mentioned_late', 'not_cited', 'doing_well', 'no_runs'];

/** The opportunity a Content action was sent from, when it carries one. */
export function sentFromOpportunityId(action: Pick<ActionItem, 'kind' | 'payload'>): string | null {
  const id = action.payload?.opportunityId;
  return action.kind === 'content_opportunity' && typeof id === 'string' ? id : null;
}

/**
 * What the Overview tab shows of where a person sent the action from: the
 * Improve tab's prompt and platforms, or a content opportunity's pages, brief
 * and prompts.
 */
export function sentFromFacts(
  action: ActionItem,
  sent: SentFromOpportunity | null,
  origin: string,
  t: ExportTranslators,
): ExportFact[] {
  const p = action.payload ?? {};
  if (action.kind === 'prompt_improve') {
    const platforms = Array.isArray(p.platforms)
      ? (p.platforms as { label?: unknown; state?: unknown }[]).filter(
          (x): x is { label: string; state: string } =>
            typeof x.label === 'string' &&
            typeof x.state === 'string' &&
            IMPROVE_STATES.includes(x.state),
        )
      : [];
    const facts: ExportFact[] = [{ label: t.improve('source'), value: t.improve('sourceValue') }];
    if (typeof p.promptText === 'string') {
      facts.push({ label: t.improve('prompt'), value: p.promptText });
    }
    if (platforms.length) {
      facts.push({
        label: t.improve('platforms'),
        value: platforms.map((x) => `${x.label} · ${t.improve(`states.${x.state}`)}`),
      });
    }
    if (typeof p.panelLink === 'string') {
      facts.push({ label: t.improve('openPanel'), value: `${origin}${p.panelLink}` });
    }
    return facts;
  }
  if (!sentFromOpportunityId(action) || !sent) return [];
  if (sent === 'unavailable') {
    return [{ label: t.opportunity('title'), value: t.opportunity('unavailable') }];
  }

  const { opportunity, basket } = sent;
  const pageUrls = Array.isArray(p.pages)
    ? (p.pages as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  const { pages, prompts, queries } = opportunityLists(
    opportunity,
    basket,
    p.assetKey ? pageUrls : undefined,
  );
  const brief = opportunity.brief;
  const facts: ExportFact[] = [
    { label: t.opportunity('title'), value: opportunity.title },
    { label: t.opportunity('open'), value: `${origin}/dashboard/content/${opportunity.id}` },
  ];
  if (opportunity.decision) {
    facts.push({
      label: t.export('decision'),
      value: t.content(`decision.${opportunity.decision}`),
    });
  }
  if (pages.length) {
    facts.push({ label: t.export('pages'), value: pages.map((page) => page.url) });
  }
  if (brief) {
    facts.push({
      label: t.opportunity('brief'),
      value: [
        `${brief.suggestedTitle} · ${brief.contentType.replace(/-/g, ' ')} · ${t.opportunity('words', { count: brief.targetWordCount })}`,
        ...brief.outline.map(
          (section, i) =>
            `${i + 1}. ${section.heading}${section.keyPoints.length ? `: ${section.keyPoints.join('; ')}` : ''}`,
        ),
      ],
    });
  }
  if (prompts.length) {
    facts.push({
      label: t.opportunity('prompts', { count: prompts.length }),
      value: prompts.map((prompt) => prompt.text),
    });
  }
  if (queries.length) {
    facts.push({
      label: t.opportunity('queries', { count: queries.length }),
      value: queries.map((query) => query.query),
    });
  }
  return facts;
}

/** The Affected tab's rows, labelled for the exports (AC-003). */
export function exportAffectedRows(
  affected: Affected | null,
  volumes: Map<string, VolumeEstimate> | null,
  origin: string,
  t: ExportTranslators,
): ExportAffected[] {
  if (!affected) return [];
  const row = (over: Partial<ExportAffected>): ExportAffected => ({
    entity: '',
    label: '',
    volume: '',
    volumeType: '',
    volumeConfidence: '',
    volumeConfidenceLabel: '',
    platforms: [],
    lostPages: [],
    citedInstead: [],
    details: '',
    link: '',
    ...over,
  });
  const leadersShown = affected.prompts.some((p) => p.leaders.length > 0);
  return [
    ...affected.prompts.map((prompt) => {
      const volume = prompt.id ? volumes?.get(prompt.id) : undefined;
      return row({
        entity: t.export('affectedPrompt'),
        label: prompt.text,
        // An estimate (PROMPT-013): its range, marked as such.
        volume: volume ? formatEstimateRange(volume) : '',
        volumeType: volume ? 'estimate' : '',
        volumeConfidence: volume?.confidence ?? '',
        volumeConfidenceLabel: volume ? t.estimate(`level.${volume.confidence}`) : '',
        platforms: prompt.platforms.map(platformName),
        lostPages: prompt.lostPages,
        citedInstead: prompt.citedInstead,
        details: prompt.leaders.map((leader) => leaderText(leader, t.affected)).join('; '),
        link: prompt.id ? `${origin}/dashboard/prompts/${prompt.id}` : '',
      });
    }),
    ...affected.pages.map((page) =>
      row({
        entity: t.export('affectedPage'),
        label: page.url,
        platforms: page.platforms.map(getPlatformName),
        details: [
          page.sessions !== null && page.before !== null
            ? `${t.affected('visits')}: ${t.affected('visitsValue', { before: page.before, now: page.sessions })}`
            : '',
          page.issues.join(', '),
        ]
          .filter(Boolean)
          .join('; '),
        link: /^https?:\/\//.test(page.url) ? page.url : '',
      }),
    ),
    ...(leadersShown
      ? []
      : affected.competitors.map((name) =>
          row({ entity: t.export('affectedCompetitor'), label: name }),
        )),
    ...affected.topics.map((name) => row({ entity: t.export('affectedTopic'), label: name })),
  ];
}

export interface ActionExportInput {
  action: ActionItem;
  detail: ActionDetail;
  /** The Affected tab's list and its prompts' demand (AC-003). */
  affected: Affected | null;
  volumes: Map<string, VolumeEstimate> | null;
  /** Why and Goal in the action's own terms (AC-003); null for an action a person sent. */
  story: ActionStory | null;
  /** A Content action's opportunity, read by the caller. */
  sentFrom: SentFromOpportunity | null;
  /** Where links point: the app's origin. */
  origin: string;
  /** The reader's time zone, for the dates. */
  timeZone: string;
}

/** The whole action, every tab, labelled as the drawer shows it. */
export function labelActionExport(input: ActionExportInput, t: ExportTranslators): ActionExport {
  const { action, detail, origin } = input;
  const texts = actionTexts(action, t.texts);
  const related: string[] = action.kpiKeys.filter(isKpiKey);
  return buildActionExport(
    action,
    detail,
    {
      title: texts.title,
      // A scored action always has a level: one read from its score if need be.
      priority:
        action.priorityScore !== null && action.priorityLevel !== null
          ? {
              label: t.page('export.priorityValue', {
                score: action.priorityScore,
                level: t.priority(`levels.${action.priorityLevel}`),
              }),
              why: action.priorityReason
                ? priorityReasonText(action.priorityReason, t.priority)
                : '',
            }
          : null,
      why: input.story?.why ?? texts.description,
      goal: input.story?.goal ?? actionGoal(action.kind, t.texts, action.payload),
      category: t.categories(action.category),
      status: t.page(`status.${action.status}`),
      // With what was removed since (AC-009), as the page says it.
      tags: [...actionContextTags(action, t.page), ...removedTag(action.payload ?? {}, t.page)],
      kpis: detail.kpis
        .filter((kpi) => related.includes(kpi.kpiKey) && isKpiKey(kpi.kpiKey))
        .map(
          (kpi) =>
            `${t.registry(`${kpi.kpiKey}.name`)} (${t.page('drawer.kpiTarget', { target: kpi.target })})`,
        ),
      context: sentFromFacts(action, input.sentFrom, origin, t),
      affected: exportAffectedRows(input.affected, input.volumes, origin, t),
      taskTitle: (task) => taskText(task, t.tasks),
      taskStatus: (status) => t.taskStatus(status),
      signal: (signal) => {
        const affected = signalAffected(signal, t.signals);
        return {
          ...signalTexts(signal, t.signalTexts),
          type: signalTypeLabel(signal, t.signalCategories, t.signals),
          entity: affected.detail ?? affected.label,
          category: t.signalCategories(signal.category),
          status: isSuperseded(signal)
            ? t.signals('superseded')
            : t.signals(`status.${signal.status}`),
          impact: t.signals(`impact.${signal.impact}`),
        };
      },
      event: (event) => actionEventText(event, t.page, t.tasks),
      skipped: (reason) => t.export('skipped', { reason }),
      taskType: (type) => t.taskTypes(type),
      taskCheck: (check) => t.taskChecks(check),
      templateDoneWhen: (taskKey) => (t.taskDoneWhen.has?.(taskKey) ? t.taskDoneWhen(taskKey) : ''),
      taskChange: ({ before, after }) =>
        before
          ? t.export('taskChangeLine', { before, after })
          : t.export('taskChangeAdd', { after }),
      taskSent: (to) => t.export(to === 'content' ? 'sentToContent' : 'sentToWebhook'),
      answerSource: t.export('answerSource'),
    },
    { origin, timeZone: input.timeZone },
  );
}

/** "(1 prompt removed since this action was created)", as a tag; none when nothing was. */
function removedTag(payload: Record<string, unknown>, t: ExportTranslators['page']): string[] {
  const removed = removedTargets(payload);
  if (!removed) return [];
  const entity = typeof payload.targetEntity === 'string' ? payload.targetEntity : null;
  return [
    t('removed.note', {
      items: entity ? t(`tags.${entity}`, { count: removed.count }) : String(removed.count),
    }),
  ];
}
