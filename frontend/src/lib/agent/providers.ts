/**
 * The AI providers an organization can add a key for in Settings › AI
 * Providers, and what each needs besides the key. Shared by the settings
 * route, Chat and the settings form — no SDK imports here.
 */

export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'azure', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** What a provider keeps besides the key: Azure's endpoint and deployment, a model. */
export interface AiProviderSettings {
  endpoint?: string;
  deployment?: string;
  model?: string;
}

/** The model Chat uses when the settings name none (Azure uses its deployment). */
export const DEFAULT_MODELS: Record<Exclude<AiProvider, 'azure' | 'openrouter'>, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.5',
  google: 'gemini-3.5-flash',
};

/** An OpenRouter model id, shown as the example: they name the model's maker. */
export const OPENROUTER_MODEL_EXAMPLE = 'openai/gpt-5.5';

/** Hosts an Azure OpenAI endpoint may be on — the ones @ai-sdk/azure treats as Azure. */
const AZURE_HOSTS = ['.openai.azure.com', '.services.ai.azure.com', '.cognitiveservices.azure.com'];

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const DEPLOYMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

/** An Azure OpenAI endpoint as its https origin, or null when it isn't one. */
export function azureEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  return AZURE_HOSTS.some((host) => url.hostname.endsWith(host)) ? url.origin : null;
}

export type SettingsError = 'endpoint' | 'deployment' | 'model';

/**
 * The settings a provider keeps, read from a request body: only its own
 * fields, trimmed. An error names the field that is missing or malformed.
 */
export function parseProviderSettings(
  provider: AiProvider,
  raw: unknown,
): { settings: AiProviderSettings } | { error: SettingsError } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? input[key].trim() : '');

  if (provider === 'azure') {
    const endpoint = azureEndpoint(text('endpoint'));
    if (!endpoint) return { error: 'endpoint' };
    const deployment = text('deployment');
    if (!DEPLOYMENT.test(deployment)) return { error: 'deployment' };
    return { settings: { endpoint, deployment } };
  }

  const model = text('model');
  // OpenRouter has no default: its ids name the model's maker.
  if (provider === 'openrouter' && !model.includes('/')) return { error: 'model' };
  if (!model) return { settings: {} };
  // Some SDKs put the id in the URL's path (Gemini): no `..`, and a `/` only
  // where OpenRouter's ids need one.
  if (!MODEL_ID.test(model) || model.includes('..')) return { error: 'model' };
  if (provider !== 'openrouter' && model.includes('/')) return { error: 'model' };
  return { settings: { model } };
}

/** The model Chat calls for a provider and its settings. */
export function chatModelId(provider: AiProvider, settings: AiProviderSettings): string {
  if (provider === 'azure') return settings.deployment ?? '';
  if (provider === 'openrouter') return settings.model ?? '';
  return settings.model || DEFAULT_MODELS[provider];
}
