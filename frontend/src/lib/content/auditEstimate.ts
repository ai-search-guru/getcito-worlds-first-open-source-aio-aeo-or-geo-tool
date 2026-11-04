import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';
import { draftHtmlDocument } from './draftExport';

/**
 * Site Audit's estimate of a draft (customer priorities item 9), as the API
 * reads it (server draftEstimate.js): the score and each category's, 0–100,
 * and how many checks it rests on: the page's own, the site's (from its
 * latest audit), and the AI's once they're read.
 */
export interface AuditEstimate {
  score: number | null;
  /** By category key, as Site Audit's (CATEGORY_META). */
  categories: Record<string, number | null>;
  checks: { page: number; site: number; ai: number };
}

/** The AI checks' verdicts, sent back with each later reading so the score keeps them. */
export interface AiVerdict {
  key: string;
  status: 'pass' | 'warn' | 'fail' | 'na';
  score: number | null;
}

export type AuditEstimateError = 'ai_budget' | 'no_subscription' | 'failed';

/** How many checks AI reads, beside the page's own (llmSignals.js). */
export const AI_CHECKS = 13;

/**
 * The page as it goes out, as Export's HTML file has it: the page as Copy
 * HTML gives it (its byline line, its reviewer's JSON-LD), in a document
 * whose head has the meta title, description and author.
 */
export function estimateDocument(page: {
  title: string;
  html: string;
  metaDescription: string;
  author: string;
}): string {
  return draftHtmlDocument(page.title, page.html, {
    table: { note: '', rows: [] },
    front: {},
    head: { title: page.title, description: page.metaDescription, author: page.author },
  });
}

/**
 * The estimate, read from the browser: the editor reads it again each time
 * typing pauses, never behind a server action Next runs one at a time. With
 * `ai`, the AI checks run too, on the workspace's AI usage, and their
 * verdicts come back to send with later readings. Never throws.
 */
export async function readAuditEstimate(
  draftId: string,
  brandId: string,
  html: string,
  { ai = false, verdicts }: { ai?: boolean; verdicts?: AiVerdict[] } = {},
): Promise<{ estimate: AuditEstimate; verdicts?: AiVerdict[] } | { error: AuditEstimateError }> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { error: 'failed' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/content-drafts/${encodeURIComponent(draftId)}/audit-estimate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          brandId,
          html,
          ...(ai ? { ai } : {}),
          ...(verdicts ? { verdicts } : {}),
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = body.code;
      return { error: code === 'ai_budget' || code === 'no_subscription' ? code : 'failed' };
    }
    const { verdicts: read, ...estimate } = body as unknown as AuditEstimate & {
      verdicts?: AiVerdict[];
    };
    return { estimate, ...(read ? { verdicts: read } : {}) };
  } catch (err) {
    console.error('Failed to read the Site Audit estimate:', err);
    return { error: 'failed' };
  }
}
