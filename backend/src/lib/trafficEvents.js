/**
 * A journey's events from the AI Traffic snippet (CE-017, 00286): the pages
 * a visitor who came from an AI assistant goes on to (k: "pv") and the goal
 * they reach (k: "cv": a signup, a demo form, an order…), each with the
 * first AI visit it is credited to. Sent only by brands with conversions on.
 *
 * The body is untrusted, from any page: read with a schema, and a row is
 * made only from what it allows. What can't be credited to an AI visit
 * (a source not on the list, a first visit past the window or in the
 * future) is dropped, not stored as unattributed.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { classifyAiSource } from './aiSources.js';

/** Goals a conversion can be (00286), per site type in the Content Editor. */
export const CONVERSION_GOALS = ['signup', 'demo', 'order', 'booking', 'newsletter', 'custom'];

/** Where a conversion came from: the site's own call, a form it caught, Shopify's pixel. */
export const CONVERSION_ORIGINS = ['call', 'form', 'shopify'];

/** How long after the first AI visit a journey is still credited to it (first touch). */
export const ATTRIBUTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A browser's clock may run a little ahead of ours. */
const CLOCK_SKEW_MS = DAY_MS;

/**
 * The most one visitor id stores (routes/traffic.js), by kind: pageviews in
 * the attribution window, conversions in a day. Far above what a person
 * does, so a journey's reads stay bounded whatever a sender does.
 */
export const VISITOR_LIMITS = {
  page: { max: 300, windowMs: ATTRIBUTION_DAYS * DAY_MS },
  conversion: { max: 10, windowMs: DAY_MS },
};

const visitorId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
// Long ad and tracking tags are cut off with the query string (eventUrl).
const pageUrl = z.string().min(1).max(16384);

const eventBody = z.object({
  k: z.enum(['pv', 'cv']),
  id: visitorId,
  u: pageUrl,
  // The first AI visit: its source key, landing page and time (ms).
  f: z.object({
    s: z.string().min(1).max(255),
    u: pageUrl,
    at: z.number().int().positive(),
  }),
  g: z.enum(CONVERSION_GOALS).optional(),
  n: z.string().max(200).optional(),
  o: z.enum(CONVERSION_ORIGINS).optional(),
  val: z.number().finite().min(0).max(1e9).optional(),
  cur: z.string().max(10).optional(),
  q: z.number().int().min(0).max(100000).optional(),
  ref: z.string().max(200).optional(),
});

/** What a path segment holding an email is stored as. */
export const EMAIL_SEGMENT = '[email]';

/**
 * Whether a path segment holds an email, raw or encoded (an encoded dot too):
 * a name, an @, then a dot past it. An @ at the start is a handle ("/@acme",
 * "/@acme.dev"). Read without decoding: an escape always stands for at least
 * one character, and only %40 and %2E stand for an @ or a dot, so the answer
 * is the decoded one's, and a malformed escape costs nothing (a decode would
 * throw on each of an address's many segments).
 */
export function holdsEmail(segment) {
  const text = segment.replace(/%40/gi, '@').replace(/%2e/gi, '.');
  const at = text.indexOf('@', 1);
  return at > 0 && text.indexOf('.', at + 2) > 0;
}

/**
 * A page's address as stored: its origin and path, no query string or
 * fragment (a thank-you page's ?email=… never gets in), and a path segment
 * that holds an email, raw or encoded (/unsubscribe/ann%40example.com), as
 * EMAIL_SEGMENT: the page still counts, the address stays out. A handle
 * ("/@acme/post") stays. Null when it isn't an http(s) address.
 */
export function eventUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const path = url.pathname
      .split('/')
      .map((segment) => (holdsEmail(segment) ? EMAIL_SEGMENT : segment))
      .join('/');
    return `${url.origin}${path}`.slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * A form's or a call's own name ("pricing-demo"), or null: never what looks
 * like a person's details (an email, a phone number), should a site put one
 * there.
 */
export function eventLabel(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  if (!text || !/^[\p{L}\p{N} _.:#/-]+$/u.test(text) || /\d{7,}/.test(text.replace(/[ .-]/g, ''))) {
    return null;
  }
  return text;
}

/** An order's id at the shop ("1001", "#1001", "gid://shopify/Order/1"), or null. */
export function orderRef(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_#:/.-]{1,128}$/.test(text) ? text : null;
}

/**
 * An order's id as stored: a hash of the brand and the shop's id. It is only
 * ever compared (an order counts once, 00286's unique index), never read
 * back, so the id itself is never kept. Null without a valid id.
 */
export function orderKey(brandId, value) {
  const ref = orderRef(value);
  return ref ? createHash('sha256').update(`${brandId}:${ref}`).digest('hex') : null;
}

/**
 * The row an event makes for the brand, or null when it makes none: not a
 * journey event, malformed, or not creditable to an AI visit (see above).
 * A conversion without its origin is the site's own call.
 */
export function eventRow(brandId, body, now = Date.now()) {
  const parsed = eventBody.safeParse(body);
  if (!parsed.success) return null;
  const event = parsed.data;
  const firstSource = classifyAiSource(event.f.s);
  if (!firstSource) return null;
  if (event.f.at > now + CLOCK_SKEW_MS) return null;
  if (event.f.at < now - ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000) return null;
  const url = eventUrl(event.u);
  const firstUrl = eventUrl(event.f.u);
  if (!url || !firstUrl) return null;
  const row = {
    brand_id: brandId,
    visitor_id: event.id,
    kind: event.k === 'cv' ? 'conversion' : 'page',
    url,
    first_source: firstSource,
    first_url: firstUrl,
    // Never after the event itself, with a browser clock running ahead.
    first_at: new Date(Math.min(event.f.at, now)).toISOString(),
  };
  if (event.k === 'pv') return row;
  if (!event.g) return null;
  const currency = typeof event.cur === 'string' ? event.cur.trim().toUpperCase() : '';
  return {
    ...row,
    goal: event.g,
    label: eventLabel(event.n),
    origin: event.o ?? 'call',
    value: event.val ?? null,
    // A currency only with an amount, and only a three-letter code.
    currency: event.val !== undefined && /^[A-Z]{3}$/.test(currency) ? currency : null,
    units: event.q ?? null,
    order_ref: orderKey(brandId, event.ref),
  };
}
