'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  Eye,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  PieChart,
  Quote,
  Smile,
  TrendingDown,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { KpiSnapshot } from '@/lib/actions/kpis';
import type { KpiKey } from '@/lib/kpis/registry';
import type { KpiStatus } from '@/lib/kpis/status';
import { isImprovement } from '@/lib/kpis/status';
import { formatCompactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const KpiSparkline = dynamic(() => import('./KpiSparkline'), {
  ssr: false,
  loading: () => <Skeleton className="h-8 w-[110px]" />,
});

const KPI_ICONS: Record<KpiKey, React.ComponentType<{ className?: string }>> = {
  ai_visibility: Eye,
  citations: Quote,
  mentions: MessageSquare,
  share_of_voice: PieChart,
  ai_referral_traffic: MousePointerClick,
  positive_sentiment: Smile,
};

/**
 * One soft color per status, shared by the badge, the sparkline and the
 * progress bar so a row's color always says one thing. Status is never
 * carried by color alone — the badge text is the accessible signal.
 */
const STATUS_BADGE: Record<KpiStatus, string> = {
  on_track: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  at_risk: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  off_track: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  goal_reached: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

const STATUS_TEXT: Record<KpiStatus, string> = {
  on_track: 'text-green-600 dark:text-green-400',
  at_risk: 'text-amber-600 dark:text-amber-400',
  off_track: 'text-red-600 dark:text-red-400',
  goal_reached: 'text-emerald-600 dark:text-emerald-400',
};

const STATUS_BAR: Record<KpiStatus, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-500',
  off_track: 'bg-red-500',
  goal_reached: 'bg-emerald-500',
};

function formatKpiValue(value: number, unit: KpiSnapshot['unit']): string {
  if (unit === 'percent') {
    return `${Math.round(value * 10) / 10}%`;
  }
  return formatCompactNumber(value);
}

function KpiChange({ snapshot }: { snapshot: KpiSnapshot }) {
  const t = useTranslations('actionCenter.kpis');
  if (snapshot.change === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const improving = isImprovement(snapshot.change, snapshot.direction);
  const Arrow = snapshot.change > 0 ? TrendingUp : TrendingDown;
  const magnitude = Math.abs(snapshot.change);
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs font-medium tabular-nums',
        improving ? 'text-green-600 dark:text-green-400' : 'text-red-500',
      )}
    >
      <Arrow className="h-3.5 w-3.5" />
      {snapshot.changeKind === 'points' ? t('pointsChange', { value: magnitude }) : `${magnitude}%`}
    </span>
  );
}

function GoalProgress({ snapshot }: { snapshot: KpiSnapshot }) {
  const t = useTranslations('actionCenter.kpis');
  return (
    <div className="w-24">
      <span className="text-xs font-medium tabular-nums">{snapshot.progress}%</span>
      <div
        role="progressbar"
        aria-valuenow={Math.min(snapshot.progress, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('vsGoalAria', { progress: snapshot.progress })}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', STATUS_BAR[snapshot.status])}
          style={{ width: `${Math.min(snapshot.progress, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function KpiTable({
  kpis,
  onEdit,
  onRemove,
  busyKey,
}: {
  kpis: KpiSnapshot[];
  /** Without them (the unsaved ready-made set) the rows have no menu. */
  onEdit?: (key: KpiKey) => void;
  onRemove?: (key: KpiKey) => void;
  busyKey: KpiKey | null;
}) {
  const editable = Boolean(onEdit && onRemove);
  const t = useTranslations('actionCenter.kpis');
  const tRegistry = useTranslations('actionCenter.registry');

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.kpi')}</TableHead>
            <TableHead className="text-xs">{t('table.value')}</TableHead>
            <TableHead className="text-xs">{t('table.change')}</TableHead>
            <TableHead className="text-xs">{t('table.trend')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="text-xs">{t('table.goal')}</TableHead>
            <TableHead className="text-xs">{t('table.vsGoal')}</TableHead>
            {editable && (
              <TableHead className="w-10">
                <span className="sr-only">{t('table.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {kpis.map((kpi) => {
            const Icon = KPI_ICONS[kpi.key];
            return (
              <TableRow key={kpi.key}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{tRegistry(`${kpi.key}.name`)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tRegistry(`${kpi.key}.description`)}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-semibold tabular-nums">
                  {formatKpiValue(kpi.value, kpi.unit)}
                </TableCell>
                <TableCell>
                  <KpiChange snapshot={kpi} />
                </TableCell>
                <TableCell>
                  <div className={STATUS_TEXT[kpi.status]}>
                    <KpiSparkline points={kpi.trend} />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_BADGE[kpi.status]}>
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
                    />
                    {t(`status.${kpi.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatKpiValue(kpi.target, kpi.unit)}
                </TableCell>
                <TableCell>
                  <GoalProgress snapshot={kpi} />
                </TableCell>
                {editable && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        disabled={busyKey === kpi.key}
                        aria-label={t('menu.label', { name: tRegistry(`${kpi.key}.name`) })}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit?.(kpi.key)}>
                          <Pencil className="h-4 w-4" />
                          {t('menu.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => onRemove?.(kpi.key)}>
                          <Trash2 className="h-4 w-4" />
                          {t('menu.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
