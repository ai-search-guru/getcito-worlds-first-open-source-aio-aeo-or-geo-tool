'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscriptionGuard';
import { isManager } from '@/lib/sessionRole';
import { API_BASE_URL } from '@/config/api';
import type { SiteTrust } from '@/lib/content/siteTrust';
import type { NoPlanMark } from '@/lib/billing/noPlan';

const AEO_SERVER_URL = API_BASE_URL;

/** The API's RECENT_AUDIT_MINUTES (routes/audits.js): a page audited since asks first. */
const RECENT_AUDIT_MINUTES = 10;

export type AuditSignalStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface AuditSignal {
  key: string;
  category: string | null;
  status: AuditSignalStatus;
  score: number | null;
  evidence: Record<string, unknown>;
  label: string;
  what: string | null;
  why: string | null;
  howToFix: string | null;
  impactTier: 'high' | 'medium' | 'standard' | null;
}

export interface CategoryScore {
  score: number | null;
  evaluated: number;
  total: number;
}

export interface AuditRecommendation {
  signalKey: string;
  label: string;
  category: string | null;
  priority: 'high' | 'medium' | 'low';
  recommendation: string;
  draft: string | null;
  /** JSON-LD or HTML to paste. Older audits keep markup in `draft` and lack this. */
  code?: string | null;
}

export interface AuditResult {
  id: string;
  brandId: string;
  url: string;
  finalUrl: string | null;
  status: 'running' | 'completed' | 'failed';
  totalScore: number | null;
  /**
   * The AI-judged signals didn't run and none were kept from an earlier
   * audit: the score leaves them out and isn't compared with other audits.
   */
  partial?: boolean;
  /** Nearest earlier completed audit of the same normalized page, for the report delta. */
  previousScore?: number | null;
  previousCreatedAt?: string | null;
  categoryScores: Record<string, CategoryScore>;
  signalsEvaluated: number | null;
  signalsTotal: number;
  rubricVersion: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  signals: AuditSignal[];
  recommendations: AuditRecommendation[];
}

export interface AuditQuota extends NoPlanMark {
  used: number;
  limit: number;
  /**
   * What's left this month for the user: the running audits and the
   * auto-audit runs still to come already taken out.
   */
  remaining: number;
  /** Audits started and not finished yet: they're charged when they complete. */
  running?: number;
  /** Where auto-audit stands this billing period (SA-006). */
  auto?: AuditAutoStatus;
}

/** Auto-audit this billing period (SA-006): 5% of the quota on days 1, 7, 14, 21 and 28. */
export interface AuditAutoStatus {
  enabled: boolean;
  /** The org's own choice; null follows the plan (on with a monthly quota). */
  setting: boolean | null;
  emailAfterRun: boolean;
  /** Pages one run audits. */
  perRun: number;
  /** Audits the runs still to come keep out of `remaining`. */
  reserved: number;
  /** Audits the runs used this period, and have running now. */
  used: number;
  running: number;
  periodStart: string;
  periodEnd: string;
  runs: { day: number; at: string; done: boolean }[];
  nextRun: { day: number; at: string } | null;
}

/** Site Audit settings (SA-006): the org's auto-audit, the brand's patterns and pins. */
export interface AuditSettings {
  autoAudit: {
    enabled: boolean;
    /** The org's own choice; null follows the plan. */
    setting: boolean | null;
    perRun: number;
    /** The plan's monthly audits; -1 unlimited. */
    limit: number;
  };
  emailAfterRun: boolean;
  /** Paths such as /legal/*, kept out of Opportunities and the runs. */
  excludePatterns: string[];
  pinned: { key: string; url: string }[];
}

export interface AuditSettingsChanges {
  /** null follows the plan's default again. */
  autoAudit?: boolean | null;
  emailAfterRun?: boolean;
  excludePatterns?: string[];
}

/** The latest auto-audit run that audited the brand's pages, for the in-app notice. */
export interface AutoAuditRun {
  id: string;
  day: number;
  status: 'running' | 'completed';
  startedAt: string;
  finishedAt: string | null;
  /** The brand's pages the run audited, how many completed, and still running. */
  pages: number;
  completed: number;
  running: number;
  /** Signals those audits failed. */
  criticalIssues: number;
}

