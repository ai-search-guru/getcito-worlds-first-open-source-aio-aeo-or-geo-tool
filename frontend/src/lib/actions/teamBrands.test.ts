// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Team actions' brand access (BRAND-ACCESS PR 12, §3.2, §10): an admin
 * invites someone to All brands or to some of the organization's brands,
 * changes them with Edit brands, and an invitation is accepted with its
 * brands in one transaction (00471). Admins always have All brands; Selected
 * brands needs at least one of the organization's brands.
 */

const ME = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'a0000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-000000000001';
const ACME = 'c0000000-0000-4000-8000-000000000001';
const GLOBEX = 'c0000000-0000-4000-8000-000000000002';
const OTHER = 'c0000000-0000-4000-8000-000000000009';

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload: unknown;
  filters: [string, unknown][];
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  rpcs: [] as [string, Record<string, unknown>][],
  rpcError: null as { code?: string; message: string } | null,
  viewerRole: 'admin',
  targetRole: 'analyst',
  invitation: null as Record<string, unknown> | null,
}));

function from(table: string) {
  const call: Call = { table, op: 'select', payload: null, filters: [] };
  db.calls.push(call);
  const answer = () => {
    if (call.op !== 'select') return { data: { id: 'new' }, error: null };
    if (table === 'brands') {
      return {
        data: [
          { id: ACME, name: 'Acme' },
          { id: GLOBEX, name: 'Globex' },
        ],
        error: null,
      };
    }
    if (table === 'profiles') {
      const byId = call.filters.find(([column]) => column === 'id')?.[1];
      if (byId === BOB) return { data: { role: db.targetRole }, error: null };
      return {
        data: [
          { id: ME, full_name: 'Ada', avatar_url: null, role: db.viewerRole, created_at: '1' },
          { id: BOB, full_name: 'Bob', avatar_url: null, role: 'analyst', created_at: '2' },
        ],
        error: null,
        count: 2,
      };
    }
    if (table === 'invitations') return { data: db.invitation, error: null, count: 0 };
    return { data: [], error: null, count: 0 };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), chain),
    update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), chain),
    eq: (column: string, value: unknown) => (call.filters.push([column, value]), chain),
    order: () => chain,
    limit: () => chain,
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME, email: 'ada@acme.test' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: ME, role: db.viewerRole, organization_id: ORG },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => from(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcs.push([name, args]);
      return db.rpcError
        ? { data: null, error: db.rpcError }
        : { data: name === 'set_member_brand_access' ? args.p_brand_ids : {}, error: null };
    },
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] } }),
        inviteUserByEmail: async () => ({}),
      },
    },
  },
}));
vi.mock('@/lib/memberEmails', () => ({
  readMemberEmails: async () =>
    new Map([
      [ME, 'ada@acme.test'],
      [BOB, 'bob@acme.test'],
    ]),
}));
vi.mock('@/lib/brandAccess', () => ({
  brandReaders: vi.fn(),
  readMemberBrandAccess: async () =>
    new Map([
      [ME, { scope: 'all', brandIds: [] }],
      [BOB, { scope: 'selected', brandIds: [ACME] }],
    ]),
}));
vi.mock('@/lib/guards/planGuard', () => ({
  enforceLimit: vi.fn(),
  getOrgPlan: async () => ({ name: 'Growth', limits: { maxTeamMembers: 5, maxBrands: 4 } }),
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn() }));

const { acceptInvitation, getTeamInfo, inviteMember, listMembers, setMemberBrands } =
  await import('./team');

beforeEach(() => {
  db.calls = [];
  db.rpcs = [];
  db.rpcError = null;
  db.viewerRole = 'admin';
  db.targetRole = 'analyst';
  db.invitation = null;
});

const inserted = (table: string) =>
  db.calls.find((c) => c.table === table && c.op === 'insert')?.payload as Record<string, unknown>;

describe('inviteMember', () => {
  it('keeps Selected brands on the invitation: the organization’s brands named, only', async () => {
    const result = await inviteMember('Cal@Acme.test', 'analyst', {
      scope: 'selected',
      brandIds: [GLOBEX, OTHER],
    });
    expect(result).toMatchObject({ emailSent: true });
    expect(inserted('invitations')).toMatchObject({
      email: 'cal@acme.test',
      role: 'analyst',
      brand_scope: 'selected',
      brand_ids: [GLOBEX],
    });
  });

  it('invites to All brands by default, and an admin always', async () => {
    await inviteMember('cal@acme.test', 'manager');
    expect(inserted('invitations')).toMatchObject({ brand_scope: 'all', brand_ids: [] });

    db.calls = [];
    await inviteMember('dee@acme.test', 'admin', { scope: 'selected', brandIds: [ACME] });
    expect(inserted('invitations')).toMatchObject({ brand_scope: 'all', brand_ids: [] });
  });

  it('refuses Selected brands with none of the organization’s', async () => {
    for (const brandIds of [[], [OTHER], ['not-an-id']]) {
      expect(
        await inviteMember('cal@acme.test', 'analyst', { scope: 'selected', brandIds }),
      ).toEqual({ error: 'Choose at least one brand' });
    }
    expect(inserted('invitations')).toBeUndefined();
  });
});

