import { goLiveGate } from '@/lib/content/goLiveGate';
import { SOURCES_DAYS } from '@/lib/content/sources';
import { getContentDraftPackageFor } from '@/lib/mcp/contentPackage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { foreignLink, outgoingTextCheck, type UntrustedShingles } from './goLiveChecks';
import {
  joinSites,
  sitesFromRead,
  sitesOfDomains,
  sitesOfPages,
  type PageSites,
} from './pageSites';
import type { GoLiveFacts, PrecedenceContext } from './precedence';
import type { GoLiveStep } from './registry/defineTool';

/**
 * What step 4b's guards decide on for one call (AUTONOMOUS-GO-LIVE §5.2,
 * §6), read only for a candidate (goLiveCandidate) and in the guards' order,
 * each only once those before it passed: the run's start, the page as it
 * will go out (as Send to CMS makes it), its text and links, whether it is
 * live already, its quality and brand facts (the gate, which may make the
 * run's own AI reads), and the agent's go-lives in the last 24 hours. A read
 * that fails leaves its fact out, and the step keeps its click. Never
 * throws. Server only.
 */

/** A page as the API's send takes it (backend/src/lib/contentDelivery.js deliveryPage). */
export interface GoLivePage {
  draftId: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  html: string;
  author: string | null;
  reviewer: string | null;
  featuredImage: { src: string; alt: string } | null;
}

export interface GoLiveRead {
  ctx: PrecedenceContext;
  step: GoLiveStep;
  /** The person the run acts as: its owner, or who clicked Run now. */
  actingUserId: string;
  /** The Chat run, and the agent run it is. */
  runId: string;
  agentRunId: string;
  /** How the run started, and its untrusted reads' word runs (goLiveChecks.ts). */
  progress: {
    scopeUntrusted?: boolean;
    fromTaintedMove?: boolean;
    untrustedShingles?: UntrustedShingles;
  };
  /** The sites the run may open: the brand's, the person's words', its reads' structured fields. */
  runSites: () => Promise<PageSites>;
}

/** The rolling window of an agent's daily limit (reserve_agent_go_live's). */
const DAY_MS = 24 * 60 * 60 * 1000;
/** The statuses that hold a slot: a page taken down went out all the same. */
const COUNTED = ['reserved', 'done', 'taken_down'];

/**
 * The facts, and the page they were read on: the engine sends that page,
 * so what was checked is what goes out. No page when the facts stop before.
 */
export async function readGoLiveFacts(
  read: GoLiveRead,
): Promise<{ facts: GoLiveFacts; page: GoLivePage | null }> {
  const facts: GoLiveFacts = {
    runUntrusted: read.progress.scopeUntrusted === true || read.progress.fromTaintedMove === true,
  };
  if (read.ctx.injectionDetected || facts.runUntrusted) return { facts, page: null };
  try {
    return await readInOrder(read, facts);
  } catch (err) {
    console.error('[chat/go-live] could not read what going live on its own decides on:', err);
    return { facts, page: null };
  }
}

