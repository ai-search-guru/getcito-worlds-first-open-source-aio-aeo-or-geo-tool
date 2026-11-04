import { z } from 'zod';
import { MAX_API_SUGGESTIONS } from '@/lib/content/agentSuggestions';
import { DRAFT_STATUSES, PAGE_TYPES } from '@/lib/content/drafts';

/**
 * The inputs of the Content Editor's agent API (CE-022), shared by the MCP
 * tools (server.ts) and their REST mirrors under /api/mcp/content-drafts.
 */

/** Any 8-4-4-4-12 hex id: seeded ids aren't all RFC 4122 versions. */
export const contentUuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID format',
  );

/** A page address the editor takes: http(s) only, as the web actions require. */
export function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const listDraftsShape = {
  brand_id: contentUuid.describe('Brand UUID, from list_brands.'),
  status: z.enum(DRAFT_STATUSES).optional().describe('Only drafts with this status.'),
};

export const createDraftShape = {
  brand_id: contentUuid.describe('Brand UUID, from list_brands.'),
  title: z.string().min(1).max(300).describe('The page title (its H1).'),
  body_html: z.string().min(1).max(500_000).describe('The page as HTML, starting with its H1.'),
  method: z
    .enum(['create', 'optimize'])
    .default('create')
    .describe('create: a new page; optimize: a new version of the live page at source_url.'),
  page_type: z.enum(PAGE_TYPES).optional().describe('The page type; detected when omitted.'),
  source_url: z
    .string()
    .trim()
    .max(2048)
    .refine(isHttpUrl, 'source_url must be an http(s) address')
    .optional()
    .describe('For optimize: the live page, on one of the brand domains.'),
  prompt_ids: z
    .array(contentUuid)
    .max(100)
    .optional()
    .describe('Tracked prompts the page answers, from list_prompts.'),
};

export const impactDays = z
  .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)])
  .default(30)
  .describe('The period: 7, 30, 90 or 365 days.');

export const addSourceShape = {
  kind: z.enum(['prompt', 'cited_page', 'gsc_query']),
  ref: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .describe('The prompt UUID, the page address (http or https), or the query.'),
};

/** Why an add_content_source ref can't be taken for its kind, or null when it can. */
export function sourceRefError(kind: 'prompt' | 'cited_page' | 'gsc_query', ref: string) {
  if (kind === 'prompt' && !contentUuid.safeParse(ref).success) return 'ref must be a prompt UUID';
  if (kind === 'cited_page' && !isHttpUrl(ref)) return 'ref must be an http(s) page address';
  return null;
}

export const suggestionsShape = {
  suggestions: z
    .array(
      z.object({
        kind: z.enum(['replace', 'insert']),
        passage: z.number().int().min(1).describe('The passage number, from get_content_draft.'),
        before: z.string().max(5000).optional().describe('replace: the exact words to change.'),
        after: z
          .string()
          .min(1)
          .max(20_000)
          .describe(
            'replace: the new words (a heading stays one short line); insert: the HTML. Links only to link_targets URLs.',
          ),
        reason: z
          .string()
          .min(1)
          .max(300)
          .describe('Why, in a few words: "answer the fan-out …", "add a dated data point".'),
        rules: z.array(z.string().max(60)).max(20).optional().describe('Rule keys it fixes.'),
      }),
    )
    .min(1)
    .max(MAX_API_SUGGESTIONS),
};
