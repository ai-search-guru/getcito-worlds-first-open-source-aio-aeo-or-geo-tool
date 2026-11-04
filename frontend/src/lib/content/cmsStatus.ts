import type { CmsDelivery, CmsTarget } from '@/lib/content/cmsSendClient';

/**
 * A page's last Send to CMS (#1331, 00262) as the Library, the editor and the
 * MCP read it, from its content_draft_deliveries row.
 */

/**
 * A send still queued after this was left by a server that stopped mid-batch
 * (00262 closes it at the workspace's next send): it reads as interrupted,
 * so neither the Library nor the editor waits on it or says it is still
 * going. Read by the reader's clock (the browser's; the server's for the
 * MCP): one 30 minutes fast would read a send under way as interrupted,
 * until its next read.
 */
const INTERRUPTED_AFTER_MS = 30 * 60_000;

/** A send as the Library, the editor and the MCP read it: one left queued, as interrupted. */
export function lastSend(row: {
  status: string;
  created_at: string;
  sent_at: string | null;
  published_at: string | null;
  /** When it was taken down (00460); absent before that migration. */
  taken_down_at?: string | null;
  error: string | null;
  target?: string | null;
}): { status: CmsDelivery['status']; target: CmsTarget; at: string; error: string | null } {
  const interrupted =
    row.status === 'queued' && Date.parse(row.created_at) < Date.now() - INTERRUPTED_AFTER_MS;
  return {
    status: interrupted ? 'failed' : (row.status as CmsDelivery['status']),
    target:
      row.target === 'webflow' ||
      row.target === 'wordpress' ||
      row.target === 'framer' ||
      row.target === 'wix'
        ? row.target
        : 'webhook',
    at: row.taken_down_at ?? row.published_at ?? row.sent_at ?? row.created_at,
    error: interrupted ? 'Not sent: interrupted' : row.error,
  };
}
