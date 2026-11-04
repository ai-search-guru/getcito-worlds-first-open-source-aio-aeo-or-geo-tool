/**
 * Following a content generation job to its end, for callers that started
 * one and want its outcome ("Suggest content" in the prompts table). The
 * server calls are passed in, so the waiting rules are tested without a
 * server.
 */

import type { ApiFailure } from '@/lib/apiFailure';
import type {
  GenerationJobStatus,
  OnDemandRequest,
  OnDemandResult,
  PromptSuggestionResult,
} from '@/lib/actions/content';

export type ContentJobOutcome =
  | { kind: 'completed'; result: NonNullable<GenerationJobStatus['result']> }
  | { kind: 'failed'; reason: string | null }
  /** Still running when we stopped waiting: it may yet finish. */
  | { kind: 'timeout' };

export async function waitForContentJob(
  jobId: string,
  {
    getStatus,
    intervalMs = 3000,
    timeoutMs = 3 * 60 * 1000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  }: {
    getStatus: (jobId: string) => Promise<GenerationJobStatus>;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<ContentJobOutcome> {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    // A status the reader can't get ('not_found', or a call that throws) is
    // a blip: keep waiting.
    const status = await getStatus(jobId).catch(() => null);
    if (!status) continue;
    if (status.status === 'completed') {
      return { kind: 'completed', result: status.result ?? { generated: 0 } };
    }
    if (status.status === 'failed') return { kind: 'failed', reason: status.failedReason };
  }
  return { kind: 'timeout' };
}

/** How one prompt's "Suggest content" ended (PROMPT-006). */
export type PromptSuggestionOutcome =
  | { kind: 'created'; opportunityId: string }
  /** An open opportunity already answers the prompt; nothing was written. */
  | { kind: 'existing'; opportunityId: string }
  /** The month's quota is used up. */
  | { kind: 'limited' }
  /** Nothing to write from yet: the prompt isn't grouped or has no answers. */
  | { kind: 'nothing' }
  /** `failure` says why when the API answered, for the toast (BUG-001). */
  | { kind: 'failed'; message: string | null; failure?: ApiFailure }
  /** Still being written when we stopped waiting. */
  | { kind: 'timeout' };

/**
 * Asks for one prompt's content suggestion and follows it to its end. Never
 * throws: whatever goes wrong on the way comes back as `failed`.
 */
export async function suggestForPrompt(
  promptId: string,
  {
    start,
    getStatus,
    newKey = () => crypto.randomUUID(),
    ...waiting
  }: {
    start: (promptId: string, idempotencyKey: string) => Promise<PromptSuggestionResult>;
    getStatus: (jobId: string) => Promise<GenerationJobStatus>;
    newKey?: () => string;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PromptSuggestionOutcome> {
  try {
    const started = await start(promptId, newKey());
    if (!started.ok) {
      return started.quotaExhausted
        ? { kind: 'limited' }
        : { kind: 'failed', message: started.error, failure: started.failure };
    }
    if ('existingId' in started) return { kind: 'existing', opportunityId: started.existingId };

    const outcome = await waitForContentJob(started.jobId, { getStatus, ...waiting });
    if (outcome.kind === 'failed') return { kind: 'failed', message: outcome.reason };
    if (outcome.kind === 'timeout') return { kind: 'timeout' };
    const { opportunityIds, existingId, limited } = outcome.result;
    if (opportunityIds?.[0]) return { kind: 'created', opportunityId: opportunityIds[0] };
    // Covered while the job ran, e.g. once the prompt was regrouped.
    if (existingId) return { kind: 'existing', opportunityId: existingId };
    return limited ? { kind: 'limited' } : { kind: 'nothing' };
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : null };
  }
}

/** How one page's "Suggest content" ended (AT-006 part B3). */
export type PageSuggestionOutcome =
  | Exclude<PromptSuggestionOutcome, { kind: 'nothing' }>
  /** No tracked prompt is about the page: nothing to write from. */
  | { kind: 'noMatch' }
  /** The page's prompts have nothing to write from yet, e.g. no answers. */
  | { kind: 'nothing' };

/**
 * Asks for one page's content suggestion and follows it to its end, as
 * suggestForPrompt does for a prompt. Never throws: whatever goes wrong on
 * the way comes back as `failed`.
 */
export async function suggestForPage(
  brandId: string,
  pagePath: string,
  {
    start,
    getStatus,
    newKey = () => crypto.randomUUID(),
    ...waiting
  }: {
    start: (request: OnDemandRequest) => Promise<OnDemandResult>;
    getStatus: (jobId: string) => Promise<GenerationJobStatus>;
    newKey?: () => string;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PageSuggestionOutcome> {
  try {
    const started = await start({ brandId, count: 1, pagePath, idempotencyKey: newKey() });
    if (!started.ok) {
      return started.quotaExhausted
        ? { kind: 'limited' }
        : { kind: 'failed', message: started.error, failure: started.failure };
    }

    const outcome = await waitForContentJob(started.jobId, { getStatus, ...waiting });
    if (outcome.kind === 'failed') return { kind: 'failed', message: outcome.reason };
    if (outcome.kind === 'timeout') return { kind: 'timeout' };
    const { opportunityIds, existingId, limited, noMatch } = outcome.result;
    if (opportunityIds?.[0]) return { kind: 'created', opportunityId: opportunityIds[0] };
    if (existingId) return { kind: 'existing', opportunityId: existingId };
    if (noMatch) return { kind: 'noMatch' };
    return limited ? { kind: 'limited' } : { kind: 'nothing' };
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : null };
  }
}
