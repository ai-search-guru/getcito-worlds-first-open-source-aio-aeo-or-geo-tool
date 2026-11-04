import type { ActionEvent, ActionItem } from '@/lib/actions/actionCenter';
import { isActionKind } from '@/lib/action-center/registry';
import { pagePath } from '@/lib/content/overlap';
import { formatEstimateRange, guessedVolumeEstimate } from '@/lib/volumeEstimate';
import { refreshYears } from '@/lib/content/currentYear';

/**
 * Composes what an action row shows from `kind` + `payload`, mirroring the
 * signals display helper: templates live in i18n
 * (actionCenter.actionTexts.<kind>), this module prepares the values and
 * picks the right variant when a payload part is optional.
 *
 * The server can raise a kind this build has never heard of — that is the
 * point of the definition registry, which grows on its own release cycle.
 * Such an action is presented generically rather than hidden: the work is
 * real, and a row nobody can read is still better than a row nobody sees.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function num(payload: Record<string, unknown>, key: string): number {
  return Number(payload[key] ?? 0);
}

/**
 * `expand_platform_visibility` → "Expand platform visibility".
 *
 * Definition ids are written to be read — they are verb phrases naming the
 * work — so the id itself is a better title than any generic string.
 */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A kind's name, as a group of actions (the History scorecard, learning
 * B3): its title without targets, else its id read as words.
 */
export function actionKindName(kind: string, t: Translator): string {
  return isActionKind(kind) ? t(`${kind}.titleGeneric`) : humanizeKind(kind);
}

/**
 * "11 prompts", "6 sources" — how many of what an action is about.
 *
 * Every payload carries `targetEntity` and `targetCount` (server
 * definitions/_helpers.js). An action raised before the library existed has
 * neither, and gets its title without a count rather than "0 prompts".
 */
export function targetLabel(payload: Record<string, unknown>, t: Translator): string {
  const count = num(payload, 'targetCount');
  const entity = str(payload, 'targetEntity');
  return count > 0 && entity ? t(`targets.${entity}`, { count }) : '';
}

/**
 * An action's title and description.
 *
 * One path for all sixty-two definitions: the specification asks for titles
 * that name their targets — "Recover 7 lost citations", never "Recover
 * citations" — and every definition's payload now says what its targets are.
 * A kind this build has no copy for is still shown, from its id: the server's
 * registry grows on its own release cycle, and a row nobody can read beats a
 * row nobody sees.
 */
