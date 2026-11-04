'use server';

import { createClient } from '@/lib/supabase/server';
import type { ContentBrief, ContentOpportunity, OpportunityBasket, WebhookConfig } from '@/types';
import { API_BASE_URL } from '@/config/api';
import { apiFailure, type ApiFailure } from '@/lib/apiFailure';
import type { ContentUsage } from '@/lib/contentUsage';
import { assertWritable } from '@/lib/subscriptionGuard';
import type { NoPlanMark } from '@/lib/billing/noPlan';
import type { QuestionVolume } from '@/lib/content/questionVolume';

const AEO_SERVER_URL = API_BASE_URL;

async function getSession() {
  const session = await sessionOrNull();
  if (!session) throw new Error('Not authenticated');
  return session;
}

async function sessionOrNull() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * No session, for the calls whose errors come back as values: the toast then
 * offers Sign in (BUG-001). Thrown, the reason wouldn't reach the browser, as
 * Next.js hides a server action's error message in production.
 */
const NO_SESSION = { ok: false as const, error: 'Not authenticated', failure: 'session' as const };

/** What a "+ New" request asks for (CONTENT-003). */
export interface OnDemandRequest {
  brandId: string;
  count: number;
  topicId?: string | null;
  promptId?: string | null;
  idea?: string | null;
  /** One page of AI Traffic's Pages section (AT-006 part B3), as a path: one opportunity. */
  pagePath?: string | null;
  /** One per submit, so a double click or a retried request starts one job. */
  idempotencyKey: string;
}

export type OnDemandResult =
  | { ok: true; jobId: string; count: number }
  | {
      ok: false;
      error: string;
      /** Why, for the toast to say in plain words (BUG-001). */
      failure: ApiFailure;
      quotaExhausted?: boolean;
      periodEnd?: string | null;
    };

/** Starts generating opportunities now ("+ New"); errors come back as values. */
export async function generateOpportunitiesOnDemand(
  request: OnDemandRequest,
): Promise<OnDemandResult> {
  const session = await sessionOrNull();
  if (!session) return NO_SESSION;

  const res = await fetch(`${AEO_SERVER_URL}/api/content/opportunities/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(request),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body.message || body.error || `Server error: ${res.status}`,
      failure: apiFailure(res.status, body),
      quotaExhausted: body.error === 'quota_exhausted',
      periodEnd: body.periodEnd ?? null,
    };
  }
  return { ok: true, jobId: body.jobId, count: body.count };
}

export interface GenerationJobStatus {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'not_found';
  progress: { phase: string; message: string } | null;
  result: {
    generated: number;
    /** Skipped as duplicates of existing opportunities (CONTENT-004); not counted. */
    duplicates?: number;
    /** The month's quota ran out before anything could be generated. */
    limited?: boolean;
    /** The opportunities this run created, newest work first. */
    opportunityIds?: string[];
    /** A run for one prompt wrote nothing: the open opportunity that answers it. */
    existingId?: string;
    /** A run for one page found no tracked prompts about it (AT-006 part B3). */
    noMatch?: boolean;
  } | null;
  failedReason: string | null;
}

export async function getGenerationJobStatus(jobId: string): Promise<GenerationJobStatus> {
  const session = await getSession();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/content/job/${jobId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { status: 'not_found', progress: null, result: null, failedReason: null };
    }

    const data = await res.json();
    return {
      status: data.status ?? 'not_found',
      progress:
        data.progress && typeof data.progress === 'object' && data.progress.phase
          ? data.progress
          : null,
      result: data.result ?? null,
      failedReason: data.failedReason ?? null,
    };
  } catch {
    return { status: 'not_found', progress: null, result: null, failedReason: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOpportunities(
  brandId: string,
  filters?: {
    status?: string;
    impact?: string;
    q?: string;
    type?: string;
    promptId?: string;
    topicId?: string;
    source?: string;
    /** Suggested on or after / before (ISO), CONTENT-002. */
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
    offset?: number;
    sort?: string;
  },
): Promise<{
  opportunities: ContentOpportunity[];
  total: number;
  aggregates: {
    avgScore: number;
    highImpactCount: number;
    sentCount: number;
    signalCount: number;
  };
}> {
  const session = await getSession();

  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.impact) params.set('impact', filters.impact);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.promptId) params.set('prompt_id', filters.promptId);
  if (filters?.topicId) params.set('topic_id', filters.topicId);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.createdFrom) params.set('created_from', filters.createdFrom);
  if (filters?.createdTo) params.set('created_to', filters.createdTo);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  if (filters?.sort) params.set('sort', filters.sort);

  const qs = params.toString();
  const url = `${AEO_SERVER_URL}/api/content/brand/${brandId}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export interface OpportunityPrompt {
  promptId: string;
  text: string;
  /** Opportunities generated for this prompt, across every status. */
  count: number;
}

/** The prompts a brand's opportunities belong to, most opportunities first (#836). */
export async function getOpportunityPrompts(brandId: string): Promise<OpportunityPrompt[]> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/brand/${brandId}/prompts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const body = (await res.json()) as { prompts: OpportunityPrompt[] };
  return body.prompts;
}

export async function sendOpportunityToActionCenter(
  id: string,
  assetKey?: string,
): Promise<{ actionId: string; created: boolean } | { error: string }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ assetKey: assetKey ?? null }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}

