/**
 * Canonical platform display-name map.
 *
 * Centralized here so the insights charts, the page-level labels, and the CSV
 * export all render the same human-readable names instead of raw slugs. Always
 * look up with a fallback (`PLATFORM_LABELS[slug] ?? slug`) so unknown
 * platforms stay visible rather than disappearing.
 *
 * It also carries a few model-slug labels, because a couple of chart/progress
 * spots reuse this map to label models when no platform is available.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  // Generic platform slugs.
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
  grok: 'Grok',
  copilot: 'Microsoft Copilot',
  'meta-ai': 'Meta AI',
  'google-ai-overviews': 'Google AI Overviews',
  'google-ai-mode': 'Google AI Mode',

  // Tracked scraper platform slugs, as stored in `prompt_results.platform`.
  'chatgpt-web': 'ChatGPT',
  'chatgpt-shopping': 'ChatGPT Shopping',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Google Gemini',

  // Model slugs reused as a fallback label in a few chart/progress spots.
  'gpt-5-chat-latest': 'GPT-5',
  'gpt-5-mini': 'GPT-5 Mini',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

/**
 * Model slug → provider-level display name ("claude-sonnet-5" → "Claude").
 * Used where rows are grouped per engine and the exact model variant is
 * noise: insights, citations, prompt detail (#435 — was copy-pasted on each
 * page). Look up with a fallback chain, e.g.
 * `MODEL_PROVIDER_LABELS[slug] ?? PLATFORM_LABELS[slug] ?? slug`.
 */
export const MODEL_PROVIDER_LABELS: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-5-chat-latest': 'ChatGPT',
  'claude-sonnet-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'claude-haiku-4-5': 'Claude',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'grok-3': 'Grok',
  'grok-4-auto': 'Grok',
  'chatgpt-web': 'ChatGPT',
  'perplexity-web': 'Perplexity',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'gemini-web': 'Google Gemini',
};

/**
 * Model slug → model-level display name ("claude-sonnet-5" → "Claude Sonnet
 * 5"). Used where the model variant matters, e.g. the competitors page's
 * head-to-head badges. Only the Claude entries differ from the
 * provider-level map today; keep the two in sync when adding slugs.
 */
export const MODEL_LABELS: Record<string, string> = {
  ...MODEL_PROVIDER_LABELS,
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-6': 'Claude Opus',
  'claude-haiku-4-5': 'Claude Haiku',
};
