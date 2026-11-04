import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ALWAYS_ON_SECTION,
  CHAT_AGENTIC_SECTIONS,
  MENU_SECTIONS,
  WORK_AREAS,
  WORK_AREA_IDS,
  cleanMenuSections,
  hiddenMenuSections,
  hiddenWithWorkAreas,
  menuOfProfile,
  menuSectionOf,
  menuSectionsFor,
  readRoleHidden,
  workAreaSections,
  type MenuAccess,
} from './menuAccess';

const analyst: MenuAccess = {
  role: 'analyst',
  roleHidden: [],
  shown: [],
  hidden: [],
  workAreas: [],
};

const hidden = (access: Partial<MenuAccess>) => [...hiddenMenuSections({ ...analyst, ...access })];

describe('menuSectionOf', () => {
  it('names a route by its first part under /dashboard', () => {
    expect(menuSectionOf('/dashboard/content/plan')).toBe('content');
    expect(menuSectionOf('/dashboard/agent')).toBe('agent');
    expect(menuSectionOf('/dashboard/agents/a1/edit')).toBe('agents');
    expect(menuSectionOf('/dashboard')).toBeNull();
    expect(menuSectionOf('/pricing')).toBeNull();
  });
});

describe('MENU_SECTIONS', () => {
  it('lists the left menu, Chat and Agent Center first and Action Center right after', () => {
    expect(MENU_SECTIONS.slice(0, 3)).toEqual(['agent', 'agents', ALWAYS_ON_SECTION]);
    expect(MENU_SECTIONS).toEqual(
      expect.arrayContaining(['agent', 'content', 'audit', 'insights', 'shopping', 'reports']),
    );
  });

  it('lists Competitors right after Reports, so roles and people can hide it', () => {
    expect(MENU_SECTIONS.indexOf('competitors')).toBe(MENU_SECTIONS.indexOf('reports') + 1);
    expect(cleanMenuSections(['competitors'])).toEqual(['competitors']);
    expect(hidden({ roleHidden: ['competitors'] })).toEqual(['competitors']);
  });

  it('keeps Competitors for the areas that compare the brand with others', () => {
    const withCompetitors = WORK_AREAS.filter((area) =>
      (area.sections as readonly string[]).includes('competitors'),
    ).map((area) => area.id);
    expect(withCompetitors).toEqual(['leaders', 'brand', 'growth', 'bizdev', 'analytics']);
    expect(hidden({ workAreas: ['brand'] })).not.toContain('competitors');
    expect(hidden({ workAreas: ['content'] })).toContain('competitors');
  });

  it('knows every section a work area names', () => {
    for (const area of WORK_AREAS) {
      for (const section of area.sections) expect(MENU_SECTIONS).toContain(section);
    }
  });
});

describe('hiddenMenuSections', () => {
  it('shows everything when nothing is hidden', () => {
    expect(hidden({})).toEqual([]);
  });

  it('leaves out what the role hides', () => {
    expect(hidden({ roleHidden: ['content', 'audit'] })).toEqual(['content', 'audit']);
  });

  it('shows a section for a person although the role hides it, and hides one it shows', () => {
    expect(
      hidden({ roleHidden: ['content', 'audit'], shown: ['audit'], hidden: ['reports'] }),
    ).toEqual(['content', 'reports']);
  });

  it('narrows the menu to the work areas', () => {
    expect(hidden({ workAreas: ['brand'] }).sort()).toEqual(
      ['audit', 'content', 'prompts', 'shopping', 'traffic'].sort(),
    );
  });

  it('keeps a section shown for the person to their work areas', () => {
    expect(hidden({ workAreas: ['brand'], shown: ['content'] })).toContain('content');
  });

  it('ignores work areas it does not know', () => {
    expect(hidden({ workAreas: ['retired-area'] })).toEqual([]);
  });

  it('keeps a section no work area names', () => {
    const sections = [...MENU_SECTIONS, 'new-section'];
    expect([...hiddenMenuSections({ ...analyst, workAreas: ['brand'] }, sections)]).not.toContain(
      'new-section',
    );
  });

  it('never hides Action Center', () => {
    expect(
      hidden({
        roleHidden: [ALWAYS_ON_SECTION],
        hidden: [ALWAYS_ON_SECTION],
        workAreas: ['brand'],
      }),
    ).not.toContain(ALWAYS_ON_SECTION);
  });

  it('takes nothing off an admin’s menu but their own work areas', () => {
    expect(hidden({ role: 'admin', roleHidden: ['content'], hidden: ['reports'] })).toEqual([]);
    expect(
      hidden({ role: 'admin', roleHidden: ['mentions'], workAreas: ['brand'] }).sort(),
    ).toEqual(['audit', 'content', 'prompts', 'shopping', 'traffic'].sort());
  });
});

