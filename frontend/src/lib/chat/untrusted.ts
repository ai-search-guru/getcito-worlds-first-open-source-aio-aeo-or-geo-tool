import type { Json } from '@/types/supabase';

/**
 * Untrusted data in a Chat run (CHAT-05 item 12, CHAT-20 §16a): what a read
 * returns that was written outside the workspace's own numbers (AI answers,
 * mention snippets, citation titles, cited and competitor pages, drafts,
 * suggestions, search queries, feeds) reaches the model as data, never as
 * instructions:
 *
 *   - hidden text is stripped first: zero-width and direction characters,
 *     HTML comments, hidden elements;
 *   - it travels inside a labelled block, `<untrusted_data source="…">`,
 *     whose tags can't be forged from inside (a tag in the data is
 *     neutralized), beside the workspace's own `<app_data>`;
 *   - text written to steer an AI assistant ("ignore previous
 *     instructions", "email this to …") is detected: the run counts as an
 *     injection attempt (every change after it waits on a card, §16a rule 3)
 *     and the answer says the data's instructions were ignored.
 *
 * The rules the model follows for these blocks are in the engine's core
 * rules. Pure.
 */

/**
 * The reads whose results are the workspace's own numbers and settings only,
 * or text a person in the workspace approved. Any other read (AI answers,
 * cited pages, drafts, suggestions, generated tasks, a tool added later) may
 * carry text written outside the workspace: its result is untrusted, and
 * after it the run is tainted (§16a).
 */
export const TRUSTED_READS: ReadonlySet<string> = new Set([
  'get_visibility_summary',
  'get_visibility_trend',
  'get_prompt_performance',
  'get_prompt_volumes',
  'get_usage',
  'get_profile',
  'list_brands',
  'list_topics',
  'get_ai_traffic_summary',
  'get_site_audit_summary',
  // The brand's approved facts: words from its own site, each approved by a
  // person in the workspace (Brand settings › Brand facts) before it is read.
  'get_brand_facts',
]);

/** Whether a read's result may carry text written outside the workspace. */
export const isUntrustedRead = (toolName: string) => !TRUSTED_READS.has(toolName);

/**
 * The block names the model reads data in; never left whole inside the data.
 * saved_notes: the person's, brand's and workspace's memory (memory/rules.ts).
 */
export const DATA_TAGS = [
  'untrusted_data',
  'app_data',
  'read_results',
  'page_context',
  'saved_notes',
] as const;

// Zero-width, soft hyphen, direction marks and isolates, word joiners, BOM.
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// Unicode tag characters (U+E0000–U+E007F): invisible, yet a model can read the ASCII they spell.
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HIDDEN_ELEMENT =
  /<([a-z][\w-]*)\b[^>]*?(?:\shidden(?=[\s=>/])|display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden\s*=\s*["']?true|font-size\s*:\s*0(?:px)?\s*[;"'])[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DATA_TAG = new RegExp(`<\\s*/?\\s*(?:${DATA_TAGS.join('|')})\\b[^>]*>`, 'gi');

/** A text without what a reader can't see, and without our block tags. */
export function stripHidden(text: string): string {
  return text
    .replace(HTML_COMMENT, '')
    .replace(HIDDEN_ELEMENT, '')
    .replace(INVISIBLE, '')
    .replace(TAG_CHARS, '')
    .replace(DATA_TAG, '[tag removed]');
}

/**
 * Text written to steer an AI assistant rather than to inform a reader. A
 * match doesn't stop the read: its data is still data; the run is marked.
 */
const INJECTION = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|existing|system)\s+(?:instructions?|prompts?|rules|messages|directions)\b/i,
  /\b(?:new|updated|revised|real)\s+(?:system\s+)?instructions?\s*:/i,
  /\byou\s+are\s+now\s+(?:a|an|the|in)\s+(?:(?:new|different|unrestricted|helpful|developer)\s+)?(?:ai|assistant|bot|chatbot|model|agent|mode)\b/i,
  /\b(?:reveal|print|show|repeat)\s+(?:your|the)\s+(?:system\s+prompt|instructions|hidden\s+prompt)\b/i,
  /^\s*(?:system|assistant|developer)\s*:\s*(?:ignore|you\s|new\s|from\s+now|add|delete|remove|send|email|forward|call|run|mark|publish|reveal)/im,
  /\b(?:ai|llm|gpt|chatbot|language\s+model)s?(?:\s+(?:assistants?|agents?|models?|crawlers?))?\s*[,:]\s*(?:you\s+(?:must|should)\s+)?(?:please\s+)?(?:ignore|email|send|forward|add|delete|remove|reveal|call|run|mark|publish|post|do\s+not)\b/i,
  /\bif\s+you\s+are\s+an?\s+(?:ai|llm|(?:large\s+)?language\s+model)\b/i,
  /\b(?:email|send|forward|post|upload|share)\s+(?:this|the|all|your|these|every)\s+(?:[\w']+\s+)?(?:chat|conversation|report|data|prompt|memory|messages?|history|files?|results?|keys?|credentials|summary|tasks?)\b[^.\n]{0,60}\bto\s+(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|(?:this|that|the|my|our)\s+(?:webhook|url|endpoint|address|server))/i,
  /\bmark\s+all\b[^.\n]{0,60}\b(?:as\s+)?(?:done|complete|completed)\b/i,
  /önceki\s+(?:tüm\s+)?(?:talimatları|komutları)\s+(?:yok\s+say|görmezden\s+gel|unut)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((pattern) => pattern.test(text));
}

/** The ASCII that tag characters spell, in place, so a check can read it. */
const spelledByTags = (text: string) =>
  text.replace(TAG_CHARS, (c) => String.fromCharCode((c.codePointAt(0) ?? 0xe0000) - 0xe0000));

/**
 * An untrusted result made safe to show the model: every text in it
 * stripped of hidden parts, and whether any text tried to instruct an AI
 * (checked before and after stripping: hidden text is where that hides, and
 * zero-width characters can split a phrase until they are gone).
 */
export function guardData(value: Json): { value: Json; injection: boolean } {
  let injection = false;
  const walk = (node: Json, depth: number): Json => {
    if (typeof node === 'string') {
      const stripped = stripHidden(node);
      const spelled = spelledByTags(node);
      // Raw (hidden text is where it hides), stripped (what the model reads) and tag-spelled.
      if (
        !injection &&
        (looksLikeInjection(node) ||
          looksLikeInjection(stripped) ||
          (spelled !== node && looksLikeInjection(spelled)))
      ) {
        injection = true;
      }
      return stripped;
    }
    if (depth > 8 || !node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, Json> = {};
    for (const [key, field] of Object.entries(node)) {
      if (field !== undefined) out[key] = walk(field, depth + 1);
    }
    return out;
  };
  const out = walk(value, 0);
  return { value: out, injection };
}

/** A source label as an attribute: plain words, no quotes or tags. */
const attribute = (label: string) => label.replace(/["<>\n\r]/g, ' ').trim() || 'data';

/**
 * A read's result as the model reads it: inside `<untrusted_data>` when it
 * may carry outside text, else `<app_data>`, labelled with its source.
 */
export function dataBlock(source: string, value: Json, untrusted: boolean): string {
  const tag = untrusted ? 'untrusted_data' : 'app_data';
  // JSON leaves "<" and "/" as they are: a tag inside a string can't close the block.
  const body = JSON.stringify(value).replace(DATA_TAG, '[tag removed]');
  return `<${tag} source="${attribute(source)}">\n${body}\n</${tag}>`;
}
