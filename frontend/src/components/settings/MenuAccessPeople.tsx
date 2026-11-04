'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { dashboardNav } from '@/config/dashboard';
import { getDashboardNavLabel } from '@/lib/dashboardNavigation';
import {
  ALWAYS_ON_SECTION,
  MENU_SECTIONS,
  hiddenMenuSections,
  menuSectionOf,
} from '@/lib/menuAccess';
import { useMenuSections } from '@/components/context/MenuAccessProvider';
import {
  setMemberMenu,
  setMenuManager,
  type MenuAccessSettings,
  type MenuMember,
  type MenuRole,
} from '@/lib/actions/menuAccess';

/** The menu's sections with their nav titles, in its order. */
const SECTION_TITLES = dashboardNav
  .flatMap((group) => group.items)
  .flatMap((item) => {
    const section = menuSectionOf(item.href);
    return section ? [{ section, title: item.title }] : [];
  });

function initials(member: MenuMember): string {
  const source = member.fullName?.trim() || member.email;
  return source
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function PersonCell({ member, sub }: { member: MenuMember; sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
        <AvatarFallback className="text-[10px]">{initials(member)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.fullName || member.email}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

/** A person's change to their role's menu, applied to one section. */
export function memberMenuWith(
  member: Pick<MenuMember, 'shown' | 'hidden'>,
  roleHidden: readonly string[],
  section: string,
  sees: boolean,
): { shown: string[]; hidden: string[] } {
  const roleSees = !roleHidden.includes(section);
  const shown = member.shown.filter((s) => s !== section);
  const hidden = member.hidden.filter((s) => s !== section);
  if (sees && !roleSees) shown.push(section);
  if (!sees && roleSees) hidden.push(section);
  const inOrder = (list: string[]) => MENU_SECTIONS.filter((s) => list.includes(s));
  return { shown: inOrder(shown), hidden: inOrder(hidden) };
}

interface Props {
  settings: MenuAccessSettings;
  /** Updates the settings shown, as a change is saved. */
  onChange: (update: (current: MenuAccessSettings) => MenuAccessSettings) => void;
  /**
   * A save failed: the settings are read again, so a change saved meanwhile
   * stays, which putting back the state before it wouldn't.
   */
  onFailed: () => void;
}

const withMember = (
  settings: MenuAccessSettings,
  userId: string,
  change: Partial<MenuMember>,
): MenuAccessSettings => ({
  ...settings,
  members: settings.members.map((m) => (m.userId === userId ? { ...m, ...change } : m)),
});

/**
 * Settings › Menu access › Who can change menus: an admin lets a manager
 * change menus too (setMenuManager). Others see who can.
 */
export function MenuManagersCard({ settings, onChange, onFailed }: Props) {
  const t = useTranslations('settings.menuAccess');
  const managers = settings.members.filter((m) => m.role === 'manager');

  const toggle = async (member: MenuMember) => {
    const allowed = !member.canManageMenus;
    onChange((current) => withMember(current, member.userId, { canManageMenus: allowed }));
    try {
      await setMenuManager(member.userId, allowed);
    } catch {
      toast.error(t('saveFailed'));
      onFailed();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('managersTitle')}</CardTitle>
        <CardDescription>
          {t('managersDescription')}
          {!settings.viewerIsAdmin && ` ${t('managersAdminOnly')}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {managers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noManagers')}</p>
        ) : (
          <ul className="divide-y">
            {managers.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <PersonCell member={member} sub={member.email} />
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {t('canChangeMenus')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={member.canManageMenus}
                  aria-label={t('canChangeMenusLabel', {
                    name: member.fullName || member.email,
                  })}
                  disabled={!settings.viewerIsAdmin}
                  onClick={() => void toggle(member)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    member.canManageMenus ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-lg transition-transform',
                      member.canManageMenus ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Settings › Menu access › People: each non-admin's menu, and their exception
 * to their role's (setMemberMenu), saved as it changes.
 */
export function MenuPeopleCard({ settings, onChange, onFailed }: Props) {
  const t = useTranslations('settings.menuAccess');
  const tSettings = useTranslations('settings');
  const tNav = useTranslations('nav');
  const [editing, setEditing] = useState<string | null>(null);
  const sections = useMenuSections();
  const people = settings.members.filter((m) => m.role !== 'admin');
  const label = (section: string) =>
    getDashboardNavLabel(SECTION_TITLES.find((s) => s.section === section)?.title ?? section, tNav);
  const roleName = (role: MenuRole) => tSettings(`team_role_${role}`);

  const save = async (member: MenuMember, menu: { shown: string[]; hidden: string[] }) => {
    onChange((current) => withMember(current, member.userId, menu));
    try {
      await setMemberMenu(member.userId, menu);
    } catch {
      toast.error(t('saveFailed'));
      onFailed();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('peopleTitle')}</CardTitle>
        <CardDescription>{t('peopleDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noPeople')}</p>
        ) : (
          <ul className="divide-y">
            {people.map((member) => {
              const role = member.role as MenuRole;
              const roleHidden = settings.roles[role] ?? [];
              const off = hiddenMenuSections({ ...member, role, roleHidden }, sections);
              const changes = [
                ...member.shown.filter((s) => sections.includes(s)).map((s) => `+${label(s)}`),
                ...member.hidden.filter((s) => sections.includes(s)).map((s) => `−${label(s)}`),
              ];
              const open = editing === member.userId;
              return (
                <li key={member.userId} className="@container py-3" data-member={member.userId}>
                  {/* One line when the card is wide; the person and Customize
                      over their work areas and menu when it's narrow. */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 [grid-template-areas:'person_edit'_'areas_areas'_'menu_menu'] @xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] @xl:[grid-template-areas:'person_areas_menu_edit']">
                    <div className="min-w-0 [grid-area:person]">
                      <PersonCell member={member} sub={`${roleName(role)} · ${member.email}`} />
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1 pl-9 [grid-area:areas] @xl:pl-0">
                      {member.workAreas.length ? (
                        member.workAreas.map((area) => (
                          <Badge key={area} variant="outline" className="font-normal">
                            {t(`areas.${area}.title`)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('allSections')}</span>
                      )}
                    </div>
                    <div className="min-w-0 pl-9 [grid-area:menu] @xl:pl-0">
                      {changes.length ? (
                        <Badge className="h-auto border-amber-200 bg-amber-50 text-left font-normal whitespace-normal text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                          {t('custom', { changes: changes.join(', ') })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal">
                          {t('roleMenu', { role: roleName(role) })}
                        </Badge>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('sectionCount', {
                          count: sections.length - off.size,
                          total: sections.length,
                        })}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="[grid-area:edit]"
                      aria-expanded={open}
                      onClick={() => setEditing(open ? null : member.userId)}
                    >
                      {open ? t('close') : t('customize')}
                    </Button>
                  </div>
                  {open && (
                    <div className="mt-3 rounded-md bg-muted/50 p-3">
                      <p className="text-sm font-medium">
                        {t('personSections', { name: member.fullName || member.email })}
                      </p>
                      <p className="text-xs text-muted-foreground">{t('personSectionsHint')}</p>
                      <div className="my-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                        {sections.map((section) => {
                          const always = section === ALWAYS_ON_SECTION;
                          const roleSees = !roleHidden.includes(section);
                          const sees =
                            always ||
                            member.shown.includes(section) ||
                            (roleSees && !member.hidden.includes(section));
                          return (
                            <label key={section} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={sees}
                                disabled={always}
                                aria-label={t('personSees', {
                                  name: member.fullName || member.email,
                                  section: label(section),
                                })}
                                onCheckedChange={(checked) =>
                                  void save(
                                    member,
                                    memberMenuWith(member, roleHidden, section, checked === true),
                                  )
                                }
                              />
                              {label(section)}
                              {always ? (
                                <span className="text-xs text-muted-foreground">
                                  {t('alwaysOnShort')}
                                </span>
                              ) : sees !== roleSees ? (
                                <span className="text-xs text-amber-700 dark:text-amber-400">
                                  {sees ? t('shownForThem') : t('hiddenForThem')}
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!changes.length}
                          onClick={() => void save(member, { shown: [], hidden: [] })}
                        >
                          {t('useRoleMenu', { role: roleName(role) })}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {t('savedAsYouChange')}
                        </span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
