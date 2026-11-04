import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * A signed-out visitor of a dashboard page goes to sign-in with the page as
 * `?next=`, query included, so signing in brings them back to it — an
 * e-mail's "Open AI Traffic" button, say.
 */

// The locale routing isn't what's tested here (and its ESM build doesn't load in Vitest).
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));
const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  organizationId: 'org-1' as string | null,
}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => ({
    supabaseResponse: NextResponse.next(),
    user: session.user,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { organization_id: session.organizationId },
              error: null,
            }),
          }),
        }),
      }),
    },
  }),
}));

const { proxy } = await import('./proxy');

describe('proxy', () => {
  it('sends a signed-out visitor to sign-in with the page they asked for', async () => {
    const res = await proxy(
      new NextRequest('https://app.example.com/dashboard/settings?tab=notifications'),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('next')).toBe('/dashboard/settings?tab=notifications');
  });

  it('names the page without its locale prefix', async () => {
    const res = await proxy(new NextRequest('https://app.example.com/en/dashboard/traffic'));
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe(
      '/dashboard/traffic',
    );
  });
});

/**
 * Agent Chat's old addresses (CHAT-01 item 2): with the new Chat on for the
 * person's workspace, a 301 to the matching /dashboard/chat address, query
 * kept; with it off, the old page as today.
 */
describe('proxy: the old Agent addresses', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    session.user = null;
    session.organizationId = 'org-1';
  });

  it('moves them to Chat with a 301, query kept, where the new Chat is on', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-1');
    session.user = { id: 'user-1' };
    const res = await proxy(new NextRequest('https://app.example.com/en/dashboard/agent/x1?q=a'));
    expect(res.status).toBe(301);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/dashboard/chat/x1');
    expect(location.search).toBe('?q=a');
  });

  it('leaves them alone while the new Chat is off, or off for this workspace', async () => {
    session.user = { id: 'user-1' };
    expect(
      (await proxy(new NextRequest('https://app.example.com/dashboard/agent'))).status,
    ).not.toBe(301);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect(
      (await proxy(new NextRequest('https://app.example.com/dashboard/agent'))).status,
    ).not.toBe(301);
  });

  it('sends a signed-out visitor to sign-in first', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    const res = await proxy(new NextRequest('https://app.example.com/dashboard/agent'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/sign-in');
  });
});
