import { z } from 'zod';
import type { ChatAskOption } from './events';

/**
 * Question cards (CHAT-07 §A, §B): what the model asks with, what an answer
 * may be, and the answer in words. No server code: the engine, the answer
 * route and the card read these.
 */

/** The engine's own tool for a question card: never a registry row, never shown. */
export const ASK_TOOL = 'ask_question';

/** A run asks at most this many questions (§B; chat_asks.position 1–4). */
export const MAX_ASKS_PER_RUN = 4;

/** The longest answer typed in Other… or the composer. */
export const ANSWER_MAX = 500;

/** What the model asks with: 2–4 options, exactly one Recommended (00417's rule too). */
export const askToolInput = z
  .object({
    // 200, as its step's label keeps it once answered (chat_asks takes 300).
    question: z.string().trim().min(1).max(200).describe('The question, in the person’s language.'),
    options: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(120),
          detail: z
            .string()
            .trim()
            .max(200)
            .optional()
            .describe('Why it fits, from the data: "Cited 18 times for pricing prompts".'),
          recommended: z.boolean().optional(),
        }),
      )
      .min(2)
      .max(4),
    allow_other: z.boolean().optional().describe('An "Other…" row the person types into.'),
    multi: z.boolean().optional().describe('Several options may be picked.'),
    then: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('What comes after the answer: "Then I’ll write the FAQ draft".'),
  })
  .refine((input) => input.options.filter((option) => option.recommended).length === 1, {
    message: 'Mark exactly one option recommended.',
    path: ['options'],
  });
export type AskToolInput = z.output<typeof askToolInput>;

/** An answer as chat_asks.answer_json keeps it. */
export interface AskAnswer {
  /** The options picked, by place. */
  selected: number[];
  /** The text typed in Other… or sent from the composer. */
  other: string | null;
  skipped: boolean;
  via: 'card' | 'composer';
}

/** POST /api/chat/runs/{id}/answer: the card's step and the answer. */
export const askAnswerInput = z.object({
  n: z.number().int().min(1),
  selected: z.array(z.number().int().min(0).max(3)).max(4).default([]),
  other: z.string().trim().max(ANSWER_MAX).nullish(),
  skipped: z.boolean().default(false),
  via: z.enum(['card', 'composer']).default('card'),
});

/** The question an answer is checked against. */
export interface AskShape {
  options: Pick<ChatAskOption, 'label' | 'recommended'>[];
  allowOther: boolean;
  multi: boolean;
}

/**
 * Whether an answer fits its question: skipped with nothing picked; else
 * options it has, each once, one only unless several may be picked, and
 * Other only where the card offers it, or from the composer, whose message
 * answers any question (§A item 8).
 */
export function answerFits(ask: AskShape, answer: AskAnswer): boolean {
  if (answer.skipped) return answer.selected.length === 0 && !answer.other;
  if (answer.selected.some((i) => i >= ask.options.length)) return false;
  if (new Set(answer.selected).size !== answer.selected.length) return false;
  const picks = answer.selected.length + (answer.other ? 1 : 0);
  if (picks === 0 || (!ask.multi && picks > 1)) return false;
  return !answer.other || ask.allowOther || answer.via === 'composer';
}

/** A label as typed: case, accents, Turkish dotted and dotless i, and spacing aside. */
const folded = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A message from the composer as an answer (§A item 8): an option's label
 * as typed (the ghost text, after Tab) picks that option; any other text is
 * the Other answer, which also answers the rest asked with it.
 */
export function composerAnswer(
  ask: Pick<AskShape, 'options'>,
  text: string,
): { selected: number[]; other: string | null; skipped: false } {
  const typed = text.trim();
  const i = ask.options.findIndex((option) => folded(option.label) === folded(typed));
  return i >= 0
    ? { selected: [i], other: null, skipped: false }
    : { selected: [], other: typed, skipped: false };
}

/** The Recommended option's label: what a skipped question goes on with (§A item 7). */
export function recommendedLabel(ask: Pick<AskShape, 'options'>): string {
  return (ask.options.find((option) => option.recommended) ?? ask.options[0]).label;
}

/**
 * The answer in words, for its collapsed line (§A item 10): the labels
 * picked and the text typed, joined with ", "; a skipped one in the
 * caller's words ("Skipped · used /pricing").
 */
export function answerWords(
  ask: Pick<AskShape, 'options'>,
  answer: AskAnswer,
  skipped: (option: string) => string,
): string {
  if (answer.skipped) return skipped(recommendedLabel(ask));
  return [
    ...answer.selected.map((i) => ask.options[i]?.label).filter(Boolean),
    ...(answer.other ? [answer.other] : []),
  ].join(', ');
}