describe('setMemberBrands', () => {
  it('writes the choice in one call, with the organization’s brands named', async () => {
    expect(await setMemberBrands(BOB, { scope: 'selected', brandIds: [ACME, OTHER] })).toEqual({
      brandAccess: { scope: 'selected', brandIds: [ACME] },
    });
    expect(db.rpcs).toEqual([
      [
        'set_member_brand_access',
        {
          p_organization_id: ORG,
          p_user_id: BOB,
          p_brand_scope: 'selected',
          p_brand_ids: [ACME],
          p_granted_by: ME,
        },
      ],
    ]);

    db.rpcs = [];
    expect(await setMemberBrands(BOB, { scope: 'all', brandIds: [ACME] })).toEqual({
      brandAccess: { scope: 'all', brandIds: [] },
    });
    expect(db.rpcs[0][1]).toMatchObject({ p_brand_scope: 'all', p_brand_ids: [] });
  });

  it('never narrows an admin, the caller included, nor to no brand', async () => {
    expect(await setMemberBrands(ME, { scope: 'selected', brandIds: [ACME] })).toEqual({
      error: 'Admins always have All brands',
    });
    db.targetRole = 'admin';
    expect(await setMemberBrands(BOB, { scope: 'selected', brandIds: [ACME] })).toEqual({
      error: 'Admins always have All brands',
    });
    db.targetRole = 'analyst';
    expect(await setMemberBrands(BOB, { scope: 'selected', brandIds: [OTHER] })).toEqual({
      error: 'Choose at least one brand',
    });
    expect(db.rpcs).toEqual([]);
  });

  it('is for admins only (BRAND-ACCESS Q2)', async () => {
    db.viewerRole = 'manager';
    await expect(setMemberBrands(BOB, { scope: 'all', brandIds: [] })).rejects.toThrow(
      'Only admins can manage team members',
    );
    expect(db.rpcs).toEqual([]);
  });
});

describe('listMembers', () => {
  it('gives an admin everyone’s brands', async () => {
    const members = await listMembers();
    expect(members.map((m) => [m.userId, m.brandAccess])).toEqual([
      [ME, { scope: 'all', brandIds: [] }],
      [BOB, { scope: 'selected', brandIds: [ACME] }],
    ]);
  });

  it('gives anyone else their own, and the others’ as All brands', async () => {
    db.viewerRole = 'manager';
    const members = await listMembers();
    expect(members.find((m) => m.userId === BOB)?.brandAccess).toEqual({
      scope: 'all',
      brandIds: [],
    });
  });
});

describe('getTeamInfo', () => {
  it('says whether the plan has more than one brand to choose', async () => {
    expect((await getTeamInfo()).multiBrand).toBe(true);
  });
});

describe('acceptInvitation', () => {
  const invitation = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    email: 'ada@acme.test',
    status: 'pending',
    expires_at: '2099-01-01T00:00:00Z',
    organization_id: ORG,
    role: 'analyst',
    brand_scope: 'selected',
    brand_ids: [ACME],
    ...over,
  });

  it('joins with the invitation’s role and brands in one transaction', async () => {
    db.invitation = invitation();
    expect(await acceptInvitation('tok')).toEqual({ organizationId: ORG, role: 'analyst' });
    expect(db.rpcs).toEqual([['accept_invitation', { p_invitation_id: 'inv-1', p_user_id: ME }]]);
    // Nothing written outside it.
    expect(db.calls.filter((c) => c.op === 'update')).toEqual([]);
  });

  it('says so when the transaction refuses', async () => {
    db.invitation = invitation();
    db.rpcError = { code: '22023', message: 'invitation is no longer valid' };
    expect(await acceptInvitation('tok')).toEqual({ error: 'invitation is no longer valid' });
  });

  it('before 00471: accepts an All-brands invitation as before, never a Selected one', async () => {
    db.rpcError = { code: 'PGRST202', message: 'no function' };
    db.invitation = invitation();
    expect(await acceptInvitation('tok')).toEqual({
      error: 'This invitation can’t be accepted yet. Please try again later.',
    });
    expect(db.calls.filter((c) => c.op === 'update')).toEqual([]);

    db.invitation = invitation({ brand_scope: 'all', brand_ids: [] });
    expect(await acceptInvitation('tok')).toEqual({ organizationId: ORG, role: 'analyst' });
    const updates = db.calls.filter((c) => c.op === 'update');
    expect(updates.map((c) => c.table)).toEqual(['profiles', 'invitations']);
    expect(updates[0].payload).toMatchObject({ organization_id: ORG, role: 'analyst' });
  });
});
