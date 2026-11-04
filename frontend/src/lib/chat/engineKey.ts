import {
  classifyProviderError,
  isKeyFailureClass,
  type KeyFailureClass,
} from '@/lib/agent/keyErrors';
import type { AiProvider } from '@/lib/agent/providers';
import type { ChatModels } from './engineModel';

/**
 * A run's model call that failed on the workspace's own key, or a provider
 * that didn't answer (AGENT-OWN-KEY §5.2): the engine ends the run with its
 * own code and words rather than "Something went wrong".
 */

/** Why the run stopped on the workspace's own key, as its progress keeps it. */
export interface RunKeyFailure {
  class: KeyFailureClass;
  provider: AiProvider;
  /** The provider's HTTP status, when it answered. */
  status: number | null;
  /** The model the key couldn't reach (`model`), as the catalog names it. */
  model: string | null;
}

/** The own key failed: the run ends `own_key`, with no second call on the same key. */
export class KeyFailureError extends Error {
  readonly failure: RunKeyFailure;

  constructor(failure: RunKeyFailure) {
    super(`The ${failure.provider} key failed: ${failure.class}`);
    this.name = 'KeyFailureError';
    this.failure = failure;
  }
}

/** The provider didn't answer after the SDK's retries: the run ends `provider_down`. */
export class ProviderDownError extends Error {
  readonly provider: AiProvider;

  constructor(provider: AiProvider, cause: unknown) {
    super(`${provider} didn't answer`, { cause });
    this.name = 'ProviderDownError';
    this.provider = provider;
  }
}

/** The model's name without its provider, as `openai/gpt-5.5` is `gpt-5.5`. */
const modelName = (budgetModel: string) => budgetModel.split('/').slice(1).join('/') || budgetModel;

/**
 * What a failed model call means for the run: a key class on the workspace's
 * own key (GetCito's key failing is ours, not the workspace's to fix), a
 * provider that didn't answer, or null for anything else (the run fails as
 * before).
 */
export function stepFailure(
  models: Pick<ChatModels, 'source' | 'provider'>,
  budgetModel: string,
  error: unknown,
): KeyFailureError | ProviderDownError | null {
  const verdict = classifyProviderError(models.provider, error);
  if (isKeyFailureClass(verdict.class)) {
    if (models.source !== 'own') return null;
    return new KeyFailureError({
      class: verdict.class,
      provider: models.provider,
      status: verdict.status,
      model: verdict.class === 'model' ? modelName(budgetModel) : null,
    });
  }
  if (verdict.class === 'transient') return new ProviderDownError(models.provider, error);
  return null;
}