export interface AuditTrendPoint {
  id: string;
  createdAt: string;
  totalScore: number | null;
  categoryScores: Record<string, CategoryScore>;
}

export interface AuditTrend {
  primaryDomain: string | null;
  points: AuditTrendPoint[];
}

/** One audit run of a page, in its history. */
export interface AuditRun {
  id: string;
  url: string;
  status: 'running' | 'completed' | 'failed';
  totalScore: number | null;
  createdAt: string;
}

export type AuditedPageStatus = 'good' | 'improving' | 'needs_work' | 'running' | 'failed';

/** One audited page: its repeat audits share the row. */
export interface AuditedPage {
  key: string;
  host: string | null;
  path: string;
  url: string;
  /** The latest completed audit (else the latest run), which the row opens. */
  auditId: string;
  score: number | null;
  previousScore: number | null;
  /** The first completed audit's score and when it ran: progress since then. */
  firstScore: number | null;
  firstAuditedAt: string | null;
  status: AuditedPageStatus;
  lastAuditedAt: string;
  /** Whether the audit the row opens was an auto-audit run's (SA-006) or a user's. */
  lastAuditSource?: 'user' | 'auto';
  /** Latest completed scores, oldest first. */
  trend: number[];
  /** Failed and warning signals in the latest completed audit. */
  issues: number | null;
  /** Runs, newest first. */
  runs: AuditRun[];
  runCount: number;
  /** The page's template on the primary domain ("/blog/*"), for Group by template (SA-007). */
  template?: string | null;
}

async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

/** A page's audit finished a few minutes ago, which a start didn't repeat (00431). */
export interface RecentAudit {
  auditId: string;
  finishedAt: string;
  /** The address asked for, in a bulk start's list. */
  url?: string;
}

/** A start of one page: its running audit (new, or the one already running), or a recent one. */
export type RunAuditResult =
  { audit: AuditResult; recent?: undefined } | { audit?: undefined; recent: RecentAudit };

/**
 * Start a single-page audit. Returns at once with the running audit, which
 * is the page's audit already running when there is one (no new credit).
 * A page audited in the last minutes isn't started: `recent` says which
 * audit, so the caller asks; `force` (Audit again) starts a new one anyway.
 */
export async function runAudit(
  brandId: string,
  url: string,
  options: { force?: boolean } = {},
): Promise<RunAuditResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, url, ...(options.force ? { force: true } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.error === 'recently_audited' && body.recent) {
      return { recent: body.recent as RecentAudit };
    }
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { audit: data.audit };
}

/** Fetch a single stored audit with all its signal results. */
export async function getAudit(auditId: string): Promise<AuditResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/${auditId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.audit;
}

/** Delete a stored audit (its signal rows cascade away). */
export async function deleteAudit(auditId: string): Promise<void> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/${auditId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }
}

/** The org's monthly Site Audit allowance (used / limit / remaining; limit -1 = unlimited). */
export async function getAuditQuota(): Promise<AuditQuota> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/quota`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.quota;
}

/**
 * The brand's site trust (CE-043): the day's read, or a new one when
 * `refresh` (the API reads again at most every few minutes).
 */
export async function getSiteTrust(brandId: string, refresh = false): Promise<SiteTrust> {
  const session = await getSession();
  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/site-trust?brandId=${encodeURIComponent(brandId)}${refresh ? '&refresh=1' : ''}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }
  const data = await res.json();
  if (!Number.isFinite(data.score) || !data.checks) throw new Error('Unexpected site trust');
  return {
    checks: data.checks,
    score: data.score,
    checkedAt: data.checkedAt,
    ...(typeof data.complete === 'boolean' && { complete: data.complete }),
  };
}

/** Score + category-score time series for the brand's primary domain. */
export async function getAuditTrend(brandId: string): Promise<AuditTrend> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/trend?brandId=${encodeURIComponent(brandId)}`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { primaryDomain: data.primaryDomain ?? null, points: data.points ?? [] };
}

