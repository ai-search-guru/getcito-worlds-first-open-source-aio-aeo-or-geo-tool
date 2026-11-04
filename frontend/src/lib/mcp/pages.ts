import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * A public web page, opened for Chat's fetch_page (CHAT-10 §B). The API
 * opens it (backend/src/lib/pageOpen.js: http(s) on the web ports, public
 * addresses only, checked again after each of at most 3 redirects, each on
 * the run's sites, 10 s, 1 MB, HTML only, no cookies or credentials) through
 * the CRON_SECRET internal endpoint, and gives back what Chat reads of it:
 * never its HTML.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.pageRefused' });

/** What Chat reads of a page. */
export interface McpOpenedPage {
  ok: true;
  /** Where it ended up, after redirects. */
  url: string;
  http_status: number;
  title: string;
  meta_description: string;
  canonical: string | null;
  language: string | null;
  /** A date the page states (modified, else published), as it states it. */
  date: string | null;
  /** Its H1–H3 headings, in order. */
  outline: { level: number; text: string }[];
  /** The JSON-LD @types it carries ("FAQPage", "Organization"). */
  json_ld_types: string[];
  /** Its main text, cut to fit. */
  text: string;
  /** How long the main text was before it was cut. */
  text_chars: number;
  /** The page has words aimed at AI assistants: ignored, and said so (CHAT-05 item 12). */
  instructions_for_ai: boolean;
}

/** Why a page couldn't be opened: safe-fetch's code, and the app's own words for it. */
export interface McpPageRefusal {
  ok: false;
  code: string;
  message: string;
}

/** The codes the API answers with, each worded here (never in the page's words). */
const REFUSALS = [
  'invalid_url',
  'blocked',
  'not_allowed',
  'too_many_redirects',
  'not_html',
  'too_large',
  'too_deep',
  'http_error',
  'timeout',
  'unreachable',
  'busy',
] as const;
type Refusal = (typeof REFUSALS)[number];
const isRefusal = (code: unknown): code is Refusal =>
  typeof code === 'string' && (REFUSALS as readonly string[]).includes(code);

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const asStringOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);

/**
 * Opens one public URL for the signed-in member, on the run's sites (hosts
 * as they are, the brand's domains with their subdomains: every redirect
 * must stay on one), or says why
 * it couldn't be opened ({ ok: false, code, message }: blocked, timeout,
 * not_html…). Throws only when the API can't be asked at all.
 */
export async function openPageFor(
  auth: McpAuthContext,
  url: string,
  sites: { hosts: readonly string[]; domains: readonly string[] } = { hosts: [], domains: [] },
): Promise<McpOpenedPage | McpPageRefusal> {
  if (!auth.organizationId) {
    return { ok: false, code: 'no_access', message: t('no_access') };
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error('CRON_SECRET must be configured for opening pages');

  const res = await fetch(`${API_BASE_URL}/api/internal/chat/pages/open`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      hosts: sites.hosts,
      domains: sites.domains,
      orgId: auth.organizationId,
    }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (isRefusal(body?.code)) {
      // The page's own answer as a number only; what it sent never reaches the model.
      const status =
        typeof body.status === 'number' && Number.isInteger(body.status) ? body.status : null;
      return {
        ok: false,
        code: body.code,
        message:
          body.code === 'http_error' && status !== null
            ? t('http_status', { status })
            : t(body.code),
      };
    }
    throw new Error(`Internal page endpoint returned ${res.status}`);
  }
  const page = (body?.page ?? null) as Record<string, unknown> | null;
  if (!page) throw new Error('Internal page endpoint returned no page');
  return {
    ok: true,
    url: asString(page.url) || url,
    http_status: typeof page.status === 'number' ? page.status : 200,
    title: asString(page.title),
    meta_description: asString(page.description),
    canonical: asStringOrNull(page.canonical),
    language: asStringOrNull(page.language),
    date: asStringOrNull(page.date),
    outline: Array.isArray(page.outline) ? (page.outline as McpOpenedPage['outline']) : [],
    json_ld_types: Array.isArray(page.jsonLd) ? (page.jsonLd as string[]) : [],
    text: asString(page.text),
    text_chars: typeof page.textChars === 'number' ? page.textChars : 0,
    instructions_for_ai: page.instructionsForAi === true,
  };
}