export function actionTexts(
  action: Pick<ActionItem, 'kind' | 'payload'>,
  t: Translator,
): { title: string; description: string } {
  const p = action.payload ?? {};
  if (!isActionKind(action.kind)) {
    return { title: humanizeKind(action.kind), description: t('unknown.description') };
  }
  // An action sent from a content opportunity is named after the work itself.
  if (action.kind === 'content_opportunity' && typeof p.title === 'string' && p.title) {
    // The opportunity's title as Content shows it, a past year read as this one.
    return { title: refreshYears(p.title), description: t(`${action.kind}.description`) };
  }
  // A draft sent from the Content Editor (CE-015) is named after its page.
  if (action.kind === 'content_draft' && typeof p.title === 'string' && p.title) {
    return {
      title: t(
        p.method === 'optimize' ? 'content_draft.optimizeTitle' : 'content_draft.createTitle',
        {
          title: p.title,
        },
      ),
      description: t('content_draft.description'),
    };
  }
  // A product or category sent from Product Visibility (ECOM-013) is named after it.
  if (
    (action.kind === 'shopping_product' || action.kind === 'shopping_category') &&
    typeof p.title === 'string' &&
    p.title
  ) {
    return {
      title: t(`${action.kind}.namedTitle`, { name: p.title }),
      description: t(`${action.kind}.description`),
    };
  }
  // A live page linking products that no longer sell (shopping path, part 7)
  // is named after the page and how many.
  if (action.kind === 'shopping_links' && Array.isArray(p.products) && p.products.length) {
    const count = p.products.length;
    const page = str(p, 'title') || pagePath(str(p, 'pageUrl'));
    return {
      title: page
        ? t(p.soldOut === true ? 'shopping_links.soldOutTitle' : 'shopping_links.namedTitle', {
            page,
            count,
          })
        : t('shopping_links.titleGeneric'),
      description: t('shopping_links.description', { count }),
    };
  }
  // A finding sent from Chat (CHAT-09 §E) carries the title and the finding
  // the person approved.
  if (action.kind === 'chat_finding' && typeof p.title === 'string' && p.title) {
    return {
      title: p.title,
      description: typeof p.why === 'string' && p.why ? p.why : t(`${action.kind}.description`),
    };
  }
  // An Improve action carries its own title and "why", written from the
  // prompt's platform states when it was sent (PROMPT-004).
  if (action.kind === 'prompt_improve' && typeof p.title === 'string' && p.title) {
    return {
      title: p.title,
      description: typeof p.why === 'string' && p.why ? p.why : t(`${action.kind}.description`),
    };
  }
  // A topic gap sent from Insights (VIS-010) names the topic, the competitor
  // and the gap it was sent with.
  if (
    action.kind === 'topic_competitor_gap' &&
    typeof p.topicName === 'string' &&
    typeof p.competitorName === 'string' &&
    typeof p.gap === 'number'
  ) {
    return {
      title: t(`${action.kind}.title`, {
        gap: p.gap.toFixed(1),
        competitor: p.competitorName,
        topic: p.topicName,
      }),
      description: t(`${action.kind}.description`),
    };
  }
  // An Opportunities topic sent from Insights (VIS-011) names the topic and
  // the demand it was sent with.
  if (
    action.kind === 'topic_opportunity' &&
    typeof p.topicName === 'string' &&
    typeof p.demand === 'number'
  ) {
    return {
      title: t(`${action.kind}.title`, {
        // The suggestions' AI-guessed demand: a range, not a count (PROMPT-013).
        demand: formatEstimateRange(guessedVolumeEstimate(p.demand, null)),
        topic: p.topicName,
      }),
      description: t(`${action.kind}.description`),
    };
  }
  // Answers sent from Mentions (MS-08) name their prompt, or how many prompts.
  if (
    action.kind === 'mention_review' &&
    typeof p.mentionCount === 'number' &&
    typeof p.promptCount === 'number'
  ) {
    const negative = typeof p.negativeCount === 'number' ? p.negativeCount : 0;
    // promptText is the first prompt's: once it is removed (AC-009), the one
    // left is another, so the title counts instead of naming it.
    const firstRemoved =
      Array.isArray(p.promptIds) &&
      Array.isArray(p.removedKeys) &&
      p.removedKeys.includes(p.promptIds[0]);
    return {
      title:
        p.promptCount === 1 && typeof p.promptText === 'string' && p.promptText && !firstRemoved
          ? t(`${action.kind}.title`, { prompt: p.promptText })
          : p.promptCount > 0
            ? t(`${action.kind}.titleMany`, { count: p.promptCount })
            : // Every prompt removed since (AC-009): no "0 prompts".
              t(`${action.kind}.titleGeneric`),
      description:
        negative > 0
          ? t(`${action.kind}.descriptionNegative`, { count: p.mentionCount, negative })
          : t(`${action.kind}.descriptionCounts`, { count: p.mentionCount }),
    };
  }
  // Pages sent from AI Traffic (AT-006) name their list and the page, or how many.
  if (
    action.kind === 'traffic_pages' &&
    (p.reason === 'cited_not_clicked' || p.reason === 'no_ai_traffic') &&
    typeof p.pageCount === 'number' &&
    Array.isArray(p.targets)
  ) {
    const list = p.reason === 'cited_not_clicked' ? 'cited' : 'noAi';
    const first = (p.targets[0] as { label?: unknown } | undefined)?.label;
    return {
      title:
        p.pageCount === 1 && typeof first === 'string' && first
          ? t(`${action.kind}.${list}Title`, { page: first })
          : t(`${action.kind}.${list}TitleMany`, { count: p.pageCount }),
      description: t(`${action.kind}.${list}Description`, {
        count: p.pageCount,
        citations: typeof p.citations === 'number' ? p.citations : 0,
      }),
    };
  }
  // A page sent from a Site Audit report (learning D2) names the page and how many checks it fails.
  if (action.kind === 'audit_page' && Array.isArray(p.targets) && Array.isArray(p.checks)) {
    const page = (p.targets[0] as { label?: unknown } | undefined)?.label;
    return {
      title:
        typeof page === 'string' && page
          ? t(`${action.kind}.pageTitle`, { page })
          : t(`${action.kind}.titleGeneric`),
      description: t(`${action.kind}.checksDescription`, { count: p.checks.length }),
    };
  }
  const targets = targetLabel(p, t);
  return {
    title: targets ? t(`${action.kind}.title`, { targets }) : t(`${action.kind}.titleGeneric`),
    description: t(`${action.kind}.description`),
  };
}