/**
 * Re-audit several pages at once. Every page started must fit the monthly
 * quota, or none starts; the server runs them a few at a time. A page with
 * an audit running keeps it (counted in `started`, no new credit); one
 * audited in the last minutes isn't started unless `force`, and is listed in
 * `recent`.
 */
export async function runAuditsBulk(
  brandId: string,
  urls: string[],
  options: { force?: boolean } = {},
): Promise<{ started: number; recent: RecentAudit[] }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/bulk`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brandId, urls, ...(options.force ? { force: true } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { started: (data.audits ?? []).length, recent: data.recent ?? [] };
}

export type StartSiteAuditsResult =
  | {
      ok: true;
      started: number;
      audits: { id: string; url: string }[];
      /** Pages audited in the last minutes, not started: run again with force to audit them. */
      recent?: RecentAudit[];
      message?: string;
    }
  | { ok: false; reason: 'forbidden_role' | 'quota_exceeded' | 'failed'; message: string };

/**
 * Start audits of a brand's pages: Chat's run_site_audit (CHAT-20 §9 row
 * 37). Admins and Managers, checked here (DECISIONS T). One page as Run
 * audit starts it, several as the Pages tab's Re-audit
 * (the API's bulk route: every page fits the month's Site Audit quota, or
 * none starts). The quota is the API's check, said back as quota_exceeded.
 * Errors come back as values (#427).
 */
export async function startSiteAudits(
  brandId: string,
  urls: string[],
  options: { force?: boolean } = {},
): Promise<StartSiteAuditsResult> {
  try {
    await assertWritable({ brandId });
    return await startAudits(brandId, urls, options.force === true);
  } catch (err) {
    console.error('Failed to start the audits:', err);
    return { ok: false, reason: 'failed', message: 'The audits couldn’t be started. Try again.' };
  }
}

async function startAudits(
  brandId: string,
  urls: string[],
  force: boolean,
): Promise<StartSiteAuditsResult> {
  if (!(await isManager(await createClient()))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can start audits from Chat.',
    };
  }
  const session = await getSession();
  const many = urls.length > 1;
  let res: Response;
  try {
    res = await fetch(`${AEO_SERVER_URL}/api/audits${many ? '/bulk' : ''}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        brandId,
        ...(many ? { urls } : { url: urls[0] }),
        ...(force ? { force: true } : {}),
      }),
    });
  } catch (err) {
    console.error('Failed to start the audits:', err);
    return { ok: false, reason: 'failed', message: 'Site Audit couldn’t be reached. Try again.' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    audit?: { id: string; url: string };
    audits?: { id: string; url: string }[];
    recent?: RecentAudit | RecentAudit[];
  };
  // A page audited in the last minutes isn't started again: said back, so Chat asks first.
  if (res.status === 409 && body.error === 'recently_audited' && body.recent) {
    return recentResult([], [{ ...(body.recent as RecentAudit), url: urls[0] }]);
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: body.error === 'quota_exceeded' ? 'quota_exceeded' : 'failed',
      message: body.message || `Server error: ${res.status}`,
    };
  }
  const audits = (many ? (body.audits ?? []) : body.audit ? [body.audit] : []).map((a) => ({
    id: a.id,
    url: a.url,
  }));
  return recentResult(audits, Array.isArray(body.recent) ? body.recent : []);
}

/** A start's result, saying which pages were audited minutes ago and not started. */
function recentResult(
  audits: { id: string; url: string }[],
  recent: RecentAudit[],
): StartSiteAuditsResult {
  if (recent.length === 0) return { ok: true, started: audits.length, audits };
  const pages = recent
    .map((r) => `${r.url} (audit ${r.auditId}, finished ${r.finishedAt})`)
    .join(', ');
  return {
    ok: true,
    started: audits.length,
    audits,
    recent,
    message: `Not started, audited in the last ${RECENT_AUDIT_MINUTES} minutes: ${pages}. Ask whether to open that audit or audit again; to audit again, run this again with force.`,
  };
}

/** One of the most common Authority / E-E-A-T gaps across the audited pages. */
export interface AuditGap {
  key: string;
  label: string;
  category: string | null;
  /** Pages whose latest audit fails or warns on it. */
  pages: number;
}

