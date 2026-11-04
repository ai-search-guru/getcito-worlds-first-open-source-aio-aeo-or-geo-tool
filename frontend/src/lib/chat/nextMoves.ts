import { z } from 'zod';
import type { TeamRole } from '@/components/context/RoleProvider';
import { maskIds, type ChatNextMove } from './events';

/**
 * Next moves (CHAT-07 §C): what the model suggests with its final answer,
 * and the moves the person is shown. No server code: the engine and the
 * page read these.
 */

/** The engine's own tool for next moves: never a registry row, never shown. */
export const NEXT_MOVES_TOOL = 'suggest_next_moves';

/** A run shows at most this many (CHAT-07, agentic UI update: "up to 3 next-move cards"). */
export const MAX_NEXT_MOVES = 3;

/** One move per kind at most (§C item 6). */
export const NEXT_MOVE_KINDS = ['continue', 'deepen', 'act', 'repeat', 'reuse'] as const;

/** Roles that only read: a write or an EXECUTE move is never theirs, as a card or as ghost text (§C item 4). */
const READ_ONLY_ROLES: readonly TeamRole[] = ['analyst', 'agency_partner'];

/**
 * A link in a move's words: an address with a scheme, www., mailto: or a
 * Markdown link. A move names a page of the workspace ("/features"), never
 * an outside address a page Chat read could have put there.
 */
const LINK = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:|\]\(/i;

/** A move's label and prompt are this long at most (00417), so a prompt fits as ghost text. */
export const MOVE_PROMPT_MAX = 80;
const moveText = z
  .string()
  .trim()
  .min(1)
  .max(MOVE_PROMPT_MAX)
  .refine((text) => !LINK.test(text));

/** One move as it is kept: each is checked on its own, so a bad one loses only itself. */
export const nextMoveItem = z.object({
  label: moveText,
  prompt: moveText,
  kind: z.enum(NEXT_MOVE_KINDS),
  class: z.enum(['read', 'write', 'execute']),
  continues_this_run: z.boolean().optional(),
});
export type NextMoveInput = z.output<typeof nextMoveItem>;

/**
 * What the model suggests with: its ranked moves, best first. Loose on
 * purpose: the call is taken whole and each move checked against
 * nextMoveItem (validMoves), so one move too long or of an unknown kind
 * doesn't lose the others.
 */
export const nextMovesInput = z.object({
  moves: z
    .array(
      z.object({
        label: z
          .string()
          .describe('Names a real object: "Do the same for /features". Never an id or a tool.'),
        prompt: z
          .string()
          .describe('The message it sends, as the person would type it, under 80 characters.'),
        kind: z.string().describe(`One of: ${NEXT_MOVE_KINDS.join(', ')}.`),
        class: z
          .string()
          .describe('read: only reads data; write: changes the workspace; execute: goes live.'),
        continues_this_run: z
          .boolean()
          .optional()
          .describe('It continues an object of this answer (a page, task or prompt it worked on).'),
      }),
    )
    .max(6),
});

/** The moves that pass nextMoveItem, in order; the rest are dropped. */
export function validMoves(moves: readonly unknown[]): NextMoveInput[] {
  return moves.flatMap((move) => {
    const parsed = nextMoveItem.safeParse(move);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A move as chat_next_moves keeps it, in rank order. */
export interface PickedMove {
  label: string;
  prompt: string;
  class: NextMoveInput['class'];
  /**
   * The model said it continues this run's object (continues_this_run): only
   * then ghost text. Its word, not checked here; the card shows what it sends.
   */
  ghostOk: boolean;
}

/**
 * The moves the person is shown, best first: read moves only for an
 * Analyst or an Agency partner, and while the workspace is read-only; one
 * per kind and per prompt; at most three; ids masked.
 */
export function pickNextMoves(
  moves: readonly NextMoveInput[],
  who: { role: TeamRole; writable: boolean },
): PickedMove[] {
  const readOnly = READ_ONLY_ROLES.includes(who.role) || !who.writable;
  const kinds = new Set<string>();
  const prompts = new Set<string>();
  const picked: PickedMove[] = [];
  for (const move of moves) {
    if (readOnly && move.class !== 'read') continue;
    const prompt = maskIds(move.prompt).trim();
    const key = prompt.toLowerCase();
    if (!prompt || kinds.has(move.kind) || prompts.has(key)) continue;
    kinds.add(move.kind);
    prompts.add(key);
    picked.push({
      label: maskIds(move.label).trim() || prompt,
      prompt,
      class: move.class,
      ghostOk: move.continues_this_run === true,
    });
    if (picked.length === MAX_NEXT_MOVES) break;
  }
  return picked;
}

/** A kept move as the browser gets it: the ghost mark, never its class. */
export function clientMove(move: Pick<PickedMove, 'label' | 'prompt' | 'ghostOk'>): ChatNextMove {
  return { label: move.label, prompt: move.prompt, ...(move.ghostOk ? { ghost: true } : {}) };
}

/**
 * The composer's ghost text after an answer (§C item 4): the first move's
 * prompt when it continues this run; else none. The moves are already the
 * role's, so a read-only role's ghost is its best read move, or none.
 */
export function ghostOf(moves: readonly ChatNextMove[]): string | undefined {
  const first = moves[0];
  return first?.ghost ? first.prompt : undefined;
}
