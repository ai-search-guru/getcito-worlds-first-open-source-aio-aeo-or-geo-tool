/**
 * The prompts table's bulk action bar (PROMPT-006): selecting the rows on
 * screen, how many content suggestions one click may ask for, how a run of
 * suggestions is summed up, and deleting a few prompts per call. The page
 * passes the calls in; this only decides.
 */

import { onDemandMax, type ContentUsage } from '@/lib/contentUsage';
import { isNoPlan } from '@/lib/billing/noPlan';
import type { PromptSuggestionOutcome } from '@/lib/contentJob';

/** Every row on the page is selected (and there is at least one). */
export function allSelected(pageIds: string[], selected: ReadonlySet<string>): boolean {
  return pageIds.length > 0 && pageIds.every((id) => selected.has(id));
}

/**
 * The header checkbox: selects the page's rows, or clears them when they are
 * all selected already. Only the page on screen, so nothing out of sight is
 * ever acted on.
 */
export function toggleAll(pageIds: string[], selected: ReadonlySet<string>): Set<string> {
  return allSelected(pageIds, selected) ? new Set() : new Set(pageIds);
}

/** The smallest plan's per-request cap, for when the quota can't be read. */
export const FALLBACK_PER_REQUEST = 3;

/**
 * Why one bulk "Suggest content" click can't take this many prompts, or null
 * when it can. It may ask for what one "+ New" request may (CONTENT-003):
 * Starter 3, Growth 5, never more than is left of the month. Nothing is asked
 * for while the quota is loading; if it can't be read, the smallest cap holds
 * and the server still keeps the month's limit. Without an active plan
 * (`noPlan`, 0 of 0, or a read-only workspace: `isLocked`) nothing blocks:
 * the click opens the plan dialog.
 */
export function bulkSuggestBlock(
  count: number,
  usage: ContentUsage | null,
  { unavailable = false, isLocked = false }: { unavailable?: boolean; isLocked?: boolean } = {},
): string | null {
  if (isNoPlan(usage, isLocked)) return null;
  if (!usage && !unavailable) return 'Checking your content quota…';
  const max = usage ? onDemandMax(usage) : FALLBACK_PER_REQUEST;
  if (max === 0) return 'Monthly limit reached';
  return count > max ? `Select up to ${max} to suggest content` : null;
}

/** How a run of suggestions went, prompt by prompt. */
export interface BulkSuggestTally {
  asked: number;
  /** Prompts the run started; the rest weren't asked for or were turned away. */
  attempted: number;
  created: string[];
  existing: string[];
  nothing: number;
  failed: number;
  stillWriting: number;
  /** The month's quota ran out. */
  limited: boolean;
}

export function emptyTally(asked: number): BulkSuggestTally {
  return {
    asked,
    attempted: 0,
    created: [],
    existing: [],
    nothing: 0,
    failed: 0,
    stillWriting: 0,
    limited: false,
  };
}

/** Adds one prompt's outcome to the run. */
export function tallyOutcome(tally: BulkSuggestTally, outcome: PromptSuggestionOutcome) {
  // A prompt the month's limit turned away was never started.
  if (outcome.kind !== 'limited') tally.attempted += 1;
  switch (outcome.kind) {
    case 'created':
      tally.created.push(outcome.opportunityId);
      break;
    case 'existing':
      tally.existing.push(outcome.opportunityId);
      break;
    case 'nothing':
      tally.nothing += 1;
      break;
    case 'failed':
      tally.failed += 1;
      break;
    case 'timeout':
      tally.stillWriting += 1;
      break;
    case 'limited':
      tally.limited = true;
      break;
  }
}

/**
 * Prompts deleted per call. Each takes its answers and their citations with
 * it, and on the heaviest brands one prompt carries about 700 answers and
 * 7,000 citations. Three stay near the 2,000 answers a brand delete takes per
 * statement (#991), well inside the signed-in user's 8-second statement
 * timeout; a whole page in one call outran it and rolled back.
 */
