import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Roles & access and Your access reads: a failure in the result, never thrown (#1777). */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

let profilesError: { message: string } | null = null;
let ctxThrows = false;

function from(table: string) {
  let listing = false;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => {
      listing = true;
      return chain;
    },
    maybeSingle: async () =>
      table === 'profiles'
        ? { data: { organization_id: ORG }, error: null }
        : { data: null, error: null },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        listing && table === 'brands'
          ? { data: [{ id: 'b1', name: 'Acme' }], error: null }
          : listing
            ? {
                data: profilesError ? null : [{ id: ME, full_name: 'Alex', role: 'admin' }],
                error: profilesError,
              }
            : { data: null, error: null },
      ).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));
// The person has Selected brands: Acme (BRAND-ACCESS §3.2).
vi.mock('@/lib/brandAccess', () => ({
  readMemberBrandAccess: async () => new Map([[ME, { scope: 'selected', brandIds: ['b1'] }]]),
}));
vi.mock('@/lib/memberEmails', () => ({
  readMemberAuth: async () => new Map([[ME, { email: 'alex@x.example', lastSignInAt: null }]]),
}));
vi.mock('@/lib/chat/precedenceContext', () => ({
  readPrecedenceContext: async () => {
    if (ctxThrows) throw new Error('db down');
    return null;
  },
}));

const { getChatAccess, listRoleMembers } = await import('./chatAccess');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  profilesError = null;
  ctxThrows = false;
});
afterEach(() => vi.unstubAllEnvs());

describe('getChatAccess', () => {
  it('says the read failed rather than throwing, and Chat off apart', async () => {
    ctxThrows = true;
    expect(await getChatAccess()).toEqual({ ok: false, failure: 'failed' });
    ctxThrows = false;
    // No context: the person isn't a member of the workspace now.
    expect(await getChatAccess()).toEqual({ ok: false, failure: 'chat_off' });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await getChatAccess()).toEqual({ ok: false, failure: 'chat_off' });
  });
});

describe('listRoleMembers', () => {
  it('lists the members, and a failed read as failed', async () => {
    expect(await listRoleMembers()).toEqual({
      ok: true,
      members: [
        {
          userId: ME,
          name: 'Alex',
          email: 'alex@x.example',
          role: 'admin',
          lastActiveAt: null,
          isYou: true,
          brands: { scope: 'selected', names: ['Acme'] },
        },
      ],
    });
    profilesError = { message: 'db down' };
    expect(await listRoleMembers()).toEqual({ ok: false, failure: 'failed' });
  });
});