/** The hub's KPI cards, over the latest audit of each page on the primary domain. */
export interface AuditOverview {
  primaryHost: string | null;
  /** Audited pages on the primary domain. */
  pages: number;
  /** Audited pages on other sites, left out of the numbers. */
  otherPages: number;
  siteScore: number | null;
  /** Points against each page's previous audit; null when none was audited twice. */
  siteScoreChange: number | null;
  authority: number | null;
  eeat: number | null;
  /** The weakest of the five categories, for the summary strip (SA-019). */
  lowestCategory: { key: string; score: number } | null;
  gaps: AuditGap[];
}

export async function getAuditOverview(brandId: string): Promise<AuditOverview> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/overview?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.overview;
}

/** Why a page is in the Opportunities inbox. */
export type OpportunityReason =
  | {
      type: 'no_ai_traffic';
      signal: 'revenue' | 'transactions' | 'key_events' | 'engagement';
      /** The page's value percentile within its site (0–100). */
      percentile: number;
      citationState: 'cited' | 'targeted_not_cited' | 'not_targeted' | null;
    }
  | { type: 'never_audited' }
  | { type: 'stale_audit'; days: number }
  /** A template's row (SA-007): the gaps most of its audited pages share. */
  | { type: 'template_gaps'; gaps: { key: string; label: string }[] }
  | {
      type: 'competitor_cited';
      /** Prompts a competitor is cited on and the brand never is, closest to this page. */
      prompts: number;
      /** The competitors cited on them, by name. */
      competitors: string[];
    };

/** A page worth auditing (SA-004). */
export interface AuditOpportunity {
  key: string;
  /** Null for a template's row, which stands for many pages. */
  url: string | null;
  /** The page's path, or a template's ("/blog/*"). */
  path: string;
  title: string | null;
  reasons: OpportunityReason[];
  pinned: boolean;
  /** An audit of the page is running. */
  running: boolean;
  /** AI visits over the last 30 days; null without Analytics or the snippet. */
  aiVisits: number | null;
  lastAudit: { at: string; score: number; auditId: string } | null;
  /** 0–100: the cube root of value × opportunity × ease (SA-005). */
  priority: number;
  priorityParts: { value: number; opportunity: number; ease: number };
  /** A template's row (SA-007): its pages, those audited, and those an audit of it starts. */
  template?: { pages: number; audited: number; toAudit: string[] };
}

/** A template of the brand's pages (SA-007): "/blog/* · 38 pages", and the gaps they share. */
export interface AuditTemplate {
  template: string;
  pages: number;
  audited: number;
  sharedGaps: { key: string; label: string; category: string | null; pages: number }[];
}

export async function getAuditTemplates(brandId: string): Promise<AuditTemplate[]> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/templates?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return (data.templates ?? []).map((t: AuditTemplate) => ({
    template: t.template,
    pages: t.pages,
    audited: t.audited,
    sharedGaps: t.sharedGaps,
  }));
}

export interface ExcludedPage {
  key: string;
  url: string;
  path: string;
  title: string | null;
}

/**
 * How much of the brand's site has a current audit (customer priorities
 * item 11): the site pages the inbox weighs, audited within staleDays, never
 * audited, or longer ago. `never` and `stale` are the inbox's Not audited rows.
 */
export interface SiteCoverage {
  pages: number;
  audited: number;
  never: number;
  stale: number;
}

export interface AuditOpportunities {
  opportunities: AuditOpportunity[];
  excluded: ExcludedPage[];
  /** An audit older than this many days no longer counts. */
  staleDays: number;
  /** Null from an API older than the web. */
  coverage: SiteCoverage | null;
}

export async function getAuditOpportunities(brandId: string): Promise<AuditOpportunities> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/opportunities?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return {
    opportunities: data.opportunities ?? [],
    excluded: data.excluded ?? [],
    staleDays: data.staleDays ?? 90,
    coverage: data.coverage ?? null,
  };
}

