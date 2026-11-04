/**
 * A draft's version history (Content Editor spec v2 §8, CE-018, 00215): the
 * live page it was imported from, each Mark ready and publish, and the page
 * before agent changes or a restore. "Now" is the draft itself.
 */

/** Where a version came from. */
export const VERSION_ORIGINS = ['import', 'agent_before', 'ready', 'publish', 'restore'] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

export function isVersionOrigin(value: unknown): value is VersionOrigin {
  return (VERSION_ORIGINS as readonly unknown[]).includes(value);
}

/** How long History keeps a version (the server prunes older ones daily). */
export const HISTORY_DAYS = 90;

/** The most versions History lists. */
export const HISTORY_LIMIT = 50;

export interface DraftVersion {
  id: string;
  origin: VersionOrigin;
  title: string;
  createdAt: string;
}

/**
 * A hand-off to the Content Agent (Quality CE-051, 00275): History lists it
 * beside the versions, without Restore (its changes were suggestions; the
 * page before the first one accepted is a version). Its checks are how many
 * it was given.
 */
export interface DraftHandOff {
  id: string;
  /** A person's Hand off, or the editor's on its own (Settings › Content). */
  origin: 'person' | 'auto';
  /** Null while it is under way; one a stopped server left reads as failed. */
  outcome: 'done' | 'stopped' | 'failed' | null;
  checks: number | null;
  /** The suggestions it left, once done (0: nothing it could change). */
  changes: number | null;
  startedAt: string;
}

/** The draft after a restore, as the server now has it. */
export interface RestoredDraft {
  title: string;
  bodyHtml: string;
  updatedAt: string;
  /** Whether the page changed (00289); false for the version the page already was, unsaid before 00289. */
  restored?: boolean;
}