async function readInOrder(
  read: GoLiveRead,
  facts: GoLiveFacts,
): Promise<{ facts: GoLiveFacts; page: GoLivePage | null }> {
  const { ctx, step } = read;
  const packaged = await getContentDraftPackageFor(
    {
      userId: read.actingUserId,
      email: null,
      organizationId: ctx.organizationId,
      role: ctx.role,
      apiKeyId: '',
    },
    step.draftId,
  );
  if ('error' in packaged) {
    // Not found: nothing to decide on; the click says so when it runs.
    if (packaged.error === 'not_ready') {
      facts.page = packaged.problem === 'placeholders' ? 'placeholders' : 'fields';
    }
    return { facts, page: null };
  }
  facts.page = 'ready';
  const page: GoLivePage = {
    draftId: packaged.draft_id,
    title: packaged.title,
    slug: packaged.slug,
    metaTitle: packaged.meta_title,
    metaDescription: packaged.meta_description,
    html: packaged.html,
    author: packaged.author,
    reviewer: packaged.reviewer,
    featuredImage: packaged.featured_image,
  };

  const [draft, published, takenDown, sources] = await Promise.all([
    supabaseAdmin
      .from('content_drafts')
      .select('published_url, kept_sources')
      .eq('id', step.draftId)
      .maybeSingle(),
    supabaseAdmin
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', step.draftId)
      .eq('status', 'published')
      .limit(1)
      .maybeSingle(),
    // A send taken down (00460); before it, no such status: nothing taken down.
    supabaseAdmin
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', step.draftId)
      .eq('status', 'taken_down')
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.rpc('content_draft_sources', { p_draft_id: step.draftId, p_days: SOURCES_DAYS }),
  ]);
  for (const result of [draft, published, takenDown, sources]) {
    if (result.error) throw new Error(result.error.message);
  }

  // Its text and links, on the page as it goes out (§6.3 Part B).
  const textHold = outgoingTextCheck(page.html, read.progress.untrustedShingles);
  if (textHold) {
    facts.text = { hold: textHold };
    return { facts, page };
  }
  const listed = (sources.data ?? {}) as {
    brandDomains?: string[];
    competitorDomains?: string[];
    citedPages?: { url?: string }[];
  };
  const sites = joinSites(
    await read.runSites(),
    sitesOfDomains(listed.brandDomains ?? []),
    // A competitor's domain is a host, as its read lists it (pageSites.ts).
    sitesFromRead(
      'list_competitors',
      (listed.competitorDomains ?? []).map((domain) => ({ domain })),
    ),
    sitesOfPages([
      ...(listed.citedPages ?? []).map((cited) => cited.url),
      ...(draft.data?.kept_sources ?? []),
    ]),
  );
  const host = foreignLink(page.html, sites);
  facts.text = host ? { hold: 'foreign_link', host } : { hold: null };
  if (host) return { facts, page };

  facts.liveItem = !!draft.data?.published_url || !!published.data;
  if (facts.liveItem) return { facts, page };
  // A page someone took down never goes live on its own again (PR 10).
  facts.takenDown = !!takenDown.data;
  if (facts.takenDown) return { facts, page };

  if (ctx.role !== 'admin' && ctx.role !== 'manager') return { facts, page };
  facts.gate = await goLiveGate({
    organizationId: ctx.organizationId,
    draftId: step.draftId,
    agentRunId: read.agentRunId,
    runId: read.runId,
    actingUserId: read.actingUserId,
    actingRole: ctx.role,
  });
  if (!facts.gate.pass) return { facts, page };

  facts.usage = await readUsage(ctx.agent?.id ?? null, step);
  return { facts, page };
}

/**
 * The agent's go-lives in the last 24 hours as reserve_agent_go_live counts
 * them: one per page and destination, a page's own counted already (it takes
 * no new slot), and when the first slot frees: a pair's latest step, a day on.
 */
async function readUsage(agentId: string | null, step: GoLiveStep): Promise<GoLiveFacts['usage']> {
  if (!agentId) return undefined;
  const { data, error } = await supabaseAdmin
    .from('chat_agent_go_live_events')
    .select('content_draft_id, target, created_at')
    .eq('agent_id', agentId)
    .in('status', COUNTED)
    .gt('created_at', new Date(Date.now() - DAY_MS).toISOString())
    .limit(500);
  if (error) throw new Error(error.message);
  const latest = new Map<string, number>();
  for (const row of data ?? []) {
    const key = `${row.content_draft_id ?? ''}|${row.target}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, Date.parse(row.created_at)));
  }
  const frees = [...latest.values()].map((at) => at + DAY_MS);
  return {
    used: latest.size,
    counted: latest.has(`${step.draftId}|${step.target}`),
    nextAt: frees.length ? new Date(Math.min(...frees)).toISOString() : null,
  };
}
