import { supabaseAdmin } from '@/lib/supabase/admin';
import type { DraftStart } from '@/lib/content/drafts';
import {
  changeDraft,
  draftChangeRefused,
  insertDraft,
  isDraftId,
  type UpdateContentDraftResult,
} from '@/lib/content/draftWrites';
import { assertWritableFor, canAccessBrandFor, isManagerFor, type RunActor } from './access';

/**
 * Chat's draft writes (create_draft, update_draft) for a run with no session
 * behind it: the same writes as createContentDraft and updateContentDraft
 * (lib/content/draftWrites.ts), with the service role, once the person is
 * checked as their session would be (access.ts): the brand theirs to see,
 * their role, the plan, the demo brand. The draft is the person's own, as
 * their own run makes it: created_by is them and author stays 'user', not
 * the Content Agent's draft MCP writes ('agent', for review). Server only,
 * and never a server action: the person is the caller's word.
 */

/** createContentDraft for the run's person. Throws as it does; 'not_found' for a brand not theirs. */
export async function createContentDraftFor(
  actor: RunActor,
  brandId: string,
  start: DraftStart,
): Promise<string> {
  // Not theirs before anything else: the demo or plan refusal would say the brand is there.
  if (!(await canAccessBrandFor(actor, brandId))) throw new Error('not_found');
  await assertWritableFor(actor, brandId);
  return insertDraft(supabaseAdmin, brandId, actor.userId, start);
}

/**
 * updateContentDraft for the run's person: an Admin's or a Manager's, on a
 * draft of a brand they may see. A draft they can't see isn't there for
 * them, as row-level security hides it from their session. Errors come back
 * as values (#427).
 */
export async function updateContentDraftFor(
  actor: RunActor,
  id: string,
  change: { title?: string; bodyHtml?: string },
): Promise<UpdateContentDraftResult> {
  try {
    if (!isDraftId(id)) return draftChangeRefused('invalid');
    if (!(await isManagerFor(actor, actor.organizationId))) {
      return draftChangeRefused('forbidden_role');
    }
    const { data, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !(await canAccessBrandFor(actor, data.brand_id))) {
      return draftChangeRefused('not_found');
    }
    await assertWritableFor(actor, data.brand_id);
    return await changeDraft(supabaseAdmin, id, change);
  } catch (err) {
    console.error('Failed to change the draft from Chat:', err);
    return draftChangeRefused('failed');
  }
}