// Agent Center (/dashboard/agents), right under Chat and only with the new
// Chat on: the same rule as Chat for roles, and in every work area: right
// after Chat where Chat is, else right after Action Center.
describe('Agent Center', () => {
  const chatOff = menuSectionsFor(false);

  it('is the one section only the new Chat has', () => {
    expect(CHAT_AGENTIC_SECTIONS).toEqual(['agents']);
    expect(menuSectionsFor(true)).toEqual(MENU_SECTIONS);
    expect(chatOff).toEqual(MENU_SECTIONS.filter((section) => section !== 'agents'));
  });

  it('is in the work areas Chat is in, right after it', () => {
    for (const area of WORK_AREAS) {
      const sections = area.sections as readonly string[];
      const chat = sections.indexOf('agent');
      if (chat >= 0) expect(sections.indexOf('agents'), area.id).toBe(chat + 1);
    }
    expect(hidden({ workAreas: ['content'] })).not.toContain('agents');
  });

  it('is in AEO/GEO & Audit, Developers and Analytics without Chat, after Action Center', () => {
    const alone = WORK_AREAS.filter((area) => {
      const sections = area.sections as readonly string[];
      return sections.includes('agents') && !sections.includes('agent');
    });
    expect(alone.map((area) => area.id)).toEqual(['aeo', 'developers', 'analytics']);
    for (const area of alone)
      expect(area.sections.slice(0, 2)).toEqual([ALWAYS_ON_SECTION, 'agents']);
    for (const workAreas of [['aeo'], ['developers'], ['analytics']]) {
      expect(hidden({ workAreas })).toContain('agent');
      expect(hidden({ workAreas })).not.toContain('agents');
    }
    // So every work area keeps it.
    expect(
      WORK_AREAS.every((area) => (area.sections as readonly string[]).includes('agents')),
    ).toBe(true);
  });

  it('is on every role’s menu until someone hides it, as Chat is', () => {
    expect(hidden({ role: 'agency_partner' })).toEqual([]);
    expect(hidden({ roleHidden: ['agents'] })).toEqual(['agents']);
    expect(cleanMenuSections(['agents', 'agent'])).toEqual(['agent', 'agents']);
  });

  it('is off every count and list while the new Chat is off', () => {
    expect([
      ...hiddenMenuSections({ ...analyst, workAreas: ['analytics'] }, chatOff),
    ]).not.toContain('agents');
    expect(hiddenWithWorkAreas(['agents'], ['analytics'], chatOff)).not.toContain('agents');
    const profile = {
      role: 'analyst' as const,
      work_areas: [],
      work_areas_asked_at: null,
      menu_shown: [],
      menu_hidden: ['agents'],
      can_manage_menus: null,
    };
    expect(menuOfProfile(profile, [], chatOff).hidden).toEqual([]);
    expect(menuOfProfile(profile, [], menuSectionsFor(true)).hidden).toEqual(['agents']);
  });
});

describe('workAreaSections', () => {
  it('joins the areas’ sections', () => {
    const sections = workAreaSections(['developers', 'brand']);
    expect(sections?.has('audit')).toBe(true);
    expect(sections?.has('mentions')).toBe(true);
    expect(sections?.has('shopping')).toBe(false);
  });

  it('is null for no known area', () => {
    expect(workAreaSections([])).toBeNull();
  });
});

describe('hiddenWithWorkAreas', () => {
  it('keeps what the admin takes off and narrows the rest to the areas', () => {
    expect(hiddenWithWorkAreas(['mentions'], ['brand'])).toEqual([
      'content',
      'audit',
      'prompts',
      'mentions',
      'shopping',
      'traffic',
    ]);
    expect(hiddenWithWorkAreas(['mentions'], [])).toEqual(['mentions']);
  });
});

