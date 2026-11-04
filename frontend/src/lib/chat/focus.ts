import { z } from 'zod';
import type { WorkAreaId } from '@/lib/menuAccess';

/**
 * What Chat focuses on for a person (CHAT-24 §2; chat_user_prefs.focus,
 * 00400): one or more interest areas, kept in the order picked, the first
 * leading Home. Focus only changes what Chat suggests, never what the
 * person may do: their role decides that (CHAT-20).
 */

/** The areas, in the picker's order (mockup #s-dept). */
export const FOCUS_AREAS = [
  'lead',
  'comp',
  'growth',
  'seo',
  'content',
  'brand',
  'pd',
  'bd',
] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];

export function isFocusArea(value: unknown): value is FocusArea {
  return typeof value === 'string' && (FOCUS_AREAS as readonly string[]).includes(value);
}

/**
 * The area each work area (Settings › Menu access, 00374) starts the
 * picker with. Developers look after the audit, prompts and citations;
 * Analytics after traffic. No work area points to Competitors.
 */
export const WORK_AREA_FOCUS: Record<WorkAreaId, FocusArea> = {
  leaders: 'lead',
  aeo: 'seo',
  content: 'content',
  brand: 'brand',
  growth: 'growth',
  product: 'pd',
  bizdev: 'bd',
  developers: 'seo',
  analytics: 'growth',
};

/** The picks the picker starts with for these work areas: each area once, in their order. */
export function focusFromWorkAreas(workAreas: readonly string[] | null): FocusArea[] {
  const picks: FocusArea[] = [];
  for (const area of workAreas ?? []) {
    const focus = WORK_AREA_FOCUS[area as WorkAreaId];
    if (focus && !picks.includes(focus)) picks.push(focus);
  }
  return picks;
}

/**
 * A saved focus: null when the person was never asked (or it can't be
 * read), an empty list when they skipped or cleared it. Unknown or
 * repeated areas are dropped.
 */
export function focusOf(value: unknown): FocusArea[] | null {
  if (!Array.isArray(value)) return null;
  const picks: FocusArea[] = [];
  for (const area of value) if (isFocusArea(area) && !picks.includes(area)) picks.push(area);
  return picks;
}

/** A focus to keep: known areas, each once. Empty clears it. */
export const focusPicks = z
  .array(z.enum(FOCUS_AREAS))
  .max(FOCUS_AREAS.length)
  .refine((picks) => new Set(picks).size === picks.length);

/** Where a focus was picked (CHAT-24 §8 `chat_focus_saved.source`). */
export type FocusSource = 'first_open' | 'settings' | 'home_pill';
