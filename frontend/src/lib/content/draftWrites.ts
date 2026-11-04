import { z } from 'zod';
import type { createClient } from '@/lib/supabase/server';
import {
  DRAFT_ORIGINS,
  PAGE_TYPES,
  WRITING_STALE_MS,
  agentStateOf,
  type DraftStart,
} from '@/lib/content/drafts';
import { escapeHtml } from '@/lib/content/attachments';
import {
  MAX_BODY_HTML_LENGTH,
  MAX_TITLE_LENGTH,
  bodyHash,
  type SaveDraftResult,
} from '@/lib/content/editor';
import { BRAND_SITE, brandSiteType } from '@/lib/content/draftPageType';
import { detectPageType } from '@/lib/content/pageTypes';
import { sanitizeDraftHtml } from '@/lib/content/sanitizeDraftHtml';
import { matchPagePrompts } from '@/lib/content/pagePrompts';
import { startingRules } from '@/lib/content/rules';
import type { VersionOrigin } from '@/lib/content/history';

/**
 * The writes behind a new draft, an editor's save and Chat's change to a
 * draft, done with the client they are given: the signed-in member's session
 * (the server actions in lib/actions/contentDrafts.ts, under row-level
 * security), or the service role for a Chat run with no session behind it
 * (lib/chat/actor/drafts.ts, once it has checked the person). Nothing here
 * checks who calls it, the plan or the role: each caller does first. Not a
 * server action module, so none of it is callable from a browser. Server only.
 */

export type DraftClient = Awaited<ReturnType<typeof createClient>>;

const draftId = z.guid();

export const startInput = z.object({
  method: z.enum(['create', 'optimize']),
  // A prompt's text can run longer than a title: cut to fit, not refused.
  title: z.string().max(5_000),
  pageType: z.enum(PAGE_TYPES),
  typePicked: z.boolean().default(false),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['opportunity', 'prompt', 'topic']), id: z.guid() }),
    z.object({ kind: z.literal('content') }),
  ]),
  bodyHtml: z.string().max(MAX_BODY_HTML_LENGTH).optional(),
  sourceUrl: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//i)
    .optional(),
  origin: z.enum(DRAFT_ORIGINS).default('editor'),
  conversationId: z.guid().nullish(),
});

/** The most prompt ids a draft keeps (00206). */
export const MAX_DRAFT_PROMPTS = 500;

/** The brand's active prompts read to match a page brought in (matchPagePrompts). */
const PAGE_PROMPTS_READ = 1_000;

/**
 * The tracked prompts a page started from this source should answer: an
 * opportunity's (its clusters', or its one prompt), the prompt picked, a
 * topic's active prompts, or, for a page brought in (pasted, read from its
 * URL or a file), the active prompts its title and headings speak to.
 * Throws 'not_found' for one the member can't read.
 */
export async function promptsFor(
  supabase: DraftClient,
  brandId: string,
  source: DraftStart['source'],
  /** The page brought in; none for the overlap check, which has no page yet. */
  page: { title: string; html: string } = { title: '', html: '' },
): Promise<{ promptIds: string[]; opportunityId: string | null }> {
  if (source.kind === 'content') {
    if (!page.html) return { promptIds: [], opportunityId: null };
    const { data, error } = await supabase
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      // The newest first, for a brand with more than are read.
      .order('created_at', { ascending: false })
      .limit(PAGE_PROMPTS_READ);
    // Without them the page still starts, with its prompts to add in Sources.
    if (error) {
      console.error('Failed to read the prompts to match an imported page:', error);
      return { promptIds: [], opportunityId: null };
    }
    return { promptIds: matchPagePrompts(page.title, page.html, data ?? []), opportunityId: null };
  }

  if (source.kind === 'opportunity') {
    const { data, error } = await supabase
      .from('content_opportunities')
      .select('id, prompt_id, cluster_id, related_cluster_ids, source_data')
      .eq('id', source.id)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    const clusterIds = [data.cluster_id, ...(data.related_cluster_ids ?? [])].filter(
      (id): id is string => typeof id === 'string',
    );
    if (!clusterIds.length) {
      return { promptIds: data.prompt_id ? [data.prompt_id] : [], opportunityId: data.id };
    }
    const members = await supabase
      .from('prompt_cluster_members')
      .select('prompt_id')
      .in('cluster_id', clusterIds)
      .limit(MAX_DRAFT_PROMPTS);
    if (members.error) throw new Error(members.error.message);
    const memberIds = (members.data ?? []).map((m) => m.prompt_id);
    if (memberIds.length) return { promptIds: memberIds, opportunityId: data.id };
    // Its clusters have no members (re-clustered since, or never written):
    // the prompts its card counts, by their words, and its own prompt
    // (editor UX review 2026-11-03: "2 prompts" on the card, none in the draft).
    return {
      promptIds: await opportunityOwnPrompts(supabase, brandId, data),
      opportunityId: data.id,
    };
  }

  const query = supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId);
  if (source.kind === 'prompt') {
    const { data, error } = await query.eq('id', source.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    return { promptIds: [data.id], opportunityId: null };
  }
  const { data, error } = await query
    .eq('topic_id', source.id)
    .eq('is_active', true)
    .limit(MAX_DRAFT_PROMPTS);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('not_found');
  return { promptIds: data.map((p) => p.id), opportunityId: null };
}

