'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { actionTexts } from '@/lib/action-center/display';
import { FINAL_READING_DAY, type ActionHistoryItem } from '@/lib/action-center/history';
import type { ActionStatus } from '@/lib/action-center/registry';
import { ActionIcon, PriorityBadge } from './ActionTable';
import { cn } from '@/lib/utils';

/** Low-saturation per type, the way the Signals table tints its categories —
 *  enough to group at a glance, not enough to colour the row. */
const TYPE_TONES: Record<string, string> = {
  growth: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  recover: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  protect: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  fix: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  compete: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
};

const STATUS_TONES: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  on_hold: 'text-muted-foreground',
  dismissed: 'text-muted-foreground',
};

export function HistoryStatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations('actionCenter.historyPage');
  return (
    <span className={cn('flex items-center gap-1.5 text-xs', STATUS_TONES[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`status.${status}`)}
    </span>
  );
}

/**
 * The Result column.
 *
 * Nothing measures an action's effect yet, so every row says so rather than
 * showing a number that was never taken. When a validation pass starts filling
 * `results`, this is where its metrics land — the empty case stays for actions
 * closed before it ran.
 */
function ResultCell({ item }: { item: ActionHistoryItem }) {
  const t = useTranslations('actionCenter.historyPage');
  const tOutcome = useTranslations('actionCenter.actionOutcome');
  const tRegistry = useTranslations('actionCenter.registry');

  // An Improve action's 30-day position result (PROMPT-008) leads the cell.
  const outcome = item.positionOutcome?.final ? item.positionOutcome : null;
  const position = outcome && (
    <p
      className={cn(
        'text-xs',
        outcome.summary.improved > 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground',
      )}
    >
      {t('positionResult', {
        improved: outcome.summary.improved,
        measurable: outcome.summary.measurable,
      })}
    </p>
  );

  if (item.results.length > 0) {
    return (
      <div className="space-y-0.5">
        {position}
        {item.results.slice(0, 2).map((metric) => (
          <p
            key={metric.id}
            className={cn(
              'text-xs tabular-nums',
              (metric.delta ?? 0) > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : (metric.delta ?? 0) < 0
                  ? 'text-red-500'
                  : '',
            )}
          >
            {(metric.delta ?? 0) > 0 ? '↑' : '↓'} {Math.abs(metric.delta ?? 0)}
            {metric.unit === 'percent' ? '%' : ''} {tRegistry(`${metric.metric}.name`)}
          </p>
        ))}
      </div>
    );
  }

  if (position) return <div className="space-y-0.5">{position}</div>;

  // Only a completed action is measured. A dismissed one's outcome reads
  // pending, or not measurable from before (00084): neither says why.
  if (item.status === 'dismissed') {
    return (
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{t('dismissedResult.label')}</p>
        <p className="text-[11px] text-muted-foreground/70">{t('dismissedResult.hint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{tOutcome(item.outcome)}</p>
      <p className="text-[11px] text-muted-foreground/70">
        {/* Not final yet (learning B1): the reading so far, of the month's. */}
        {item.readings?.length && !item.outcomeFinal
          ? t('outcomeSoFar', {
              day: item.readings[item.readings.length - 1].day,
              final: FINAL_READING_DAY,
            })
          : t(`outcomeHint.${item.outcome}`)}
      </p>
    </div>
  );
}

export function HistoryTable({
  items,
  selectedId,
  onSelect,
}: {
  items: ActionHistoryItem[];
  selectedId: string | null;
  onSelect: (item: ActionHistoryItem) => void;
}) {
  const t = useTranslations('actionCenter.historyPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTypes = useTranslations('actionCenter.actionCategories');
  const tAffected = useTranslations('actionCenter.historyPage.affected');

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.action')}</TableHead>
            <TableHead className="text-xs">{t('table.type')}</TableHead>
            <TableHead className="text-xs">{t('table.priority')}</TableHead>
            <TableHead className="text-xs">{t('table.affected')}</TableHead>
            <TableHead className="text-xs">{t('table.result')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="text-xs">{t('table.date')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const texts = actionTexts(
              { kind: item.kind, payload: item.payload } as Parameters<typeof actionTexts>[0],
              tTexts,
            );
            const date = item.completedAt ?? item.createdAt;
            return (
              <TableRow
                key={item.id}
                className={cn('cursor-pointer', selectedId === item.id && 'bg-muted/50')}
                onClick={() => onSelect(item)}
              >
                <TableCell className="max-w-[360px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <ActionIcon
                        kind={item.kind}
                        category={item.type}
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{texts.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        AC-{item.actionNo}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-[10px]', TYPE_TONES[item.type])}>
                    {tTypes(item.type)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <PriorityBadge score={item.priorityScore} level={item.priorityLevel} />
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {item.affected.slice(0, 2).map((entity) => (
                      <p key={entity.id} className="text-xs text-muted-foreground">
                        {entity.count != null
                          ? tAffected(entity.type, { count: entity.count })
                          : entity.name}
                      </p>
                    ))}
                    {item.affected.length === 0 && (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <ResultCell item={item} />
                </TableCell>
                <TableCell>
                  <HistoryStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {new Date(date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
