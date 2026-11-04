import { type NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/config/api';

/**
 * Same-origin proxy to the AEO API server.
 *
 * A handful of client components call the API server directly from the
 * browser (topic/prompt/competitor suggestions, tracking re-analysis). That
 * made every visitor's own network a dependency of the signup funnel: the
 * API host has to resolve *and* be routable from wherever they are. On
 * 2026-08-28 the CDN range it sits on stopped accepting TCP from a Turkish
 * ISP, and onboarding died with "Couldn't fetch topic suggestions right now"
 * for anyone on that network — with no trace in the API server's logs or
 * Supabase's, because the request never left the browser.
 *
 * Routing those calls through this handler means the only host a visitor
 * connects to is the one already serving them the page. The hop to
 * API_BASE_URL happens from our infrastructure instead, where reachability
 * is ours to guarantee.
 *
 * The upstream path is forwarded verbatim, so `/api/aeo/api/topics/suggest`
 * reaches `${API_BASE_URL}/api/topics/suggest` and server routes still line
 * up one-to-one with what the browser asked for.
 *
 * Auth is unchanged: the caller's Supabase bearer token rides through and
 * the API server authorizes it exactly as before. This handler adds no
 * authority of its own — it forwards, it does not authenticate.
 */

/**
 * The suggestion endpoints run two LLM calls back to back (web research, then
 * structured extraction) — measured at ~12s for topics and longer for prompts
 * on a whole topic set. The platform default would cut them off.
 */
export const maxDuration = 300;

/** Never cache a proxied call: every one of these is per-brand and mutating-ish. */
export const dynamic = 'force-dynamic';

/**
 * A read (GET, HEAD) gives up once the API hasn't started answering in this
 * long, with a 504 the page can say something about: a hung upstream used to
 * leave cards on their skeletons until the platform cut the function off,
 * minutes later. Changes keep maxDuration: the suggestion runs above are
 * POSTs. Once the API answers, its body streams through without a limit.
 */
const READ_TIMEOUT_MS = 60_000;

/**
 * Headers that describe *this* connection rather than the request, and so
 * must not be replayed upstream — `host` would misroute virtual hosts, and a
 * stale `content-length` contradicts the body we re-send.
 */
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

async function forward(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;

  if (!/^https?:\/\//.test(API_BASE_URL)) {
    return NextResponse.json({ error: 'API server is not configured' }, { status: 500 });
  }

  const upstream = new URL(`${API_BASE_URL}/${(path ?? []).join('/')}`);
  upstream.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // A read's time limit runs until the API's answer starts, not through its body.
  const timeout = hasBody ? null : new AbortController();
  const timer = timeout && setTimeout(() => timeout.abort(), READ_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
      signal: timeout?.signal,
    });
  } catch (err) {
    if (timeout?.signal.aborted) {
      console.error('[aeo-proxy] upstream timed out', upstream.pathname);
      return NextResponse.json(
        { error: 'API server took too long to answer', code: 'upstream_timeout' },
        { status: 504 },
      );
    }
    // The upstream being unreachable used to surface as an opaque browser
    // network error. Name it, so the next outage is one log line away.
    console.error('[aeo-proxy] upstream unreachable', upstream.pathname, err);
    return NextResponse.json({ error: 'API server is unreachable' }, { status: 502 });
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Only content-type is copied. `fetch` has already decoded the body, so
  // replaying content-encoding or content-length would describe bytes that no
  // longer exist and the browser would fail to parse the response.
  const responseHeaders = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Context) {
  return forward(request, params);
}

export async function POST(request: NextRequest, { params }: Context) {
  return forward(request, params);
}

export async function PUT(request: NextRequest, { params }: Context) {
  return forward(request, params);
}

export async function PATCH(request: NextRequest, { params }: Context) {
  return forward(request, params);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return forward(request, params);
}
