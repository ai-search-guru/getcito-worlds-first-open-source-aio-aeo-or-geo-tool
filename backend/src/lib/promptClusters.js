/**
 * Prompt clusters (#857): groups of prompts in one topic that a single piece
 * of content can answer, plus each cluster's fan-out basket.
 *
 * Opportunities are generated per prompt today, so one need asked eight ways
 * yields eight near-identical suggestions. Clusters are the unit they will be
 * generated for instead. This module only builds and maintains them:
 *
 * - A scope is a topic, or the brand's prompts with no topic. A scope is
 *   clustered with one model call, and re-clustered only when its active
 *   prompts (ids and text) change.
 * - A rebuild keeps a cluster's id when most of its prompts survive, so
 *   whatever is attached to a cluster later outlives the re-run.
 * - The basket is the sub-queries AI engines searched while answering the
 *   cluster's prompts in the last 30 days, searched in at least two answers.
 *   Each query is judged once, per cluster, as relevant to the cluster and the
 *   brand or not. Later runs only refresh its count.
 */

import { createHash } from 'node:crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './aiProvider.js';
import { getLanguageName } from './languages.js';
import supabaseAdmin from '../config/supabase.js';
import { chunkIds, selectInChunks } from './chunkedIn.js';
import { logger } from './logger.js';

const FANOUT_WINDOW_DAYS = 30;
const FANOUT_MIN_ANSWERS = 2;
/** Queries judged per cluster: the most searched ones. */
export const MAX_QUERIES_PER_CLUSTER = 100;
/** A rebuilt cluster keeps an old cluster's id at this member overlap (Jaccard). */
const KEEP_ID_OVERLAP = 0.5;
/** Model calls in flight at once, for both clustering and judging. */
const CONCURRENCY = 4;
const PAGE = 1000;

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Identity of a scope's active prompts: changes when a prompt is added, removed or edited. */
export function scopeFingerprint(prompts) {
  const lines = prompts.map((p) => `${p.id}\n${p.text}`).sort();
  return createHash('sha1').update(lines.join('\n\n')).digest('hex');
}

/**
 * The model's clusters as rows for replace_prompt_clusters, with every prompt
 * in exactly one cluster. Out-of-range and repeated indexes are dropped (the
 * first cluster to claim a prompt keeps it), empty clusters are dropped, and a
 * prompt the model left out gets a cluster of its own rather than vanishing.
 */
export function normalizeClusters(prompts, clusters) {
  const taken = new Set();
  const rows = [];
  for (const c of clusters || []) {
    const ids = [];
    for (const i of c.promptIndexes || []) {
      if (!Number.isInteger(i) || i < 0 || i >= prompts.length || taken.has(i)) continue;
      taken.add(i);
      ids.push(prompts[i].id);
    }
    if (!ids.length) continue;
    rows.push({
      label: c.label,
      primary_intent: c.primaryIntent,
      secondary_intents: c.secondaryIntents || [],
      prompt_ids: ids,
    });
  }
  prompts.forEach((p, i) => {
    if (taken.has(i)) return;
    rows.push({ label: p.text, primary_intent: p.text, secondary_intents: [], prompt_ids: [p.id] });
  });
  return rows;
}

/**
 * Gives each new cluster the id of the old cluster it mostly continues, so a
 * re-run does not orphan what hangs off a cluster. Pairs are taken by highest
 * overlap first; each old id is used at most once. Unmatched clusters get
 * `id: null` and are created.
 *
 * @param {{prompt_ids: string[]}[]} next
 * @param {{id: string, prompt_ids: string[]}[]} previous
 */
export function keepClusterIds(next, previous) {
  const pairs = [];
  next.forEach((n, ni) => {
    const a = new Set(n.prompt_ids);
    for (const p of previous) {
      const shared = p.prompt_ids.filter((id) => a.has(id)).length;
      const union = a.size + p.prompt_ids.length - shared;
      const overlap = union ? shared / union : 0;
      if (overlap >= KEEP_ID_OVERLAP) pairs.push({ ni, id: p.id, overlap });
    }
  });
  pairs.sort((x, y) => y.overlap - x.overlap);

  const ids = new Map();
  const used = new Set();
  for (const { ni, id } of pairs) {
    if (ids.has(ni) || used.has(id)) continue;
    ids.set(ni, id);
    used.add(id);
  }
  return next.map((n, ni) => ({ ...n, id: ids.get(ni) ?? null }));
}

