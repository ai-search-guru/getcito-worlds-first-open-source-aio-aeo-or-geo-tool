import {
  getAIProviderDisplayName,
  resolveAIProvider,
  type AIProviderKey,
} from '@/components/AiProviderAvatar';
import { MODEL_PROVIDER_LABELS, PLATFORM_LABELS } from '@/config/platformLabels';
import { regionLabel } from '@/lib/region';

/**
 * Human names for the platforms and locations signals store as slugs and
 * codes (AC-001/AC-002): no raw `gemini-web` or `JP` in the Action Center.
 */

// The scraped apps and the generic engine slugs, as PLATFORM_LABELS lists
// them, without its model entries.
const PLATFORM_SLUGS = new Set([
  'chatgpt-web',
  'google-aio',
  'google-aimode',
  'gemini-web',
  'perplexity-web',
  'copilot-web',
  'grok-web',
  'perplexity',
  'copilot',
  'grok',
  'meta-ai',
  'google-ai-overviews',
  'google-ai-mode',
]);

// API models tracked beside the scraped apps of the same engine: "ChatGPT
// API" next to "ChatGPT", never two plain "ChatGPT"s.
const API_PLATFORMS = new Set(['chatgpt', 'gemini', 'claude']);

const MODEL_PREFIXES = ['gpt-', 'claude-', 'gemini-', 'grok-', 'sonar', 'llama-'];

function isModel(slug: string): boolean {
  return slug in MODEL_PROVIDER_LABELS || MODEL_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

/**
 * The engine a platform or model belongs to (`gemini-web` and `gemini` are
 * both Google's Gemini), or null for a slug we don't know — the shared
 * resolver would call it ChatGPT.
 */
export function platformFamily(slug: string): AIProviderKey | null {
  if (PLATFORM_SLUGS.has(slug) || API_PLATFORMS.has(slug) || isModel(slug)) {
    return resolveAIProvider(slug);
  }
  return null;
}

/**
 * A platform's human name: `gemini-web` → "Gemini", `google-aio` → "Google AI
 * Overview". A model id (the platform-gap signal compares models) keeps the
 * id as a qualifier, `gpt-5-6` → "ChatGPT (gpt-5-6)", since two models of one
 * engine would otherwise read the same. An unknown slug stays as it is rather
 * than borrowing another engine's name.
 */
export function platformName(slug: string): string {
  const family = platformFamily(slug);
  if (!family) return PLATFORM_LABELS[slug] ?? slug;
  const name = getAIProviderDisplayName(family);
  if (PLATFORM_SLUGS.has(slug)) return name;
  if (API_PLATFORMS.has(slug)) return `${name} API`;
  return `${name} (${slug})`;
}

/** Whether a signal's place includes an engine, for the Platform filter. */
export function isOnPlatform(platforms: readonly string[], family: AIProviderKey): boolean {
  return platforms.some((slug) => platformFamily(slug) === family);
}

/** A location's human name: `US` → "United States", `US-CA` → "California". */
export function locationName(code: string): string {
  return regionLabel(code);
}

/** The label a library target shows, named for people rather than for storage. */
export function targetName(entity: string, label: string): string {
  if (entity === 'platforms') return platformName(label);
  if (entity === 'regions') return locationName(label);
  return label;
}

// The AI crawlers the site audit checks robots.txt for, by user agent.
const CRAWLER_NAMES: Record<string, string> = {
  gptbot: 'GPTBot (OpenAI)',
  'oai-searchbot': 'OAI-SearchBot (OpenAI)',
  'chatgpt-user': 'ChatGPT-User (OpenAI)',
  claudebot: 'ClaudeBot (Anthropic)',
  'anthropic-ai': 'anthropic-ai (Anthropic)',
  perplexitybot: 'PerplexityBot (Perplexity)',
  'google-extended': 'Google-Extended (Google)',
};

/** A crawler's name as its operator writes it: `gptbot` → "GPTBot (OpenAI)". */
export function crawlerName(agent: string): string {
  return CRAWLER_NAMES[agent.toLowerCase()] ?? agent;
}
