/**
 * Positions panel → Improve tab (PROMPT-003): the shapes the server returns
 * (backend/src/lib/promptImprove.js) and the panel's editable copy of them.
 * Kept out of the 'use server' actions file, whose every runtime export must
 * be a server action.
 */

import type { NoPlanMark } from '@/lib/billing/noPlan';

export type ImproveState =
  'no_runs' | 'not_mentioned' | 'mentioned_late' | 'not_cited' | 'doing_well';

export type ImproveSourceType = 'fanout' | 'domain' | 'answer' | 'competitor_url' | 'brand_page';

export interface ImproveSource {
  type: ImproveSourceType;
  ref: string;
}

export interface ImproveSuggestion {
  id: string;
  platform: string;
  state: ImproveState;
  title: string;
  body: string;
  sources: ImproveSource[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ImprovePlatform {
  id: string;
  label: string;
  state: ImproveState;
  runs: number;
  mentionedRuns: number;
  citedRuns: number;
  mentionPosition: number | null;
  mentionTotal?: number | null;
  citationRank: { rank: number; total: number } | null;
  /** What the suggestions could draw on; null when the platform got none. */
  inputs: { fanouts: number; citedDomains: number; competitorUrls: number; answer: boolean } | null;
}

/** A send of this set to Action Center that is still live (PROMPT-004). */
export interface ImproveSend {
  actionId: string;
  actionNo: number;
  sentAt: string;
  suggestionIds: string[];
}

export interface ImproveSent {
  /** The newest live send of the current set; decides "Open in Actions". */
  latest: ImproveSend | null;
  /** Suggestions any live send of this set carried ("Already sent"). */
  sentSuggestionIds: string[];
}

export interface ImproveSet {
  sent: ImproveSent;
  rangeKey: string;
  region: string;
  platforms: ImprovePlatform[];
  suggestions: ImproveSuggestion[];
  latestResultAt: string | null;
  generatedAt: string;
  /** Answers newer than the set exist: the panel rebuilds it. */
  stale: boolean;
}

/**
 * The monthly Improve budget as the panel shows it. The budget itself is in
 * dollars (the workspace's AI budget: Starter $5, Growth $25, Enterprise $50
 * or more) and stays on the server; the panel gets an estimate of the
 * generations it still buys.
 */
export interface ImproveQuota extends NoPlanMark {
  unlimited: boolean;
  exhausted: boolean;
  generationsLeft: number | null;
  percentLeft: number | null;
  /** The free trial's smaller allowance: more comes with starting the plan. */
  trial?: boolean;
}

/** The panel's range as sent to the server: the resolved bounds plus the picked preset. */
export interface ImproveRangeInput {
  preset: string;
  from: string;
  to?: string;
  customFrom?: string;
  customTo?: string;
  region?: string;
}

/** A suggestion as the panel holds it: edited in place, checked, removable. */
export interface DraftSuggestion extends ImproveSuggestion {
  checked: boolean;
  removed: boolean;
  /** Written by the user with "Add your own suggestion". */
  own?: boolean;
}

export const STATE_LABEL: Record<ImproveState, string> = {
  no_runs: 'No runs in this period',
  not_mentioned: 'Not mentioned',
  mentioned_late: 'Mentioned · Late',
  not_cited: 'Mentioned early · not cited',
  doing_well: 'Doing well',
};

/** Order of the groups: the biggest gaps first. */
export const STATE_ORDER: ImproveState[] = [
  'not_mentioned',
  'mentioned_late',
  'not_cited',
  'doing_well',
  'no_runs',
];

/**
 * Below this share of runs mentioning the brand, a platform counts as not
 * mentioned, however high those few ranked. The Tracked Prompts Positions
 * column applies it too, so its "missing" matches this tab's "Not mentioned".
 * Mirrors MIN_MENTION_RATE in backend/src/lib/promptImprove.js — keep the two
 * in sync.
 */
export const MIN_MENTION_RATE = 0.5;

/** "mentioned in 8 of 120 runs": why a platform's state is what it is. */
export function mentionRateLabel(p: Pick<ImprovePlatform, 'runs' | 'mentionedRuns'>): string {
  return `mentioned in ${p.mentionedRuns} of ${p.runs} run${p.runs === 1 ? '' : 's'}`;
}

export function toDrafts(suggestions: ImproveSuggestion[]): DraftSuggestion[] {
  return suggestions.map((s) => ({ ...s, checked: true, removed: false }));
}

/** "x of y selected · n platforms" — removed suggestions don't count. */
export function selectionSummary(drafts: DraftSuggestion[]): {
  selected: number;
  total: number;
  platforms: number;
} {
  const live = drafts.filter((d) => !d.removed);
  const selected = live.filter((d) => d.checked);
  return {
    selected: selected.length,
    total: live.length,
    platforms: new Set(selected.map((d) => d.platform)).size,
  };
}

/** Whether the user changed anything the server didn't generate. */
export function hasUnsentEdits(drafts: DraftSuggestion[], original: ImproveSuggestion[]): boolean {
  const byId = new Map(original.map((s) => [s.id, s]));
  return drafts.some((d) => {
    if (d.own) return !d.removed;
    const o = byId.get(d.id);
    return !o || d.removed || !d.checked || d.title !== o.title || d.body !== o.body;
  });
}

/** Short label for a source chip. */
export function sourceChipLabel(source: ImproveSource): string {
  switch (source.type) {
    case 'fanout':
      return `Fan-out: ${source.ref}`;
    case 'answer':
      return 'AI answer';
    case 'brand_page':
      return `Your page: ${shortUrl(source.ref)}`;
    case 'competitor_url':
      return shortUrl(source.ref);
    default:
      return source.ref;
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return url;
  }
}

/** Where "Open in Actions" goes: the Actions tab with this action's panel open. */
export function actionCenterLink(actionId: string): string {
  return `/dashboard/action-center/actions?action=${actionId}`;
}
