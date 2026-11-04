'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { AuditQuota } from '@/lib/actions/audits';
import { isNoPlan } from '@/lib/billing/noPlan';

/** A page audited this recently is left out of a bulk audit unless included: it scores the same unchanged. */
export const RECENT_AUDIT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Pages named in the dialog before "and N more". */
const NAMED = 3;

/** A page a bulk audit would start, with when it was last audited. */
export interface PageToAudit {
  url: string;
  path: string;
  lastAuditAt: string | null;
}

/**
 * What a bulk audit starts (customer priorities item 11): the pages in the
 * order given, less those audited in the last RECENT_AUDIT_DAYS when left
 * out, and only as many as the month has audits left (`remaining`, null
 * without a limit); the rest wait.
 */
export function auditPlan(
  pages: PageToAudit[],
  {
    leaveOutRecent,
    remaining,
    now,
  }: { leaveOutRecent: boolean; remaining: number | null; now: number },
) {
  const recent = pages.filter(
    (p) => p.lastAuditAt !== null && now - Date.parse(p.lastAuditAt) < RECENT_AUDIT_DAYS * DAY_MS,
  );
  const candidates = leaveOutRecent ? pages.filter((p) => !recent.includes(p)) : pages;
  const run = remaining === null ? candidates : candidates.slice(0, Math.max(0, remaining));
  return { recent, run, waiting: candidates.length - run.length };
}

/**
 * Asks before a bulk audit (customer priorities item 11): which pages, how
 * many of the month's audits it uses, the pages audited in the last week
 * (left out unless included), and past what's left, that the most valuable
 * (or the first, in the order shown) go now and the rest wait. `mode` says
 * where the pages come from: Not audited's Audit all, or a selection.
 */
export function AuditConfirmDialog({
  pages,
  mode,
  ordered,
  staleDays,
  quota,
  starting,
  now,
  onConfirm,
  onOpenChange,
}: {
  /** The pages, in the order they'd start; null when closed. */
  pages: PageToAudit[] | null;
  mode: 'notAudited' | 'picked';
  /** How the pages are ordered: by value (Opportunities), or as the list shows them (Pages). */
  ordered: 'value' | 'shown';
  staleDays: number;
  quota: AuditQuota | null;
  starting: boolean;
  now: number;
  onConfirm: (urls: string[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('audit.confirm');
  const format = useFormatter();
  const { isLocked } = useUpgradeGate();
  const [leaveOutRecent, setLeaveOutRecent] = useState(true);
  // Without an active plan the quota reads 0 of 0: no limit to speak of here,
  // the start itself opens the plan dialog.
  const limited = quota !== null && quota.limit !== -1 && !isNoPlan(quota, isLocked);
  const remaining = limited ? quota.remaining : null;
  const list = pages ?? [];
  const { recent, run, waiting } = auditPlan(list, { leaveOutRecent, remaining, now });
  const day = (iso: string) => format.dateTime(new Date(iso), { month: 'short', day: 'numeric' });

  return (
    <Dialog
      open={pages !== null}
      onOpenChange={(open) => {
        if (!starting) onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { count: list.length })}</DialogTitle>
          <DialogDescription>
            {mode === 'notAudited' ? t('notAudited', { days: staleDays }) : t(`picked.${ordered}`)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t('list', {
            pages: list
              .slice(0, NAMED)
              .map((p) => p.path)
              .join(', '),
            count: Math.max(0, list.length - NAMED),
          })}
        </p>
        {recent.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <Checkbox
              className="mt-0.5"
              checked={leaveOutRecent}
              onCheckedChange={(on) => setLeaveOutRecent(on === true)}
            />
            <span>
              <span className="font-medium">
                {t('recent', { count: recent.length, days: RECENT_AUDIT_DAYS })}
              </span>
              <br />
              {t('recentPages', {
                pages: recent
                  .slice(0, NAMED)
                  .map((p) => t('recentPage', { page: p.path, date: day(p.lastAuditAt!) }))
                  .join(' · '),
                count: Math.max(0, recent.length - NAMED),
              })}
            </span>
          </label>
        )}
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {remaining === null
            ? t('noLimit')
            : remaining === 0
              ? t('noneLeft')
              : waiting > 0
                ? t(`over.${ordered}`, { remaining, rest: waiting })
                : t.rich('uses', {
                    count: run.length,
                    remaining,
                    b: (chunks) => <b className="font-medium text-foreground">{chunks}</b>,
                  })}
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={starting} onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={starting || run.length === 0}
            onClick={() => onConfirm(run.map((p) => p.url))}
            className="gap-2"
          >
            {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('confirm', { count: run.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
