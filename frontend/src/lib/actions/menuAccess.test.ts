import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Menu access (00374): who may change menus, and what the server writes.
 * The person's own client reads their profile and their role's row; the
 * service client reads members and writes everything but work areas.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface Call {
  client: 'user' | 'admin';
  table: string;
  op: string;
  row?: unknown;
  options?: unknown;
  filters: [string, unknown][];
}
let calls: Call[] = [];
/** What a read or write answers, by `${client}.${table}.${op}`. */
let answers: Record<string, { data: unknown; error: null | { message: string } }> = {};

function builder(client: Call['client']) {
  return (table: string) => {
    const call: Call = { client, table, op: 'select', filters: [] };
    calls.push(call);
    const answer = () => answers[`${client}.${table}.${call.op}`] ?? { data: null, error: null };
    const chain = {
      select: () => chain,
      update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
      upsert: (row: unknown, options: unknown) =>
        Object.assign(call, { op: 'upsert', row, options }) && chain,
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      order: () => chain,
      single: async () => answer(),
      maybeSingle: async () => answer(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return chain;
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: builder('user'),
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: builder('admin') } }));
vi.mock('@/lib/memberEmails', () => ({
  readMemberEmails: async (ids: string[]) => new Map(ids.map((id) => [id, `${id}@x.example`])),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  getMenuAccessSettings,
  getMyMenu,
  setMemberMenu,
  setMenuManager,
  setMyWorkAreas,
  setRoleMenu,
} = await import('./menuAccess');

const writes = () => calls.filter((c) => c.op !== 'select');

function signedInAs(profile: Record<string, unknown>) {
  answers['user.profiles.select'] = {
    data: {
      id: ME,
      organization_id: ORG,
      work_areas: [],
      work_areas_asked_at: null,
      menu_shown: [],
      menu_hidden: [],
      can_manage_menus: false,
      ...profile,
    },
    error: null,
  };
}

beforeEach(() => {
  calls = [];
  answers = {};
});

describe('getMyMenu', () => {
  it('leaves out what the role hides, narrowed to the work areas', async () => {
    signedInAs({ role: 'analyst', work_areas: ['brand', 'gone'], menu_shown: ['prompts'] });
    answers['user.organization_menu_roles.select'] = {
      data: { hidden_sections: ['citations'] },
      error: null,
    };

    const menu = await getMyMenu();

    expect(menu.hidden.sort()).toEqual(
      ['audit', 'citations', 'content', 'prompts', 'shopping', 'traffic'].sort(),
    );
    expect(menu.hiddenByAdmin).toEqual(['citations']);
    expect(menu.workAreas).toEqual(['brand']);
    expect(menu.workAreasAsked).toBe(false);
    expect(menu.canManageMenus).toBe(false);
    const roleRead = calls.find((c) => c.table === 'organization_menu_roles');
    expect(roleRead?.client).toBe('user');
    expect(roleRead?.filters).toEqual([
      ['organization_id', ORG],
      ['role', 'analyst'],
    ]);
  });

  it('narrows an admin’s menu to their work areas only, without reading a role row', async () => {
    signedInAs({ role: 'admin', work_areas: ['brand'], menu_hidden: ['reports'] });

    const menu = await getMyMenu();

    expect(menu.hidden.sort()).toEqual(
      ['audit', 'content', 'prompts', 'shopping', 'traffic'].sort(),
    );
    expect(menu.canManageMenus).toBe(true);
    expect(calls.some((c) => c.table === 'organization_menu_roles')).toBe(false);
  });

  it('counts a manager an admin let change menus', async () => {
    signedInAs({ role: 'manager', can_manage_menus: true, work_areas_asked_at: '2026-10-28' });
    expect(await getMyMenu()).toMatchObject({ canManageMenus: true, workAreasAsked: true });
  });

  it('has Agent Center only with the new Chat on for the workspace', async () => {
    signedInAs({ role: 'analyst', menu_hidden: ['agents'] });
    answers['user.organization_menu_roles.select'] = { data: null, error: null };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await getMyMenu()).hidden).not.toContain('agents');
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG);
    expect((await getMyMenu()).hidden).toContain('agents');
    // AEO/GEO & Audit and Analytics keep it, without Chat.
    for (const area of ['aeo', 'analytics']) {
      signedInAs({ role: 'admin', work_areas: [area] });
      const { hidden } = await getMyMenu();
      expect(hidden, area).toContain('agent');
      expect(hidden, area).not.toContain('agents');
    }
    vi.unstubAllEnvs();
  });
});

describe('setRoleMenu', () => {
  it('refuses people who can’t change menus', async () => {
    signedInAs({ role: 'analyst' });
    await expect(setRoleMenu('analyst', ['content'])).rejects.toThrow(/menu managers/);
    signedInAs({ role: 'manager', can_manage_menus: false });
    await expect(setRoleMenu('analyst', ['content'])).rejects.toThrow(/menu managers/);
    signedInAs({ role: 'analyst', can_manage_menus: true });
    await expect(setRoleMenu('analyst', ['content'])).rejects.toThrow(/menu managers/);
    expect(writes()).toEqual([]);
  });

  it('never sets the admins’ menu', async () => {
    signedInAs({ role: 'admin' });
    await expect(setRoleMenu('admin' as never, ['content'])).rejects.toThrow(/Nobody sets/);
    expect(writes()).toEqual([]);
  });

  it('keeps the role’s known sections, without Action Center', async () => {
    signedInAs({ role: 'manager', can_manage_menus: true });

    await setRoleMenu('analyst', ['reports', 'action-center', 'nope', 'content']);

    expect(writes()).toEqual([
      expect.objectContaining({
        client: 'admin',
        table: 'organization_menu_roles',
        op: 'upsert',
        row: {
          organization_id: ORG,
          role: 'analyst',
          hidden_sections: ['content', 'reports'],
          updated_by: ME,
        },
        options: { onConflict: 'organization_id,role' },
      }),
    ]);
  });
});

