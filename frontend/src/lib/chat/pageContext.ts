import { dashboardNav } from '@/config/dashboard';
import type { ChatReference } from './references';

/**
 * What a page tells Chat's side panel it shows (CHAT-01 items 20–22, the
 * page context contract): its name, the date range and filters it is on,
 * up to three questions for the empty panel, and what on it can be asked
 * about. The panel turns it into removable chips in the composer (names,
 * never IDs) and sends it with the message as the run's default scope
 * (CHAT-04 item 8). A page that says nothing still gets its menu name and
 * the brand.
 */

export interface ChatPageFilter {
  /** The page's own handle for the filter (`platform`, `topic`). */
  key: string;
  /** What the chip shows: the value's name ("ChatGPT", "All platforms"). */
  label: string;
  /** The value itself, for the run (a platform id, a topic id); empty for all. */
  value: string;
}

export interface ChatPageContext {
  /** The page's name as its header says it; the menu's when not given. */
  pageName?: string;
  dateRange?: { from: string; to: string | null; label: string } | null;
  filters?: ChatPageFilter[];
  /** Questions for the empty panel: a click fills the box, never sends (item 21). */
  suggestions?: string[];
  /** What on the page can be asked about: first in the @ menu (CHAT-02 item 16). */
  referenceables?: ChatReference[];
}

/** A context chip: the composer's ComposerChip, with the value the run reads. */
export interface ChatContextChip {
  key: string;
  label: string;
  value?: string;
}

/** The most suggestion chips in the empty panel (item 21). */
export const MAX_SUGGESTIONS = 3;

/**
 * The chips a page's context makes, in the mockup's order: the page, the
 * brand, the date range, then each filter. A chip the person removed stays
 * off (item 20); one without a label isn't made.
 */
export function contextChips(
  context: ChatPageContext | null,
  fallback: { pageName: string | null; brand: { id: string; name: string } | null },
  removed: ReadonlySet<string> = new Set(),
): ChatContextChip[] {
  const pageName = context?.pageName ?? fallback.pageName;
  const chips: ChatContextChip[] = [];
  if (pageName) chips.push({ key: 'page', label: pageName });
  if (fallback.brand?.name) {
    chips.push({ key: 'brand', label: fallback.brand.name, value: fallback.brand.id });
  }
  const range = context?.dateRange;
  if (range?.label) {
    chips.push({ key: 'dates', label: range.label, value: `${range.from}/${range.to ?? ''}` });
  }
  for (const filter of context?.filters ?? []) {
    if (filter.label) {
      chips.push({ key: `filter:${filter.key}`, label: filter.label, value: filter.value });
    }
  }
  return chips.filter((chip) => !removed.has(chip.key));
}

/**
 * The menu entry a page is under, by the longest route that holds it (a
 * topic's page is under Topics): its title, for the menu's translations;
 * null off the menu (Settings, Brands).
 */
export function menuTitleOf(pathname: string): string | null {
  let best: { title: string; length: number } | null = null;
  for (const group of dashboardNav) {
    for (const item of group.items) {
      for (const entry of [item, ...(item.children ?? [])]) {
        const holds = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        if (holds && (!best || entry.href.length > best.length)) {
          best = { title: entry.title, length: entry.href.length };
        }
      }
    }
  }
  return best?.title ?? null;
}

/**
 * A date range's chip, as the page's own control names it: "Last 30 days",
 * "Last 24 hours", or a custom range's days. `t` reads chatPanel.range.
 */
export function rangeChipLabel(
  preset: string,
  custom: { from?: string; to?: string },
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (preset === '24h') return t('day');
  if (preset === 'custom') {
    return custom.from && custom.to
      ? t('custom', { from: custom.from, to: custom.to })
      : t('customOpen');
  }
  const days = Number.parseInt(preset, 10);
  return Number.isFinite(days) ? t('days', { days }) : t('all');
}

/**
 * The row that moved most, up or down (CHAT-01 item 21: a suggestion from
 * the page's largest drop or gain, on data it already loaded, no model
 * call); null when nothing moved.
 */
export function largestMove<T extends { change: number | null }>(
  rows: readonly T[] | null | undefined,
): (T & { change: number }) | null {
  let best: (T & { change: number }) | null = null;
  for (const row of rows ?? []) {
    const change = row.change;
    if (change === null || change === 0 || !Number.isFinite(change)) continue;
    if (!best || Math.abs(change) > Math.abs(best.change)) best = row as T & { change: number };
  }
  return best;
}
