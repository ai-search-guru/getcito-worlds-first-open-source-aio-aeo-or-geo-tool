/**
 * Automatic checks (AC-010): a task whose How we check is `auto` is checked
 * on its page, on the brand's own site, fetched again with the free reader
 * (safe-fetch, never the paid scraper), by what the task changes:
 *
 *  - a broken page answers again (fix_broken_target);
 *  - a page is published: it answers where it never did, or changed since
 *    the first look (publish_content: the page may be live already);
 *  - the audit checks that raised a structured data fix pass on the page
 *    now (fix_structured_data), by the audit's own evaluators;
 *  - robots.txt lets the AI crawlers in, and the page isn't noindex
 *    (fix_crawler_access raised by the audit's ai-bot-access);
 *  - it changed since the first look, by more than a date, a price or a
 *    rotating quote moving (optimize, refresh, strengthen): the first look
 *    keeps a sketch of the page's words, and enough of them must have
 *    changed. A call to action is confirmed by hand: a re-fetch can't tell
 *    (tasks/templates.js);
 *  - a written task's new text is on it, and the text it replaces gone;
 *  - a shopping links task's page links no product that no longer sells,
 *    read as the catalog sync's shopping check reads it (shoppingCheck.js;
 *    Check now only: the sync checks it, not the sweep).
 *
 * A task that passes is completed, with the check kept on it and a line in
 * the action's History; one that doesn't keeps what is missing, for its
 * card. A task someone reopened after it passed stays open, held: the
 * sweep leaves it, and no check closes it while its page is the same. A
 * page that can't be read keeps only when it was tried. Site Audit fixes aren't
 * checked here: a new audit is a paid run.
 */

import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { fetchPage } from '../safeFetch.js';
import { checkShoppingDraft } from '../shoppingCheck.js';
import { classIdWords, furnitureNamed } from '../pageContent.js';
import { onBrandDomain } from '../audit/host.js';
import { aiBotAccess } from '../audit/signals/trust.js';
import {
  faqSchema,
  jsonLdPresence,
  jsonLdRelevance,
  jsonLdValidity,
} from '../audit/signals/structure.js';

/** What each library task's check reads. */
export const CHECKS = Object.freeze({
  publish_content: 'published',
  fix_broken_target: 'answers',
  fix_structured_data: 'structuredData',
  fix_crawler_access: 'crawlers',
  optimize_content: 'changed',
  refresh_content: 'changed',
  strengthen_reference_asset: 'changed',
  strengthen_entity_content: 'changed',
});

/** The most open tasks one nightly sweep checks: pages are fetched one at a time. */
export const SWEEP_LIMIT = 200;
/** The most of one brand's tasks a night's sweep checks: a brand with many new tasks doesn't hold the others back. */
export const SWEEP_PER_BRAND = 20;
/** Rows the sweep reads a page at a time to fill a night past the brands' caps, and pages at most. */
const SWEEP_PAGE = 1000;
const SWEEP_PAGES = 5;
/** A task tried this recently isn't tried again by the sweep. */
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** The most of a page or a robots.txt read: the check runs on the API's process. */
const MAX_PAGE_BYTES = 512 * 1024;
const OPEN = ['todo', 'in_progress'];

/**
 * A page changed when the share of its 4-word runs it has in common with
 * its first look falls below this: a date, a count, a price or a rotating
 * testimonial leave it near 0.97; a 150-word FAQ added, 0.84…
 */
export const CHANGED_BELOW = 0.9;
/**
 * …and at least this many of its runs changed: on a short page a date and
 * a price moving are a large share, never this many runs (each word is in
 * up to four). A rotated 28-word testimonial or a new 50-word review is
 * 41–66; a rewritten 60-word paragraph 117 or more, a 150-word FAQ 146.
 */
export const MIN_CHANGED_RUNS = 80;
/**
 * Words in a block's class or id that name what changes by itself (a
 * sidebar, testimonials, the latest posts): left out of the words a change
 * is measured on, as furniture is, unless they hold most of the page. Not
 * left out of the words a written task's text is looked for in. "widget"
 * and "popular" alone aren't such words: Elementor and HubSpot name each of
 * the page's blocks a widget, and a pricing page its "Most popular" plan.
 */