describe('setMemberMenu', () => {
  it('never changes an admin’s menu', async () => {
    signedInAs({ role: 'manager', can_manage_menus: true });
    answers['admin.profiles.select'] = { data: { role: 'admin' }, error: null };

    await expect(setMemberMenu(ADA, { shown: [], hidden: ['content'] })).rejects.toThrow(
      /Nobody sets/,
    );
    expect(writes()).toEqual([]);
  });

  it('refuses someone outside the organization', async () => {
    signedInAs({ role: 'admin' });
    await expect(setMemberMenu(ADA, { shown: [], hidden: [] })).rejects.toThrow(/Not a member/);
    expect(calls.find((c) => c.client === 'admin')?.filters).toEqual([
      ['id', ADA],
      ['organization_id', ORG],
    ]);
  });

  it('writes the exceptions, a section shown winning over hidden', async () => {
    signedInAs({ role: 'admin' });
    answers['admin.profiles.select'] = { data: { role: 'analyst' }, error: null };

    await setMemberMenu(ADA, { shown: ['audit', 'audit'], hidden: ['audit', 'content', 'x'] });

    expect(writes()).toEqual([
      expect.objectContaining({
        client: 'admin',
        table: 'profiles',
        op: 'update',
        row: { menu_shown: ['audit'], menu_hidden: ['content'] },
        filters: [
          ['id', ADA],
          ['organization_id', ORG],
        ],
      }),
    ]);
  });
});

describe('setMenuManager', () => {
  it('is for admins only', async () => {
    signedInAs({ role: 'manager', can_manage_menus: true });
    await expect(setMenuManager(ADA, true)).rejects.toThrow(/Only admins/);
    expect(writes()).toEqual([]);
  });

  it('only gives it to managers', async () => {
    signedInAs({ role: 'admin' });
    answers['admin.profiles.select'] = { data: { role: 'analyst' }, error: null };
    await expect(setMenuManager(ADA, true)).rejects.toThrow(/Only managers/);
    expect(writes()).toEqual([]);
  });

  it('takes only true or false', async () => {
    signedInAs({ role: 'admin' });
    answers['admin.profiles.select'] = { data: { role: 'manager' }, error: null };
    await expect(setMenuManager(ADA, 'yes' as never)).rejects.toThrow();
    expect(writes()).toEqual([]);
  });

  it('lets a manager change menus', async () => {
    signedInAs({ role: 'admin' });
    answers['admin.profiles.select'] = { data: { role: 'manager' }, error: null };

    await setMenuManager(ADA, true);

    expect(writes()).toEqual([
      expect.objectContaining({
        table: 'profiles',
        op: 'update',
        row: { can_manage_menus: true },
      }),
    ]);
  });
});

describe('setMyWorkAreas', () => {
  it('refuses an area it doesn’t know', async () => {
    await expect(setMyWorkAreas(['brand', 'sales'])).rejects.toThrow();
    expect(writes()).toEqual([]);
  });

  it('writes the person’s own areas, in the list’s order, and marks them asked', async () => {
    await setMyWorkAreas(['analytics', 'brand', 'leaders']);

    const [write] = writes();
    expect(write).toMatchObject({
      client: 'user',
      table: 'profiles',
      op: 'update',
      filters: [['id', ME]],
    });
    expect(write.row).toMatchObject({ work_areas: ['leaders', 'brand', 'analytics'] });
    expect((write.row as { work_areas_asked_at: string }).work_areas_asked_at).toEqual(
      expect.any(String),
    );
  });

  it('takes none: every section, and the step answered', async () => {
    await setMyWorkAreas([]);
    expect(writes()[0].row).toMatchObject({ work_areas: [] });
  });
});

describe('getMenuAccessSettings', () => {
  it('is for admins and menu managers', async () => {
    signedInAs({ role: 'manager' });
    await expect(getMenuAccessSettings()).rejects.toThrow(/menu managers/);
  });

  it('reads the role table and the members', async () => {
    signedInAs({ role: 'manager', can_manage_menus: true });
    answers['admin.organization_menu_roles.select'] = {
      data: [
        { role: 'analyst', hidden_sections: ['content', 'action-center'] },
        { role: 'agency_partner', hidden_sections: ['nope'] },
      ],
      error: null,
    };
    answers['admin.profiles.select'] = {
      data: [
        { id: ME, role: 'manager', full_name: 'Me', can_manage_menus: true, work_areas: ['brand'] },
        {
          id: ADA,
          role: 'analyst',
          full_name: null,
          can_manage_menus: true,
          menu_hidden: ['audit'],
        },
      ],
      error: null,
    };

    const settings = await getMenuAccessSettings();

    expect(settings.roles).toEqual({ manager: [], analyst: ['content'], agency_partner: [] });
    expect(settings.viewerIsAdmin).toBe(false);
    expect(settings.members).toEqual([
      expect.objectContaining({
        userId: ME,
        email: `${ME}@x.example`,
        workAreas: ['brand'],
        canManageMenus: true,
        isCurrentUser: true,
      }),
      // A flag left from when they were a manager counts for nothing.
      expect.objectContaining({ userId: ADA, hidden: ['audit'], canManageMenus: false }),
    ]);
  });
});