export interface OpportunityActionResult {
  id: string;
  actionNo: number;
  title: string | null;
  status: string;
  outcome: string;
  completedAt: string | null;
  validatedAt: string | null;
  metrics: { metric: string; unit: string; before: number | null; after: number | null }[];
}

/**
 * The Action Center actions sent from an opportunity, with what they measured.
 * Read with the user's session, so RLS keeps it to their organization.
 */
export async function getOpportunityActions(ids: string[]): Promise<OpportunityActionResult[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('actions')
    .select('id, action_no, status, outcome, completed_at, validated_at, validation, payload')
    .in('id', ids)
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as { title?: string };
    const validation = (row.validation ?? null) as {
      metrics?: OpportunityActionResult['metrics'];
    } | null;
    return {
      id: row.id,
      actionNo: Number(row.action_no),
      title: payload.title ?? null,
      status: row.status,
      outcome: row.outcome,
      completedAt: row.completed_at,
      validatedAt: row.validated_at,
      metrics: validation?.metrics ?? [],
    };
  });
}

export interface OpportunityTopic {
  topicId: string;
  name: string;
  count: number;
}

export async function getOpportunityTopics(brandId: string): Promise<OpportunityTopic[]> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/brand/${brandId}/topics`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const body = (await res.json()) as { topics: OpportunityTopic[] };
  return body.topics;
}

/** Needs (prompt groups) by what "+ New" can still do for them. */
export interface NeedCounts {
  /** With tracked answers and no opportunity yet: New can write for these. */
  open: number;
  /** Already have an opportunity. */
  covered: number;
  /** No tracked answers in the last 30 days yet: nothing to write from. */
  noAnswers: number;
}

/** What "+ New" can still write for, read when its dialog opens. */
export interface OpportunityAvailability extends NeedCounts {
  needs: number;
  /** Per topic id, and `none` for prompts without a topic. */
  topics: Record<string, NeedCounts>;
  /** Prompt id → the open opportunity its need already has. */
  promptOpportunity: Record<string, string>;
}

export async function getOpportunityAvailability(
  brandId: string,
): Promise<OpportunityAvailability> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/brand/${brandId}/availability`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function getOpportunity(id: string): Promise<ContentOpportunity> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function getOpportunityBasket(id: string): Promise<OpportunityBasket> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/basket`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/**
 * An opportunity's volume: its question's, the prompt it is shown with
 * (questionVolume.ts). Null when the prompt isn't the brand's or has none.
 */
export async function getQuestionVolume(
  brandId: string,
  promptId: string,
): Promise<QuestionVolume | null> {
  const supabase = await createClient();
  // Imported here: the admin client is created at module load and needs the
  // service-role env, which only this read uses (as tracking.ts does).
  const { readQuestionVolume } = await import('@/lib/content/questionVolumeRead');
  return readQuestionVolume(supabase, brandId, promptId);
}

export interface BriefQuota extends NoPlanMark {
  used: number;
  limit: number;
  remaining: number;
}

export async function getBriefQuota(): Promise<BriefQuota> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/briefs/quota`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/** Both monthly content counters and their period (CONTENT-001). */
export async function getContentUsage(): Promise<ContentUsage> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/usage`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function generateBrief(
  opportunityId: string,
): Promise<{ brief: ContentBrief; quota: BriefQuota | null }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${opportunityId}/brief`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { brief: data.brief, quota: data.quota ?? null };
}

