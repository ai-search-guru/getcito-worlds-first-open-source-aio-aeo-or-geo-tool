/**
 * GA4 session-source classification (#704, AT-004).
 *
 * Two signals, as spec §5.1 asks:
 *
 *   - The AI source list (aiSources.js), shared with the tracking snippet: a
 *     listed host or one of its subdomains, or an exact alias. One engine
 *     arrives under several source strings — `chatgpt.com`, `chatgpt` and
 *     `openai` are the same product — and the list collapses them without
 *     guessing. It also covers history from before GA4 had a channel for AI.
 *   - GA4's own "AI Assistant" channel (May 2026; Default Channel Group
 *     definitions: medium exactly "ai-assistant"). It needs no setup in the
 *     customer's property and catches assistants the list doesn't know yet.
 *
 * Values are the same host-style keys the snippet records in
 * ai_traffic_logs.source_platform, so the two origins name the same engine
 * the same way. They are still never summed — matching names is for
 * comparison and for choosing one origin per day, never for adding.
 */

import { aiSourcePattern, classifyAiSource, normalizeSource } from './aiSources.js';

/** GA4's channel for sessions from AI assistants, in sessionDefaultChannelGroup. */
export const GA_AI_ASSISTANT_CHANNEL = 'AI Assistant';

/** Every session source worth asking GA4 for, as one RE2 pattern. */
export const GA_AI_SOURCE_PATTERN = aiSourcePattern({ origin: 'analytics' });

/** GA4's own placeholders for a session without a source. */
const NO_SOURCE = new Set(['', '(not set)', '(direct)', '(none)']);

/**
 * The platform behind a raw GA4 source string, or null when unrecognised.
 * Unrecognised is a normal outcome — the caller stores the raw value so the
 * list can grow from what customers actually receive.
 */
export function classifyGaSource(raw) {
  return classifyAiSource(raw, { origin: 'analytics' });
}

/**
 * The platform a GA4 AI-traffic row is stored under: the list's key when the
 * source is on it; for a session GA4 put in its AI Assistant channel but the
 * list doesn't know yet, the source itself (normalized), so a new assistant
 * shows under its own name instead of vanishing. Null otherwise.
 */
export function gaAiPlatform(source, channel) {
  const known = classifyGaSource(source);
  if (known) return known;
  if (channel !== GA_AI_ASSISTANT_CHANNEL) return null;
  const value = normalizeSource(source);
  return NO_SOURCE.has(value) ? null : value;
}
