import type { SupabaseClient } from '@supabase/supabase-js';
import { dashboardNav } from '@/config/dashboard';
import type { UserRole } from '@/types';

/**
 * Menu access: which left-menu sections a person sees. Hide only: a hidden
 * section is off the menu, its pages still open from a link, and what the
 * person can do there doesn't change.
 *
 * A section is named by its route under /dashboard ('content', 'audit',
 * 'insights'…), the name the database keeps (00374).
 */

/** On everyone's menu, always: where the work is. */
export const ALWAYS_ON_SECTION = 'action-center';

/** The section a route belongs to: '/dashboard/content/plan' → 'content'. */
export function menuSectionOf(href: string): string | null {
  const [, root, section] = href.split('/');
  return root === 'dashboard' && section ? section : null;
}

/** Every section of the left menu, in its order. */
export const MENU_SECTIONS: string[] = dashboardNav
  .flatMap((group) => group.items)
  .map((item) => menuSectionOf(item.href))
  .filter((section): section is string => section !== null);

/**
 * Sections only the new Chat has (CHAT_AGENTIC): Agent Center. While it is
 * off for the workspace they are on no menu and in no list of sections.
 */
export const CHAT_AGENTIC_SECTIONS: string[] = dashboardNav
  .flatMap((group) => group.items)
  .filter((item) => item.requiresChatAgentic)
  .map((item) => menuSectionOf(item.href))
  .filter((section): section is string => section !== null);

/** The left menu's sections a workspace has, in its order: all of them with the new Chat on. */
export function menuSectionsFor(chatAgentic: boolean): string[] {
  return chatAgentic
    ? MENU_SECTIONS
    : MENU_SECTIONS.filter((section) => !CHAT_AGENTIC_SECTIONS.includes(section));
}

/**
 * What a person works on or leads, with the sections that work needs. They
 * follow the audiences on getcito.com › Solutions. Agent Center is in every
 * area Chat is in, right after it; AEO/GEO & Audit, Developers and Analytics
 * have it without Chat, right after Action Center.
 */
export const WORK_AREAS = [
  {
    id: 'leaders',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'mentions',
      'traffic',
      'reports',
    ],
  },
  {
    id: 'aeo',
    sections: ['action-center', 'agents', 'content', 'audit', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'content',
    sections: ['action-center', 'agent', 'agents', 'content', 'prompts', 'citations', 'reports'],
  },
  {
    id: 'brand',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'mentions',
      'citations',
      'reports',
    ],
  },
  {
    id: 'growth',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'citations',
      'traffic',
      'reports',
    ],
  },
  {
    id: 'product',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'prompts',
      'mentions',
      'shopping',
      'reports',
    ],
  },
  {
    id: 'bizdev',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'mentions',
      'citations',
      'reports',
    ],
  },
  {
    id: 'developers',
    sections: ['action-center', 'agents', 'audit', 'prompts', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'analytics',
    sections: [
      'action-center',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'mentions',
      'citations',
      'shopping',
      'traffic',
      'reports',
    ],
  },
] as const;

export type WorkAreaId = (typeof WORK_AREAS)[number]['id'];

export const WORK_AREA_IDS: WorkAreaId[] = WORK_AREAS.map((area) => area.id);

/** Sections some work area names: work areas narrow only these. */
const AREA_SECTIONS = new Set<string>(WORK_AREAS.flatMap((area) => area.sections));

export function isWorkAreaId(value: string): value is WorkAreaId {
  return (WORK_AREA_IDS as string[]).includes(value);
}

/** The sections a set of work areas needs; every section for none. */
export function workAreaSections(areas: readonly string[]): Set<string> | null {
  const known = WORK_AREAS.filter((area) => areas.includes(area.id));
  if (!known.length) return null;
  return new Set(known.flatMap((area) => area.sections));
}

/** What decides a person's menu. */
export interface MenuAccess {
  role: UserRole;
  /** The sections the person's role doesn't see (organization_menu_roles). */
  roleHidden: readonly string[];
  /** Sections shown for the person although the role hides them. */
  shown: readonly string[];
  /** Sections hidden for the person although the role shows them. */
  hidden: readonly string[];
  workAreas: readonly string[];
}

/**
 * The sections of `sections` a person's menu leaves out: their role's,
 * changed by their own exceptions, then narrowed to their work areas. A
 * section no work area names (one added later) stays. Nobody takes a
 * section off an admin's menu, only their own work areas narrow it; Action
 * Center is never left out.
 */
