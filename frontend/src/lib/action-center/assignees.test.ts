import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who actions are assigned to. Profiles are readable only by their owner
 * (RLS), so they are read with the admin client — only those in the brand's
 * organization, once the brand is checked to be the user's.
 */

let profiles: Record<string, unknown>[];
let profileReads: unknown[][];
const getUserById = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => {
          profileReads.push(ids);
          return { data: profiles.filter((p) => ids.includes(p.id as string)), error: null };
        },
      }),
    }),
    auth: { admin: { getUserById: (id: string) => getUserById(id) } },
  },
}));

const { readAssignees } = await import('./assignees');

/** The signed-in user's client: the brand comes back only if it is theirs. */
const userClient = (organizationId: string | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: organizationId ? { organization_id: organizationId } : null,
            error: null,
          }),
        }),
      }),
    }),
  }) as unknown as SupabaseClient;

beforeEach(() => {
  profileReads = [];
  profiles = [
    { id: 'u1', full_name: 'Ada Lovelace', avatar_url: 'https://a/1.png', organization_id: 'org' },
    { id: 'u2', full_name: null, avatar_url: null, organization_id: 'org' },
    { id: 'x9', full_name: 'Someone Else', avatar_url: null, organization_id: 'other' },
  ];
  getUserById.mockReset();
  getUserById.mockImplementation(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
  }));
});

describe('readAssignees', () => {
  it("names every member of the brand's organization, not only the user", async () => {
    const assignees = await readAssignees(userClient('org'), 'b1', ['u1', 'u2', 'u1']);
    expect(Object.fromEntries(assignees)).toEqual({
      u1: {
        id: 'u1',
        fullName: 'Ada Lovelace',
        avatarUrl: 'https://a/1.png',
        email: 'u1@example.com',
      },
      u2: { id: 'u2', fullName: null, avatarUrl: null, email: 'u2@example.com' },
    });
    expect(profileReads).toEqual([['u1', 'u2']]);
  });

  it('names no one outside the organization, and reads no e-mail for them', async () => {
    const assignees = await readAssignees(userClient('org'), 'b1', ['x9']);
    expect(assignees.size).toBe(0);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("names no one when the brand isn't the user's", async () => {
    expect((await readAssignees(userClient(null), 'b1', ['u1'])).size).toBe(0);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('reads nothing when no action is assigned', async () => {
    expect((await readAssignees(userClient('org'), 'b1', [])).size).toBe(0);
    expect(profileReads).toEqual([]);
  });
});