/** The most prompt texts of an opportunity's card read back to prompts. */
const CARD_PROMPTS_READ = 50;

/**
 * An opportunity's prompts without its clusters: its own prompt, then the
 * brand's prompts whose words are the ones its card lists
 * (`source_data.prompts`, what the card counts), each once.
 */
async function opportunityOwnPrompts(
  supabase: DraftClient,
  brandId: string,
  opportunity: { prompt_id: string | null; source_data: unknown },
): Promise<string[]> {
  const own = opportunity.prompt_id ? [opportunity.prompt_id] : [];
  const listed = (opportunity.source_data as { prompts?: unknown } | null)?.prompts;
  const texts = Array.isArray(listed)
    ? [
        ...new Set(listed.filter((p): p is string => typeof p === 'string' && p.trim() !== '')),
      ].slice(0, CARD_PROMPTS_READ)
    : [];
  if (!texts.length) return own;
  const { data, error } = await supabase
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .in('text', texts)
    .limit(CARD_PROMPTS_READ);
  // Without them the draft still starts, with its own prompt, the rest to add in Sources.
  if (error) {
    console.error("Failed to read an opportunity's prompts by their words:", error);
    return own;
  }
  return [...new Set([...own, ...(data ?? []).map((p) => p.id)])].slice(0, MAX_DRAFT_PROMPTS);
}

/**
 * Keeps the draft as it is now in its History (CE-018, 00215
 * content_draft_snapshot). A failure is logged, not thrown: the step it
 * records has already happened.
 */
export async function keepVersion(
  supabase: DraftClient,
  id: string,
  origin: Exclude<VersionOrigin, 'restore'>,
): Promise<void> {
  const { error } = await supabase.rpc('content_draft_snapshot', {
    p_draft_id: id,
    p_origin: origin,
  });
  if (error) console.error(`Failed to keep the draft's ${origin} version:`, error.message);
}

/**
 * A new draft (New content, Start, Chat's create_draft: CE-003, CE-015) for
 * the person `createdBy`, the brand checked by the caller: its page type,
 * what it is for, and its first text. A new page, or an existing one Start
 * chose to optimize, starts with its title as the H1; content brought to
 * optimize is checked against the draft allow-list, as a save is. A type the
 * person picked stays; Start's guess is stored as detected, so it follows the
 * page (CE-023). Throws 'invalid' for a start that isn't one.
 */
