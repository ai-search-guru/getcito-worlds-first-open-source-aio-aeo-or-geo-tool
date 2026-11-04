import { z } from 'zod';
import { fetchPage, PageFetchError } from '../safeFetch.js';
import { estimatedCardUsd, reportCardLimits } from './config.js';
import { countryLanguage, isCountry } from './countries.js';
import {
  emailDomain,
  isFreeEmail,
  linkedinProfile,
  siteMatchesEmail,
  websiteHost,
} from './identity.js';
import { reportCardStore } from './store.js';
import { verifyBotToken } from './turnstile.js';

/**
 * A free report card request from the www.getcito.com form (REPORT-CARD
 * §3, §4, §8), answered with the code the form shows a message for:
 *
 *   - queued (200): a new card is on its way;
 *   - resent (200): the company had one in the last 30 days, and it is
 *     e-mailed again at no cost (one still being made counts as queued);
 *   - daily_cap (429): today's cards are spent; this one is made the next
 *     morning;
 *   - free_email (422): not a work e-mail;
 *   - invalid (422): a field is wrong, named in `fields`;
 *   - site_unreachable (422): the site can't be opened;
 *   - bot_check (403): the bot check failed;
 *   - unavailable (503): the monthly budget is spent, or the bot check
 *     isn't set up on this server.
 *
 * Nothing is kept for a request that isn't answered queued, resent or
 * daily_cap.
 */

export const COMPANY_SIZES = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5000+',
];

/** The day's capped cards start at this hour (UTC) on a later day. */
const NEXT_DAY_START_HOUR = 6;
/** How many days ahead a capped card may wait for a free slot. */
const MAX_DAYS_AHEAD = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a field's error says under it, on the form. */
export const FIELD_MESSAGES = {
  firstName: 'Please enter your first name.',
  lastName: 'Please enter your last name.',
  title: 'Please enter your job title.',
  email: 'Please enter your work e-mail.',
  linkedinUrl: 'Please enter your LinkedIn profile URL (linkedin.com/in/…).',
  companyName: 'Please enter your company’s name.',
  website: 'Use the website of the company in your work e-mail.',
  targetCountry: 'Please choose a country.',
  companySize: 'Please choose your company’s size.',
  industry: 'Please choose an industry from the list.',
  dealValue: 'Please enter an amount and a currency.',
  consentPrivacy: 'Please accept the Privacy Notice.',
  consentOwnSite: 'Please confirm this is your company’s website.',
  consentMarketing: 'Please tick the box or leave it empty.',
};

const line = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

/** "501–1,000" as the form may send it, as "501-1000". */
const sizeOf = (value) =>
  typeof value === 'string' ? value.replace(/[–—]/g, '-').replace(/[,\s]/g, '') : value;

export const requestSchema = z.object({
  firstName: line(60),
  lastName: line(60),
  title: line(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((email) => emailDomain(email) !== null),
  linkedinUrl: z
    .string()
    .max(300)
    .refine((value) => linkedinProfile(value) !== null)
    .transform((value) => linkedinProfile(value)),
  companyName: line(100),
  website: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((value) => websiteHost(value) !== null),
  targetCountry: z
    .string()
    .trim()
    .toUpperCase()
    .refine((code) => isCountry(code)),
  companySize: z.preprocess(sizeOf, z.enum(COMPANY_SIZES)),
  industry: optionalText(60).refine(
    (value) => value === null || /^[\p{L}\p{N} &/,.'-]+$/u.test(value),
  ),
  dealValue: z
    .object({
      amount: z.coerce.number().positive().max(1_000_000_000),
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/),
    })
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  consentPrivacy: z.literal(true),
  consentOwnSite: z.literal(true),
  consentMarketing: z.boolean().optional().default(false),
  botToken: z.string().max(4096).optional(),
  page: optionalText(100),
  utm: z
    .object({
      source: z.string().max(100).optional(),
      medium: z.string().max(100).optional(),
      campaign: z.string().max(100).optional(),
      term: z.string().max(100).optional(),
      content: z.string().max(100).optional(),
    })
    .strip()
    .optional()
    .transform((value) => (value && Object.keys(value).length ? value : null)),
});

/** The form's field errors, one message a field. */
function fieldErrors(issues) {
  const fields = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (FIELD_MESSAGES[field] && !fields[field]) fields[field] = FIELD_MESSAGES[field];
  }
  return fields;
}

/**
 * A fetch that got an answer from the site: an error status (a bot wall's
 * 403 or 503 challenge, a home page that 404s), a page that isn't HTML or
 * too many redirects. The site is up; the card's run reads what it can.
 */
const ANSWERED = new Set(['http_error', 'not_html', 'too_large', 'too_many_redirects']);

/**
 * Whether the site opens: its home page, as given and then with "www.",
 * read once and only as far as the first bytes. Only a site that can't be
 * reached (DNS, connection, TLS, timeout) or isn't allowed doesn't.
 */