/**
 * Each cluster's fan-out queries, most searched first, capped. A query that
 * several member prompts searched is counted once per answer: an answer
 * belongs to one prompt, so summing the per-prompt counts is exact.
 *
 * @param {[string, string, number][]} rows - [prompt_id, query, times_searched]
 * @param {Map<string, string>} clusterOf - prompt id → cluster id
 * @returns {Map<string, {query: string, times: number}[]>}
 */
export function clusterQueries(rows, clusterOf) {
  const sums = new Map();
  for (const [promptId, query, times] of rows) {
    const clusterId = clusterOf.get(promptId);
    if (!clusterId) continue;
    if (!sums.has(clusterId)) sums.set(clusterId, new Map());
    const q = sums.get(clusterId);
    q.set(query, (q.get(query) || 0) + Number(times));
  }
  const out = new Map();
  for (const [clusterId, q] of sums) {
    out.set(
      clusterId,
      [...q]
        .map(([query, times]) => ({ query, times }))
        .sort((a, b) => b.times - a.times || a.query.localeCompare(b.query))
        .slice(0, MAX_QUERIES_PER_CLUSTER),
    );
  }
  return out;
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

// ─── Model calls ─────────────────────────────────────────────────────────────

const clusterSchema = z.object({
  clusters: z.array(
    z.object({
      label: z.string().describe('A short name for the shared need, 3 to 7 words'),
      primaryIntent: z
        .string()
        .describe('The need every prompt in the cluster shares, as a short phrase'),
      secondaryIntents: z
        .array(z.string())
        .describe('Narrower angles of the same need that some prompts add, as short phrases'),
      promptIndexes: z
        .array(z.number())
        .describe('The bracketed indexes of the prompts in this cluster'),
    }),
  ),
});

const CLUSTER_SYSTEM_PROMPT = `You group a brand's tracked AI search prompts by intent.

A cluster is a set of prompts that one piece of content could answer well: the same user need, asked in different words or from slightly different angles.

Rules:
- Put every prompt in exactly one cluster.
- Clusters usually hold 3 to 8 prompts. A prompt whose need no other prompt shares stays alone. Do not pad clusters to reach a size.
- Group by need, not by shared words. "How do I track my brand in ChatGPT?" and "What tools monitor AI search visibility?" belong together; "ChatGPT pricing" does not join them just because it names ChatGPT.
- Prefer fewer clusters when one article could cover the prompts well. Asking how something works and asking how to influence it usually belong together.
- Split prompts that would need different content, for example a how-to guide versus a comparison of vendors.
- Refer to prompts only by their bracketed index in promptIndexes.`;

export async function clusterScope(brand, topicName, prompts) {
  if (prompts.length === 1) return normalizeClusters(prompts, []);
  const { object } = await generateObject({
    model: resolveModel(process.env.PROMPT_CLUSTER_MODEL),
    schema: clusterSchema,
    system: CLUSTER_SYSTEM_PROMPT,
    prompt: `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
Topic: ${topicName || 'No topic'}

Prompts:
${prompts.map((p, i) => `[${i}] ${p.text}`).join('\n')}

Write every label and intent in ${getLanguageName(brand.language)}.`,
  });
  return normalizeClusters(prompts, object.clusters);
}

const judgeSchema = z.object({
  decisions: z.array(
    z.object({
      index: z.number(),
      included: z.boolean(),
      reason: z.string().describe('Why, in at most 12 words'),
    }),
  ),
});

const JUDGE_SYSTEM_PROMPT = `You decide which search queries belong in a content opportunity.

AI engines searched these queries while answering the cluster's prompts. Include a query when content written for the cluster's need should answer it and it matters to this brand's business. Exclude it when it is about something else that only shares words with the cluster (for example a product's pricing, news or an unrelated feature), or when it is relevant to the topic but not to what this brand offers.

Queries that look up a competitor's or another vendor's product for the same need are relevant: content that compares the options has to answer them.

Return one decision per query, referring to it by its bracketed index.`;

export async function judgeQueries(brand, cluster, prompts, queries) {
  const { object } = await generateObject({
    model: resolveModel(process.env.PROMPT_CLUSTER_MODEL),
    schema: judgeSchema,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
About the brand: ${brand.description || 'Not specified'}

Cluster: ${cluster.label}
Need: ${cluster.primary_intent}
Prompts:
${prompts.map((t) => `- ${t}`).join('\n')}

Queries:
${queries.map((q, i) => `[${i}] ${q}`).join('\n')}

Write every reason in ${getLanguageName(brand.language)}.`,
  });
  const decisions = new Map();
  for (const d of object.decisions) {
    if (Number.isInteger(d.index) && d.index >= 0 && d.index < queries.length) {
      if (!decisions.has(queries[d.index])) decisions.set(queries[d.index], d);
    }
  }
  return decisions;
}

// ─── Reads and writes ────────────────────────────────────────────────────────

/** A brand's clusters with their member prompt ids. */
export async function loadClusters(brandId) {
  const { data: clusters, error } = await supabaseAdmin
    .from('prompt_clusters')
    .select('id, topic_id, label, primary_intent')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);

  const { data: members, error: mErr } = await selectInChunks(
    (clusters || []).map((c) => c.id),
    (chunk) =>
      supabaseAdmin
        .from('prompt_cluster_members')
        .select('prompt_id, cluster_id')
        .in('cluster_id', chunk),
    // Fifty clusters stay under PostgREST's 1,000-row page.
    50,
  );
  if (mErr) throw new Error(mErr.message);

  const byCluster = new Map((clusters || []).map((c) => [c.id, { ...c, prompt_ids: [] }]));
  for (const m of members || []) byCluster.get(m.cluster_id)?.prompt_ids.push(m.prompt_id);
  return [...byCluster.values()];
}

async function loadJudged(clusterIds) {
  const judged = new Map();
  // Ten clusters hold at most 1,000 rows, PostgREST's page.
  for (const chunk of chunkIds(clusterIds, Math.floor(PAGE / MAX_QUERIES_PER_CLUSTER))) {
    const { data, error } = await supabaseAdmin
      .from('prompt_cluster_queries')
      .select('cluster_id, query, included, reason, judged_at')
      .in('cluster_id', chunk);
    if (error) throw new Error(error.message);
    for (const r of data || []) judged.set(`${r.cluster_id}\n${r.query}`, r);
  }
  return judged;
}

async function refreshScopes(brand, prompts, topics) {
  const scopes = new Map();
  for (const p of prompts) {
    const key = p.topic_id ?? null;
    if (!scopes.has(key)) scopes.set(key, []);
    scopes.get(key).push(p);
  }

  const { data: stored, error } = await supabaseAdmin
    .from('prompt_cluster_scopes')
    .select('topic_id, fingerprint')
    .eq('brand_id', brand.id);
  if (error) throw new Error(error.message);
  const storedPrints = new Map((stored || []).map((s) => [s.topic_id ?? null, s.fingerprint]));
  // Scopes that lost all their active prompts are emptied too.
  for (const key of storedPrints.keys()) if (!scopes.has(key)) scopes.set(key, []);

  const stale = [...scopes].filter(
    ([key, list]) => storedPrints.get(key) !== scopeFingerprint(list),
  );
  if (!stale.length) return 0;

  const existing = await loadClusters(brand.id);
  const topicName = new Map(topics.map((t) => [t.id, t.name]));

  await inBatches(stale, async ([topicId, list]) => {
    try {
      const next = list.length ? await clusterScope(brand, topicName.get(topicId), list) : [];
      const previous = existing.filter((c) => (c.topic_id ?? null) === topicId);
      const { error: rpcErr } = await supabaseAdmin.rpc('replace_prompt_clusters', {
        p_brand_id: brand.id,
        p_topic_id: topicId,
        p_fingerprint: scopeFingerprint(list),
        p_clusters: keepClusterIds(next, previous),
      });
      if (rpcErr) throw new Error(rpcErr.message);
    } catch (err) {
      // The fingerprint was not written, so the scope is retried next run.
      logger.error({ err, brandId: brand.id, topicId }, '[clusters] clustering a scope failed');
    }
  });
  return stale.length;
}

async function refreshBaskets(brand, prompts) {
  const runStart = new Date().toISOString();
  const clusters = await loadClusters(brand.id);
  if (!clusters.length) return { judged: 0 };

  const since = new Date(Date.now() - FANOUT_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: rows, error } = await supabaseAdmin.rpc('brand_prompt_fanout_queries', {
    p_brand_id: brand.id,
    p_since: since,
    p_min_answers: FANOUT_MIN_ANSWERS,
  });
  if (error) throw new Error(error.message);

  const clusterOf = new Map();
  for (const c of clusters) for (const id of c.prompt_ids) clusterOf.set(id, c.id);
  const basket = clusterQueries(rows || [], clusterOf);
  const judged = await loadJudged(clusters.map((c) => c.id));
  const promptText = new Map(prompts.map((p) => [p.id, p.text]));

  let judgedCount = 0;
  await inBatches(clusters, async (cluster) => {
    const queries = basket.get(cluster.id) || [];
    if (!queries.length) return;
    try {
      const fresh = queries
        .filter((q) => !judged.has(`${cluster.id}\n${q.query}`))
        .map((q) => q.query);
      const decisions = fresh.length
        ? await judgeQueries(
            brand,
            cluster,
            cluster.prompt_ids.map((id) => promptText.get(id)).filter(Boolean),
            fresh,
          )
        : new Map();
      judgedCount += decisions.size;

      const upserts = [];
      for (const q of queries) {
        const prior = judged.get(`${cluster.id}\n${q.query}`);
        const decision = decisions.get(q.query);
        // A query the model skipped stays unjudged and is asked about next run.
        if (!prior && !decision) continue;
        upserts.push({
          cluster_id: cluster.id,
          query: q.query,
          times_searched: q.times,
          included: prior ? prior.included : decision.included,
          reason: prior ? prior.reason : decision.reason,
          judged_at: prior ? prior.judged_at : runStart,
          last_seen_at: runStart,
        });
      }
      if (upserts.length) {
        const { error: upErr } = await supabaseAdmin
          .from('prompt_cluster_queries')
          .upsert(upserts, { onConflict: 'cluster_id,query' });
        if (upErr) throw new Error(upErr.message);
      }
    } catch (err) {
      logger.error(
        { err, brandId: brand.id, clusterId: cluster.id },
        '[clusters] basket refresh failed',
      );
    }
  });

  // Queries that fell out of the window or out of the cluster's top list.
  for (const chunk of chunkIds(clusters.map((c) => c.id))) {
    const { error: delErr } = await supabaseAdmin
      .from('prompt_cluster_queries')
      .delete()
      .in('cluster_id', chunk)
      .lt('last_seen_at', runStart);
    if (delErr) throw new Error(delErr.message);
  }
  return { judged: judgedCount };
}

/**
 * Brings a brand's clusters and baskets up to date. Safe to run after every
 * tracking cycle: unchanged scopes and already-judged queries cost no model
 * call.
 */
export async function refreshPromptClusters(brandId) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, industry, description, language')
    .eq('id', brandId)
    .single();
  if (!brand) return;

  const { data: sets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  const prompts = [];
  if (sets?.length) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('prompts')
        .select('id, text, topic_id')
        .in(
          'prompt_set_id',
          sets.map((s) => s.id),
        )
        .eq('is_active', true)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      prompts.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }

  const { data: topics } = await supabaseAdmin
    .from('topics')
    .select('id, name')
    .eq('brand_id', brandId);

  const reclustered = await refreshScopes(brand, prompts, topics || []);
  const { judged } = await refreshBaskets(brand, prompts);
  logger.info({ brandId, prompts: prompts.length, reclustered, judged }, '[clusters] refreshed');
}