export async function insertDraft(
  supabase: DraftClient,
  brandId: string,
  createdBy: string,
  start: DraftStart,
): Promise<string> {
  const parsed = startInput.safeParse(start);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const { method, pageType, typePicked, source, bodyHtml, sourceUrl, origin, conversationId } =
    parsed.data;
  const title = parsed.data.title.trim().slice(0, MAX_TITLE_LENGTH).trim();

  const bodyHtmlKept =
    bodyHtml !== undefined
      ? sanitizeDraftHtml(bodyHtml)
      : title
        ? `<h1>${escapeHtml(title)}</h1>`
        : '';
  const { promptIds, opportunityId } = await promptsFor(supabase, brandId, source, {
    title,
    html: bodyHtml !== undefined ? bodyHtmlKept : '',
  });
  // A page brought in to optimize aims at its own length, not a new page's.
  const rules = startingRules(method, bodyHtml !== undefined ? bodyHtmlKept : undefined);

  const { data, error } = await supabase
    .from('content_drafts')
    .insert({
      brand_id: brandId,
      created_by: createdBy,
      method,
      title,
      page_type: pageType,
      page_type_source: typePicked ? 'user' : 'detected',
      body_html: bodyHtmlKept,
      opportunity_id: opportunityId,
      source_url: sourceUrl ?? null,
      prompt_ids: [...new Set(promptIds)].slice(0, MAX_DRAFT_PROMPTS),
      ...(rules.importLength ? { rules } : {}),
      // Where it was made (00463): set once.
      origin,
      conversation_id: conversationId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  // A page brought in from its address starts History as the live page.
  if (sourceUrl && bodyHtml !== undefined) await keepVersion(supabase, data.id, 'import');
  return data.id;
}

const saveInput = z.object({
  title: z.string().max(MAX_TITLE_LENGTH),
  bodyHtml: z.string(),
  base: z.object({
    updatedAt: z.string().min(1),
    bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** The page of a save whose answer never came back: it may be this editor's own write. */
    unconfirmedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
});

/** Saves that find the draft written meanwhile, then try again over it. */
const SAVE_ATTEMPTS = 3;

/**
 * The editor's autosave (saveContentDraft): the body, checked against the
 * draft allow-list again (sanitizeDraftHtml), and the title read from it,
 * written only over the version the editor last saw (`base`). When another
 * write came first, the page tells which kind: the same page means only the
 * draft's other columns changed (Mark ready, its type), and the save goes
 * over them; another page means someone else changed it (another tab, a
 * teammate, the Content Agent), and nothing is overwritten. A page that is
 * the editor's own last save whose answer was lost (`unconfirmedHash`)
 * counts as the same page. A save RLS refused, or of a draft that no longer
 * exists, comes back not_found rather than saved.
 *
 * Until a person picks the page type, it follows the page (CE-023): detected
 * again from what was saved, and written only while it is still detected, so
 * a pick made meanwhile stays. That second write makes the version the
 * editor goes on from.
 */
export async function saveDraft(
  supabase: DraftClient,
  id: string,
  input: {
    title: string;
    bodyHtml: string;
    base: { updatedAt: string; bodyHash: string; unconfirmedHash?: string };
  },
): Promise<SaveDraftResult> {
  if (typeof input?.bodyHtml === 'string' && input.bodyHtml.length > MAX_BODY_HTML_LENGTH) {
    return { ok: false, reason: 'too_large' };
  }
  const parsed = saveInput.safeParse(input);
  if (!draftId.safeParse(id).success || !parsed.success) return { ok: false, reason: 'invalid' };
  const { title, base } = parsed.data;
  const bodyHtml = sanitizeDraftHtml(parsed.data.bodyHtml);
  const savingHash = await bodyHash(bodyHtml);
  let expected = base.updatedAt;
  // While the Content Agent writes the page (CE-015), a tab left open waits:
  // the agent's page would go over its save. A 'writing' left by a stopped
  // server doesn't hold it.
  const writingSince = new Date(Date.now() - WRITING_STALE_MS).toISOString();
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('content_drafts')
      .update({ title, body_html: bodyHtml })
      .eq('id', id)
      .eq('updated_at', expected)
      .or(`agent_state.is.null,agent_state.neq.writing,agent_state_at.lt."${writingSince}"`)
      .select(`updated_at, page_type, page_type_source, source_url, ${BRAND_SITE}`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      let updatedAt: string = data.updated_at;
      if (data.page_type_source === 'detected') {
        // With the existing page's address, as Start detected it.
        const detected = detectPageType(
          { title, html: bodyHtml, url: data.source_url },
          brandSiteType(data.brands),
        );
        // A page that shows no type keeps the one it had (Start's guess).
        if (detected && detected !== data.page_type) {
          // Only over this save: a write in between would otherwise become
          // the editor's base, and its next autosave would go over it.
          const { data: typed, error: typeError } = await supabase
            .from('content_drafts')
            .update({ page_type: detected })
            .eq('id', id)
            .eq('page_type_source', 'detected')
            .eq('updated_at', data.updated_at)
            .select('updated_at')
            .maybeSingle();
          // The page is saved; its type catches up on the next save.
          if (typeError) {
            console.error('Failed to update the detected page type:', typeError.message);
          } else if (typed) {
            updatedAt = typed.updated_at;
          }
        }
      }
      return { ok: true, updatedAt, bodyHash: savingHash };
    }

    const { data: current, error: readError } = await supabase
      .from('content_drafts')
      .select('updated_at, body_html, agent_state, agent_state_at')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) return { ok: false, reason: 'not_found' };
    // The page is changing elsewhere: Reload opens it as the agent leaves it.
    if (agentStateOf(current.agent_state, current.agent_state_at) === 'writing') {
      return { ok: false, reason: 'conflict' };
    }
    const currentHash = await bodyHash(current.body_html);
    // The page the editor last saw, its lost save's, or already this one:
    // writing over any of them loses nothing.
    if (
      currentHash !== base.bodyHash &&
      currentHash !== base.unconfirmedHash &&
      currentHash !== savingHash
    ) {
      return { ok: false, reason: 'conflict' };
    }
    expected = current.updated_at;
  }
  return { ok: false, reason: 'conflict' };
}

export type UpdateContentDraftResult =
  | {
      ok: true;
      updatedAt: string;
      bodyHash: string;
      /** History's version of the page before the change, which Undo restores. */
      beforeVersionId: string;
    }
  | {
      ok: false;
      reason: 'forbidden_role' | 'not_found' | 'conflict' | 'invalid' | 'failed';
      message: string;
    };

type DraftChangeRefusal = Extract<UpdateContentDraftResult, { ok: false }>;

/** The refusals of Chat's change to a draft that come before it is read, the same on both paths. */
const DRAFT_CHANGE_REFUSALS = {
  invalid: { ok: false, reason: 'invalid', message: 'That isn’t a draft’s id.' },
  forbidden_role: {
    ok: false,
    reason: 'forbidden_role',
    message: 'Only an admin or a manager can change a draft from Chat.',
  },
  not_found: { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' },
  failed: { ok: false, reason: 'failed', message: 'The draft couldn’t be changed. Try again.' },
} as const satisfies Record<string, DraftChangeRefusal>;

/** One of those refusals, a new object each time: a caller may change what it's given. */
export function draftChangeRefused(reason: keyof typeof DRAFT_CHANGE_REFUSALS): DraftChangeRefusal {
  return { ...DRAFT_CHANGE_REFUSALS[reason] };
}

/** Whether `id` is a draft's id at all, before anything is read. */
export const isDraftId = (id: string): boolean => draftId.safeParse(id).success;

/**
 * Chat's change to a draft's title or page (update_draft, CHAT-20 §9 row
 * 55), the role and the plan checked by the caller. History keeps the page
 * before it first ('agent_before', CE-018: the page before an agent changes
 * it), then it is saved as the editor saves, over the page just read
 * (saveDraft: the same allow-list, the agent's lock, a conflict when it
 * changed in between). Errors come back as values (#427).
 */
export async function changeDraft(
  supabase: DraftClient,
  id: string,
  change: { title?: string; bodyHtml?: string },
): Promise<UpdateContentDraftResult> {
  if (!isDraftId(id)) return draftChangeRefused('invalid');
  const { data: current, error } = await supabase
    .from('content_drafts')
    .select('title, body_html, updated_at, archived_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', message: 'The draft couldn’t be read.' };
  if (!current || current.archived_at) return draftChangeRefused('not_found');
  // The page before goes to History first: without it, Undo couldn't bring it back.
  const { data: version, error: versionError } = await supabase.rpc('content_draft_snapshot', {
    p_draft_id: id,
    p_origin: 'agent_before',
  });
  if (versionError || typeof version !== 'string') {
    if (versionError) console.error('Failed to keep the draft before Chat’s change:', versionError);
    return {
      ok: false,
      reason: 'failed',
      message: 'The page before couldn’t be kept in History, so nothing was changed. Try again.',
    };
  }
  const saved = await saveDraft(supabase, id, {
    title: change.title ?? current.title,
    bodyHtml: change.bodyHtml ?? current.body_html,
    base: { updatedAt: current.updated_at, bodyHash: await bodyHash(current.body_html) },
  });
  if (!saved.ok) {
    return saved.reason === 'conflict'
      ? {
          ok: false,
          reason: 'conflict',
          message: 'The page changed while Chat was saving it. Open it to see the latest.',
        }
      : saved.reason === 'not_found'
        ? draftChangeRefused('not_found')
        : {
            ok: false,
            reason: 'invalid',
            message:
              saved.reason === 'too_large'
                ? 'The page is too long to save.'
                : 'The page couldn’t be saved as it is.',
          };
  }
  return {
    ok: true,
    updatedAt: saved.updatedAt,
    bodyHash: saved.bodyHash,
    beforeVersionId: version,
  };
}