/** Pin, exclude or (null) clear pages of the Opportunities inbox. */
export async function setOpportunityPrefs(
  brandId: string,
  urls: string[],
  state: 'pinned' | 'excluded' | null,
): Promise<void> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/opportunities/prefs`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brandId, urls, state }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }
}

export async function getAuditSettings(brandId: string): Promise<AuditSettings> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/settings?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.settings;
}

/** Save the settings sent; returns them all as saved. */
export async function saveAuditSettings(
  brandId: string,
  changes: AuditSettingsChanges,
): Promise<AuditSettings> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/settings`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brandId, ...changes }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.settings;
}

export async function getLatestAutoRun(brandId: string): Promise<AutoAuditRun | null> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/auto-runs/latest?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.run ?? null;
}

export interface AuditedPages {
  pages: AuditedPage[];
  /** Pages audited for the brand, across all pages of the list. */
  total: number;
  /** The brand's primary host, whose pages are listed by path alone. */
  primaryHost: string | null;
}

/** List a page of the brand's audited pages, most recently audited first. */
export async function getAuditPages(
  brandId: string,
  offset = 0,
  limit = 50,
): Promise<AuditedPages> {
  const session = await getSession();

  const params = new URLSearchParams({
    brandId,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${AEO_SERVER_URL}/api/audits/pages?${params}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  const pages: AuditedPage[] = data.pages ?? [];
  return { pages, total: data.total ?? pages.length, primaryHost: data.primaryHost ?? null };
}

/** The Site Audit hub's main reads: the page shows once they're in. */
export interface AuditHub {
  pages: AuditedPages;
  quota: AuditQuota;
  trend: AuditTrend;
  /** The KPI cards; null when they can't be read (the cards are left out). */
  overview: AuditOverview | null;
}

/**
 * The hub's main reads in one request, run side by side here. Server actions
 * called from the page run one at a time, so separate calls added their
 * times up: 23 s on production (2026-10-19), not the slowest read's 13.
 */
export async function getAuditHub(brandId: string, pageLimit = 50): Promise<AuditHub> {
  const [pages, quota, trend, overview] = await Promise.all([
    getAuditPages(brandId, 0, pageLimit),
    getAuditQuota(),
    getAuditTrend(brandId),
    getAuditOverview(brandId).catch((err) => {
      console.error('Failed to load the Site Audit overview:', err);
      return null;
    }),
  ]);
  return { pages, quota, trend, overview };
}

/** The hub's slower reads, which fill in after the page shows. */
export interface AuditHubExtras {
  /** The Opportunities inbox; null when it can't be read (its tab is left out). */
  opportunities: AuditOpportunities | null;
  /** The latest auto-audit run on the brand's pages; null for none, or when it can't be read. */
  latestRun: AutoAuditRun | null;
}

/**
 * The Opportunities inbox and the latest auto-audit run, side by side, after
 * getAuditHub: the inbox alone took 13 s on production (2026-10-19), and the
 * page needn't wait for it.
 */
export async function getAuditHubExtras(brandId: string): Promise<AuditHubExtras> {
  const [opportunities, latestRun] = await Promise.all([
    getAuditOpportunities(brandId).catch((err) => {
      console.error('Failed to load the Site Audit opportunities:', err);
      return null;
    }),
    getLatestAutoRun(brandId).catch((err) => {
      console.error('Failed to load the latest auto-audit run:', err);
      return null;
    }),
  ]);
  return { opportunities, latestRun };
}

/**
 * "Send to Action Center" on a Site Audit report (learning D2): the page and
 * the checks it fails as one Fix action. The server reads the audit again;
 * the same page sent again returns the action open for it, and an older
 * report of a page audited since is refused with its latest audit's id.
 * Returned, not thrown: a thrown error's message is masked in production.
 */
export async function sendAuditToActionCenter(
  brandId: string,
  auditId: string,
): Promise<
  | { actionId: string; actionNo: number; created: boolean }
  // newer_audit names the page's latest audit, to send from instead.
  | { error: string; code?: string; latestAuditId?: string }
> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${AEO_SERVER_URL}/api/action-center/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, auditId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      error: body.details || body.error || `Server error: ${res.status}`,
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
      ...(typeof body.latestAuditId === 'string' ? { latestAuditId: body.latestAuditId } : {}),
    };
  }
  return res.json();
}