/**
 * A task named inside an event message.
 *
 * Events carry the task's key, not its text, because an event is a record of
 * what happened and the text is a rendering choice that may change. Falls back
 * to a humanised key so an event about a task this build has no copy for still
 * reads as a sentence.
 */
export function eventTaskText(
  key: unknown,
  t: Translator & { has?: (key: string) => boolean },
): string {
  if (typeof key !== 'string' || key.length === 0) return '';
  if (t.has && !t.has(key)) return humanizeKind(key).toLowerCase();
  return t(key);
}

/** Chat's History events about one task (CHAT-09 §D), named as a checked task is. */
const CHAT_TASK_EVENTS = new Set([
  'file_attached',
  'file_detached',
  'task_ready_for_review',
  'task_review_withdrawn',
]);

/** A History entry as a sentence: what happened, to what, by which tool. */
export function actionEventText(
  event: ActionEvent,
  t: Translator,
  tTasks: Translator & { has?: (key: string) => boolean },
): string {
  const text = t(`drawer.events.${event.event}`, {
    to: String(event.data.to ?? ''),
    // A task added to the open opportunity on its question.
    merged: event.data.merged === true ? 'yes' : 'no',
    count: Number(event.data.count ?? 0),
    // Tasks the writer left for review (AC-010).
    reviews: Number(event.data.reviews ?? 0),
    // Work the product did itself names the task in the reader's language
    // and the tool as it is recorded — the tool id is the audit fact, so it
    // is not translated.
    // A checked task is named once (`{task}{title}`): by its own title when it
    // has one; lines written before the API sent only one carry both. So is a
    // task Chat attached a file to or set to Ready for review (CHAT-09 §D).
    task:
      (event.event === 'task_checked' || CHAT_TASK_EVENTS.has(event.event)) && event.data.title
        ? ''
        : eventTaskText(event.data.task, tTasks),
    // Where it came from: `chat` for what Chat did (CHAT-20 §10a).
    source: String(event.data.source ?? ''),
    // A finding Chat added, and a file it attached, in their own words.
    finding: String(event.data.finding ?? ''),
    file: String(event.data.file ?? ''),
    // Who undid a Chat action (CHAT-20 §10b): named when they were.
    by:
      typeof event.data.by === 'string' && event.data.by
        ? event.data.by
        : t('drawer.eventParts.someone'),
    tool: String(event.data.tool ?? ''),
    improved: Number(event.data.improved ?? 0),
    measurable: Number(event.data.measurable ?? 0),
    // A task someone added, renamed or sent is named in its own words, as it
    // was typed (AC-004).
    title: String(event.data.title ?? ''),
    // The validation sweep's verdict once the action closed: improved,
    // declined, and so on.
    outcome: String(event.data.outcome ?? ''),
    // Which reading it was, counted from the close, and whether the last
    // (learning B1); none for one measured once before.
    day: Number(event.data.day ?? 0),
    final: event.data.final === true ? 'yes' : 'no',
    // The Chat agent a run on the action was (CHAT-21 §F item 31), by its name
    // then, and why it stopped; a deleted agent's line ends without a name.
    agent: String(event.data.agent ?? ''),
    named: event.data.agent ? 'yes' : 'no',
    reason: String(event.data.stop_reason ?? ''),
  });
  if (event.event !== 'evidence_attached') return text;
  // A finding added from Chat says its note and where it was read, when it has them.
  const parts = [text];
  if (typeof event.data.note === 'string' && event.data.note.trim()) {
    parts.push(t('drawer.eventParts.note', { note: event.data.note.trim() }));
  }
  const sources = Array.isArray(event.data.sources)
    ? event.data.sources.filter((source): source is string => typeof source === 'string')
    : [];
  if (sources.length > 0) {
    parts.push(t('drawer.eventParts.sources', { sources: sources.join(', ') }));
  }
  return parts.join(' · ');
}

/**
 * What the drawer shows under "Goal".
 *
 * Its own helper rather than an inline `t(`${kind}.goal`)` in two components,
 * because an unknown kind has no goal key and next-intl would render the key
 * itself into the drawer.
 */
