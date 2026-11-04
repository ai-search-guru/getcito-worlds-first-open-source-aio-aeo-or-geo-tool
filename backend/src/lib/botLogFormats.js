/**
 * What each AI-bot sender posts to /bots/ingest (AT-010, spec §6.1), read
 * into one request shape — { userAgent, ip, url, status, at, country } — for
 * botIngest.js to verify:
 *
 *   * Cloudflare Worker (option A): JSON { requests: [...] } already in that
 *     shape (botWorkerScript.js).
 *   * Cloudflare Logpush (option B): newline-delimited JSON of the
 *     http_requests dataset, gzipped — ClientRequestUserAgent, ClientIP,
 *     ClientRequestHost, ClientRequestURI, EdgeResponseStatus,
 *     EdgeStartTimestamp (unix ns, unix s or RFC 3339, as the job is set)
 *     and ClientCountry. Creating the job uploads a test file,
 *     {"content":"tests"}, which reads as no requests.
 *   * Vercel drain (option C): a JSON array or NDJSON of log entries; only
 *     those with a `proxy` object describe a request (clientIp, userAgent[],
 *     host, path, statusCode, timestamp in ms). Build and function output
 *     lines are skipped.
 *
 * Log senders report every line they hold; `records` is that count, for the
 * raw-record cap.
 *
 * A file is read without holding up the API's other requests: it's inflated
 * asynchronously, to at most MAX_INFLATED_BYTES, holds at most MAX_LOG_LINES
 * (LogTooLargeError otherwise), and its lines are parsed a slice at a time.
 * A line whose time can't be read is dropped, not the file.
 */

import { setImmediate as nextTurn } from 'timers/promises';
import { promisify } from 'util';
import { gunzip } from 'zlib';

const gunzipAsync = promisify(gunzip);

/**
 * A gzipped body opens to at most this much. A Logpush job set up as
 * botSenderSetup.js says sends at most 10,000 lines, about 3 MB.
 */
export const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/** Lines one body may hold: twice what such a Logpush file holds. */
export const MAX_LOG_LINES = 20_000;

/** Lines parsed before the API's other requests get a turn. */
const PARSE_SLICE = 1000;

/** A body past MAX_INFLATED_BYTES or MAX_LOG_LINES; the route answers 413. */
export class LogTooLargeError extends Error {}

/**
 * The body as text. A body sent with Content-Encoding: gzip arrives already
 * inflated by the body parser; a gzipped file sent as is (Logpush's) is told
 * by its magic bytes and inflated here.
 */
export async function bodyText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const gzipped = buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!gzipped) return buffer.toString('utf8');
  try {
    const inflated = await gunzipAsync(buffer, { maxOutputLength: MAX_INFLATED_BYTES });
    return inflated.toString('utf8');
  } catch (err) {
    if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new LogTooLargeError(`The file opens to more than ${MAX_INFLATED_BYTES} bytes`);
    }
    throw err;
  }
}

const tooManyLines = (count) =>
  new LogTooLargeError(`The file holds ${count} lines; at most ${MAX_LOG_LINES} are read`);

/** JSON lines, or one JSON array; malformed lines are left out. */
async function readLines(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    let list;
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    if (list.length > MAX_LOG_LINES) throw tooManyLines(list.length);
    return list;
  }
  const lines = trimmed.split('\n');
  if (lines.length > MAX_LOG_LINES) throw tooManyLines(lines.length);
  const read = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % PARSE_SLICE === 0) await nextTurn();
    const line = lines[i].trim();
    if (!line) continue;
    try {
      read.push(JSON.parse(line));
    } catch {
      // A malformed line is left out.
    }
  }
  return read;
}

/** An ISO time, or undefined for a value that isn't one. */
function isoTime(ms) {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Logpush's EdgeStartTimestamp in any of its formats, as an ISO time. */
function logpushTime(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return isoTime(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  // ns, ms or s since the epoch, told apart by size.
  return isoTime(n > 1e15 ? n / 1e6 : n > 1e12 ? n : n * 1000);
}

export function readWorkerBody(text) {
  try {
    const body = JSON.parse(text || '{}');
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    return { records: requests.length, requests };
  } catch {
    return { records: 0, requests: [] };
  }
}

export async function readLogpushBody(text) {
  const lines = await readLines(text);
  const requests = lines
    .filter((l) => l && typeof l === 'object' && 'ClientRequestUserAgent' in l)
    .map((l) => ({
      userAgent: l.ClientRequestUserAgent,
      ip: l.ClientIP,
      url: l.ClientRequestHost
        ? `https://${l.ClientRequestHost}${l.ClientRequestURI ?? '/'}`
        : l.ClientRequestURI,
      status: l.EdgeResponseStatus,
      at: logpushTime(l.EdgeStartTimestamp),
      country: l.ClientCountry,
    }))
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

export async function readVercelBody(text) {
  const lines = await readLines(text);
  const requests = lines
    .filter((l) => l?.proxy && typeof l.proxy === 'object')
    .map(({ proxy, timestamp }) => ({
      userAgent: Array.isArray(proxy.userAgent) ? proxy.userAgent[0] : proxy.userAgent,
      ip: proxy.clientIp,
      url: proxy.host ? `https://${proxy.host}${proxy.path ?? '/'}` : proxy.path,
      status: proxy.statusCode,
      at: isoTime(proxy.timestamp ?? timestamp ?? Date.now()),
      country: null,
    }))
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

const READERS = {
  cloudflare_worker: readWorkerBody,
  cloudflare_logpush: readLogpushBody,
  vercel_drain: readVercelBody,
};

/** A connection's body as requests, and how many records it held. */
export async function readSenderBody(kind, buffer) {
  const read = READERS[kind];
  if (!read) return { records: 0, requests: [] };
  return read(await bodyText(buffer));
}
