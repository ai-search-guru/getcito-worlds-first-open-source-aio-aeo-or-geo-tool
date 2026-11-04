import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import type { ChatEventPayloads, ChatWhatsNewEntry } from '../events';
import { WHATS_NEW_ENTRIES } from './entries';
import { MAX_SHOWN, markWhatsNewRead } from './reads';

/**
 * What's new in a run (CHAT-11 items 10–11, 18): its one step reads "Read
 * What's new · 3 updates for your plan", and the updates it found show as
 * cards under the answer, in the team's words as approved, and count as
 * read. The engine calls these after get_whats_new's read.
 */

export const WHATS_NEW_TOOL = 'get_whats_new';

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.whatsNew' });

/** The updates a get_whats_new read returned. */
export function updatesOf(value: unknown): unknown[] {
  const updates = (value as { updates?: unknown } | null)?.updates;
  return Array.isArray(updates) ? updates : [];
}

/** The step's detail: "3 updates for your plan", or "Nothing new for your plan". */
export function whatsNewStepDetail(value: unknown): string {
  return t('step', { count: updatesOf(value).length });
}

/**
 * The read's updates as cards: each the approved entry of its feature, as
 * written (never the model's words), with the plans that include it when
 * the person's doesn't. Three at most; an update with no entry is left out.
 */
export function whatsNewCards(value: unknown): ChatWhatsNewEntry[] {
  const cards: ChatWhatsNewEntry[] = [];
  for (const update of updatesOf(value)) {
    const { feature, on_plans: onPlans } = (update ?? {}) as Record<string, unknown>;
    const entry = WHATS_NEW_ENTRIES.find((e) => e.feature === feature);
    if (!entry || cards.some((card) => card.slug === entry.slug)) continue;
    cards.push({
      slug: entry.slug,
      feature: entry.feature,
      lines: [...entry.lines],
      href: entry.route,
      ...(typeof onPlans === 'string' && onPlans ? { onPlans } : {}),
    });
  }
  return cards.slice(0, MAX_SHOWN);
}

/** Shows the read's updates as cards, then marks them read for the person. */
export async function showWhatsNew(
  value: unknown,
  userId: string,
  emit: (cards: ChatEventPayloads['whats_new.ready']) => void,
): Promise<void> {
  const entries = whatsNewCards(value);
  if (entries.length === 0) return;
  emit({ entries });
  await markWhatsNewRead(
    userId,
    entries.map((entry) => entry.slug),
  );
}