export const PROMPT_DELETE_BATCH = 3;

/** How a delete run went. */
export interface BatchDeleteResult {
  deletedIds: string[];
  /** Still there: left out by RLS, in the call that failed, or never asked for after it. */
  keptIds: string[];
  /** A call failed, so the run stopped there. */
  failed: boolean;
}

/**
 * Deletes prompts a few per call, one call after another, so each statement
 * stays short. It stops at the first call that fails, as a brand delete
 * stops at a failed batch: what came before stays deleted, the rest is kept.
 * `onProgress` hears how many prompts are done after each call.
 */
export async function deleteInBatches(
  ids: string[],
  deleteBatch: (ids: string[]) => Promise<{ deletedIds: string[] } | { error: string }>,
  onProgress?: (done: number) => void,
): Promise<BatchDeleteResult> {
  const deleted = new Set<string>();
  let failed = false;
  for (let start = 0; start < ids.length; start += PROMPT_DELETE_BATCH) {
    const batch = ids.slice(start, start + PROMPT_DELETE_BATCH);
    const result = await deleteBatch(batch).catch(() => ({ error: 'unreachable' }));
    if ('error' in result) {
      failed = true;
      break;
    }
    for (const id of result.deletedIds) deleted.add(id);
    onProgress?.(start + batch.length);
  }
  return {
    deletedIds: ids.filter((id) => deleted.has(id)),
    keptIds: ids.filter((id) => !deleted.has(id)),
    failed,
  };
}

/**
 * A run of suggestions, one prompt after another: each content job regroups
 * the brand's prompts first, and two at once would regroup over each other.
 * It stops at the month's limit, and when a job outlives the wait, since the
 * next one would then run beside it.
 */
export async function runInTurn<T>(
  items: T[],
  suggest: (item: T, index: number) => Promise<PromptSuggestionOutcome>,
): Promise<BulkSuggestTally> {
  const tally = emptyTally(items.length);
  for (const [i, item] of items.entries()) {
    const outcome = await suggest(item, i);
    tallyOutcome(tally, outcome);
    if (outcome.kind === 'limited' || outcome.kind === 'timeout') break;
  }
  return tally;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The toast at the end of a run: what was written as the title, the rest as
 * one line. The tone follows what the user got out of it.
 */
export function bulkSuggestSummary(t: BulkSuggestTally): {
  tone: 'success' | 'info' | 'error';
  title: string;
  description: string | undefined;
} {
  const handled = t.created.length + t.existing.length + t.nothing + t.failed + t.stillWriting;
  const notStarted = t.asked - t.attempted;
  const details = [
    t.existing.length > 0 && `${t.existing.length} already had one`,
    t.nothing > 0 &&
      `${plural(t.nothing, 'needs', 'need')} tracked answers and a prompt group first`,
    t.stillWriting > 0 && `${t.stillWriting} still being written`,
    t.failed > 0 && `${t.failed} failed`,
    t.limited && 'monthly limit reached',
    notStarted > 0 && `${notStarted} not started`,
  ].filter((d): d is string => Boolean(d));
  const description = details.length ? capitalize(details.join(' · ')) : undefined;

  if (t.created.length > 0) {
    return {
      tone: 'success',
      title: `${plural(t.created.length, 'content suggestion', 'content suggestions')} created`,
      description,
    };
  }
  if (t.limited && handled === 0) {
    return { tone: 'error', title: 'Monthly content limit reached.', description: undefined };
  }
  if (t.existing.length > 0 && handled === t.existing.length && !t.limited) {
    return {
      tone: 'info',
      title:
        t.existing.length === 1
          ? 'This prompt already has a content suggestion'
          : 'These prompts already have content suggestions',
      description: undefined,
    };
  }
  if (t.failed > 0 && t.failed === handled) {
    return { tone: 'error', title: "Couldn't write content suggestions", description };
  }
  return { tone: 'info', title: 'No new content suggestions', description };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
