import type { Signal } from '@/lib/signals/map';
import { signalWhereValue, type CitedPage, type WhereValue } from '@/lib/signals/detail';
import { OPEN_SIGNAL_STATUSES } from '@/lib/signals/registry';
import { platformName } from '@/lib/signals/names';
import { getPlatformName } from '@/lib/trafficPlatforms';

/**
 * What an action is about, item by item (AC-003): the prompts, pages,
 * competitors and topics behind its counts, read from the signals it rests
 * on so the list matches them. A count with nothing to see behind it ("7
 * prompts") is what this replaces.
 *
 * Each signal says what it can: its prompt or prompts, the platforms it
 * happened on, the brand's pages that lost a citation and those cited
 * instead, the competitors ahead per prompt, AI-traffic pages and their
 * visits, a technical finding's checks. Signals about the same prompt or page
 * merge into one row.
 */

export interface AffectedPrompt {
  /** Null for a prompt named by text only. */
  id: string | null;
  text: string;
  /** Where it happened: the platforms it was lost, missed or mentioned uncited on. */
  platforms: string[];
  /** The brand's pages that stopped being cited for it. */
  lostPages: string[];
  /** Pages cited in their place. */
  citedInstead: string[];
  /** Competitors named ahead of the brand on it, per platform (1 = first). */
  leaders: { competitor: string; platform: string; them: number | null; you: number | null }[];
  /** Its topic: what tells copies of one prompt text apart. */
  topics: string[];
}

export interface AffectedPage {
  url: string;
  /** AI sessions now and in the window before; null when not recorded. */
  sessions: number | null;
  before: number | null;
  /** The platforms its AI visits came from. */
  platforms: string[];
  /** Failed checks, for a technical finding. */
  issues: string[];
}

export interface Affected {
  prompts: AffectedPrompt[];
  pages: AffectedPage[];
  /** How many in all: a grouped finding names its first 50 and counts the rest. */
  promptTotal: number;
  pageTotal: number;
  /** The AI engines involved (slugs), and the brand's pages that lost a citation, for the chips. */
  platforms: string[];
  lostPages: string[];
  competitors: string[];
  topics: string[];
}

/** A new, empty list: each call fills its own arrays. */
const empty = (): Affected => ({
  prompts: [],
  pages: [],
  promptTotal: 0,
  pageTotal: 0,
  platforms: [],
  lostPages: [],
  competitors: [],
  topics: [],
});

const add = (list: string[], ...items: string[]) => {
  for (const item of items) if (item && !list.includes(item)) list.push(item);
};

const urlsOf = (value: WhereValue | null): string[] =>
  value?.type === 'citations'
    ? value.items.map((page: CitedPage) => page.url)
    : value?.type === 'list'
      ? [...value.items]
      : [];

/** One of the things an action kept when it was created (action_entities, 00244). */
export interface KeptEntity {
  type: string;
  /** A prompt's id (or its text, for an action that kept texts), a page's address, a competitor's id… */
  key: string;
  label: string | null;
  /** Deleted or paused since: counted out, never listed. */
  removed: boolean;
}

/** A key that is a row's id: a prompt kept by its text has none. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (key: string) => (UUID_RE.test(key) ? key : null);

/**
 * The action's affected items, from the signals that support it. With none
 * (an action a person sent), from what it was sent about. Its prompts or
 * pages count as the action counts them (AC-009): the list it kept when it
 * was created, less what was removed since, not the signals the nightly
 * pass rewrites; the rows still show what the signals say about each.
 *
 * With `kept` (that list, read from action_entities), the rows are its
 * items still there: each with what the signals say of it, one the signals
 * no longer name as a plain row, and none the action never had (or had and
 * lost since). The heading and the rows then agree.
 */
