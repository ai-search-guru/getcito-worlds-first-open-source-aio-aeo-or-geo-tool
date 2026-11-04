import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../messages/en.json';
import type { AskAnswer } from './asks';

/**
 * A request bigger than what is left of the AI limit (CHAT-04 item 17a;
 * Chat Wave 2 W2-03). Before work in several like parts (drafts, pages,
 * tasks), the model says how many with PARTS_TOOL; the server counts how
 * many the limit left covers (budget.ts fitChatUnits: a count, never
 * dollars), and:
 *   - all of them: the work goes on;
 *   - none: the run pauses at the AI limit, as a step the limit can't
 *     cover does (`run.paused_cap`, CHAT-04 item 17);
 *   - some: Chat doesn't shrink the work on its own. With the person there,
 *     a question card asks: Do the first {k} now (Recommended), Get more AI
 *     credits (the run pauses at the limit, whose card sells the credits) or
 *     Cancel (the run stops). With no one there (an agent's or a scheduled
 *     run), it does the first {k}, files them, and stops at the AI limit
 *     ("Stopped at the AI limit"), which the run's Inbox row shows.
 * A skill's run checks once more as it starts, before anything is read:
 * a limit that can't cover one write step pauses it there, with nothing
 * spent. On the workspace's own key nothing is checked. The words here;
 * engine.ts does the rest.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.partial' });

/** The engine's own tool: the model says how many like parts its work has. */
export const PARTS_TOOL = 'plan_parts';

/** The most parts one check takes: past it the job is checked as this many. */
export const MAX_PARTS = 50;

export const partsToolInput = z.object({
  parts: z
    .number()
    .int()
    .min(2)
    .max(MAX_PARTS)
    .describe('How many like parts the work has: 5 drafts is 5.'),
  // Shown on the card: a plural noun, no more.
  unit: z
    .string()
    .trim()
    .regex(/^\p{L}[\p{L} -]{0,39}$/u)
    .describe('What the parts are, plural, in the person’s language: "drafts", "tasks", "pages".'),
});
export type PartsInput = z.infer<typeof partsToolInput>;

export const PARTS_TOOL_DESCRIPTION =
  'Before work in several like parts (several drafts, pages, tasks or images), call this once, alone in its reply, with how many parts and what they are. The app checks the AI limit covers them; when it covers only some, the person picks what to do. Follow its result.';

/** The write phase's rule for it (engine.ts coreRules). */
export const PARTS_RULE = `Before work in several like parts (several drafts, pages, tasks or images), call ${PARTS_TOOL} once with how many, alone in its reply, and follow its result: do only the parts it says.`;

/**
 * Whether someone is there to ask: a person's own chat, driven by their own
 * request. An agent's run, or one no session is behind (a scheduled or
 * triggered run), takes the safe default instead.
 */
export function personPresent(rc: {
  agentRunId: string | null;
  sessionUserId: string | null;
  actor: { userId: string };
}): boolean {
  return rc.agentRunId === null && rc.sessionUserId === rc.actor.userId;
}

/** What the limit left decides for a job of `parts`, `fits` of which it covers. */
export type PartsFit = { kind: 'all' } | { kind: 'none' } | { kind: 'some'; fits: number };

export function partsFit(fits: number, parts: number): PartsFit {
  if (fits >= parts) return { kind: 'all' };
  if (fits <= 0) return { kind: 'none' };
  return { kind: 'some', fits };
}

/** A question card's words (asks.ts's shape): the first option the recommended one. */
export function partsQuestion(fits: number, parts: number, unit: string) {
  return {
    question: t('question', { fits, parts, unit }),
    options: [
      { label: t('doFirst', { fits }), detail: t('doFirstDetail'), recommended: true },
      { label: t('credits'), detail: t('creditsDetail') },
      { label: t('cancel') },
    ],
  };
}

/** What the person picked: the card's place, or the recommended one when skipped. */
export type PartsChoice = 'first' | 'credits' | 'cancel';

export function partsChoice(answer: Pick<AskAnswer, 'selected' | 'skipped'>): PartsChoice {
  if (answer.skipped) return 'first';
  const picked = answer.selected[0];
  return picked === 1 ? 'credits' : picked === 2 ? 'cancel' : 'first';
}

/** The tool's result for the model: every part, or only the first `fits`. */
export function partsResult(fits: number, parts: number, unit: string) {
  if (fits >= parts) return { ok: true, covered: parts };
  return {
    ok: true,
    do_now: fits,
    of: parts,
    message: `The AI limit left covers ${fits} of the ${parts} ${unit}. Do only the first ${fits} now, then stop and say in one line which are left for when there is more AI limit. Don't start another.`,
  };
}
