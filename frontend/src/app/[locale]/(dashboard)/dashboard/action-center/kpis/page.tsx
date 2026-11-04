'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertCircle, ListFilter, Plus, Settings2, Sparkles, Target, X } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';
import {
  getKpiPresetPreview,
  getKpiSnapshots,
  removeKpi,
  seedKpiPresets,
  type KpiSnapshot,
  type KpiSnapshotsResult,
  type KpiWindow,
} from '@/lib/actions/kpis';
import type { KpiCategory, KpiKey } from '@/lib/kpis/registry';
import type { KpiStatus } from '@/lib/kpis/status';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActionCenterTabs } from '@/components/action-center/ActionCenterTabs';
import { KpiFrameworkDrawer } from '@/components/action-center/KpiFrameworkDrawer';
import { KpiTable } from '@/components/action-center/KpiTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

type KpiDatePreset = '7d' | '30d' | '90d';
const KPI_DATE_PRESETS: readonly KpiDatePreset[] = ['7d', '30d', '90d'];
const PRESET_DAYS: Record<KpiDatePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };
const KPI_STATUSES: readonly KpiStatus[] = ['on_track', 'at_risk', 'off_track', 'goal_reached'];
const DAY_MS = 86_400_000;

function utcDay(offset = 0): string {
  return new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
}

export default function ActionCenterKpisPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.kpis');

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </HeaderWithAiUsage>
      <ActionCenterTabs />
      {brand ? (
        <KpisContent key={brand.id} brand={brand} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      )}
    </div>
  );
}

function KpisContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.kpis');
  const tCategories = useTranslations('actionCenter.categories');

  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): Edit, Add and Remove open the
  // upgrade dialog instead, and a brand that never had a KPI is shown the
  // ready-made set unsaved, as a member is.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [result, setResult] = useState<KpiSnapshotsResult | null>(null);
  // A brand that never had a KPI opens on the ready-made set: saved for an
  // admin or manager (and said so once), shown unsaved to everyone else.
  const [preview, setPreview] = useState<KpiSnapshot[] | null>(null);
  const [justSetUp, setJustSetUp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [category, setCategory] = useState<KpiCategory | 'all'>('all');
  const [busyKey, setBusyKey] = useState<KpiKey | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editKey, setEditKey] = useState<KpiKey | null>(null);
  const [datePreset, setDatePreset] = useState<KpiDatePreset>('30d');
  const [statusFilter, setStatusFilter] = useState<Set<KpiStatus>>(new Set());

  const window = useMemo<KpiWindow>(() => {
    const days = PRESET_DAYS[datePreset];
    return { dayFrom: utcDay(days - 1), dayTo: utcDay() };
  }, [datePreset]);

  const openDrawer = guard(
    (key: KpiKey | null = null) => {
      setEditKey(key);
      setIsDrawerOpen(true);
    },
    { action: tActions('editKpis') },
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      let next = await getKpiSnapshots(brand.id, window);
      let unsaved: KpiSnapshot[] | null = null;
      if (!next.configured && next.everSetUp === false) {
        if (canManage && !isLocked) {
          // Once per brand (00163): a failed setup leaves the empty state.
          // Read again either way: a colleague may have set it up meanwhile.
          // Only a setup that happened says so: a second read racing it (as
          // React's development double run does) must not hide the note.
          const seeded = await seedKpiPresets(brand.id).catch(() => false);
          if (seeded) setJustSetUp(true);
          next = await getKpiSnapshots(brand.id, window);
        } else {
          unsaved = await getKpiPresetPreview(brand.id, window).catch(() => null);
        }
      }
      setPreview(unsaved);
      setResult(next);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id, window, canManage, isLocked]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewing = !result?.configured && (preview?.length ?? 0) > 0;
  const kpis = useMemo(
    () => (result?.configured ? result.kpis : (preview ?? [])),
    [result, preview],
  );
  const categories = useMemo(() => {
    const counts = new Map<KpiCategory, number>();
    for (const kpi of kpis) counts.set(kpi.category, (counts.get(kpi.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [kpis]);
  const visible = kpis.filter(
    (k) =>
      (category === 'all' || k.category === category) &&
      (statusFilter.size === 0 || statusFilter.has(k.status)),
  );

  const toggleStatus = (status: KpiStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const handleRemove = async (key: KpiKey) => {
    setBusyKey(key);
    try {
      await removeKpi(brand.id, key);
      await load();
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }

  const drawer = (
    <KpiFrameworkDrawer
      brandId={brand.id}
      open={isDrawerOpen}
      onOpenChange={setIsDrawerOpen}
      onSaved={() => void load()}
      focusKpi={editKey}
    />
  );

  if (!result?.configured && !previewing) {
    return (
      <>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <Target className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
          <Button className="mt-4" onClick={() => openDrawer()}>
            <Plus className="h-4 w-4" />
            {t('empty.cta')}
          </Button>
        </div>
        {drawer}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {(justSetUp || previewing) && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="flex-1">
            {previewing
              ? t(isLocked ? 'presets.previewReadOnly' : 'presets.preview')
              : t('presets.setUp')}
          </p>
          {justSetUp && (
            <button
              type="button"
              onClick={() => setJustSetUp(false)}
              aria-label={t('presets.dismiss')}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill
            label={t('allKpis')}
            count={kpis.length}
            isActive={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {categories.map(([key, count]) => (
            <CategoryPill
              key={key}
              label={tCategories(key)}
              count={count}
              isActive={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted/50',
                statusFilter.size > 0 && 'border-foreground/30 bg-muted',
              )}
            >
              <ListFilter className="h-3.5 w-3.5" />
              {t('filters')}
              {statusFilter.size > 0 && (
                <span className="text-xs text-muted-foreground">{statusFilter.size}</span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('table.status')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {KPI_STATUSES.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={statusFilter.has(status)}
                    onCheckedChange={() => toggleStatus(status)}
                  >
                    {t(`status.${status}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <div
            className="flex h-8 overflow-hidden rounded-md border"
            role="group"
            aria-label={t('dateRangeAria')}
          >
            {KPI_DATE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDatePreset(preset)}
                aria-pressed={datePreset === preset}
                className={cn(
                  'px-3 text-xs font-medium transition-colors',
                  datePreset === preset
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground hover:bg-muted',
                )}
              >
                {preset}
              </button>
            ))}
          </div>
          {!previewing && (
            <>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => openDrawer()}>
                <Settings2 className="h-3.5 w-3.5" />
                {t('editKpis')}
              </Button>
              <Button size="sm" className="text-xs" onClick={() => openDrawer()}>
                <Plus className="h-3.5 w-3.5" />
                {t('addKpi')}
              </Button>
            </>
          )}
        </div>
      </div>

      {visible.length > 0 ? (
        <KpiTable
          kpis={visible}
          onEdit={previewing ? undefined : (key) => openDrawer(key)}
          onRemove={
            previewing
              ? undefined
              : guard((key: KpiKey) => void handleRemove(key), { action: tActions('removeKpis') })
          }
          busyKey={busyKey}
        />
      ) : kpis.length > 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setCategory('all');
              setStatusFilter(new Set());
            }}
          >
            {t('clearFilter')}
          </Button>
        </div>
      ) : (
        // Configured but nothing active/computable — distinct from the
        // never-configured empty state.
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('allInactive')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => openDrawer()}>
            {t('editKpis')}
          </Button>
        </div>
      )}

      {drawer}
    </div>
  );
}

function CategoryPill({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
        isActive
          ? 'border-foreground/20 bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
