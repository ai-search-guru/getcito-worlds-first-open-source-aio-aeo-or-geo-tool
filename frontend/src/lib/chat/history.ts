import type { ModelMessage } from 'ai';
import { cutText } from './fit';

/**
 * What a run sends of the chat so far (CHAT-04 items 5, 7 and 23): the
 * recent turns as they were, older ones folded into a short summary, and
 * for the reading model only a few lines. Built the same way from the same
 * messages every time, and folded four turns at a time, so the summary
 * stays the same between folds and the prompt cache keeps it (§D items
 * 21–22). No model: each older turn keeps the start of its question and of
 * its answer. Pure.
 */

/** The turns kept as they were, at least, before older ones are folded. */
export const KEEP_TURNS = 4;
/** Turns fold this many at a time, so the summary changes only every few turns. */
export const FOLD_TURNS = 4;
/** One message of a recent turn, at most. */
export const MESSAGE_CHARS = 4_000;
/** A folded turn's question and answer in the summary, at most. */
const SUMMARY_QUESTION_CHARS = 200;
const SUMMARY_ANSWER_CHARS = 300;
/** A turn in the reading model's few lines. */
const DIGEST_CHARS = 240;
/** Turns the reading model gets. */
const DIGEST_TURNS = 2;

export interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

export interface HistoryPlan {
  /** The folded turns in short, labelled as the chat's own past, or null. */
  summary: string | null;
  /** The recent turns, each message within MESSAGE_CHARS. */
  recent: ModelMessage[];
  /** For the reading model (CHAT-04 item 23): the last turns in a few lines, or null. */
  digest: string | null;
  /** Turns folded into the summary. */
  folded: number;
}

interface Turn {
  question: string;
  answer: string;
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) =>
  text.length > max ? `${cutText(text, max - 1)}…` : text;
const clipMessage = (text: string) =>
  text.length > MESSAGE_CHARS ? `${cutText(text, MESSAGE_CHARS)}\n[…shortened]` : text;

/** The rows as turns: a question and what was answered to it; answers with no question go. */
function turnsOf(rows: readonly HistoryRow[]): Turn[] {
  const turns: Turn[] = [];
  for (const row of rows) {
    if (!row.content.trim()) continue;
    if (row.role === 'user') turns.push({ question: row.content, answer: '' });
    else if (turns.length > 0) {
      const last = turns[turns.length - 1];
      last.answer = last.answer ? `${last.answer}\n\n${row.content}` : row.content;
    }
  }
  return turns;
}

const turnChars = (turn: Turn) =>
  clipMessage(turn.question).length + clipMessage(turn.answer).length;

function summaryLine(turn: Turn): string {
  const asked = clip(flat(turn.question), SUMMARY_QUESTION_CHARS);
  const answered = turn.answer ? clip(flat(turn.answer), SUMMARY_ANSWER_CHARS) : '(no answer)';
  return `- Asked: ${asked}\n  Answered: ${answered}`;
}

/**
 * The chat before this question, within `maxChars` (the run's history
 * budget): turns past the last KEEP_TURNS fold FOLD_TURNS at a time, and
 * more while the recent ones are over three quarters of the budget; the
 * summary takes the last quarter, its oldest lines left out first.
 */
export function planHistory(rows: readonly HistoryRow[], maxChars: number): HistoryPlan {
  const turns = turnsOf(rows);
  const n = turns.length;
  let folded = n > KEEP_TURNS ? Math.floor((n - KEEP_TURNS) / FOLD_TURNS) * FOLD_TURNS : 0;
  const recentBudget = Math.floor(maxChars * 0.75);
  const recentChars = () => turns.slice(folded).reduce((sum, turn) => sum + turnChars(turn), 0);
  while (folded < n - 1 && recentChars() > recentBudget) {
    folded = Math.min(n - 1, folded + FOLD_TURNS);
  }

  const recent: ModelMessage[] = [];
  for (const turn of turns.slice(folded)) {
    recent.push({ role: 'user', content: clipMessage(turn.question) });
    if (turn.answer) recent.push({ role: 'assistant', content: clipMessage(turn.answer) });
  }

  let summary: string | null = null;
  if (folded > 0) {
    // The summary's room doesn't follow the recent turns' size, so the
    // summary changes only when turns fold, and the cache keeps it.
    const room = Math.max(400, maxChars - recentBudget);
    const lines = turns.slice(0, folded).map(summaryLine);
    let length = lines.reduce((sum, line) => sum + line.length + 1, -1);
    let dropped = 0;
    while (dropped < lines.length - 1 && length > room) {
      length -= lines[dropped].length + 1;
      dropped += 1;
    }
    lines.splice(0, dropped);
    const head =
      dropped > 0
        ? `Earlier in this chat, in short (${dropped} older ${dropped === 1 ? 'turn' : 'turns'} left out):`
        : 'Earlier in this chat, in short:';
    summary = `${head}\n${lines.join('\n')}`;
  }

  const last = turns.slice(-DIGEST_TURNS);
  const digest =
    last.length > 0
      ? [
          `The chat so far${n > last.length ? ` (last ${last.length} of ${n} turns)` : ''}:`,
          ...last.map(
            (turn) =>
              `- Asked: ${clip(flat(turn.question), DIGEST_CHARS)}${
                turn.answer ? `\n  Answered: ${clip(flat(turn.answer), DIGEST_CHARS)}` : ''
              }`,
          ),
        ].join('\n')
      : null;

  return { summary, recent, digest, folded };
}

/** The history as the writing model gets it: the summary first, then the recent turns. */
export function historyMessages(plan: HistoryPlan): ModelMessage[] {
  if (!plan.summary) return plan.recent;
  return [{ role: 'user', content: plan.summary }, ...plan.recent];
}
