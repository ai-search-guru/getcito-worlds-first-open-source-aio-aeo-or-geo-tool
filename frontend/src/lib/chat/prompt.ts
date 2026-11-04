import type { ModelMessage, SystemModelMessage } from 'ai';

/**
 * A model step's prompt, ordered for the prompt cache (CHAT-04 §D items
 * 21–25). From what changes least to what changes every request:
 *
 *   1. the tools and the phase's core rules: the same for every workspace,
 *      until a release (cache mark 1, on the core system block; the tools
 *      render before the system, so the mark covers them too);
 *   2. the workspace block: the person's role, the plan, the chat's brand,
 *      what isn't available to them, the skills they may use (cache mark 2);
 *      then the bodies of the skills loaded for this run, below the system
 *      rules (CHAT-13 item 6), unmarked: they change within a run;
 *   3. the chat so far: its summary and recent turns, which only grow at the
 *      end (cache mark 3, on its last message; the writing model only);
 *   4. this turn: the day, the question, what was read, and the step's own
 *      calls and results (cache mark 4, on the last of those, once there
 *      are any: a run that goes on reads them back).
 *
 * Nothing volatile goes before (4): no time, no request id, no usage, and
 * the tools in a fixed order. Anthropic takes at most four marks a request;
 * a mark is the AI SDK's `providerOptions.anthropic.cacheControl`, 5-minute
 * ephemeral (verified against @ai-sdk/anthropic 3.0.81's docs and its
 * CacheControlValidator). A prefix under the model's minimum (512 tokens on
 * Claude Sonnet 5.5 and Haiku 5.5) isn't cached and costs nothing extra.
 * Only a Claude step gets marks; another provider's ignores Anthropic's
 * options, so it gets the same order without them. A one-shot step (a
 * scheduled job's single call) gets none: nothing would read it back (§D
 * item 25). Pure.
 */

/** Anthropic's prompt-cache mark: the default 5-minute cache (§D item 26). */
export const CACHE_MARK = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

/** The most marks one request may carry (Anthropic's limit). */
export const MAX_CACHE_MARKS = 4;

export interface StepPromptParts {
  /** (1) The phase's core rules: no workspace, person or time in them. */
  core: string;
  /** (2) The workspace block. */
  workspace: string;
  /** (2b) The loaded skills' block, when a skill is loaded (CHAT-13 item 6). */
  skills?: string;
  /** (3) The chat so far, oldest first; empty for the reading model. */
  history: ModelMessage[];
  /** (4) This turn's message from the person: the day, the question, what was read. */
  turn: ModelMessage;
  /** (4) The step's calls and results so far in this phase. */
  steps: ModelMessage[];
  /** Mark the cache: a Claude step that more steps or turns will read back. */
  cache: boolean;
}

const marked = <T extends ModelMessage | SystemModelMessage>(message: T): T => ({
  ...message,
  providerOptions: { ...message.providerOptions, ...CACHE_MARK },
});

/**
 * The step's system blocks and messages, in cache order, with its marks.
 * Copies: the run's own messages (kept between requests) never carry a mark.
 */
export function stepPrompt(parts: StepPromptParts): {
  system: SystemModelMessage[];
  messages: ModelMessage[];
  marks: number;
} {
  const core: SystemModelMessage = { role: 'system', content: parts.core };
  const workspace: SystemModelMessage = { role: 'system', content: parts.workspace };
  const skills: SystemModelMessage[] = parts.skills
    ? [{ role: 'system', content: parts.skills }]
    : [];
  if (!parts.cache) {
    return {
      system: [core, workspace, ...skills],
      messages: [...parts.history, parts.turn, ...parts.steps],
      marks: 0,
    };
  }
  const history = [...parts.history];
  const steps = [...parts.steps];
  let marks = 2;
  if (history.length > 0) {
    history[history.length - 1] = marked(history[history.length - 1]);
    marks += 1;
  }
  if (steps.length > 0 && marks < MAX_CACHE_MARKS) {
    steps[steps.length - 1] = marked(steps[steps.length - 1]);
    marks += 1;
  }
  return {
    system: [marked(core), marked(workspace), ...skills],
    messages: [...history, parts.turn, ...steps],
    marks,
  };
}

/** The day, for this turn's message only (§D item 22: never in the prefix). */
export const todayLine = (now: Date = new Date()) => `Today is ${now.toISOString().slice(0, 10)}.`;