export function hiddenMenuSections(
  access: MenuAccess,
  sections: readonly string[] = MENU_SECTIONS,
): Set<string> {
  const left = new Set<string>();
  const areaSections = workAreaSections(access.workAreas);
  for (const section of sections) {
    if (section === ALWAYS_ON_SECTION) continue;
    const byPerson =
      access.role === 'admin' ||
      (access.shown.includes(section)
        ? true
        : access.hidden.includes(section)
          ? false
          : !access.roleHidden.includes(section));
    const byArea = !areaSections || !AREA_SECTIONS.has(section) || areaSections.has(section);
    if (!byPerson || !byArea) left.add(section);
  }
  return left;
}

/**
 * The sections off a menu with these work areas, given those the person's
 * role and exceptions take off whatever they work on: as they pick, before
 * it's saved. Of `sections`, the menu's the workspace has.
 */
export function hiddenWithWorkAreas(
  hiddenByAdmin: readonly string[],
  workAreas: readonly string[],
  sections: readonly string[] = MENU_SECTIONS,
): string[] {
  const byAreas = hiddenMenuSections(
    {
      role: 'admin',
      roleHidden: [],
      shown: [],
      hidden: [],
      workAreas,
    },
    sections,
  );
  return sections.filter((section) => hiddenByAdmin.includes(section) || byAreas.has(section));
}

/** A person's menu, as the dashboard and Settings read it. */
export interface MyMenu {
  /** Sections off this person's left menu. */
  hidden: string[];
  /** Of those, the ones their role or an exception takes off, whatever their work areas. */
  hiddenByAdmin: string[];
  workAreas: WorkAreaId[];
  /** Whether they answered (or skipped) "What do you work on?". */
  workAreasAsked: boolean;
  /** Admin, or a manager an admin let change menus. */
  canManageMenus: boolean;
}

/** The profile's menu columns (00374), read with the rest of the profile. */
export interface MenuProfile {
  role: UserRole;
  work_areas: string[] | null;
  work_areas_asked_at: string | null;
  menu_shown: string[] | null;
  menu_hidden: string[] | null;
  can_manage_menus: boolean | null;
}

export function canManageMenus(profile: Pick<MenuProfile, 'role' | 'can_manage_menus'>): boolean {
  return profile.role === 'admin' || (profile.role === 'manager' && !!profile.can_manage_menus);
}

export function workAreasOf(values: readonly string[] | null): WorkAreaId[] {
  return (values ?? []).filter(isWorkAreaId);
}

/**
 * A person's menu from their profile and their role's hidden sections, of
 * `sections`: the menu's the workspace has (menuSectionsFor).
 */
export function menuOfProfile(
  profile: MenuProfile,
  roleHidden: readonly string[],
  sections: readonly string[] = MENU_SECTIONS,
): MyMenu {
  const workAreas = workAreasOf(profile.work_areas);
  const access = {
    role: profile.role,
    roleHidden,
    shown: profile.menu_shown ?? [],
    hidden: profile.menu_hidden ?? [],
  };
  return {
    hidden: [...hiddenMenuSections({ ...access, workAreas }, sections)],
    hiddenByAdmin: [...hiddenMenuSections({ ...access, workAreas: [] }, sections)],
    workAreas,
    workAreasAsked: profile.work_areas_asked_at !== null,
    canManageMenus: canManageMenus(profile),
  };
}

/**
 * The sections a role's row hides, as RLS lets members of the organization
 * read it. None for admins, without a read; none, logged, when it can't be
 * read, so the menu shows whole rather than not at all.
 */
export async function readRoleHidden(
  supabase: Pick<SupabaseClient, 'from'>,
  organizationId: string,
  role: UserRole,
): Promise<string[]> {
  if (role === 'admin') return [];
  const { data, error } = await supabase
    .from('organization_menu_roles')
    .select('hidden_sections')
    .eq('organization_id', organizationId)
    .eq('role', role)
    .maybeSingle();
  if (error) {
    console.error('[menu-access] the role menu could not be read; showing the whole menu', error);
    return [];
  }
  return (data?.hidden_sections as string[] | null) ?? [];
}

/** Known sections only, once each, in the menu's order; never Action Center. */
export function cleanMenuSections(values: readonly string[]): string[] {
  return MENU_SECTIONS.filter(
    (section) => section !== ALWAYS_ON_SECTION && values.includes(section),
  );
}
