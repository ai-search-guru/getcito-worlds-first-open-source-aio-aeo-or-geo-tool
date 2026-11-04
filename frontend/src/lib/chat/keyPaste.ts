/**
 * An API key pasted into Chat's composer (CHAT-16, W4-05). A message that
 * holds one is never sent: it would reach the model, the chat's history and
 * the run's records. The composer says so and offers to take the key out
 * (or, on Enterprise for an Admin, to save it securely in Settings › AI
 * Providers); the run routes refuse such a message as well, without logging
 * it. Pure: no network, no storage.
 */

/** A key's provider, as its prefix tells it. */
export type PastedKeyProvider = 'anthropic' | 'openrouter' | 'openai' | 'google';

/**
 * Each provider's key shape, most specific first: Anthropic's sk-ant-,
 * OpenRouter's sk-or-v1- (hex), OpenAI's sk-proj- and plain sk-, Google's
 * AIza. Long enough that a word never reads as one; a plain sk- one also
 * has a digit and a capital letter, as a random key does and a page's slug
 * ("/sk-guide-to-ai-search-in-2026") doesn't.
 */
const KEY_SHAPES: readonly {
  provider: PastedKeyProvider;
  pattern: RegExp;
  random?: boolean;
}[] = [
  { provider: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { provider: 'openrouter', pattern: /\bsk-or-v1-[0-9a-f]{32,}/g },
  { provider: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, random: true },
  { provider: 'google', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
];

/** A key's random part has a digit and a capital letter. */
const looksRandom = (key: string) => /[0-9]/.test(key) && /[A-Z]/.test(key);

/** Every key-shaped match of one shape in the text. */
function matchesOf(text: string, shape: (typeof KEY_SHAPES)[number]): string[] {
  return [...text.matchAll(shape.pattern)]
    .map((m) => m[0])
    .filter((key) => !shape.random || looksRandom(key));
}

/** The first key in the text and its provider; null when it holds none. */
export function pastedKeyOf(text: string): { provider: PastedKeyProvider; key: string } | null {
  for (const shape of KEY_SHAPES) {
    const [key] = matchesOf(text, shape);
    if (key) return { provider: shape.provider, key };
  }
  return null;
}

/** Whether the text holds something shaped like an API key. */
export function looksLikeApiKey(text: string): boolean {
  return pastedKeyOf(text) !== null;
}

/** The text with every key taken out, its spaces tidied. */
export function withoutApiKeys(text: string): string {
  let rest = text;
  for (const shape of KEY_SHAPES) {
    for (const key of matchesOf(rest, shape)) rest = rest.split(key).join('');
  }
  return rest
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

/** Whether a request body's text field holds an API key: the run routes refuse it unread. */
export function bodyHasApiKey(body: unknown, field: string): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && looksLikeApiKey(value);
}
