'use client';

import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { actionKindName } from '@/lib/action-center/display';
import { successRate, topDismissReason, type ScorecardRow } from '@/lib/action-center/scorecard';
import type { ActionOutcome } from '@/lib/action-center/registry';
import { signedPercent } from '@/lib/signals/metrics';
import { cn } from '@/lib/utils';

/** The results a row lists, in the order they read, and each one's tone. */
const RESULTS: { key: keyof ScorecardRow; outcome: ActionOutcome; tone: string }[] = [
  { key: 'improved', outcome: 'improved', tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'mixed', outcome: 'mixed', tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'noChange', outcome: 'no_meaningful_change', tone: 'text-muted-foreground' },
  { key: 'declined', outcome: 'declined', tone: 'text-red-600 dark:text-red-400' },
  { key: 'notMeasurable', outcome: 'not_measurable', tone: 'text-muted-foreground' },
  { key: 'pending', outcome: 'pending_measurement', tone: 'text-muted-foreground' },
];

/**
 * The scorecard (learning B3): what each kind of action did at this brand,
 * from its own actions only. A kind with too few results says so instead of
 * a rate.
 */
export function ScorecardTable({ rows }: { rows: ScorecardRow[] }) {
  const t = useTranslations('actionCenter.historyPage.scorecard');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tOutcome = useTranslations('actionCenter.actionOutcome');
  const tReason = useTranslations('actionCenter.dismissReason');

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <h2 className="font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{t('columns.kind')}</TableHead>
              <TableHead className="text-right text-xs">{t('columns.completed')}</TableHead>
              <TableHead className="text-xs">{t('columns.results')}</TableHead>
              <TableHead className="text-right text-xs">{t('columns.successRate')}</TableHead>
              <TableHead className="text-right text-xs">{t('columns.medianChange')}</TableHead>
              <TableHead className="text-right text-xs">{t('columns.dismissed')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rate = successRate(row);
              const reason = topDismissReason(row);
              const change = row.medianChange == null ? null : Math.round(row.medianChange * 100);
              const results = RESULTS.filter(({ key }) => (row[key] as number) > 0);
              return (
                <TableRow key={row.kind}>
                  <TableCell className="text-sm font-medium">
                    {actionKindName(row.kind, tTexts)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{row.completed}</TableCell>
                  <TableCell>
                    {results.length > 0 ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {results.map(({ key, outcome, tone }) => (
                          <span key={key} className={cn('flex items-center gap-1.5 text-xs', tone)}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            <span className="tabular-nums">{row[key] as number}</span>
                            {tOutcome(outcome)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {rate == null ? (
                      <span className="text-xs text-muted-foreground">{t('tooFew')}</span>
                    ) : (
                      <span className="text-sm font-medium tabular-nums">{rate}%</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right text-sm tabular-nums',
                      change == null || change === 0
                        ? 'text-muted-foreground'
                        : change > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {change == null ? '—' : signedPercent(change)}
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="text-sm tabular-nums">{row.dismissed}</p>
                    {reason && (
                      <p className="text-[11px] text-muted-foreground">
                        {t('mostly', { reason: tReason(`${reason}.label`) })}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
