/**
 * An anonymous key for a tracking-snippet visitor, in place of their IP
 * address (GDPR).
 *
 * The IP address is only needed to tell one visitor's pageviews from
 * another's for half an hour (a visit, AT-003) and to find the pageview a
 * not-found title belongs to. So it is never stored: the key is a one-way
 * hash of the IP with the brand and a salt that changes every day. The
 * database keeps each day's salt for two days only (traffic_salt, 00250);
 * once a salt is gone, nothing links its keys to an address, and a visitor
 * gets a new key every day, so their days can't be joined either.
 */

import { createHash } from 'node:crypto';
import supabaseAdmin from '../config/supabase.js';

let cached = null;

/** Today's salt (UTC), read once a day; the database makes it on first use. */
export async function dailySalt(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (cached?.day === day) return cached.salt;
  const { data, error } = await supabaseAdmin.rpc('traffic_salt', { p_day: day });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) throw new Error('traffic_salt returned no salt');
  cached = { day, salt: data };
  return data;
}

/**
 * The visitor's key for this brand today, or null without an IP address.
 *
 * @param {{ brandId: string, ip: string | null | undefined, now?: Date }} params
 * @returns {Promise<string | null>} 64 hex characters
 */
export async function visitorKey({ brandId, ip, now = new Date() }) {
  if (!ip) return null;
  const salt = await dailySalt(now);
  return createHash('sha256').update(`${salt}:${brandId}:${ip}`).digest('hex');
}

/** Forgets the cached salt (tests). */
export function resetDailySalt() {
  cached = null;
}
