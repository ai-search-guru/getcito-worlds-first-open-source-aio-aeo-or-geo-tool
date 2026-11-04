'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BarChart3,
  Briefcase,
  Check,
  Code,
  Crown,
  Loader2,
  MessageCircle,
  Package,
  PenLine,
  Search,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dashboardNav } from '@/config/dashboard';
import { getDashboardNavLabel } from '@/lib/dashboardNavigation';
import {
  WORK_AREAS,
  WORK_AREA_IDS,
  hiddenWithWorkAreas,
  menuSectionOf,
  type WorkAreaId,
} from '@/lib/menuAccess';
import { setMyWorkAreas } from '@/lib/actions/menuAccess';
import { useMenuSections } from '@/components/context/MenuAccessProvider';

const AREA_ICONS: Record<WorkAreaId, LucideIcon> = {
  leaders: Crown,
  aeo: Search,
  content: PenLine,
  brand: MessageCircle,
  growth: TrendingUp,
  product: Package,
  bizdev: Briefcase,
  developers: Code,
  analytics: BarChart3,
};

/** The menu's sections with their icons and nav titles, in its order. */
const SECTIONS = dashboardNav
  .flatMap((group) => group.items)
  .flatMap((item) => {
    const section = menuSectionOf(item.href);
    return section ? [{ section, title: item.title, icon: item.icon }] : [];
  });

/**
 * "What do you work on?" (menu access): the person picks what they work on or
 * lead, and sees the menu it gives them. Asked once, after the brand is set up
 * in onboarding, or on an invited person's first sign-in; saved on Continue or
 * Skip, so it isn't asked again. Changed later in Settings › Account.
 */
export function WorkAreasStep({
  title,
  lede,
  hiddenByAdmin = [],
  footer,
  onDone,
}: {
  title: string;
  lede: string;
  /** Sections the person's role or an exception takes off, whatever they pick. */
  hiddenByAdmin?: readonly string[];
  /** The wizard's own row under the step (Back, step dots). */
  footer?: ReactNode;
  onDone: () => void;
}) {
  const t = useTranslations('welcome');
  const tAreas = useTranslations('settings.menuAccess');
  const tNav = useTranslations('nav');
  const [picked, setPicked] = useState<WorkAreaId[]>([]);
  const [saving, setSaving] = useState<'continue' | 'skip' | null>(null);
  // Agent Center only with the new Chat on (none outside the dashboard).
  const sections = useMenuSections();
  const hidden = hiddenWithWorkAreas(hiddenByAdmin, picked, sections);
  const label = (title: string) => getDashboardNavLabel(title, tNav);

  const toggle = (area: WorkAreaId) =>
    setPicked((current) =>
      WORK_AREA_IDS.filter((a) => (a === area ? !current.includes(a) : current.includes(a))),
    );

  const save = async (areas: WorkAreaId[], which: 'continue' | 'skip') => {
    setSaving(which);
    try {
      await setMyWorkAreas(areas);
      onDone();
    } catch {
      toast.error(t('saveFailed'));
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col p-6 md:p-10">
      <div className="mx-auto w-full max-w-4xl flex-1">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{lede}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORK_AREAS.map((area) => {
            const Icon = AREA_ICONS[area.id];
            const on = picked.includes(area.id);
            return (
              <button
                key={area.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(area.id)}
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/40',
                  on && 'border-foreground ring-1 ring-foreground',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4 shrink-0" />
                  {tAreas(`areas.${area.id}.title`)}
                  <span
                    className={cn(
                      'ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      on && 'border-foreground bg-foreground text-background',
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {tAreas(`areas.${area.id}.text`)}
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  {area.sections
                    .filter((section) => sections.includes(section))
                    .map((section) => label(SECTIONS.find((s) => s.section === section)!.title))
                    .join(' · ')}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-dashed p-4">
          <p className="mb-2 flex items-baseline gap-2 text-sm font-medium">
            {t('yourMenu')}
            <span className="text-xs font-normal text-muted-foreground">
              {tAreas('sectionCount', {
                count: sections.length - hidden.length,
                total: sections.length,
              })}
            </span>
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {SECTIONS.filter(
              ({ section }) => sections.includes(section) && !hidden.includes(section),
            ).map(({ section, title, icon: Icon }) => (
              <li key={section} data-section={section} className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{label(title)}</span>
              </li>
            ))}
          </ul>
          {hiddenByAdmin.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('hiddenByAdmin', { count: hiddenByAdmin.length })}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground sm:flex-1">{t('changeLater')}</p>
          <Button variant="ghost" disabled={saving !== null} onClick={() => void save([], 'skip')}>
            {saving === 'skip' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('skip')}
          </Button>
          <Button disabled={saving !== null} onClick={() => void save(picked, 'continue')}>
            {saving === 'continue' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('continue')}
          </Button>
        </div>
      </div>
      {footer}
    </div>
  );
}
