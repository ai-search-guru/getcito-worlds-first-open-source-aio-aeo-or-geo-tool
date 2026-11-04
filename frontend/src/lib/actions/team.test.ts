import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Removing a member: their profile leaves the organization, and the author
 * they were (Settings › Authors) is no longer linked to them, since only they
 * could unlink themself from a session.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  columns?: string;
  filters: [string, unknown][];
  order?: [string, unknown];
}
const sessionCalls: Call[] = [];
let adminCalls: Call[] = [];
/** What a read or write of each table answers through the service client. */
let adminAnswers: Record<string, { data: unknown; error: null | { message: string } }> = {};
/** The signed-in person's role. */
let sessionRole = 'admin';

function builder(calls: Call[], answerOf: (call: Call) => unknown) {
  return (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const chain = {
      select: (columns?: string) => {
        if (columns !== undefined) call.columns = columns;
        return chain;
      },
      update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
      order: (column: string, options?: unknown) => {
        call.order = [column, options];
        return chain;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      single: async () => answerOf(call),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answerOf(call)).then(resolve),
    };
    return chain;
  };
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const readMemberEmails = vi.hoisted(() => vi.fn());
vi.mock('@/lib/memberEmails', () => ({ readMemberEmails }));
// Who may use a brand (BRAND-ACCESS): person id → the brands they may.
const brandReaders = vi.hoisted(() => vi.fn());
vi.mock('@/lib/brandAccess', () => ({ brandReaders }));
vi.mock('@/lib/guards/planGuard', () => ({ enforceLimit: vi.fn(), getOrgPlan: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN } } }) },
    from: builder(sessionCalls, () => ({
      data: { id: ADMIN, role: sessionRole, organization_id: ORG },
      error: null,
    })),
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) =>
      builder(
        adminCalls,
        (call) => adminAnswers[`${call.table}.${call.op}`] ?? { data: null, error: null },
      )(table),
  },
}));

const { listBrandMembers, listInvitations, removeMember } = await import('./team');

beforeEach(() => {
  sessionCalls.length = 0;
  adminCalls = [];
  adminAnswers = {};
  sessionRole = 'admin';
});

describe('removeMember', () => {
  it('takes the member out of the organization and unlinks the author they were', async () => {
    await removeMember(MEMBER);

    expect(adminCalls).toEqual([
      {
        table: 'profiles',
        op: 'update',
        row: { organization_id: null },
        filters: [
          ['id', MEMBER],
          ['organization_id', ORG],
        ],
      },
      {
        table: 'content_authors',
        op: 'update',
        row: { user_id: null },
        filters: [
          ['organization_id', ORG],
          ['user_id', MEMBER],
        ],
      },
    ]);
  });

  it('leaves the author linked when the member could not be removed', async () => {
    adminAnswers['profiles.update'] = { data: null, error: { message: 'boom' } };

    await expect(removeMember(MEMBER)).rejects.toThrow('boom');
    expect(adminCalls.map((c) => c.table)).toEqual(['profiles']);
  });

  it('says so when the author link could not be cleared', async () => {
    adminAnswers['content_authors.update'] = { data: null, error: { message: 'denied' } };

    await expect(removeMember(MEMBER)).rejects.toThrow('denied');
  });

  it('refuses to remove yourself', async () => {
    await expect(removeMember(ADMIN)).rejects.toThrow('You cannot remove yourself');
    expect(adminCalls).toEqual([]);
  });
});

describe('listInvitations', () => {
  const PENDING = {
    id: 'i1',
    email: 'new@example.com',
    role: 'analyst',
    status: 'pending',
    invited_by: ADMIN,
    expires_at: '2026-11-07T00:00:00Z',
    created_at: '2026-10-31T00:00:00Z',
    accepted_at: null,
  };

  it.each(['admin', 'analyst'])(
    'lists the pending invitations to an %s from the server, without their token (00390)',
    async (role) => {
      sessionRole = role;
      adminAnswers['invitations.select'] = { data: [PENDING], error: null };

      const list = await listInvitations();

      expect(adminCalls).toEqual([
        {
          table: 'invitations',
          op: 'select',
          columns:
            'id, email, role, status, invited_by, expires_at, created_at, accepted_at, brand_scope, brand_ids',
          filters: [
            ['organization_id', ORG],
            ['status', 'pending'],
          ],
          order: ['created_at', { ascending: false }],
        },
      ]);
      // Only admins read invitations themselves now (00390).
      expect(sessionCalls.map((c) => c.table)).toEqual(['profiles']);
      expect(list).toEqual([
        {
          id: 'i1',
          email: 'new@example.com',
          role: 'analyst',
          status: 'pending',
          invitedBy: ADMIN,
          expiresAt: '2026-11-07T00:00:00Z',
          createdAt: '2026-10-31T00:00:00Z',
          acceptedAt: null,
          brandAccess: { scope: 'all', brandIds: [] },
        },
      ]);
    },
  );

  it('names the brands an invitation shares to admins only (BRAND-ACCESS §3.2)', async () => {
    const BRAND = '55555555-5555-4555-8555-555555555555';
    adminAnswers['invitations.select'] = {
      data: [{ ...PENDING, brand_scope: 'selected', brand_ids: [BRAND] }],
      error: null,
    };
    expect((await listInvitations())[0].brandAccess).toEqual({
      scope: 'selected',
      brandIds: [BRAND],
    });
    sessionRole = 'analyst';
    expect((await listInvitations())[0].brandAccess).toEqual({ scope: 'all', brandIds: [] });
  });

  it('says so when the invitations could not be read', async () => {
    adminAnswers['invitations.select'] = { data: null, error: { message: 'down' } };

    await expect(listInvitations()).rejects.toThrow('down');
  });
});

describe('listBrandMembers', () => {
  const NARROW = '44444444-4444-4444-8444-444444444444';
  const BRAND = '55555555-5555-4555-8555-555555555555';
  beforeEach(() => {
    adminAnswers['profiles.select'] = {
      data: [
        { id: ADMIN, full_name: 'Ada', avatar_url: null, role: 'admin', created_at: '2026-01-01' },
        {
          id: MEMBER,
          full_name: 'Bo',
          avatar_url: null,
          role: 'manager',
          created_at: '2026-02-01',
        },
        {
          id: NARROW,
          full_name: 'Cy',
          avatar_url: null,
          role: 'analyst',
          created_at: '2026-03-01',
        },
      ],
      error: null,
    };
    readMemberEmails.mockResolvedValue(new Map([[MEMBER, 'bo@acme.example']]));
  });

  it('lists the members who can see the brand, in the team’s order', async () => {
    brandReaders.mockResolvedValue(
      new Map([
        [ADMIN, new Set([BRAND])],
        [MEMBER, new Set([BRAND])],
      ]),
    );
    const members = await listBrandMembers(BRAND);
    expect(brandReaders).toHaveBeenCalledWith(ORG, [BRAND]);
    expect(members.map((m) => [m.userId, m.email, m.isCurrentUser])).toEqual([
      [ADMIN, '', true],
      [MEMBER, 'bo@acme.example', false],
    ]);
  });

  it('answers a brand the caller can’t see as not found', async () => {
    brandReaders.mockResolvedValue(new Map([[MEMBER, new Set([BRAND])]]));
    await expect(listBrandMembers(BRAND)).rejects.toThrow('Brand not found');
  });
});