describe('menuOfProfile', () => {
  const profile = {
    role: 'manager' as const,
    work_areas: ['brand', 'retired'],
    work_areas_asked_at: null,
    menu_shown: ['prompts'],
    menu_hidden: [],
    can_manage_menus: true,
  };

  it('builds the menu from the profile and the role’s row', () => {
    expect(menuOfProfile(profile, ['citations'])).toEqual({
      hidden: ['content', 'audit', 'prompts', 'citations', 'shopping', 'traffic'],
      hiddenByAdmin: ['citations'],
      workAreas: ['brand'],
      workAreasAsked: false,
      canManageMenus: true,
    });
  });

  it('lets only managers and admins change menus', () => {
    expect(menuOfProfile({ ...profile, role: 'analyst' }, []).canManageMenus).toBe(false);
    expect(
      menuOfProfile({ ...profile, role: 'admin', can_manage_menus: false }, []).canManageMenus,
    ).toBe(true);
  });
});

describe('readRoleHidden', () => {
  function client(answer: { data: unknown; error: unknown }) {
    const from = vi.fn(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => answer,
      };
      return chain;
    });
    return { from };
  }

  it('reads the role’s row', async () => {
    const supabase = client({ data: { hidden_sections: ['content'] }, error: null });
    expect(await readRoleHidden(supabase as never, 'org', 'analyst')).toEqual(['content']);
    expect(supabase.from).toHaveBeenCalledWith('organization_menu_roles');
  });

  it('reads nothing for admins', async () => {
    const supabase = client({ data: null, error: null });
    expect(await readRoleHidden(supabase as never, 'org', 'admin')).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('shows the whole menu, and logs, when the row can’t be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = client({ data: null, error: { message: 'down' } });
    expect(await readRoleHidden(supabase as never, 'org', 'manager')).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('cleanMenuSections', () => {
  it('keeps known sections once, in the menu’s order, without Action Center', () => {
    expect(cleanMenuSections(['reports', 'nope', 'content', 'reports', ALWAYS_ON_SECTION])).toEqual(
      ['content', 'reports'],
    );
  });
});

describe('the database (00374)', () => {
  const migration = (name: string) =>
    readFileSync(join(__dirname, `../../../supabase/migrations/${name}.sql`), 'utf8');
  const sql = migration('00374_menu_access');
  const triggerName = (text: string, fn: string) =>
    text.match(
      new RegExp(`create trigger (\\w+)\\s+before update[^;]*?function public\\.${fn}`),
    )?.[1];

  it('accepts exactly the work areas the app knows', () => {
    const check = sql.match(/work_areas <@ array\[([^\]]*)\]/)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual(WORK_AREA_IDS);
  });

  it('clears menu access when the person moves organization, the right to change menus on a new role', () => {
    const body = sql.match(
      /function public\.reset_profile_menu_access\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1];
    const flat = body?.replace(/\s+/g, ' ');
    // A new organization or role clears the right to change menus…
    expect(flat).toContain(
      '(new.organization_id is distinct from old.organization_id or new.role is distinct from old.role) and new.can_manage_menus is not distinct from old.can_manage_menus then new.can_manage_menus := false;',
    );
    // …and a new organization the person's exceptions, unless the same
    // update sets them.
    expect(flat).toContain(
      "if new.organization_id is distinct from old.organization_id then if new.menu_shown is not distinct from old.menu_shown then new.menu_shown := '{}'; end if; if new.menu_hidden is not distinct from old.menu_hidden then new.menu_hidden := '{}'; end if;",
    );
    // Before-update triggers run in name order: the guard sees what the
    // person asked for, then the reset clears.
    expect(sql).toMatch(
      /create trigger profiles_reset_menu_access\s+before update of organization_id, role on public\.profiles/,
    );
    const guard = triggerName(
      migration('00228_profiles_server_columns'),
      'guard_profile_server_columns',
    );
    const reset = triggerName(sql, 'reset_profile_menu_access');
    expect(guard).toBeTruthy();
    expect(reset).toBeTruthy();
    expect(guard! < reset!).toBe(true);
  });
});
