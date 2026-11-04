import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { chatModelId, type AiProvider, type AiProviderSettings } from './providers';

/** A provider SDK's language model — each of them builds the same kind. */
export type AgentModel = ReturnType<ReturnType<typeof createOpenAI>>;

/**
 * OpenAI's Responses API (and Azure's) stores each response by default, and
 * saved turns would then go back as references to those stored items rather
 * than as text: a key from another project, an expired item or zero data
 * retention fails the thread with "item not found". The app keeps the whole
 * history itself.
 */
export const AGENT_PROVIDER_OPTIONS = {
  openai: { store: false },
  azure: { store: false },
};

/** The provider, key and settings Chat calls a model with. */
export interface AgentModelConfig {
  provider: AiProvider;
  apiKey: string;
  settings: AiProviderSettings;
}

/**
 * Builds the in-product agent's LLM with the caller-supplied API key.
 *
 * The key is request-scoped: on cloud each org brings its own key for the
 * provider it picked in Settings › AI Providers, and the chat route resolves
 * it per turn via `resolveAgentModelConfig(orgId)`; self-host passes the
 * operator's env Anthropic key.
 *
 * Anthropic's default (claude-sonnet-5) matches the tracking flow's Claude
 * option so behavior + cost shape stay consistent across the product.
 */
export function buildAgentModel({ provider, apiKey, settings }: AgentModelConfig): AgentModel {
  const model = chatModelId(provider, settings);
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'azure':
      // The resource's own endpoint (checked against Azure's hosts when it
      // was saved); the SDK adds /v1 and calls the deployment by name.
      return createAzure({ apiKey, baseURL: `${settings.endpoint}/openai` })(model);
    case 'openrouter':
      // OpenRouter speaks Chat Completions, not OpenAI's default Responses API.
      return createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      }).chat(model);
  }
}
