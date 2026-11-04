'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dashboardNav } from '@/config/dashboard';
import { getDashboardNavGroupLabel, getDashboardNavLabel } from '@/lib/dashboardNavigation';
import {
  ALWAYS_ON_SECTION,
  MENU_SECTIONS,
  WORK_AREAS,
  menuSectionOf,
  workAreaSections,
} from '@/lib/menuAccess';
import {
  getMenuAccessSettings,
  setRoleMenu,
  type MenuAccessSettings,
  type MenuRole,
} from '@/lib/actions/menuAccess';
import { useCanManageMenus, useMenuSections } from '@/components/context/MenuAccessProvider';
import { MenuManagersCard, MenuPeopleCard } from '@/components/settings/MenuAccessPeople';

const MENU_ROLES: MenuRole[] = ['manager', 'analyst', 'agency_partner'];

/** The menu's sections, by its groups, as the role table lists them. */
const GROUPS = dashboardNav.map((group) => ({
  title: group.title,
  items: group.items.flatMap((item) => {
    const section = menuSectionOf(item.href);
    return section ? [{ section, title: item.title, icon: item.icon }] : [];
  }),
}));

/** What a ready-made set hides: every section it doesn't name; none for Everything. */
export function hiddenForSet(set: string): string[] {
  const sections = set === 'all' ? null : workAreaSections([set]);
  if (!sections) return [];
  return MENU_SECTIONS.filter((section) => section !== ALWAYS_ON_SECTION && !sections.has(section));
}

/**
 * Settings › Menu access (00374): which left-menu sections each role sees.
 * Admins, and managers an admin lets, change it; each change saves at once.
 * Hide only: the pages still open from a link.
 */
export function MenuAccessSection() {
  const t = useTranslations('settings.menuAccess');
  if (!useCanManageMenus()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('notAllowed')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <MenuAccessSettingsView />;
}

function MenuAccessSettingsView() {
  const t = useTranslations('settings.menuAccess');
  const tSettings = useTranslations('settings');
  const tNav = useTranslations('nav');
  // The rows: the sections the workspace has (Agent Center only with the new Chat on).
  const sections = useMenuSections();
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => sections.includes(item.section)),
  }));
  const [settings, setSettings] = useState<MenuAccessSettings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getMenuAccessSettings().then(
      (next) => {
        if (current) setSettings(next);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // After a failed save, the settings as the server has them: a change saved
  // meanwhile stays, which putting back the state before it wouldn't.
  const reload = () => getMenuAccessSettings().then(setSettings, () => setFailed(true));

  // The save's own revalidation brings the menu up to date (setRoleMenu).
  const saveRole = async (role: MenuRole, hidden: string[]) => {
    if (!settings) return;
    setSettings((current) =>
      current ? { ...current, roles: { ...current.roles, [role]: hidden } } : current,
    );
    try {
      await setRoleMenu(role, hidden);
    } catch {
      toast.error(t('saveFailed'));
      void reload();
    }
  };

  const toggle = (role: MenuRole, section: string, sees: boolean) => {
    const hidden = settings?.roles[role] ?? [];
    void saveRole(
      role,
      sees
        ? hidden.filter((s) => s !== section)
        : MENU_SECTIONS.filter((s) => s === section || hidden.includes(s)),
    );
  };

  const roleName = (role: MenuRole) => tSettings(`team_role_${role}`);
  const updateSettings = (update: (current: MenuAccessSettings) => MenuAccessSettings) =>
    setSettings((current) => (current ? update(current) : current));
  const setItems = [
    { value: 'all', label: t('everything') },
    ...WORK_AREAS.map((area) => ({ value: area.id, label: t(`areas.${area.id}.title`) })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{t('note')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('rolesTitle')}</CardTitle>
          <CardDescription>{t('rolesDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {failed ? (
            <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
          ) : !settings ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table className="table-fixed">
              {/* Fixed shares, so the table fits Settings' column at 1024 px wide. */}
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[15%]" />
                {MENU_ROLES.map((role) => (
                  <col key={role} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('section')}</TableHead>
                  <TableHead className="px-1 text-center">{tSettings('team_role_admin')}</TableHead>
                  {MENU_ROLES.map((role) => (
                    <TableHead
                      key={role}
                      className="px-1 text-center leading-tight whitespace-normal"
                    >
                      {roleName(role)}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow>
                  <TableHead />
                  <TableHead className="px-1 text-center text-[11px] font-normal text-muted-foreground">
                    {t('everything')}
                  </TableHead>
                  {MENU_ROLES.map((role) => (
                    <TableHead key={role} className="px-0.5">
                      <Select
                        value=""
                        onValueChange={(set) => {
                          if (set) void saveRole(role, hiddenForSet(set));
                        }}
                        items={setItems}
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-7 w-full min-w-0 gap-0.5 px-1 text-xs [&_svg]:size-3"
                          aria-label={t('useSetLabel', { role: roleName(role) })}
                        >
                          <SelectValue placeholder={t('useSet')} className="min-w-0 truncate" />
                        </SelectTrigger>
                        <SelectContent className="w-auto min-w-48">
                          {setItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group, i) => [
                  // Chat, first and in no group, sits above the headings as on the menu.
                  (group.title || i > 0) && (
                    <TableRow key={`group-${i}`} className="hover:bg-transparent">
                      <TableCell
                        colSpan={2 + MENU_ROLES.length}
                        className="pt-4 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {group.title
                          ? getDashboardNavGroupLabel(group.title, tNav)
                          : t('otherGroup')}
                      </TableCell>
                    </TableRow>
                  ),
                  ...group.items.map(({ section, title, icon: Icon }) => {
                    const label = getDashboardNavLabel(title, tNav);
                    const always = section === ALWAYS_ON_SECTION;
                    return (
                      <TableRow key={section}>
                        <TableCell className="whitespace-normal">
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {label}
                          </span>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <Checkbox
                            checked
                            disabled
                            aria-label={t('adminSees', { section: label })}
                          />
                        </TableCell>
                        {MENU_ROLES.map((role) => (
                          <TableCell key={role} className="px-1 text-center">
                            <Checkbox
                              checked={always || !settings.roles[role].includes(section)}
                              disabled={always}
                              onCheckedChange={(checked) => toggle(role, section, checked === true)}
                              aria-label={
                                always
                                  ? t('alwaysOn', { section: label })
                                  : t('sees', { role: roleName(role), section: label })
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  }),
                ])}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {settings && (
        <>
          <MenuManagersCard
            settings={settings}
            onChange={updateSettings}
            onFailed={() => void reload()}
          />
          <MenuPeopleCard
            settings={settings}
            onChange={updateSettings}
            onFailed={() => void reload()}
          />
        </>
      )}
    </div>
  );
}
