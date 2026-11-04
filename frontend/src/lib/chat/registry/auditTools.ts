import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { getAuditQuota, startSiteAudits } from '@/lib/actions/audits';
import { contentUuid, isHttpUrl } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool } from './defineTool';
import { listWords } from './targets';

/**
 * Chat's Site Audit WRITE row (CHAT-20 §9 row 37): audits of the brand's
 * pages, started as the Site Audit page starts them, against the month's
 * Site Audit quota (the API's check), as the signed-in member. Every start
 * asks, in every mode, with what it uses of the quota on the card
 * (`cost_card`, CHAT-04): ten one-page calls ask ten times. Admins and
 * Managers (DECISIONS T). Its results stay once it ran: no Undo (§9).
 */

const BRAND = FIXTURE_IDS.brand;

const costT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.costs' });

/**
 * The pages a start audits, as the API counts them (routes/audits.js
 * uniquePages): one per page, whatever its spelling (www, a last slash).
 */
export function auditPages(urls: readonly string[]): string[] {
  const byPage = new Map<string, string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const key = `${host}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
      if (!byPage.has(key)) byPage.set(key, url);
    } catch {
      // Not a URL: the input refuses it first.
    }
  }
  return [...byPage.values()];
}

/** What a start uses of the month's audits, for its card; null when the plan has no limit. */
export async function auditCost(urls: readonly string[]): Promise<string | null> {
  const count = auditPages(urls).length;
  // Unread, the card still says it uses some: the API checks the quota when it starts.
  const quota = await getAuditQuota().catch(() => null);
  if (!quota) return costT('siteAuditUnknown', { count });
  if (quota.limit === -1) return null;
  return count > quota.remaining
    ? costT('siteAuditOver', { count, left: quota.remaining })
    : costT('siteAudit', { count, left: quota.remaining });
}

export const AUDIT_TOOLS = [
  defineTool({
    name: 'run_site_audit',
    class: 'write',
    area: 'site_audit',
    description:
      "Audit pages of the brand's site in Site Audit: one URL by default, or several at once. Each page uses one of the month's Site Audit audits; several start only if all fit. A page with an audit running gets that one back, with no new audit used. A page audited in the last 10 minutes isn't started: the result lists it, so ask whether to open that audit or audit it again, and only then run again with force. Only pages the person asked for.",
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    // A card in every mode, with what it uses of the quota (§9 row 37).
    flags: { costCard: true },
    minRole: 'manager',
    // The month's Site Audit quota is the API's check (quota_exceeded).
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C3',
    labelKey: 'startAudit',
    route: '/dashboard/audit',
    mcpTool: 'run_site_audit',
    specRow: '37',
    // The run's cap counts pages (§14).
    batch: { field: 'urls' },
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      urls: z
        .array(z.string().trim().max(2048).refine(isHttpUrl, 'Each page is an http(s) address'))
        .min(1)
        .max(10)
        .describe('The pages to audit, as full addresses.'),
      force: z
        .boolean()
        .optional()
        .describe(
          'Audit again a page audited in the last 10 minutes. Only after the person said to.',
        ),
    }),
    run: (_ctx, input) =>
      input.force
        ? startSiteAudits(input.brand_id, input.urls, { force: true })
        : startSiteAudits(input.brand_id, input.urls),
    target: async (input) => {
      const pages = listWords(auditPages(input.urls));
      // What the card's Approve uses of the month's audits.
      return [pages, await auditCost(input.urls)].filter(Boolean).join(' · ') || null;
    },
    fixture: { input: { brand_id: BRAND, urls: ['https://acme.example/pricing'] } },
  }),
];