export function actionGoal(
  kind: string,
  t: Translator,
  payload?: Record<string, unknown> | null,
): string {
  // An Improve action names its own prompt and platforms (PROMPT-004); a
  // finding sent from Chat its own goal, when it gave one (CHAT-09 §E).
  if (
    (kind === 'prompt_improve' || kind === 'chat_finding') &&
    typeof payload?.goal === 'string' &&
    payload.goal
  ) {
    return payload.goal;
  }
  return isActionKind(kind) ? t(`${kind}.goal`) : t('unknown.goal');
}

/**
 * Kinds a person sends rather than a definition raises, and the catalog
 * check's (shopping_links): none rests on detection signals.
 */
const PERSON_SENT_KINDS: string[] = [
  'content_opportunity',
  'prompt_improve',
  'topic_competitor_gap',
  'topic_opportunity',
  'mention_review',
  'traffic_pages',
  'audit_page',
  'content_draft',
  'shopping_product',
  'shopping_category',
  'shopping_links',
  'chat_finding',
];

/** Compact evidence chips under the title: signal count plus the kind's own
 *  count (pages, prompts, competitors). */
export function actionContextTags(action: ActionItem, t: Translator): string[] {
  // Actions a person sent (a content opportunity, an Improve set, a topic
  // gap or opportunity) have no detection signals by design; "0 signals" would read as
  // missing evidence.
  const tags = PERSON_SENT_KINDS.includes(action.kind)
    ? []
    : [t('tags.signals', { count: action.signalCount })];
  const count = num(action.payload ?? {}, 'targetCount');
  const entity = str(action.payload ?? {}, 'targetEntity');
  if (count > 0 && entity) tags.push(t(`tags.${entity}`, { count }));
  return tags;
}

/**
 * How a team member is named in an assignee picker.
 *
 * `full_name` is optional on a profile and most of this organization's members
 * have never set one, so the previous fallback — the first eight characters of
 * the user's uuid — put strings like `1d3fb0a2` in the dropdown. Email is the
 * one identifier every member is guaranteed to have and to recognise, which is
 * what the team settings list has always shown.
 */
export function memberLabel(member: { fullName: string | null; email: string }): string {
  return member.fullName?.trim() || member.email;
}

/**
 * The assignee an action shows the moment one is picked, before the list is
 * read again: the member's name, avatar and e-mail, so a member without a
 * name is named by e-mail at once (assigneeLabel), not left blank.
 */
export function pickedAssignee(
  assigneeId: string | null,
  members: { userId: string; email: string; fullName: string | null; avatarUrl: string | null }[],
): ActionItem['assignee'] {
  if (!assigneeId) return null;
  const member = members.find((m) => m.userId === assigneeId);
  return {
    id: assigneeId,
    fullName: member?.fullName ?? null,
    avatarUrl: member?.avatarUrl ?? null,
    email: member?.email ?? null,
  };
}

/** An action's assignee named as the picker names them: null when nothing is known. */
export function assigneeLabel(assignee: {
  fullName: string | null;
  email?: string | null;
}): string | null {
  return assignee.fullName?.trim() || assignee.email || null;
}

/**
 * Up to two initials for an avatar: of a name's words, or of an e-mail's
 * name split at its dots, dashes and underscores ("ada.lovelace@…" → "AL").
 */
export function labelInitials(label: string): string {
  const name = label.includes('@') ? label.slice(0, label.indexOf('@')) : label;
  return name
    .split(/[\s._+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * A task's text: what the user wrote, or the template it was generated from.
 *
 * Generated tasks carry a `task_key` into actionCenter.actionTasks and no
 * title. Adding or renaming a task writes a title, which wins from then on —
 * the key stays behind so which template a task grew from is still answerable.
 */
export function taskText(
  task: {
    taskKey: string | null;
    title: string | null;
    titleParams?: Record<string, string | number>;
  },
  t: Translator,
): string {
  const title = task.title?.trim();
  if (title) return title;
  if (!task.taskKey) return '';

  // A planned task that knows what it acts on carries the values as
  // parameters and is rendered from the `_target` variant of its message:
  // "Analyze citations across 11 sources" rather than "Analyze citations".
  // Library tasks name a count and an entity, rendered here in the reader's
  // language; the original tasks name their own fields.
  const params = { ...(task.titleParams ?? {}) };
  if (params.count && params.entity) {
    params.targets = t(`targets.${params.entity}`, { count: Number(params.count) });
  }
  return Object.keys(params).length > 0 ? t(`${task.taskKey}_target`, params) : t(task.taskKey);
}