const SELF_CHANGING = new Set([
  'sidebar',
  'promo',
  'announcement',
  'pagination',
  'tags',
  'testimonial',
  'testimonials',
  'latest',
  'recent',
  'trending',
]);
/** …and two words, one after the other, that do: a theme's widget area, a popular posts list. */
const SELF_CHANGING_PAIRS = new Set([
  'widget area',
  'widgets area',
  'footer widgets',
  'popular posts',
  'popular post',
  'popular articles',
]);

/** Whether an element's class or id names what changes by itself. */
function selfChanging(attribs) {
  const names = classIdWords(attribs);
  return names.some(
    (word, i) => SELF_CHANGING.has(word) || SELF_CHANGING_PAIRS.has(`${word} ${names[i + 1]}`),
  );
}
/**
 * The way a sketch reads a page. A first look kept by another (before
 * SELF_CHANGING was left out, 2026-10-28) isn't compared: the page gets a
 * new first look, so a block left out now doesn't read as the change.
 */
export const SKETCH_VERSION = 2;
/** The 4-word runs' hashes a sketch keeps, the smallest: about 2.5 KB. */
const SKETCH_SIZE = 256;
/** A page with fewer visible words than this isn't read: an empty shell, or bot protection's page. */
const MIN_WORDS = 20;
/** A block named as furniture, or a menu, header, footer or form, holding more than this share of the body's words is the page itself. */
const MAX_SKIPPED_SHARE = 0.5;

/** The audit's structured data checks, by the key the audit raised a fix with. */
const STRUCTURED_CHECKS = {
  'json-ld-presence': jsonLdPresence,
  'json-ld-validity': jsonLdValidity,
  'json-ld-relevance': jsonLdRelevance,
  'faq-schema': faqSchema,
};
/** What the card says for a structured data check still failing (en.json taskCheckMissing). */
const STRUCTURED_MISSING = {
  'json-ld-presence': 'no_structured_data',
  'json-ld-validity': 'structured_data_invalid',
  'json-ld-relevance': 'structured_data_irrelevant',
  'faq-schema': 'no_faq_schema',
};
/**
 * A fix raised without the audit's checks named (another action's, F06's
 * brand-entity, say): its JSON-LD must at least be valid, and since a page
 * may have had a valid block all along (a site-wide Organization), it
 * passes only after a check on the page found it failing (`sawFailing`).
 */