export async function updateOpportunityStatus(
  id: string,
  status: string,
  /** Why it was dismissed (CONTENT-006); only read with status 'dismissed'. */
  reason?: 'not_relevant' | 'wrong_angle',
): Promise<ContentOpportunity> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export type SendToWebhookResult =
  | { success: true; webhookStatus: number; opportunityStatus: string }
  | { success: false; error: string };

export async function sendToWebhook(id: string): Promise<SendToWebhookResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/send-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    let error = body.error || `Server error: ${res.status}`;
    if (error.includes('No active webhook')) {
      error = 'No workflow connected';
    }
    return { success: false, error };
  }

  const data = await res.json();
  return {
    success: true,
    webhookStatus: data.webhookStatus,
    opportunityStatus: data.opportunityStatus,
  };
}

/** Why the API didn't run a webhook test: not an admin or manager, or a general reason. */
export type WebhookTestFailure = 'forbidden' | ApiFailure;

export interface WebhookTestResult {
  success: boolean;
  /** The webhook's HTTP status; 0 when it wasn't reached or the test didn't run. */
  status: number;
  /** Why the address was refused or couldn't be reached. */
  error?: string;
  /** Where a redirect (3xx) points. */
  location?: string;
  /** Set when the API refused the test itself, rather than the webhook answering. */
  failure?: WebhookTestFailure;
}

/**
 * Test Webhook for a brand whose webhook the caller can edit (#1568 review).
 * The API's refusals come back as values: thrown, Next.js would hide why.
 */
