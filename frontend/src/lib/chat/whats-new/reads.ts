import { planFactsOf } from '@/lib/mcp/chatFacts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  WHATS_NEW_ENTRIES,
  daysSince,
  entryAccess,
  isPublished,
  matchesFeature,
  plansLine,
  type EntryPlan,
  type WhatsNewEntry,
} from './entries';

/**
 * What's new for a person (CHAT-11 §B–E, W4-20): the approved entries their
 * plan shows (a `hide` entry never; a `show_upgrade` one with "On {plans}."),
 * whether each is read, and marking them read. Read state is per person
 * (chat_whats_new_reads, 00464), the same in the side panel and on the full
 * page. Server only.
 */

/** Chat Home's New line shows an unread entry this many days after its day (owner decision 14). */
export const HOME_LINE_DAYS = 14;

/** The What's new chip's dot counts unread entries this recent: older ones are "older updates". */
export const UNREAD_DAYS = 90;

/** Entries one What's new answer shows at most (CHAT-11 item 10). */
export const MAX_SHOWN = 3;

/** An entry as the person sees it: no price, plan names from Billing. */
export interface WhatsNewItem {
  slug: string;
  feature: string;
  homeLine: string;
  lines: string[];
  route: WhatsNewEntry['route'];
  /** "Growth and Enterprise" for an entry their plan doesn't include (show_upgrade); else null. */
  onPlans: string | null;
  published: string;
  read: boolean;
}

export interface WhatsNewPick {
  items: WhatsNewItem[];
  /** An unread entry from the last UNREAD_DAYS days, for the chip's dot. */
  hasUnread: boolean;
  /** Entries left out of this pick that the person could still read ("Show older updates"). */
  more: boolean;
}

export interface PickOptions {
  plan: EntryPlan;
  read: ReadonlySet<string>;
  now: Date;
  /** Unread ones only. */
  unreadOnly?: boolean;
  /** Only entries this many days old or newer. */
  days?: number;
  /** The entry the person named ("What's new: how can {feature} help me?"): first. */
  feature?: string;
  /**
   * Entries already shown, by feature or slug: left out, so "Show older
   * updates" reads the next ones in the same order until none are left.
   */
  shown?: readonly string[];
  limit?: number;
  entries?: readonly WhatsNewEntry[];
}

/**
 * The entries to show (CHAT-11 item 10): the named one first, then the
 * unread, then the newest; only those whose day has come and the plan
 * shows. Pure.
 */
export function pickWhatsNew(options: PickOptions): WhatsNewPick {
  const { plan, read, now } = options;
  const shown = (options.entries ?? WHATS_NEW_ENTRIES).filter(
    (entry) => isPublished(entry, now) && entryAccess(entry, plan) !== 'hidden',
  );
  const hasUnread = shown.some(
    (entry) => !read.has(entry.slug) && daysSince(entry, now) <= UNREAD_DAYS,
  );
  const named = options.feature?.trim() ?? '';
  const seen = new Set((options.shown ?? []).map((name) => name.trim().toLowerCase()));
  const candidates = shown.filter(
    (entry) =>
      (!options.unreadOnly || !read.has(entry.slug)) &&
      (options.days === undefined || daysSince(entry, now) <= options.days) &&
      !seen.has(entry.slug) &&
      !seen.has(entry.feature.toLowerCase()),
  );
  const rank = (entry: WhatsNewEntry) =>
    (named && matchesFeature(entry, named) ? 0 : 2) + (read.has(entry.slug) ? 1 : 0);
  // Entries come newest first; a stable sort keeps that within each rank.
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  const limit = Math.max(1, Math.min(options.limit ?? MAX_SHOWN, 10));
  const items = ordered.slice(0, limit).map((entry): WhatsNewItem => ({
    slug: entry.slug,
    feature: entry.feature,
    homeLine: entry.homeLine,
    lines: [...entry.lines],
    route: entry.route,
    onPlans: entryAccess(entry, plan) === 'upgrade' ? `${plansLine(entry.plans)}` : null,
    published: entry.published,
    read: read.has(entry.slug),
  }));
  return { items, hasUnread, more: ordered.length > items.length };
}

/** The slugs a person has read. A read that fails counts nothing read: the worst is a line shown again. */
export async function readWhatsNewReads(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('chat_whats_new_reads')
    .select('entry_slug')
    .eq('user_id', userId);
  if (error) {
    console.error('[chat/whats-new] could not read what was read:', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { entry_slug: string }[]).map((row) => row.entry_slug));
}

/**
 * What's new for the person: their plan's entries, read or not, as
 * pickWhatsNew picks them, and the plan's name. Server only.
 */
export async function readWhatsNew(
  params: { userId: string; organizationId: string; now?: Date } & Omit<
    PickOptions,
    'plan' | 'read' | 'now'
  >,
): Promise<WhatsNewPick & { planName: string }> {
  const { userId, organizationId, now = new Date(), ...options } = params;
  const [facts, read] = await Promise.all([planFactsOf(organizationId), readWhatsNewReads(userId)]);
  return {
    ...pickWhatsNew({ ...options, plan: facts, read, now }),
    planName: facts.planName,
  };
}

/**
 * Marks entries read for the person (CHAT-11 item 18): shown in an answer,
 * Show me sent, or Try it opened. Only slugs of approved entries; one row
 * per person and entry, a repeat changes nothing. False when it couldn't be
 * kept.
 */
export async function markWhatsNewRead(userId: string, slugs: readonly string[]): Promise<boolean> {
  const known = new Set(WHATS_NEW_ENTRIES.map((entry) => entry.slug));
  const rows = [...new Set(slugs)]
    .filter((slug) => known.has(slug))
    .map((slug) => ({ user_id: userId, entry_slug: slug }));
  if (rows.length === 0) return true;
  const { error } = await supabaseAdmin
    .from('chat_whats_new_reads')
    .upsert(rows, { onConflict: 'user_id,entry_slug', ignoreDuplicates: true });
  if (error) {
    console.error('[chat/whats-new] could not mark entries read:', error.message);
    return false;
  }
  return true;
}
