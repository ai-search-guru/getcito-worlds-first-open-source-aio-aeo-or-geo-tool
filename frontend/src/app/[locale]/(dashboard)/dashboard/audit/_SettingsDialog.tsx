'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  getAuditSettings,
  saveAuditSettings,
  setOpportunityPrefs,
  type AuditAutoStatus,
  type AuditSettings,
  type AuditSettingsChanges,
  type AutoAuditRun,
} from '@/lib/actions/audits';
import { nextAutoRun } from '@/lib/auditAutoRuns';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { formatMonthDay, formatNumber } from '@/lib/format';

/** One pattern per line, blank lines dropped. */
export function parsePatterns(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Site Audit › Settings (SA-006): the organization's auto-audit switch and
 * e-mail, the brand's exclude patterns and its pinned pages. Admins and
 * managers change them, Unpin included; everyone else reads them. With the page's quota, the
 * switch also says when the runs happen: the last one and the next (the
 * first, when it was just turned on).
 */
export function AuditSettingsDialog({
  brandId,
  open,
  onOpenChange,
  canManage,
  onSaved,
  schedule,
  latestRun,
  now,
}: {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  /** Read the page's quota and inbox again: the reserved share or the inbox may change. */
  onSaved: () => void;
  /** Where auto-audit stands this billing month (the quota's). */
  schedule?: AuditAutoStatus | null;
  /** The latest run on this brand's pages. */
  latestRun?: AutoAuditRun | null;
  now?: Date;
}) {
  const t = useTranslations('audit.settings');
  // A read-only workspace (plan not active): the settings open to read; Save
  // and Unpin open the upgrade dialog instead.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tReadOnly = useTranslations('readOnly');
  const [settings, setSettings] = useState<AuditSettings | null>(null);
  const [autoAudit, setAutoAudit] = useState(false);
  const [emailAfterRun, setEmailAfterRun] = useState(false);
  const [patterns, setPatterns] = useState('');
  const [saving, setSaving] = useState(false);
  const [unpinning, setUnpinning] = useState<string | null>(null);

  const apply = (next: AuditSettings) => {
    setSettings(next);
    setAutoAudit(next.autoAudit.enabled);
    setEmailAfterRun(next.emailAfterRun);
    setPatterns(next.excludePatterns.join('\n'));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettings(null);
    getAuditSettings(brandId)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((err) => {
        console.error('Failed to load the Site Audit settings:', err);
        if (!cancelled) {
          toast.error(t('loadFailed'));
          onOpenChange(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, brandId, t, onOpenChange]);

  // Only what changed is sent: the switch stays on the plan's default until
  // someone turns it.
  const changes: AuditSettingsChanges = {};
  if (settings) {
    if (autoAudit !== settings.autoAudit.enabled) changes.autoAudit = autoAudit;
    if (emailAfterRun !== settings.emailAfterRun) changes.emailAfterRun = emailAfterRun;
    const next = parsePatterns(patterns);
    if (next.join('\n') !== settings.excludePatterns.join('\n')) changes.excludePatterns = next;
  }
  const changed = Object.keys(changes).length > 0;

  const handleSave = async () => {
    if (!changed) return;
    setSaving(true);
    try {
      apply(await saveAuditSettings(brandId, changes));
      toast.success(t('saved'));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleUnpin = async (url: string) => {
    setUnpinning(url);
    try {
      await setOpportunityPrefs(brandId, [url], null);
      setSettings((prev) =>
        prev ? { ...prev, pinned: prev.pinned.filter((p) => p.url !== url) } : prev,
      );
      toast.success(t('unpinned'));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setUnpinning(null);
    }
  };

  const auto = settings?.autoAudit;
  // Read-only (no active plan): the month's audits read 0, so it says there's
  // no plan, not "all 0 audits a month are yours".
  const autoLine = !auto
    ? null
    : isLocked
      ? tReadOnly('noPlan')
      : auto.limit === -1
        ? t('autoAuditUnlimited', { perRun: auto.perRun })
        : autoAudit
          ? t('autoAuditOn', {
              perRun: auto.perRun,
              total: formatNumber(auto.perRun * 5),
              limit: formatNumber(auto.limit),
            })
          : t('autoAuditOff', { limit: formatNumber(auto.limit) });

  const timing: string[] = [];
  if (auto && autoAudit && schedule && now) {
    if (latestRun) {
      timing.push(
        latestRun.status === 'running'
          ? t('runningNow')
          : t('lastRun', { date: formatMonthDay(latestRun.startedAt) }),
      );
    }
    const next = nextAutoRun(schedule, now);
    const date = next.soon ? t('withinADay') : formatMonthDay(next.at);
    timing.push(auto.enabled ? t('nextRun', { date }) : t('firstRun', { date }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        {!settings ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <Section title={t('autoAudit')}>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="audit-auto"
                  checked={autoAudit}
                  onCheckedChange={(on) => setAutoAudit(on === true)}
                  disabled={!canManage}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="audit-auto">{t('autoAuditLabel')}</Label>
                  <p className="text-xs text-muted-foreground">{autoLine}</p>
                  {timing.length > 0 && (
                    <p className="text-xs font-medium text-foreground">{timing.join(' · ')}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{t('orgWide')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="audit-email"
                  checked={emailAfterRun}
                  onCheckedChange={(on) => setEmailAfterRun(on === true)}
                  disabled={!canManage}
                />
                <Label htmlFor="audit-email">{t('emailLabel')}</Label>
              </div>
            </Section>

            <Section title={t('excludeTitle')}>
              <Textarea
                aria-label={t('excludeTitle')}
                value={patterns}
                onChange={(e) => setPatterns(e.target.value)}
                placeholder={'/careers/*\n/tag/*'}
                rows={3}
                disabled={!canManage}
              />
              <p className="text-xs text-muted-foreground">{t('excludeHelp')}</p>
            </Section>

            <Section title={t('pinnedTitle')}>
              {settings.pinned.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('noPinned')}</p>
              ) : (
                <>
                  <ul className="divide-y rounded-md border">
                    {settings.pinned.map((page) => (
                      <li
                        key={page.key}
                        className="flex items-center justify-between gap-3 px-3 py-1.5"
                      >
                        <span className="truncate" title={page.url}>
                          {pathOf(page.url)}
                        </span>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={guard(() => void handleUnpin(page.url), {
                              action: tActions('unpinPages'),
                            })}
                            disabled={unpinning !== null}
                          >
                            {unpinning === page.url && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            {t('unpin')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t('pinnedHelp')}</p>
                </>
              )}
            </Section>

            {!canManage && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={guard(handleSave, { action: tActions('saveAuditSettings') })}
            disabled={!canManage || !changed || saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
