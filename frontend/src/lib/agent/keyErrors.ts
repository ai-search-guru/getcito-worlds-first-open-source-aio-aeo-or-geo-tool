import { APICallError, RetryError } from 'ai';
import type { AiProvider } from '@/lib/agent/providers';

/**
 * What a failed model call says about the key it ran on (AGENT-OWN-KEY §5.1):
 *
 * - `invalid`: the provider refused the key.
 * - `no_credit`: the provider's account can't pay.
 * - `model`: the key can't reach the model.
 * - `unreadable`: the saved key can't be decrypted; ours, before any call,
 *   so never an answer of classifyProviderError.
 * - `transient`: the provider is busy or down; the SDK has retried.
 * - `request`: our request, not the key.
 *
 * The first four are the key classes: the key is marked failing
 * (lib/chat/keyHealth.ts), and the agents on it stop and pause.
 */
export type ProviderErrorClass =
  'invalid' | 'no_credit' | 'model' | 'unreadable' | 'transient' | 'request';

/** The classes that say the key itself fails. */
export const KEY_FAILURE_CLASSES = ['invalid', 'no_credit', 'model', 'unreadable'] as const;
export type KeyFailureClass = (typeof KEY_FAILURE_CLASSES)[number];

export function isKeyFailureClass(value: unknown): value is KeyFailureClass {
  return (KEY_FAILURE_CLASSES as readonly unknown[]).includes(value);
}

export interface ProviderErrorVerdict {
  class: Exclude<ProviderErrorClass, 'unreadable'>;
  /** The provider's HTTP status, when it answered. */
  status: number | null;
}

/** The provider's error body: the SDK's parsed `data`, else the raw response read as JSON. */
function errorBody(error: APICallError): unknown {
  if (error.data !== undefined && error.data !== null) return error.data;
  if (!error.responseBody) return null;
  try {
    return JSON.parse(error.responseBody);
  } catch {
    return null;
  }
}

/** The words a provider's error body carries: types, codes, statuses and reasons, lower case. */
function bodyWords(body: unknown): string {
  const words: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      words.push(String(value).toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 10)) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (['type', 'code', 'status', 'reason', 'message', 'error', 'details'].includes(key)) {
          visit(item, depth + 1);
        }
      }
    }
  };
  visit(body, 0);
  return words.join(' ');
}

/** A dropped connection or a timeout, rather than an answer. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR)/.test(code)) {
    return true;
  }
  return error instanceof TypeError && /fetch failed|network/i.test(error.message);
}

/**
 * Sorts a failed model call by what it says about the key (AGENT-OWN-KEY
 * §5.1). Unwraps the AI SDK's RetryError to its last error and reads the
 * APICallError's status and body. Anything it can't read is `request`: a
 * failure that isn't the key's never pauses agents.
 */
export function classifyProviderError(provider: AiProvider, error: unknown): ProviderErrorVerdict {
  let cause = error;
  if (RetryError.isInstance(cause)) cause = cause.lastError;

  if (!APICallError.isInstance(cause)) {
    return { class: isNetworkError(cause) ? 'transient' : 'request', status: null };
  }

  const status = cause.statusCode ?? null;
  const words = bodyWords(errorBody(cause));
  const says = (...needles: string[]) => needles.some((needle) => words.includes(needle));

  if (status === null) return { class: 'transient', status };

  // OpenRouter answers 403 for its moderation flag, and 402 for credit.
  if (provider === 'openrouter') {
    if (status === 402) return { class: 'no_credit', status };
    if (status === 403) return { class: 'request', status };
  }

  if (status === 401) return { class: 'invalid', status };

  if (status === 403) {
    // Anthropic's permission_error, Google's PERMISSION_DENIED, Azure's denial.
    return { class: 'invalid', status };
  }

  if (says('insufficient_quota', 'billing_error', 'credit balance is too low')) {
    return { class: 'no_credit', status };
  }
  if (status === 402) return { class: 'no_credit', status };

  if (status === 400 && says('api_key_invalid', 'api key not valid')) {
    return { class: 'invalid', status };
  }

  if (status === 404 || says('deploymentnotfound', 'model_not_found')) {
    return { class: 'model', status };
  }

  // Google's RESOURCE_EXHAUSTED can't be told from a rate limit: transient.
  if (status === 408 || status === 409 || status === 429 || status === 529 || status >= 500) {
    return { class: 'transient', status };
  }

  return { class: 'request', status };
}
