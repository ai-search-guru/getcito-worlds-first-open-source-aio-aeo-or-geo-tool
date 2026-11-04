import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { AGENT_PROVIDER_OPTIONS, buildAgentModel } from '@/lib/agent/model';
import { chatModelId, type AiProvider } from '@/lib/agent/providers';
import { resolveChatModelKey, type ChatKeySource } from './key';
import { ownKeyFailure } from './keyHealth';

/**
 * The models a Chat run calls (CHAT-16 items 5 and 23). Auto, the default:
 * Claude Haiku 5.5 reads (picks and runs the reads), Claude Sonnet 5.5
 * writes (the answer and any change). On GetCito's key, or the workspace's
 * own Anthropic key, the run has both phases; on another provider's own key
 * one model does both, in one phase. The key comes from key.ts. Server only.
 *
 * Claude 5.5's Messages API (as #1743 found for the Content Editor):
 *   - no temperature, top_p or top_k: it turns sampling settings away, so
 *     none is ever passed;
 *   - no forced tool_choice: Sonnet 5.5 answers a forced one with a 400, so
 *     tools are always `auto` and a structured answer uses native structured
 *     output (output_config.format), never the SDK's forced "json" tool;
 *   - max_tokens always sent: the SDK doesn't know 5.5 and would send 4,096,
 *     and 5.5's thinking, on by default, counts toward it.
 */

/** Which half of a run a model step is: reading the data, or writing the answer and changes. */
export type ChatPhase = 'read' | 'write';

/** Claude Haiku 5.5: the API's id, and the price catalog's (C1, server modelPrices.js AUTO_MIX). */
export const AUTO_READ_MODEL = { api: 'claude-haiku-5-5', catalog: 'anthropic/claude-haiku-5.5' };
/** Claude Sonnet 5.5. */
export const AUTO_WRITE_MODEL = {
  api: 'claude-sonnet-5-5',
  catalog: 'anthropic/claude-sonnet-5.5',
};

/** A reading step's most output tokens, thinking included: it picks reads, it doesn't write. */
export const READ_MAX_OUTPUT_TOKENS = 8_000;
/** A writing step's: the answer, or a page's draft. */
export const WRITE_MAX_OUTPUT_TOKENS = 16_000;

type ProviderOptions = Record<string, Record<string, string | number | boolean | null>>;

/** One step's model and how it is called. */
export interface ChatModelChoice {
  model: LanguageModel;
  /** The id the AI budget prices it by ("anthropic/claude-sonnet-5.5"). */
  budgetModel: string;
  maxOutputTokens: number;
  /** Per provider; for Claude, native structured output. Never sampling settings. */
  providerOptions: ProviderOptions;
  /** A first-party Claude model: the read phase ends with a structured answer. */
  claude: boolean;
}

export interface ChatModels {
  /** Whose key the steps run on: the budget meters GetCito's. */
  source: ChatKeySource;
  /** The key's provider, for its errors' words (AGENT-OWN-KEY §5.2). */
  provider: AiProvider;
  /**
   * The workspace's own key was marked failing when the run started
   * (00440): the run's first answered call marks it working again.
   */
  keyFailing: boolean;
  /** `auto`: Haiku reads, Sonnet writes; `single`: one model does both, in one phase. */
  phases: 'auto' | 'single';
  pick(phase: ChatPhase): ChatModelChoice;
}

/** Claude's call settings: native structured output when a step asks for JSON. */
const CLAUDE_OPTIONS: ProviderOptions = {
  anthropic: { structuredOutputMode: 'outputFormat' },
};

/** Auto on an Anthropic key: Haiku 5.5 reads, Sonnet 5.5 writes. */
export function autoModels(apiKey: string, source: ChatKeySource): ChatModels {
  const anthropic = createAnthropic({ apiKey });
  const read: ChatModelChoice = {
    model: anthropic(AUTO_READ_MODEL.api),
    budgetModel: AUTO_READ_MODEL.catalog,
    maxOutputTokens: READ_MAX_OUTPUT_TOKENS,
    providerOptions: CLAUDE_OPTIONS,
    claude: true,
  };
  const write: ChatModelChoice = {
    model: anthropic(AUTO_WRITE_MODEL.api),
    budgetModel: AUTO_WRITE_MODEL.catalog,
    maxOutputTokens: WRITE_MAX_OUTPUT_TOKENS,
    providerOptions: CLAUDE_OPTIONS,
    claude: true,
  };
  return {
    source,
    provider: 'anthropic',
    keyFailing: false,
    phases: 'auto',
    pick: (phase) => (phase === 'read' ? read : write),
  };
}

/**
 * The run's models, from the key it runs on (resolveChatModelKey); null when
 * the workspace has no key Chat may use. Throws OwnKeyUnreadableError when
 * the workspace's own key can't be read. On the own key, its health is read
 * once here (a read that fails reads as working).
 */
export async function resolveChatModels(organizationId: string): Promise<ChatModels | null> {
  const key = await resolveChatModelKey(organizationId);
  if (!key) return null;
  const keyFailing =
    key.source === 'own' && (await ownKeyFailure(organizationId).catch(() => null)) !== null;
  if (key.config.provider === 'anthropic') {
    return { ...autoModels(key.config.apiKey, key.source), keyFailing };
  }
  // Another provider's own key: its model, as Settings › AI Providers names it, does both.
  const single: ChatModelChoice = {
    model: buildAgentModel(key.config),
    budgetModel: `${key.config.provider}/${chatModelId(key.config.provider, key.config.settings)}`,
    maxOutputTokens: WRITE_MAX_OUTPUT_TOKENS,
    providerOptions: AGENT_PROVIDER_OPTIONS,
    claude: false,
  };
  return {
    source: key.source,
    provider: key.config.provider,
    keyFailing,
    phases: 'single',
    pick: () => single,
  };
}

/**
 * A step's prompt in tokens, counted up (about 3 characters to a token, where
 * English averages 4): the budget's hold assumes the most it could be.
 */
export function estimateInputTokens(parts: readonly unknown[]): number {
  let chars = 0;
  for (const part of parts) {
    chars += typeof part === 'string' ? part.length : (JSON.stringify(part ?? null)?.length ?? 0);
  }
  return Math.ceil(chars / 3);
}
