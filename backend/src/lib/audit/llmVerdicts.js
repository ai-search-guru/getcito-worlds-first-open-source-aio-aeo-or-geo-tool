/**
 * The Site Audit's kept AI verdicts (00430 site_audit_llm_verdicts): each
 * AI-judged signal's verdict by the hash of the input it was judged from, the
 * signal, the model and the prompt version, so an unchanged page reads its
 * verdicts back with no AI call (llmSignals.js). Reads and writes never
 * throw: a failed read judges the page again, a failed write keeps nothing.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { pageKey } from './history.js';

/** How long a verdict no audit has read is kept. */
export const VERDICT_RETENTION_DAYS = 180;
/** Verdicts deleted per prune call. */
export const VERDICT_PRUNE_BATCH = 1000;
/** Prune calls per daily run at most; the rest waits a day. */
export const MAX_VERDICT_PRUNE_CALLS = 100;

/** Completed audits of a brand read to find a page's latest one. */
export const LAST_VERDICTS_AUDITS = 500;

const pairKey = (inputHash, signalKey) => `${inputHash}|${signalKey}`;

/**
 * The kept verdicts of the given (inputHash, signalKey) pairs under one model
 * and prompt version, by `${inputHash}|${signalKey}`. The rows read are marked
 * used, so the prune keeps them.
 *
 * @param {Array<{ inputHash: string, signalKey: string }>} pairs
 * @param {{ model: string, promptVersion: string, now?: Date }} options
 * @returns {Promise<Map<string, { status: string, score: number|null, reason: string }>>}
 */
export async function readVerdicts(pairs, { model, promptVersion, now = new Date() }) {
  const found = new Map();
  if (pairs.length === 0) return found;
  const wanted = new Set(pairs.map((p) => pairKey(p.inputHash, p.signalKey)));
  const { data, error } = await supabaseAdmin
    .from('site_audit_llm_verdicts')
    .select('id, input_hash, signal_key, status, score, reason')
    .eq('model', model)
    .eq('prompt_version', promptVersion)
    .in('input_hash', [...new Set(pairs.map((p) => p.inputHash))])
    .in('signal_key', [...new Set(pairs.map((p) => p.signalKey))]);
  if (error) {
    logger.warn({ err: error }, '[audit] kept AI verdicts read failed; judging again');
    return found;
  }
  const ids = [];
  for (const row of data ?? []) {
    const key = pairKey(row.input_hash, row.signal_key);
    if (!wanted.has(key)) continue;
    ids.push(row.id);
    found.set(key, {
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      reason: row.reason ?? '',
    });
  }
  if (ids.length > 0) {
    const { error: touchErr } = await supabaseAdmin
      .from('site_audit_llm_verdicts')
      .update({ used_at: now.toISOString() })
      .in('id', ids);
    if (touchErr) logger.warn({ err: touchErr }, '[audit] kept AI verdicts touch failed');
  }
  return found;
}

/**
 * Keep new verdicts. A verdict already kept for the same key stays as it is,
 * so two audits of one page at once keep the first.
 *
 * @param {Array<{ inputHash: string, signalKey: string, status: string, score: number|null, reason: string }>} verdicts
 * @param {{ model: string, promptVersion: string }} options
 */
export async function saveVerdicts(verdicts, { model, promptVersion }) {
  if (verdicts.length === 0) return;
  const { error } = await supabaseAdmin.from('site_audit_llm_verdicts').upsert(
    verdicts.map((v) => ({
      input_hash: v.inputHash,
      signal_key: v.signalKey,
      model,
      prompt_version: promptVersion,
      status: v.status,
      score: v.score,
      reason: String(v.reason ?? '').slice(0, 500),
    })),
    { onConflict: 'input_hash,signal_key,model,prompt_version', ignoreDuplicates: true },
  );
  if (error) logger.warn({ err: error }, '[audit] AI verdicts not kept');
}

/**
 * The AI-judged verdicts of the brand's latest complete (not partial) audit
 * of the same page, by signal key, for an audit whose AI call failed: the
 * page keeps the verdicts it had. A verdict that audit couldn't judge
 * either is left out.
 *
 * @param {string} brandId
 * @param {string} url
 * @param {string[]} signalKeys
 * @returns {Promise<Map<string, { status: string, score: number|null, reason: string, auditId: string }>>}
 */
export async function lastPageVerdicts(brandId, url, signalKeys) {
  const verdicts = new Map();
  const key = pageKey(url)?.key;
  if (!key) return verdicts;
  const { data: audits, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, final_url')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .eq('partial', false)
    .order('created_at', { ascending: false })
    .limit(LAST_VERDICTS_AUDITS);
  if (error) throw error;
  const audit = (audits ?? []).find((a) => pageKey(a.final_url ?? a.url)?.key === key);
  if (!audit) return verdicts;

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, status, score, evidence')
    .eq('audit_id', audit.id)
    .in('signal_key', signalKeys);
  if (rowsErr) throw rowsErr;
  for (const row of rows ?? []) {
    if (row.evidence?.error) continue;
    verdicts.set(row.signal_key, {
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      reason: typeof row.evidence?.reason === 'string' ? row.evidence.reason : '',
      auditId: audit.id,
    });
  }
  return verdicts;
}

/**
 * The daily prune of verdicts no audit has read for VERDICT_RETENTION_DAYS,
 * VERDICT_PRUNE_BATCH a call (00430 site_audit_llm_verdicts_prune). Stops
 * when a call deletes fewer than a batch.
 */
export async function pruneLlmVerdicts(now = Date.now()) {
  const before = new Date(now - VERDICT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  for (let call = 0; call < MAX_VERDICT_PRUNE_CALLS; call++) {
    const { data, error } = await supabaseAdmin.rpc('site_audit_llm_verdicts_prune', {
      p_before: before,
      p_limit: VERDICT_PRUNE_BATCH,
    });
    if (error) {
      logger.warn({ err: error }, '[audit] AI verdicts prune failed');
      return;
    }
    if ((data ?? 0) < VERDICT_PRUNE_BATCH) return;
  }
  logger.warn(
    { calls: MAX_VERDICT_PRUNE_CALLS },
    '[audit] AI verdicts prune stopped early; the rest goes tomorrow',
  );
}
