/**
 * Why the brand's winning pages win (learning C4).
 *
 * G14 (AI landing pages converting well above the site) and G10 (prompts
 * whose visibility is rising) point at pages that already work: nothing
 * said what they have that the brand's other pages don't. This compares
 * them, through Site Audit's own rule checks (pageFeatures.js: structure,
 * FAQ, schema, statistics, dates, length), with the brand's other pages a
 * completed Site Audit read lately. The result is the brand's own "what
 * works here": the checks most of its winning pages pass and most of its
 * other pages don't, and the other pages missing the most of them.
 *
 * The other pages are read from their audits only, never fetched: no cost,
 * and only pages the brand chose to audit. A winning page without a recent
 * audit is read like a page AI answers cite (competitorPages.js readPages):
 * free, within the brand's daily reads, only what the checks found kept.
 * Nothing leaves the brand: no other brand's pages are compared.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { fetchPage } from '../safeFetch.js';
import { extractHostname } from '../responseParser.js';
import { opportunityKey } from '../audit/opportunities.js';
import { describeSignal } from '../audit/rubric.js';
import { ReadLaterError, citedPages, readPages, scopePromptIds } from './competitorPages.js';
import { FEATURE_CHECKS } from './pageFeatures.js';

const { competitorPages: CP, winningPages: W } = resolve();

const DAY_MS = 86_400_000;
/** Answers read for G10's prompts, newest first (as competitorPages.js). */
const ANSWERS_READ = 300;
/** Audits read to find the brand's latest one per page. */
const AUDITS_READ = 300;
/** A check's results that say something; 'na' doesn't. */
const DECIDED = new Set(['pass', 'warn', 'fail']);