export function affectedOf(
  signals: Signal[],
  payload: Record<string, unknown> = {},
  kept: KeptEntity[] | null = null,
): Affected {
  const out = signals.length === 0 ? affectedFromPayload(payload) : affectedOfSignals(signals);
  const entity = typeof payload.targetEntity === 'string' ? payload.targetEntity : null;
  const keptOnes = entity ? (kept ?? []).filter((e) => e.type === entity) : [];
  // Any kept of its kind, removed ones too: an action that lost all of them lists none.
  if (keptOnes.length > 0) {
    return keptRows(
      out,
      entity!,
      keptOnes.filter((e) => !e.removed),
      payload,
    );
  }
  // What was removed since (withEntityCounts) isn't listed: by its key (a
  // prompt's id, or its text where it has none), a competitor by its name.
  const strings = (value: unknown) =>
    new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const keys = strings(payload.removedKeys);
  const labels = strings(payload.removedLabels);
  const count = typeof payload.targetCount === 'number' ? payload.targetCount : 0;
  if (payload.targetEntity === 'prompts') {
    const listed = out.prompts.length;
    // A prompt listed by its text alone (a topic's, a mention review's: kept
    // by their ids, listed as texts) is matched by the text 00244 keeps as its
    // label. The RPC names only the first 20 removed, so past those such a
    // row can stay listed.
    const removed = (row: AffectedPrompt) =>
      keys.has(row.id ?? row.text) || (row.id === null && labels.has(row.text));
    if (keys.size > 0 || labels.size > 0) out.prompts = out.prompts.filter((row) => !removed(row));
    out.promptTotal = Math.max(0, out.promptTotal - (listed - out.prompts.length));
    // A count is never shown with nothing behind it.
    if (count > 0 && out.prompts.length > 0) out.promptTotal = count;
  }
  if (payload.targetEntity === 'pages') {
    const listed = out.pages.length;
    if (keys.size > 0) out.pages = out.pages.filter((row) => !keys.has(row.url));
    out.pageTotal = Math.max(0, out.pageTotal - (listed - out.pages.length));
    if (count > 0 && out.pages.length > 0) out.pageTotal = count;
  }
  if (payload.targetEntity === 'competitors') {
    const names = strings(payload.removedLabels);
    if (names.size > 0) out.competitors = out.competitors.filter((name) => !names.has(name));
  }
  return out;
}

/**
 * The prompts whose demand a drawer reads: its Affected rows' (the kept
 * list's), and those its signals name. The Why is told from the signals
 * (actionStory), and they can name prompts the action didn't keep: read for
 * the rows alone, its range would leave those out.
 */