export async function siteOpens(site, { fetcher = fetchPage } = {}) {
  for (const host of [site, `www.${site}`]) {
    try {
      await fetcher(`https://${host}/`, { truncate: true, maxBytes: 64 * 1024, timeoutMs: 8000 });
      return true;
    } catch (err) {
      if (err instanceof PageFetchError && ANSWERED.has(err.code)) return true;
      // The next host, or not reachable.
    }
  }
  return false;
}

/** The first day from today with room under the cap: when its card may start, or null. */
async function startTime(store, now, dailyCap) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let day = 0; day <= MAX_DAYS_AHEAD; day += 1) {
    const from = new Date(today + day * DAY_MS);
    const used = await store.cardsStarting(from, new Date(from.getTime() + DAY_MS));
    if (used < dailyCap) {
      return day === 0 ? now : new Date(from.getTime() + NEXT_DAY_START_HOUR * 60 * 60 * 1000);
    }
  }
  return null;
}

const answer = (status, code, extra = {}) => ({ status, body: { code, ...extra } });

/**
 * Answers one request. `ip` is the caller's address, for the bot check only;
 * it is never kept.
 *
 * @param {unknown} body
 * @param {{ ip?: string, now?: Date }} context
 * @param {{ store?: ReturnType<typeof reportCardStore>, verifyBot?: typeof verifyBotToken, opens?: (site: string) => Promise<boolean>, limits?: ReturnType<typeof reportCardLimits> }} [deps]
 * @returns {Promise<{ status: number, body: { code: string, domain?: string, fields?: Record<string, string> } }>}
 */
export async function submitReportCardRequest(
  body,
  { ip, now = new Date() } = {},
  {
    store = reportCardStore(),
    verifyBot = verifyBotToken,
    opens = siteOpens,
    limits = reportCardLimits(),
  } = {},
) {
  const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (isFreeEmail(rawEmail)) {
    return answer(422, 'free_email', { domain: emailDomain(rawEmail) });
  }

  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return answer(422, 'invalid', { fields: fieldErrors(parsed.error.issues) });
  }
  const input = parsed.data;
  const domain = emailDomain(input.email);
  const site = websiteHost(input.website);
  if (!siteMatchesEmail(site, domain)) {
    return answer(422, 'invalid', { domain, fields: { website: FIELD_MESSAGES.website } });
  }

  const bot = await verifyBot(input.botToken, ip);
  if (bot === 'unconfigured') return answer(503, 'unavailable', { domain });
  if (bot !== 'pass') return answer(403, 'bot_check', { domain });

  const request = {
    first_name: input.firstName,
    last_name: input.lastName,
    title: input.title,
    email: input.email,
    linkedin_url: input.linkedinUrl,
    company_name: input.companyName,
    website: input.website,
    domain,
    country: input.targetCountry,
    company_size: input.companySize,
    industry: input.industry,
    deal_value: input.dealValue?.amount ?? null,
    deal_currency: input.dealValue?.currency ?? null,
    consent_privacy: true,
    consent_own_site: true,
    consent_marketing: input.consentMarketing,
    page: input.page,
    utm: input.utm,
  };

  // The company's card from the last 30 days: e-mailed again, or, still
  // being made, e-mailed to this person too once it's ready.
  const since = new Date(now.getTime() - limits.repeatDays * DAY_MS);
  const recent = await store.recentCard(domain, since);
  if (recent) {
    const resent = recent.status === 'ready';
    await store.insertRequest({
      ...request,
      report_card_id: recent.id,
      outcome: resent ? 'resent' : 'queued',
    });
    return answer(200, resent ? 'resent' : 'queued', { domain: site });
  }

  // The month's budget, with room kept for the cards still to run.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { spent, pending } = await store.spendSince(monthStart);
  const estimate = estimatedCardUsd(limits);
  if (spent + (pending + 1) * estimate > limits.monthlyBudgetUsd) {
    return answer(503, 'unavailable', { domain: site });
  }

  if (!(await opens(site))) return answer(422, 'site_unreachable', { domain: site });

  const runAfter = await startTime(store, now, limits.dailyCap);
  if (!runAfter) return answer(503, 'unavailable', { domain: site });
  const capped = runAfter.getTime() > now.getTime();

  const card = await store.insertCard({
    domain,
    site,
    company_name: input.companyName,
    country: input.targetCountry,
    language: countryLanguage(input.targetCountry),
    run_after: runAfter.toISOString(),
  });
  if (!card) {
    // Another request for the company queued one a moment ago: this one shares it.
    const shared = await store.recentCard(domain, since);
    await store.insertRequest({
      ...request,
      report_card_id: shared?.id ?? null,
      outcome: 'queued',
    });
    return answer(200, 'queued', { domain: site });
  }
  await store.insertRequest({
    ...request,
    report_card_id: card.id,
    outcome: capped ? 'daily_cap' : 'queued',
  });
  return capped
    ? answer(429, 'daily_cap', { domain: site })
    : answer(200, 'queued', { domain: site });
}
