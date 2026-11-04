import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { slugOf } from '@/lib/content/readyToPublish';

/**
 * A page marked Published at its live address (CE-013), from the browser
 * through the API's proxy: the address is the server's to write, as a CMS's
 * is (00262), and a linked action gets the live page with it.
 */

export type PublishError =
  | 'invalid_url'
  | 'not_found'
  /** The API has no publish route yet (an API older than CE-013's). */
  | 'no_route'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

export type PublishResult =
  | {
      ok: true;
      publishedUrl: string;
      publishedAt: string;
      /** Off the brand's domains, it's kept, but the Live page tab can't measure it. */
      onBrandDomain: boolean;
      /** The linked action's Publish task done (every page it names live). */
      taskCompleted: boolean;
    }
  | { ok: false; code: PublishError };

/** Where the page is live now (CE-013), or null: after it was published elsewhere meanwhile. */
export async function readLiveUrl(draftId: string): Promise<string | null> {
  const { data } = await createClient()
    .from('content_drafts')
    .select('published_url')
    .eq('id', draftId)
    .maybeSingle();
  return data?.published_url ?? null;
}

/** Marks the page Published at `url`. */
export async function publishPage(draftId: string, url: string): Promise<PublishResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/content-drafts/${encodeURIComponent(draftId)}/publish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ url }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (body.code === 'invalid_url' || body.code === 'invalid')
        return { ok: false, code: 'invalid_url' };
      // A page gone is the route's own answer; any other 404 (Express's
      // "Cannot POST", no JSON) is an API without the route.
      if (res.status === 404 && body.code !== 'not_found') return { ok: false, code: 'no_route' };
      const general = apiFailure(res.status, body);
      return {
        ok: false,
        code:
          general === 'session' ||
          general === 'workspace' ||
          general === 'busy' ||
          general === 'subscription' ||
          general === 'not_found'
            ? general
            : 'failed',
      };
    }
    return {
      ok: true,
      publishedUrl: String(body.publishedUrl ?? url),
      publishedAt: String(body.publishedAt ?? new Date().toISOString()),
      onBrandDomain: body.onBrandDomain !== false,
      taskCompleted: body.taskCompleted === true,
    };
  } catch (err) {
    console.error('Failed to mark the page published:', err);
    return { ok: false, code: 'failed' };
  }
}

/**
 * The address the dialog starts from: where the page went live (a CMS's, or
 * one given before), else the page it optimizes, else the brand's site with
 * the page's slug (its last send's, else its title's: never the site's home
 * page, which the person would mark live with one click). Empty when none
 * can be read.
 */
export async function readPublishAddress(draftId: string): Promise<string> {
  const supabase = createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('brand_id, title, published_url, source_url, slug')
    .eq('id', draftId)
    .maybeSingle();
  if (error || !draft) return '';
  if (draft.published_url) return draft.published_url;
  if (draft.source_url) return draft.source_url;
  const { data: domain } = await supabase
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', draft.brand_id)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle();
  const host = String(domain?.domain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  const slug = draft.slug || slugOf(draft.title ?? '', null);
  if (!host || !slug) return '';
  return `https://${host}/${slug}`;
}
