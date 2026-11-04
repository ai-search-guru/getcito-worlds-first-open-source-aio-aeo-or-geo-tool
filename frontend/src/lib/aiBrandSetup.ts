/**
 * Client-side helpers for the AI calls that are shared between the
 * onboarding wizard and the "add a brand" page.
 *
 * Each function owns session lookup, Authorization header construction, and
 * the POST itself. On success it returns typed data; on failure it throws so
 * the caller can decide what to show the user: a SetupDailyLimitError once a
 * workspace that never subscribed has used the day's setup suggestions (429),
 * a plain Error otherwise.
 *
 * These are plain async functions, not server actions — they run in the browser
 * and reach the API via the proxy at BROWSER_API_BASE_URL.
 */

import { createClient } from '@/lib/supabase/client';
import { BROWSER_API_BASE_URL } from '@/config/api';
import { TOPIC_NAME_CHARS } from '@/lib/topicNames';
import { isSiteType, type SiteType } from '@/lib/content/pageTypes';

const API_BASE = BROWSER_API_BASE_URL;

async function getAuthHeader(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return `Bearer ${session?.access_token}`;
}

/**
 * The day's setup suggestions are used up: a workspace that never subscribed
 * gets a few a day (429 `onboarding_daily_limit`), and adds its own until
 * tomorrow. Its message is the call's usual one, so a caller that only shows
 * the message says what it said before.
 */
export class SetupDailyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupDailyLimitError';
  }
}

/** How a suggestion call failed, as the onboarding steps tell it. */
export type SuggestFailure = 'failed' | 'dailyLimit';

export function suggestFailure(err: unknown): SuggestFailure {
  return err instanceof SetupDailyLimitError ? 'dailyLimit' : 'failed';
}

/** The error a failed call throws: SetupDailyLimitError past the day's limit, else an Error. */
async function failure(res: Response, message: string): Promise<Error> {
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (body?.code === 'onboarding_daily_limit') return new SetupDailyLimitError(message);
  }
  return new Error(message);
}

// ── Shared request body shape ──────────────────────────────────────────────────

export interface BrandSetupParams {
  brandName: string;
  description: string;
  website: string;
  language: string;
  /** The brand's industry, where one is kept: a brand's Prompts page sends it; setup has none. */
  industry?: string;
}

/**
 * The longest the API takes each field (backend/src/lib/brandSetupInput.js).
 * What's sent is cut to them, so a long description kept on the brand never
 * fails a suggestion. A topic is held to `topic` where it's typed: its name
 * comes back with its prompts, so it isn't cut here. `topics` is the most
 * one prompts call takes; more go in batches.
 */
export const BRAND_SETUP_LIMITS = {
  name: 200,
  industry: 200,
  website: 200,
  description: 2000,
  topics: 20,
  topic: TOPIC_NAME_CHARS,
};

/** At most `max` UTF-16 units, as the API's limits count them, never half of an emoji's pair. */
function cut(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

// ── Topic suggestions ──────────────────────────────────────────────────────────

export interface SuggestTopicsResult {
  /** Flat list of topic name strings returned by the server. */
  topics: string[];
}

/**
 * POST /api/topics/suggest
 *
 * Returns the list of suggested topic names.
 * Throws if the request fails.
 */
export async function suggestTopics(params: BrandSetupParams): Promise<SuggestTopicsResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/topics/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
      industry: '',
      description: cut(params.description, BRAND_SETUP_LIMITS.description),
      website: cut(params.website, BRAND_SETUP_LIMITS.website),
      language: params.language,
    }),
  });

  if (!res.ok) throw await failure(res, 'Failed to suggest topics');
  const data = await res.json();
  const topics = (data.topics || []).map((t: { name: string }) => t.name);
  return { topics };
}

// ── Prompt generation from topics ─────────────────────────────────────────────

export interface TopicPromptGroup {
  topic: string;
  prompts: string[];
}

