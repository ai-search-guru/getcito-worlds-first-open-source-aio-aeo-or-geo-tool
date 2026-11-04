import type { Json } from '@/types/supabase';

/**
 * What every Undo rule reads with (undo.ts, undoSetup.ts): the state it
 * keeps, and the small readers of the rows and inputs it gets. Server only.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A state Undo keeps: before the change, and after it. */
export type Snapshot = { [key: string]: Json };

export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Throws a read's error, saying what Undo was reading. */
export function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`Could not read ${what} for Undo: ${error.message}`);
}