const DEFAULT_STRUCTURED = ['json-ld-validity'];
/** Checks whose warn is still the problem: a block that doesn't parse. */
const PASS_ONLY = new Set(['json-ld-validity']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A shopping links task's mark (action-center/fromShoppingCheck.js). */
const SHOPPING_SOURCE = 'shopping_check';

/** What a task's check reads, or null when it has none here. */
export function checkKind(task) {
  const d = task.details ?? {};
  if (d.check !== 'auto' || !text(d.url)) return null;
  if (d.source === SHOPPING_SOURCE) return 'shoppingLinks';
  if (task.task_key) return CHECKS[task.task_key] ?? null;
  return text(d.change?.after) ? 'text' : null;
}

/**
 * Why a task has no check here, by what it lacks, as Check now says it
 * (en.json checkNot): no page, a written task with no new text to look
 * for, or a library task checked elsewhere (a Site Audit fix, by the next
 * audit).
 */
function uncheckable(task) {
  const d = task.details ?? {};
  if (d.check === 'auto' && !text(d.url)) return 'no_address';
  if (d.check === 'auto' && !task.task_key) return 'no_change_text';
  return 'not_checkable';
}

/** A name's last label that is a file's, not a domain's: "pricing.html" is a page. */
const FILE_ENDINGS = new Set([
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'jsp',
  'cfm',
  'shtml',
  'xml',
  'pdf',
]);

/**
 * The task's page as an address: a full one as it is; "//host/path" and a
 * bare host and path ("acme.example/pricing", "çiçek.com/x") as https, as
 * the URL import reads it; a path on the brand's first domain. Null when
 * none can be made.
 */
export function pageAddress(url, host) {
  const value = text(url);
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return host ? `https://${host}${value}` : null;
  if (/\s/.test(value)) return null;
  try {
    const parsed = new URL(`https://${value}`);
    const last = parsed.hostname.split('.').pop() ?? '';
    const domain = parsed.hostname.includes('.') && /^([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(last);
    return domain && !FILE_ENDINGS.has(last.toLowerCase()) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Words as compared: lower case, letters and digits only, a space around each. */
const words = (value) =>
  ` ${String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

/** Elements whose words are never the page's: code and frames. */
const CODE = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg']);
/** Elements whose words aren't the page's own unless they hold most of them: menus, header, footer, forms. */
const AROUND = new Set(['nav', 'header', 'footer', 'aside', 'form', 'button']);
/** Read after an element's children: its last word ends with it. */
const AFTER = { type: 'text', data: ' ' };

/**
 * A page, parsed by htmlparser2: fetchPage's depth count (htmlDepth.js)
 * follows its tree, so the count bounds the parse. parse5, cheerio's default,
 * reopens formatting elements a closed block left open, so its tree can grow
 * far past the page's own nesting.
 */
const loadPage = (html) => cheerio.load(html, { xml: { xmlMode: false } });

/**
 * Each element's text length under `start`, code left out: one pass, children
 * before their parent, as a stack.
 */
function textLengths(start) {
  const lengths = new Map();
  const stack = [[start, false]];
  while (stack.length) {
    const [node, done] = stack.pop();
    if (node.type === 'text') continue;
    if (!done) {
      stack.push([node, true]);
      for (const child of node.children ?? []) stack.push([child, false]);
      continue;
    }
    let length = 0;
    if (!(node.type === 'tag' && CODE.has(node.name))) {
      for (const child of node.children ?? []) {
        length += child.type === 'text' ? child.data.length : (lengths.get(child) ?? 0);
      }
    }
    lengths.set(node, length);
  }
  return lengths;
}

/**
 * A page's visible words: its body's text outside its menus, header,
 * footer, forms and furniture (author box, share, related, ads…), with its
 * title and meta description; entities read as their characters, no
 * script's or style's (a JSON-LD date or price changes with no one's work).
 * A block left out as furniture, or a form, that holds most of the body's
 * words is the page (an <article class="category-social-media">, a page in
 * one <form>), and is read. Two passes over the body, as stacks: linear on
 * any page, never out of stack. With `steady`, what changes by itself
 * (selfChanging) is left out too: the words a change is measured on.
 *
 * @param {string} html
 * @param {import('cheerio').CheerioAPI} [$] the page, when it is parsed already
 * @param {{ steady?: boolean }} [opts]
 */
export function visibleText(html, $ = loadPage(html), { steady = false } = {}) {
  const head = [$('title').first().text(), $('meta[name="description"]').attr('content')];
  const start = $('body')[0] ?? $.root()[0];
  if (!start) return head.filter(Boolean).join(' ');
  const lengths = textLengths(start);
  const most = (lengths.get(start) ?? 0) * MAX_SKIPPED_SHARE;
  const out = [];
  const stack = [...(start.children ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node.type === 'text') {
      out.push(node.data);
      continue;
    }
    if (node.type !== 'tag' || CODE.has(node.name)) continue;
    const aside =
      AROUND.has(node.name) ||
      furnitureNamed(node.attribs) ||
      (steady && selfChanging(node.attribs));
    if (aside && (lengths.get(node) ?? 0) <= most) continue;
    // A block's words start and end with it: "Pricing" and "Plans" never run together.
    out.push(' ');
    stack.push(AFTER);
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
  }
  return [...head, out.join('')].filter(Boolean).join(' ');
}

const hash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 10);

/** A page's words, as compared. */
const wordList = (visible) => words(visible).trim().split(' ').filter(Boolean);

/**
 * A page's sketch: the SKETCH_SIZE smallest hashes of its 4-word runs, and
 * how many runs it has (`runs`).
 */
export function sketch(visible) {
  const w = wordList(visible);
  const seen = new Set();
  for (let i = 0; i + 4 <= w.length; i += 1)
    seen.add(hash(`${w[i]} ${w[i + 1]} ${w[i + 2]} ${w[i + 3]}`));
  return { hashes: [...seen].sort().slice(0, SKETCH_SIZE), runs: seen.size, v: SKETCH_VERSION };
}

/** The share two pages' 4-word runs have in common, estimated from their sketches. */
export function similarity(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const union = [...new Set([...a, ...b])].sort().slice(0, SKETCH_SIZE);
  return union.length ? union.filter((h) => A.has(h) && B.has(h)).length / union.length : 1;
}

/** Whether a page asks not to be indexed (its robots meta tags). */
function noindex($) {
  return $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, el) => String($(el).attr('content') ?? '').toLowerCase())
    .get()
    .some((content) => /\bnoindex\b/.test(content));
}

/**
 * The 4-word runs two pages don't share, estimated from their sketches'
 * similarity J and run counts: |A Δ B| = (|A| + |B|)(1 − J)/(1 + J).
 */
export function changedRuns(first, now) {
  const j = similarity(first.hashes, now.hashes);
  return ((first.runs + now.runs) * (1 - j)) / (1 + j);
}

/**
 * What the page's words say against the first look: the first look (or one
 * of another page) keeps them; a change of more than CHANGED_BELOW's share,
 * and of at least MIN_CHANGED_RUNS runs, passes. A page that didn't change
 * enough keeps its first look, so small changes add up.
 */
function changedSince(previous, url, visible) {
  const now = sketch(visible);
  const first = previous?.sketch;
  if (
    !Array.isArray(first?.hashes) ||
    !Number.isFinite(first?.runs) ||
    first.v !== SKETCH_VERSION ||
    previous.url !== url
  ) {
    return { passed: false, missing: ['first_look'], sketch: now };
  }
  const changed =
    similarity(first.hashes, now.hashes) < CHANGED_BELOW &&
    changedRuns(first, now) >= MIN_CHANGED_RUNS;
  return changed
    ? { passed: true, missing: [], sketch: now }
    : { passed: false, missing: ['not_changed'], sketch: first };
}

/** An HTML page served where robots.txt should be: no robots.txt. */
const isHtml = (body) => /^\s*(<!doctype\s+html|<html[\s>])/i.test(body ?? '');

/**
 * A task's check on its page: `{ passed, missing, sketch?, wasMissing?, sawFailing? }`,
 * or null when the page couldn't be read (no answer, a timeout, a server
 * error, a 4xx other than "not there", a page nested too deep to parse):
 * nothing but the try is kept then.
 * `missing` names what stands between the task and done, as the card words
 * it (en.json actionCenter.taskCheckMissing).
 *
 * @param {string} kind  checkKind's
 * @param {string} url   the page's address, on the brand's site
 * @param {{ previous?: object|null, after?: string, before?: string|null, auditChecks?: string[],
 *   domains?: string[]|null, fetch?: Function }} [options]
 *   `previous`: the last check kept on the task; `after`, `before`: a
 *   written task's change; `auditChecks`: the audit checks that raised the
 *   action on this page; `domains`: the brand's, a redirect off them is off
 *   the site
 */
export async function checkPage(
  kind,
  url,
  {
    previous = null,
    after = '',
    before = null,
    auditChecks = [],
    domains = null,
    fetch = fetchPage,
  } = {},
) {
  const read = { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES, truncate: true };
  let page;
  try {
    page = await fetch(url, read);
  } catch (err) {
    // "Not there" (404, 410) is an answer. Another 4xx (bot protection, a
    // rate limit), a server error, none at all or a page nested too deep to
    // parse ('too_deep') says nothing.
    if (err?.code === 'http_error' && (err.status === 404 || err.status === 410)) {
      return { passed: false, missing: ['page_error'], wasMissing: true };
    }
    return null;
  }
  // A redirect off the brand's site isn't the brand's page.
  if (domains && !onBrandDomain(page.url, domains)) return { passed: false, missing: ['off_site'] };
  if (kind === 'answers') return { passed: true, missing: [] };

  const $ = loadPage(page.html);
  if (kind === 'structuredData') {
    const named = auditChecks.filter((key) => STRUCTURED_CHECKS[key]);
    const failing = (named.length ? named : DEFAULT_STRUCTURED).filter((key) => {
      const { status } = STRUCTURED_CHECKS[key].evaluate({ $ });
      return status === 'fail' || (PASS_ONLY.has(key) && status !== 'pass');
    });
    if (failing.length) {
      return {
        passed: false,
        missing: failing.map((key) => STRUCTURED_MISSING[key]),
        ...(named.length ? {} : { sawFailing: true }),
      };
    }
    // None named, and never seen failing on this page: valid all along, not fixed.
    if (!named.length && !(previous?.sawFailing && previous.url === url)) {
      return { passed: false, missing: ['valid_before'] };
    }
    return { passed: true, missing: [] };
  }

  if (kind === 'crawlers') {
    let robotsTxt = '';
    try {
      const robots = await fetch(new URL('/robots.txt', page.url).href, {
        ...read,
        // Crawlers read it whatever its type (S3 serves it as octet-stream).
        types: /(?:)/,
        accept: 'text/plain',
      });
      robotsTxt = isHtml(robots.html) ? '' : robots.html;
    } catch (err) {
      // None (4xx): no rules, every crawler in. Asked to wait (429), a
      // server error or no answer says nothing.
      const none = err?.code === 'http_error' && err.status < 500 && err.status !== 429;
      if (!none) return null;
    }
    const missing = [];
    if (aiBotAccess.evaluate({ robotsTxt }).status === 'fail') missing.push('crawlers_blocked');
    if (noindex($)) missing.push('noindex');
    return { passed: missing.length === 0, missing };
  }

  const visible = visibleText(page.html, $);
  // An empty shell, or bot protection's page, isn't the page.
  if (wordList(visible).length < MIN_WORDS) return null;
  if (kind === 'text') {
    const onPage = words(visible);
    if (!onPage.includes(words(after))) return { passed: false, missing: ['change_not_found'] };
    // A replacement: the text it replaces gone too, unless the new text holds it.
    const old = text(before);
    if (old && !words(after).includes(words(old)) && onPage.includes(words(old))) {
      return { passed: false, missing: ['old_text_still_there'] };
    }
    return { passed: true, missing: [] };
  }
  // A change is measured without what changes by itself.
  const steady = () => visibleText(page.html, $, { steady: true });
  if (kind === 'published') {
    // Not there before, never seen live, and answers now: published.
    if (previous?.wasMissing && !previous.sketch && previous.url === url) {
      return { passed: true, missing: [] };
    }
    return changedSince(previous, url, steady());
  }
  if (kind === 'changed') return changedSince(previous, url, steady());
  return null;
}

/** A stored domain's host, as the site is served: www kept. */
const storedHost = (domain) =>
  String(domain ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase() || null;

/** The brand's domains, its primary first. */
async function brandDomains(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.domain).filter(Boolean);
}

/** An address as compared with a target's: its host without www, its path without a trailing slash. */
function samePage(address) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The audit checks the task's page failed when its action was raised
 * (payload.targets[].checks): the page's own target (http or https, www or
 * not, a trailing slash or not), else the action's only one, else every
 * target's together (the stricter side).
 */
async function auditChecksFor(actionId, url) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('targets:payload->targets')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const targets = (Array.isArray(data?.targets) ? data.targets : []).filter(Boolean);
  const page = samePage(url);
  const own = targets.find((t) => typeof t.id === 'string' && samePage(t.id) === page);
  const read = own ? [own] : targets;
  return [
    ...new Set(
      read
        .flatMap((t) => (Array.isArray(t.checks) ? t.checks : []))
        .filter((c) => typeof c === 'string'),
    ),
  ];
}

/**
 * Writes the task's details as checked, only if the task is as it was read
 * (its status and its last change): neither a move nor an edit meanwhile is
 * lost. Whether it was written.
 */
async function writeCheck(task, details, { completes = false, now }) {
  let write = supabaseAdmin
    .from('action_tasks')
    .update({
      details,
      ...(completes ? { status: 'completed', skip_reason: null } : {}),
      updated_at: now.toISOString(),
    })
    .eq('id', task.id)
    .eq('status', task.status);
  if (task.updated_at) write = write.eq('updated_at', task.updated_at);
  const { data: updated, error } = await write.select('id');
  if (error) throw new Error(error.message);
  return Boolean(updated?.length);
}

/**
 * A shopping links task: its draft's page checked again as the catalog sync
 * checks it (checkShoppingDraft), which keeps the Library's row and, once
 * the live page links no product that no longer sells, completes the task
 * with its check kept and closes the action, each in its History
 * (fromShoppingCheck.js). A page read from its draft (not reached, too
 * short to be the page, off the brand's site) is no answer; a draft with no
 * shopping path left (archived, its path removed) has nothing to check.
 */
async function checkShoppingTask(task, action, { fetch, now }) {
  const d = task.details ?? {};
  if (!text(d.draftId)) return { reason: 'not_checkable' };
  const found = await checkShoppingDraft(action.brand_id, d.draftId, { readPage: fetch, now });
  if (!found) return { reason: 'no_shopping_path' };
  if (found.readFrom !== 'page') {
    await writeCheck(
      task,
      { ...d, autoCheck: { ...(d.autoCheck ?? {}), triedAt: now.toISOString() } },
      { now },
    );
    return { reason: 'no_answer' };
  }
  const autoCheck = {
    at: now.toISOString(),
    triedAt: now.toISOString(),
    url: found.pageUrl,
    passed: !found.bad.length,
    missing: found.bad.length ? ['links_not_for_sale'] : [],
  };
  // Passed: the check completed the task, its autoCheck kept, unless
  // someone changed it meanwhile.
  if (autoCheck.passed) {
    return found.action === 'closed' || found.action === 'kept'
      ? { autoCheck }
      : { reason: 'changed' };
  }
  if (!(await writeCheck(task, { ...d, autoCheck }, { now }))) return { reason: 'changed' };
  return { autoCheck };
}

/**
 * Checks one task and keeps what it found on it (`details.autoCheck`, with
 * the page it read): passed, it is completed and the action's History says
 * so. A task someone reopened after it passed on this page is held: its
 * checks are kept, never close it while its page is the same, and the
 * sweep leaves it (the call is theirs). Returns `{ autoCheck }`, or
 * `{ reason }` when nothing was checked: 'not_checkable' (no check here),
 * 'not_open' (done or skipped), 'no_answer' (the page couldn't be read),
 * 'changed' (someone changed the task meanwhile), 'no_shopping_path' (a
 * shopping links task whose draft has no path left to check).
 *
 * @param {{ id: string, action_id: string, task_key: string|null, title?: string|null,
 *   status: string, details: object|null, updated_at?: string }} task
 * @param {{ brand_id: string }} action
 */
export async function runTaskCheck(read, action, { fetch = fetchPage, now = new Date() } = {}) {
  const kind = checkKind(read);
  if (!kind) return { reason: uncheckable(read) };
  if (!OPEN.includes(read.status)) return { reason: 'not_open' };
  if (kind === 'shoppingLinks') return checkShoppingTask(read, action, { fetch, now });
  const d = read.details ?? {};
  const previous = d.autoCheck ?? null;
  // Tried now, before anything is read: a task that can't be checked here
  // (no address, a read that throws) leaves the head of the sweep's queue,
  // and a second run that read the task before this one isn't let check it too.
  const claim = { ...d, autoCheck: { ...(previous ?? {}), triedAt: now.toISOString() } };
  if (!(await writeCheck(read, claim, { now }))) return { reason: 'changed' };
  const task = { ...read, details: claim, updated_at: now.toISOString() };
  const domains = await brandDomains(action.brand_id);
  const url = pageAddress(d.url, storedHost(domains[0]));
  if (!url) return { reason: 'no_address' };
  let auditChecks = [];
  if (kind === 'structuredData' || kind === 'crawlers') {
    auditChecks = await auditChecksFor(task.action_id, url);
    // Raised from the bot logs (a cited page crawlers never read): robots.txt
    // can't say it's fixed. Its try is kept (the claim), so the sweep goes on to others.
    if (kind === 'crawlers' && !auditChecks.includes('ai-bot-access')) {
      return { reason: 'from_bot_logs' };
    }
  }

  // Only the brand's own pages are read.
  const found = onBrandDomain(url, domains)
    ? await checkPage(kind, url, {
        previous,
        after: d.change?.after,
        before: d.change?.before,
        auditChecks,
        domains,
        fetch,
      })
    : { passed: false, missing: ['off_site'] };
  const samePageAsBefore = previous?.url === url;
  // An open task whose last check passed on this page can only have been
  // reopened: held from then on, for this page, whatever later checks find.
  const held = samePageAsBefore && (previous?.held === true || previous?.passed === true);
  const completes = Boolean(found?.passed) && !held;
  // A first look is kept for the page it was taken of, through a read that found nothing to keep.
  const kept = found?.sketch ?? (samePageAsBefore ? previous?.sketch : undefined);
  const autoCheck = found
    ? {
        at: now.toISOString(),
        triedAt: now.toISOString(),
        url,
        passed: found.passed,
        missing: found.missing,
        ...(kept ? { sketch: kept } : {}),
        ...(found.wasMissing ? { wasMissing: true } : {}),
        // Kept for the page, so a fix after a failing check passes.
        ...(found.sawFailing || (samePageAsBefore && previous?.sawFailing)
          ? { sawFailing: true }
          : {}),
        ...(held ? { held: true } : {}),
      }
    : { ...(previous ?? {}), triedAt: now.toISOString() };

  if (!(await writeCheck(task, { ...d, autoCheck }, { completes, now }))) {
    return { reason: 'changed' };
  }
  if (!found) return { reason: 'no_answer' };

  if (completes) {
    const { error: eventError } = await supabaseAdmin.from('action_events').insert({
      action_id: task.action_id,
      event: 'task_checked',
      // Named once: by its own title when someone renamed it, else its library key.
      data: {
        taskId: task.id,
        task: task.title ? null : (task.task_key ?? null),
        title: task.title ?? null,
      },
      actor_id: null,
    });
    if (eventError) logger.warn({ err: eventError }, '[task-checks] History line not written');
    await supabaseAdmin
      .from('actions')
      .update({ updated_at: now.toISOString() })
      .eq('id', task.action_id);
  }
  return { autoCheck };
}

/**
 * The nightly sweep: open tasks checked `auto` that can be checked here (a
 * library task with a check, or a written one with its new text) and have a
 * page, of open actions, not held (reopened after they passed), the least
 * recently tried first, none tried in the last day, one page at a time, at
 * most SWEEP_LIMIT and SWEEP_PER_BRAND of one brand's. A failure on one task
 * is logged and the rest go on.
 *
 * @returns {Promise<{ checked: number, passed: number }>}
 */
export async function sweepTaskChecks({
  limit = SWEEP_LIMIT,
  fetch = fetchPage,
  now = new Date(),
} = {}) {
  const since = now.getTime() - RECHECK_AFTER_MS;
  const due = [];
  const perBrand = new Map();
  for (let page = 0; page < SWEEP_PAGES && due.length < limit; page += 1) {
    const { data: rows, error } = await supabaseAdmin
      .from('action_tasks')
      .select(
        'id, action_id, task_key, title, status, details, updated_at, actions!inner(brand_id, status, deleted_at, brands!inner(is_demo))',
      )
      // A demo brand's tasks (00380) are sample data: their pages aren't read.
      .eq('actions.brands.is_demo', false)
      .in('status', OPEN)
      .eq('details->>check', 'auto')
      .not('details->>url', 'is', null)
      .or(
        `task_key.in.(${Object.keys(CHECKS).join(',')}),and(task_key.is.null,details->change->>after.not.is.null)`,
      )
      // A task reopened after it passed is the person's call: Check now still reads it.
      .is('details->autoCheck->>held', null)
      .is('actions.deleted_at', null)
      .not('actions.status', 'in', '(completed,dismissed)')
      .order('details->autoCheck->>triedAt', { ascending: true, nullsFirst: true })
      .order('id')
      .range(page * SWEEP_PAGE, (page + 1) * SWEEP_PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of rows ?? []) {
      if (due.length >= limit) break;
      const kind = checkKind(row);
      // A shopping links task is checked after each catalog sync, not here.
      if (!kind || kind === 'shoppingLinks') continue;
      if (Date.parse(row.details?.autoCheck?.triedAt ?? '') >= since) continue;
      const action = Array.isArray(row.actions) ? row.actions[0] : row.actions;
      const taken = perBrand.get(action?.brand_id) ?? 0;
      if (taken >= SWEEP_PER_BRAND) continue;
      perBrand.set(action?.brand_id, taken + 1);
      due.push(row);
    }
    if ((rows ?? []).length < SWEEP_PAGE) break;
  }
  let checked = 0;
  let passed = 0;
  for (const row of due) {
    const action = Array.isArray(row.actions) ? row.actions[0] : row.actions;
    try {
      const result = await runTaskCheck(row, action, { fetch, now });
      if (result.autoCheck) {
        checked += 1;
        if (result.autoCheck.passed) passed += 1;
      }
    } catch (err) {
      logger.warn({ err, taskId: row.id }, '[task-checks] check failed');
    }
  }
  logger.info({ checked, passed }, '[task-checks] sweep done');
  return { checked, passed };
}