export interface GeneratePromptsResult {
  topicPrompts: TopicPromptGroup[];
}

/**
 * POST /api/prompts/from-topics
 *
 * Returns per-topic prompt groups, in the topics' order. The API takes
 * BRAND_SETUP_LIMITS.topics a call, so more (a brand's Prompts page starts
 * with every topic it tracks) are asked in batches side by side; no topics,
 * no call. Throws if any request fails.
 */
export async function generatePromptsFromTopics(
  params: BrandSetupParams,
  topics: string[],
): Promise<GeneratePromptsResult> {
  const authorization = await getAuthHeader();
  const batches: string[][] = [];
  for (let i = 0; i < topics.length; i += BRAND_SETUP_LIMITS.topics) {
    batches.push(topics.slice(i, i + BRAND_SETUP_LIMITS.topics));
  }
  const groups = await Promise.all(
    batches.map(async (batch): Promise<TopicPromptGroup[]> => {
      const res = await fetch(`${API_BASE}/api/prompts/from-topics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        body: JSON.stringify({
          brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
          industry: cut(params.industry, BRAND_SETUP_LIMITS.industry) ?? '',
          description: cut(params.description, BRAND_SETUP_LIMITS.description),
          topics: batch,
          language: params.language,
        }),
      });

      if (!res.ok) throw await failure(res, 'Failed to generate prompts');
      const data = await res.json();
      return (data.topicPrompts || []).map((tp: { topic: string; prompts: string[] }) => ({
        topic: tp.topic,
        prompts: tp.prompts,
      }));
    }),
  );
  return { topicPrompts: groups.flat() };
}

// ── Competitor suggestions ─────────────────────────────────────────────────────

export interface SuggestedCompetitor {
  name: string;
  domain: string;
}

export interface SuggestCompetitorsResult {
  competitors: SuggestedCompetitor[];
  /** Whether the research found the brand sells products online (an online store). */
  isEcommerce: boolean;
}

/**
 * POST /api/competitors/suggest
 *
 * Returns the list of suggested competitors (name + domain), and whether the
 * brand itself sells products online. Throws if the request fails.
 */
export async function suggestCompetitors(
  params: BrandSetupParams & { region?: string },
): Promise<SuggestCompetitorsResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/competitors/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
      industry: '',
      description: cut(params.description, BRAND_SETUP_LIMITS.description),
      // The site tells the model which company the name means, the region
      // which market its competitors should come from.
      website: cut(params.website, BRAND_SETUP_LIMITS.website),
      region: params.region,
      language: params.language,
    }),
  });

  if (!res.ok) throw await failure(res, 'Failed to suggest competitors');
  const data = await res.json();
  const competitors = (data.competitors || []).map((c: { name: string; domain: string }) => ({
    name: c.name,
    domain: c.domain,
  }));
  return { competitors, isEcommerce: data.isEcommerce === true };
}

// ── Site type ─────────────────────────────────────────────────────────────────

export interface DetectSiteTypeResult {
  /** Null when the type was chosen by hand already, or couldn't be told. */
  siteType: SiteType | null;
  /** The industry written to the brand; null when it already had one. */
  industry: string | null;
}

/**
 * POST /api/brands/:id/detect-site-type
 *
 * The brand's kind of site, read from its home page right after it is made
 * (action plan by business type, Step 0), and kept on the brand unless a
 * person chose one. Throws if the request fails.
 */
export async function detectSiteType(brandId: string): Promise<DetectSiteTypeResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(
    `${API_BASE}/api/brands/${encodeURIComponent(brandId)}/detect-site-type`,
    { method: 'POST', headers: { Authorization: authorization } },
  );

  if (!res.ok) throw await failure(res, 'Failed to detect the site type');
  const data = await res.json();
  return {
    siteType: isSiteType(data.siteType) ? data.siteType : null,
    industry: typeof data.industry === 'string' ? data.industry : null,
  };
}