export async function testWebhook(
  brandId: string,
  webhookUrl: string,
  webhookSecret?: string,
): Promise<WebhookTestResult> {
  const session = await sessionOrNull();
  if (!session) return { success: false, status: 0, failure: 'session' };

  const res = await fetch(`${AEO_SERVER_URL}/api/content/webhook-test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, webhookUrl, webhookSecret }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      success: false,
      status: 0,
      failure: body.code === 'forbidden' ? 'forbidden' : apiFailure(res.status, body),
    };
  }

  return res.json();
}

export async function bulkUpdateStatus(
  ids: string[],
  status: string,
): Promise<{ updated: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ids, status }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/**
 * Permanently delete opportunities (#731).
 *
 * Distinct from `bulkUpdateStatus(ids, 'dismissed')`, which only moves a row
 * behind a status filter. Anything deleted here is gone, including any brief
 * generated for it.
 */
export async function bulkDeleteOpportunities(ids: string[]): Promise<{ deleted: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ids }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export type BulkSendResult =
  | {
      success: true;
      sent: number;
      failed: number;
      /** Of the failed, those whose webhook redirects (0 from an API before #1590's follow-up). */
      redirected: number;
    }
  | {
      success: false;
      error: string;
    };

export async function bulkSendToWebhook(ids: string[]): Promise<BulkSendResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/send-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ids }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    let error = body.error || `Server error: ${res.status}`;
    if (error.includes('No active webhook')) {
      error = 'No workflow connected';
    }
    return { success: false, error };
  }

  const data = await res.json();
  return {
    success: true,
    sent: data.sent,
    failed: data.failed,
    redirected: data.redirected ?? 0,
  };
}

export async function getWebhookConfig(brandId: string): Promise<WebhookConfig | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('webhook_configs')
    .select('*')
    .eq('brand_id', brandId)
    .limit(1)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    brandId: data.brand_id,
    name: data.name,
    webhookUrl: data.webhook_url,
    webhookSecret: data.webhook_secret || undefined,
    events: data.events || [],
    isActive: data.is_active ?? false,
    createdAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}

export async function saveWebhookConfig(
  brandId: string,
  config: {
    webhookUrl: string;
    webhookSecret?: string;
    events: string[];
    isActive?: boolean;
  },
): Promise<WebhookConfig> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const allowedEvents = [
    'opportunity.sent',
    'daily_pulse.created',
    'action_task.sent',
    'content_draft.sent',
  ];
  const events = Array.from(new Set(config.events)).filter((event) =>
    allowedEvents.includes(event),
  );
  if (events.length === 0) throw new Error('Select at least one webhook event.');

  const { data, error } = await supabase
    .from('webhook_configs')
    .upsert(
      {
        brand_id: brandId,
        name: 'Default',
        webhook_url: config.webhookUrl,
        webhook_secret: config.webhookSecret || null,
        events,
        is_active: config.isActive ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,name' },
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    brandId: data.brand_id,
    name: data.name,
    webhookUrl: data.webhook_url,
    webhookSecret: data.webhook_secret || undefined,
    events: data.events || [],
    isActive: data.is_active ?? false,
    createdAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}

export type AlternativeResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      error: string;
      failure: ApiFailure;
      quotaExhausted?: boolean;
      noCluster?: boolean;
    };

/**
 * "Another angle" (CONTENT-006): starts generating one more opportunity for
 * the same need with a different angle. Errors come back as values.
 */
export async function suggestAlternative(
  id: string,
  { direction, idempotencyKey }: { direction?: string | null; idempotencyKey: string },
): Promise<AlternativeResult> {
  const session = await sessionOrNull();
  if (!session) return NO_SESSION;

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/alternative`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ direction: direction || null, idempotencyKey }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body.message || body.error || `Server error: ${res.status}`,
      failure: apiFailure(res.status, body),
      quotaExhausted: body.error === 'quota_exhausted',
      noCluster: body.error === 'no_cluster',
    };
  }
  return { ok: true, jobId: body.jobId };
}

export type PromptSuggestionResult =
  | { ok: true; jobId: string }
  | { ok: true; existingId: string }
  | { ok: false; error: string; failure: ApiFailure; quotaExhausted?: boolean };

/**
 * "Suggest content" from the prompts table (PROMPT-006): one content
 * opportunity for the prompt, or the open one it already has. Errors come
 * back as values.
 */
export async function suggestContentForPrompt(
  promptId: string,
  idempotencyKey: string,
): Promise<PromptSuggestionResult> {
  const session = await sessionOrNull();
  if (!session) return NO_SESSION;

  const res = await fetch(`${AEO_SERVER_URL}/api/content/prompts/${promptId}/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ idempotencyKey }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body.message || body.error || `Server error: ${res.status}`,
      failure: apiFailure(res.status, body),
      quotaExhausted: body.error === 'quota_exhausted',
    };
  }
  return body.existingId
    ? { ok: true, existingId: body.existingId }
    : { ok: true, jobId: body.jobId };
}

/**
 * The prompt's open content opportunity, if any (PROMPT-006): with the
 * month's quota used up, the row menu can still open it. Null when there is
 * none or it can't be read.
 */
export async function getOpenSuggestionForPrompt(promptId: string): Promise<string | null> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/prompts/${promptId}/suggestion`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.existingId ?? null;
}