const hostOf = (value) => extractHostname(/^https?:\/\//i.test(value) ? value : `https://${value}`);
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * The checks most of the winning pages pass (at least half) and most of the
 * other pages don't (at most half), the widest difference first. A check is
 * counted on the pages it decides (pass, warn or fail), never 'na'.
 *
 * @param {Array<{ checks: Record<string, string> }>} winners
 * @param {Array<{ checks: Record<string, string> }>} others
 */
export function winningPatterns(winners, others) {
  const rate = (pages, key) => {
    const decided = pages.filter((page) => DECIDED.has(page.checks?.[key]));
    const passed = decided.filter((page) => page.checks[key] === 'pass').length;
    return { passed, of: decided.length };
  };
  return FEATURE_CHECKS.flatMap((key) => {
    const w = rate(winners, key);
    const o = rate(others, key);
    if (w.of === 0 || o.of === 0 || w.passed === 0) return [];
    const wRate = w.passed / w.of;
    const oRate = o.passed / o.of;
    if (wRate < 0.5 || oRate > 0.5 || wRate <= oRate) return [];
    return [
      {
        key,
        label: describeSignal(key)?.label ?? key,
        winners: w.passed,
        ofWinners: w.of,
        others: o.passed,
        ofOthers: o.of,
        lead: wRate - oRate,
      },
    ];
  })
    .sort((a, b) => b.lead - a.lead)
    .map(({ lead: _lead, ...pattern }) => pattern);
}

/**
 * The other pages missing the most of the patterns, at most `limit`: where
 * what works at the brand can go next. A page missing none isn't listed.
 */
export function pagesMissing(others, patterns, limit = W.missingPages) {
  return others
    .map((page) => ({
      url: page.url,
      missing: patterns.map((p) => p.key).filter((key) => page.checks?.[key] !== 'pass'),
    }))
    .filter((page) => page.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length || a.url.localeCompare(b.url))
    .slice(0, limit);
}

/**
 * The action's winning pages, at most `perAction`: G14's target pages (an
 * Analytics landing path is read on the brand's primary domain), or the
 * brand's own pages its prompts' answers cited lately, the most cited first.
 */
async function winningPagesOf(brandId, payload, domains, now) {
  const entity = payload?.targetEntity ?? payload?.entity;
  if (entity === 'pages') {
    const primary = domains.find((d) => d.is_primary) ?? domains[0];
    const host = primary ? hostOf(primary.domain) : null;
    const listed = Array.isArray(payload.targets) ? payload.targets : [];
    return listed
      .map((target) => String(target?.id ?? target?.label ?? ''))
      .flatMap((page) => {
        const url = /^https?:\/\//i.test(page)
          ? page
          : host && page.startsWith('/')
            ? `https://${host}${page}`
            : null;
        const key = url ? opportunityKey(url) : null;
        return url && key ? [{ key, url, domain: hostOf(url) }] : [];
      })
      .filter((page, i, all) => all.findIndex((p) => p.key === page.key) === i)
      .slice(0, W.perAction);
  }

  const promptIds = await scopePromptIds(brandId, payload);
  if (promptIds.length === 0) return [];
  const since = new Date(now.getTime() - CP.answersDays * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('prompt_results')
    .select('mention_count, citations')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .in('prompt_id', promptIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ANSWERS_READ);
  if (error) throw new Error(error.message);
  const { own } = citedPages(data ?? [], {
    ownDomains: domains.map((d) => d.domain).filter(Boolean),
    competitorDomains: [],
  });
  return own.slice(0, W.perAction).map(({ key, url, domain }) => ({ key, url, domain }));
}

/**
 * The brand's pages with a completed Site Audit since `auditDays`, on its own
 * domains, each with its latest audit: Map of page key → { url, auditId }.
 */
async function auditedPages(brandId, ownHosts, now) {
  const since = new Date(now.getTime() - W.auditDays * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, final_url, completed_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(AUDITS_READ);
  if (error) throw new Error(error.message);
  const pages = new Map();
  for (const audit of data ?? []) {
    const url = audit.final_url || audit.url;
    const key = url ? opportunityKey(url) : null;
    const host = url ? hostOf(url) : null;
    if (!key || !host || pages.has(key)) continue;
    if (!ownHosts.some((domain) => onDomain(host, domain))) continue;
    pages.set(key, { key, url, auditId: audit.id });
  }
  return pages;
}

/** Each audit's compared checks: Map of audit id → { check key: status }. */
async function auditChecks(auditIds) {
  if (auditIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('audit_signal_results')
    .select('audit_id, signal_key, status')
    .in('audit_id', auditIds)
    .in('signal_key', [...FEATURE_CHECKS]);
  if (error) throw new Error(error.message);
  const checks = new Map(auditIds.map((id) => [id, {}]));
  for (const row of data ?? []) checks.get(row.audit_id)[row.signal_key] = row.status;
  return checks;
}

const passing = (checks) => FEATURE_CHECKS.filter((key) => checks?.[key] === 'pass');

/**
 * The "Analyze your winning pages" task's result: the winning pages, how
 * many other pages they were compared with, the checks that set the winners
 * apart, and the other pages missing the most of those.
 *
 * It throws ReadLaterError when it can't give one: a winning page to read
 * that the day's reads left can't cover (the next night), or nothing to
 * compare — no winning page, none readable, too few other pages audited
 * (`retryDays`, the reason as the task's output).
 *
 * @param {{ brandId: string, payload: object, now?: Date, read?: typeof fetchPage }} input
 *   read: the page reader, for tests
 */
export async function analyzeWinningPages({
  brandId,
  payload,
  now = new Date(),
  read = fetchPage,
}) {
  const nothing = (reason, message, found = {}) =>
    new ReadLaterError(message, {
      output: {
        winningPages: [],
        others: 0,
        patterns: [],
        missingPages: [],
        unreadable: 0,
        ...found,
        reason,
      },
      retryDays: W.retryDays,
    });

  const { data: domainRows, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  const domains = (domainRows ?? []).filter((d) => d.domain);
  const ownHosts = domains.map((d) => hostOf(d.domain)).filter(Boolean);

  const winners = await winningPagesOf(brandId, payload, domains, now);
  if (winners.length === 0) throw nothing('no_winner', 'no winning page to compare');

  const audited = await auditedPages(brandId, ownHosts, now);
  const others = [...audited.values()]
    .filter((page) => !winners.some((winner) => winner.key === page.key))
    .slice(0, W.others);
  if (others.length < W.minOthers) {
    throw nothing('too_few_audited', 'too few of the brand’s other pages audited', {
      others: others.length,
    });
  }

  // A winning page's audit when it has one; else it is read, all the same night.
  const toRead = winners
    .filter((winner) => !audited.has(winner.key))
    .map((winner) => ({ ...winner, own: true }));
  await readPages({ brandId, pages: toRead, now, read });
  const checks = await auditChecks([
    ...winners.flatMap((winner) => audited.get(winner.key)?.auditId ?? []),
    ...others.map((page) => page.auditId),
  ]);

  const winningPages = winners.flatMap((winner) => {
    const audit = audited.get(winner.key);
    if (audit) {
      return [{ url: winner.url, source: 'audit', words: null, checks: checks.get(audit.auditId) }];
    }
    const fetched = toRead.find((page) => page.key === winner.key);
    return fetched?.features
      ? [
          {
            url: winner.url,
            source: 'read',
            words: fetched.features.words ?? null,
            checks: fetched.features.checks ?? {},
          },
        ]
      : [];
  });
  const unreadable = winners.length - winningPages.length;
  if (winningPages.length === 0) {
    throw nothing('winner_unreadable', 'no winning page could be read', { unreadable });
  }

  const otherPages = others.map((page) => ({ url: page.url, checks: checks.get(page.auditId) }));
  const patterns = winningPatterns(winningPages, otherPages);
  return {
    winningPages: winningPages.map(({ checks: own, ...page }) => ({
      ...page,
      passes: passing(own),
    })),
    others: otherPages.length,
    patterns,
    missingPages: pagesMissing(otherPages, patterns),
    unreadable,
    reason: null,
  };
}