export function demandPromptIds(
  affected: Affected,
  signals: Signal[],
  payload: Record<string, unknown> = {},
): string[] {
  const ids = [...affected.prompts, ...affectedOf(signals, payload).prompts].map((row) => row.id);
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** The rows as the action's kept list has them (affectedOf). */
function keptRows(
  out: Affected,
  entity: string,
  kept: KeptEntity[],
  payload: Record<string, unknown>,
): Affected {
  const count = typeof payload.targetCount === 'number' ? payload.targetCount : 0;
  if (entity === 'prompts') {
    const byKey = new Map(kept.map((e) => [e.key, e]));
    // A prompt listed by its text alone matches the label kept for it; one
    // with an id only its own (copies of a text live in other topics).
    const byLabel = new Map(kept.flatMap((e) => (e.label ? [[e.label, e] as const] : [])));
    const merged = new Map<string, AffectedPrompt>();
    const rows: AffectedPrompt[] = [];
    for (const row of out.prompts) {
      const match = row.id ? byKey.get(row.id) : (byKey.get(row.text) ?? byLabel.get(row.text));
      if (!match) continue;
      const first = merged.get(match.key);
      if (first) {
        // The same prompt by its id and by its text: one row, with all it says.
        add(first.platforms, ...row.platforms);
        add(first.lostPages, ...row.lostPages);
        add(first.citedInstead, ...row.citedInstead);
        add(first.topics, ...row.topics);
        first.leaders.push(...row.leaders);
        continue;
      }
      // A key is an id only when it is one: an action that kept texts has none.
      if (!row.id) row.id = idOf(match.key);
      merged.set(match.key, row);
      rows.push(row);
    }
    for (const e of kept) {
      if (merged.has(e.key)) continue;
      rows.push({
        id: idOf(e.key),
        text: e.label ?? e.key,
        platforms: [],
        lostPages: [],
        citedInstead: [],
        leaders: [],
        topics: [],
      });
    }
    out.prompts = rows;
    // An action made before 00244 kept its first 50: the count says the rest.
    out.promptTotal = Math.max(count, rows.length);
  } else if (entity === 'pages') {
    // An address as compared: its trailing slash aside.
    const pageKey = (url: string) => bareUrl(url).replace(/\/+$/, '');
    const keys = new Set(kept.map((e) => pageKey(e.key)));
    const listed = new Set<string>();
    const rows = out.pages.filter((row) => {
      const key = pageKey(row.url);
      if (!keys.has(key) || listed.has(key)) return false;
      listed.add(key);
      return true;
    });
    for (const e of kept) {
      if (listed.has(pageKey(e.key))) continue;
      rows.push({ url: e.key, sessions: null, before: null, platforms: [], issues: [] });
    }
    out.pages = rows;
    out.pageTotal = Math.max(count, rows.length);
  } else if (entity === 'competitors') {
    out.competitors = kept.map((e) => e.label ?? e.key);
  }
  return out;
}

function affectedOfSignals(signals: Signal[]): Affected {
  const prompts = new Map<string, AffectedPrompt>();
  const pages = new Map<string, AffectedPage>();
  const out: Affected = empty();
  let promptExtra = 0;
  let pageExtra = 0;

  const promptRow = (id: string | null, text: string): AffectedPrompt | null => {
    if (!text && !id) return null;
    const key = id ?? `text:${text}`;
    let row = prompts.get(key);
    if (!row) {
      row = { id, text, platforms: [], lostPages: [], citedInstead: [], leaders: [], topics: [] };
      prompts.set(key, row);
    } else if (!row.text && text) {
      row.text = text;
    }
    return row;
  };
  const pageRow = (url: string): AffectedPage | null => {
    if (!url) return null;
    let row = pages.get(url);
    if (!row) {
      row = { url, sessions: null, before: null, platforms: [], issues: [] };
      pages.set(url, row);
    }
    return row;
  };

  for (const signal of signals) {
    const value = (key: Parameters<typeof signalWhereValue>[1]) => signalWhereValue(signal, key);
    const mine: AffectedPrompt[] = [];

    const single = value('prompt');
    if (single?.type === 'prompt') {
      const row = promptRow(single.id, single.text);
      if (row) mine.push(row);
    }
    const many = value('prompts');
    if (many?.type === 'prompts') {
      for (const item of many.items) {
        const row = promptRow(item.id, item.text);
        if (row) mine.push(row);
      }
      // A list cut at its first 50 counts the rest. A bare count with no
      // names (a topic's prompts, ids only) is left to what lists them, so a
      // count is never shown with nothing behind it.
      if (many.items.length > 0) promptExtra += Math.max(0, many.total - many.items.length);
    }

    // Per prompt, where a competitor is ahead.
    const positions = value('competitorPositions');
    if (positions?.type === 'positions') {
      add(out.competitors, positions.competitor);
      for (const item of positions.items) {
        const row = promptRow(item.promptId, item.promptText);
        if (!row) continue;
        add(row.platforms, item.platform);
        row.leaders.push({
          competitor: positions.competitor,
          platform: item.platform,
          them: item.competitor.now,
          you: item.you.now,
        });
      }
    }
    // Per prompt, where the brand is named without a citation.
    const mentions = value('mentionDetails');
    if (mentions?.type === 'mentions') {
      for (const item of mentions.items) {
        const row = promptRow(item.promptId, item.promptText);
        if (row) add(row.platforms, ...item.platforms);
      }
    }

    // What the signal says about all its prompts at once.
    const platforms = value('platforms');
    const slugs = platforms?.type === 'platforms' ? [...platforms.slugs] : [];
    add(out.platforms, ...slugs);
    const lost = urlsOf(value('lostUrl'));
    const citedNow = urlsOf(value('citedNow'));
    add(out.lostPages, ...lost);
    for (const row of mine) {
      if (row.leaders.length === 0) add(row.platforms, ...slugs);
      add(row.lostPages, ...lost);
      add(row.citedInstead, ...citedNow);
    }
    // A signal about one prompt names its topic; one about many, theirs together.
    if (mine.length === 1) add(mine[0].topics, ...signal.where.topics);

    // Pages: AI-traffic pages with their visits, others by URL.
    const mineP: AffectedPage[] = [];
    const pageValue = value('pages');
    if (pageValue?.type === 'trafficPages') {
      for (const item of pageValue.items) {
        const row = pageRow(item.page);
        if (!row) continue;
        // Another signal may have recorded them where this one didn't.
        if (item.sessions !== null) row.sessions = item.sessions;
        if (item.before !== null) row.before = item.before;
        mineP.push(row);
      }
      pageExtra += Math.max(0, pageValue.total - pageValue.items.length);
    } else if (pageValue?.type === 'list') {
      for (const url of pageValue.items) {
        const row = pageRow(url);
        if (row) mineP.push(row);
      }
      pageExtra += Math.max(0, pageValue.total - pageValue.items.length);
    }
    const url = value('url');
    if (url?.type === 'text') {
      const row = pageRow(url.text);
      if (row) mineP.push(row);
    }
    const referrals = value('aiReferrals');
    if (referrals?.type === 'referrals') {
      for (const item of referrals.items) {
        if (!item.page) continue;
        const row = pageRow(item.page);
        if (!row) continue;
        add(row.platforms, ...item.platforms.map((p) => p.platform));
        row.sessions ??= item.sessions;
        row.before ??= item.before;
      }
    }
    const issues = value('issue');
    if (issues?.type === 'list') {
      for (const row of mineP) add(row.issues, ...issues.items);
    }

    const competitor = value('competitor');
    if (competitor?.type === 'text') add(out.competitors, competitor.text);
    if (competitor?.type === 'list') add(out.competitors, ...competitor.items);
    const topic = value('topic');
    if (topic?.type === 'text') add(out.topics, topic.text);
    if (topic?.type === 'list') add(out.topics, ...topic.items);
  }

  out.prompts = [...prompts.values()];
  out.pages = [...pages.values()];
  out.promptTotal = out.prompts.length + promptExtra;
  out.pageTotal = out.pages.length + pageExtra;
  for (const row of out.prompts) add(out.platforms, ...row.platforms);
  return out;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** A URL without its scheme and "www.": "acme.example/pricing". */
export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

/** "/blog/best-tools?ref=a" for an absolute URL; the value itself otherwise. */
export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`;
  } catch {
    return url;
  }
}

/** "acme.example" for an absolute URL; null otherwise. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** An action a person sent: what it was sent about, from its payload. */
function affectedFromPayload(payload: Record<string, unknown>): Affected {
  const out: Affected = empty();
  const platforms = (Array.isArray(payload.platforms) ? payload.platforms : [])
    .map((p) => (typeof p === 'string' ? p : str((p as Record<string, unknown>)?.id)))
    .filter(Boolean);

  if (str(payload.promptText)) {
    out.prompts.push({
      id: str(payload.promptId) || null,
      text: str(payload.promptText),
      platforms,
      lostPages: [],
      citedInstead: [],
      leaders: [],
      topics: [],
    });
  }
  const targets: unknown[] = Array.isArray(payload.targets) ? payload.targets : [];
  const entity = str(payload.targetEntity);
  // A prompt once: a mention review's promptText is its first target too.
  const listed = new Set(out.prompts.map((row) => row.id ?? row.text));
  for (const raw of targets) {
    // A target is { id, label }, or (topics, mentions) its text alone.
    const target = (typeof raw === 'string' ? { label: raw } : (raw ?? {})) as Record<
      string,
      unknown
    >;
    const label = str(target.label) || str(target.id);
    if (!label) continue;
    if (entity === 'prompts') {
      const key = str(target.id) || label;
      if (listed.has(key)) continue;
      listed.add(key);
      out.prompts.push({
        id: str(target.id) || null,
        text: label,
        platforms: [],
        lostPages: [],
        citedInstead: [],
        leaders: [],
        topics: [],
      });
    } else if (entity === 'pages') {
      out.pages.push({ url: label, sessions: null, before: null, platforms: [], issues: [] });
    } else if (entity === 'competitors') {
      add(out.competitors, label);
    } else if (entity === 'topics') {
      add(out.topics, label);
    }
  }
  out.promptTotal = out.prompts.length;
  out.pageTotal = out.pages.length;
  add(out.platforms, ...platforms);
  return out;
}

/**
 * The signals that support an action now (AC-007): open, and the action's.
 * With none left (all resolved, or moved on), the list falls back to every
 * signal it took, so a finished action still shows what it was about.
 */
export function supportingOf(signals: Signal[], actionId: string): Signal[] {
  return signals.filter(
    (signal) => OPEN_SIGNAL_STATUSES.includes(signal.status) && signal.actionId === actionId,
  );
}

export function affectedSignals(signals: Signal[], actionId: string): Signal[] {
  const supporting = supportingOf(signals, actionId);
  return supporting.length > 0 ? supporting : signals;
}

/** The header's counts, each opening the list behind it. Zero ones are left out. */
export function affectedCounts(affected: Affected): {
  prompts: number;
  pages: number;
  platforms: number;
  competitors: number;
  topics: number;
} {
  const pages = new Set([...affected.pages.map((p) => p.url), ...affected.lostPages]);
  // Engines (chatgpt-web) and the sites AI visits come from (chatgpt.com) by
  // name, so one platform counts once.
  const platforms = new Set([
    ...affected.platforms.map(platformName),
    ...affected.pages.flatMap((p) => p.platforms.map(getPlatformName)),
  ]);
  return {
    prompts: affected.promptTotal,
    pages: pages.size + (affected.pageTotal - affected.pages.length),
    platforms: platforms.size,
    competitors: affected.competitors.length,
    topics: affected.topics.length,
  };
}

/** What the Affected tab's label counts: its rows, or the names it lists. */
export function affectedTotal(affected: Affected): number {
  const rows = affected.promptTotal + affected.pageTotal;
  return rows > 0 ? rows : affected.competitors.length + affected.topics.length;
}

/**
 * The actions list's export of an action's affected items (AC-005): the
 * Affected tab's count and the names it lists. A group cut at its first 50
 * prompts names those and counts them all, as the tab does.
 */
export function affectedSummary(affected: Affected): { count: number; items: string[] } {
  const rows = [...affected.prompts.map((p) => p.text), ...affected.pages.map((p) => p.url)];
  return {
    count: affectedTotal(affected),
    items: rows.length > 0 ? rows : [...affected.competitors, ...affected.topics],
  };
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** "#1", or "—" when not named. */
function rankLabel(position: number | null): string {
  return position === null ? '—' : `#${Math.round(position * 10) / 10}`;
}

/**
 * "Trade Coffee #1 vs you #4 on ChatGPT", or "…; you're not named", in the
 * reader's language (actionsPage.drawer.affected).
 */
export function leaderText(leader: AffectedPrompt['leaders'][number], t: Translator): string {
  const values = {
    competitor: leader.competitor,
    them: rankLabel(leader.them),
    platform: platformName(leader.platform),
  };
  return leader.you === null
    ? t('aheadNotNamed', values)
    : t('aheadValue', { ...values, you: rankLabel(leader.you) });
}

export type AffectedChipEntity =
  'signals' | 'prompts' | 'pages' | 'platforms' | 'competitors' | 'topics';

/**
 * The drawer header's chips: each count and the tab that lists what it
 * counts (AC-003). Signals count those that support the action, or all it
 * took once none do, as the Affected list falls back to them.
 */
export function affectedChips(
  signals: Signal[],
  affected: Affected,
  actionId: string,
): { entity: AffectedChipEntity; count: number; tab: 'signals' | 'affected' }[] {
  const counts = affectedCounts(affected);
  const supporting = supportingOf(signals, actionId).length;
  const chips: { entity: AffectedChipEntity; count: number; tab: 'signals' | 'affected' }[] = [];
  if (signals.length > 0) {
    chips.push({ entity: 'signals', count: supporting || signals.length, tab: 'signals' });
  }
  for (const entity of ['prompts', 'pages', 'platforms', 'competitors', 'topics'] as const) {
    if (counts[entity] > 0) chips.push({ entity, count: counts[entity], tab: 'affected' });
  }
  return chips;
}
