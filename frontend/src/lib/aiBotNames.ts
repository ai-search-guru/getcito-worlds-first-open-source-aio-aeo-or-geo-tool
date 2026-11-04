/**
 * How the AI bot report names each bot and type (AT-011). The keys are the
 * bot list's (backend/src/lib/ai-bots.json, AT-010): every bot there needs a
 * name here (aiBotNames.test.ts checks).
 */

export const BOT_TYPES = ['training', 'search', 'user'] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const AI_BOT_NAMES: Record<string, string> = {
  gptbot: 'GPTBot',
  'oai-searchbot': 'OAI-SearchBot',
  'chatgpt-user': 'ChatGPT-User',
  claudebot: 'ClaudeBot',
  'claude-searchbot': 'Claude-SearchBot',
  'claude-user': 'Claude-User',
  perplexitybot: 'PerplexityBot',
  'perplexity-user': 'Perplexity-User',
};

/** A bot's name, or its key when it isn't known. */
export function botName(key: string): string {
  return AI_BOT_NAMES[key] ?? key;
}
