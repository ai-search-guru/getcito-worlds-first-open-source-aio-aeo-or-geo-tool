'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import type { PublishCmsTarget } from '@/lib/actions/cmsSend';
import { unpublishDraftWork } from '@/lib/content/actionDrafts';
import { createClient } from '@/lib/supabase/server';

export type TakeDownDraftResult =
  | {
      ok: true;
      /** The CMS it was taken down in, a draft there again; null when the API didn't say. */
      target: PublishCmsTarget | null;
    }
  | {
      ok: false;
      reason:
        | 'forbidden_role'
        | 'not_found'
        | 'not_live'
        | 'unavailable'
        | 'not_connected'
        | 'refused'
        | 'failed';
      message: string;
    };

const draftId = z.guid();

/** The API's codes for a CMS the brand no longer has connected, or whose key it refused. */
const NOT_CONNECTED = /^no_|_not_configured$|_not_ready$|^(webflow|wordpress|wix)_refused$/;

/**
 * Take a published page down to a draft in its CMS (AUTONOMOUS-GO-LIVE PR
 * 10): Chat's unpublish_cms, and Take down in the Inbox notice, Chat's
 * Activity and the Content Library. Always a person's click, never an agent
 * on its own. Admins and Managers, a Manager even while publishing is off
 * for Managers: it only lowers what is live, so it stays open while the
 * workspace is read-only, as the API's route does. Through POST
 * /api/content-drafts/:id/take-down (Webflow, WordPress or Wix); then the
 * page leaves what its action is measured on (unpublishDraftWork), logged
 * when that fails. Errors come back as values.
 */
export async function takeDownDraft(id: string): Promise<TakeDownDraftResult> {
  try {
    return await takeDown(id);
  } catch (err) {
    console.error('Failed to take the page down:', err);
    return { ok: false, reason: 'failed', message: 'The page couldn’t be taken down. Try again.' };
  }
}

async function takeDown(id: string): Promise<TakeDownDraftResult> {
  if (!draftId.safeParse(id).success) {
    return { ok: false, reason: 'not_found', message: 'That page isn’t in the Library.' };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'forbidden_role', message: 'Sign in again.' };
  const [{ data: profile, error: profileError }, { data: draft, error }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('content_drafts').select('id, brand_id, action_id').eq('id', id).maybeSingle(),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (error) throw new Error(error.message);
  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can take a page down.',
    };
  }
  if (!draft) return { ok: false, reason: 'not_found', message: 'That page isn’t in the Library.' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return { ok: false, reason: 'failed', message: 'Your session ended. Sign in again.' };
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/content-drafts/${id}/take-down`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (err) {
    console.error('Failed to take the page down:', err);
    return { ok: false, reason: 'failed', message: 'The CMS couldn’t be reached. Try again.' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    target?: PublishCmsTarget;
  };
  if (!res.ok) {
    const code = body.code ?? '';
    const message = body.error || 'The page couldn’t be taken down.';
    if (code === 'not_live') return { ok: false, reason: 'not_live', message };
    if (code === 'take_down_unavailable') return { ok: false, reason: 'unavailable', message };
    if (code === 'take_down_refused') return { ok: false, reason: 'refused', message };
    if (NOT_CONNECTED.test(code)) return { ok: false, reason: 'not_connected', message };
    if (res.status === 403) return { ok: false, reason: 'forbidden_role', message };
    if (res.status === 404) return { ok: false, reason: 'not_found', message };
    return { ok: false, reason: 'failed', message };
  }
  // The page is down: what its action is measured on follows, logged if it can't.
  if (draft.action_id) {
    try {
      await unpublishDraftWork(
        supabase,
        { id, brandId: draft.brand_id, actionId: draft.action_id },
        user.id,
      );
    } catch (err) {
      console.error('Failed to take the page back in its action:', err);
    }
  }
  const target = body.target;
  return {
    ok: true,
    target: target === 'webflow' || target === 'wordpress' || target === 'wix' ? target : null,
  };
}
