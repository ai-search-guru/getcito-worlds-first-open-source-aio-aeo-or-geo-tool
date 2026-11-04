'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, Trash2, RefreshCw, AlertCircle, ListChecks } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { useRecentAudit } from '@/components/audit/useRecentAudit';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  getAudit,
  runAudit,
  deleteAudit,
  sendAuditToActionCenter,
  type AuditResult,
} from '@/lib/actions/audits';
import { AuditReport } from '@/components/audit/AuditReport';
import { failingChecks } from '@/lib/audit/failingChecks';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { useUpgradeGate } from '@/components/context/upgradeGate';

export default function AuditDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const t = useTranslations('audit');
  const router = useRouter();
  const { askOne } = useRecentAudit();
  const tFailed = t('failed');
  // A read-only workspace (plan not active): Re-audit and Delete open the
  // upgrade dialog instead (Delete without its confirm).
  const { guard, isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAndPoll = useCallback(async () => {
    const gen = ++genRef.current;
    const cancelled = () => genRef.current !== gen;
    setError(null);
    setLoading(true);

    try {
      setTimedOut(false);

      let result = await getAudit(id);

      if (cancelled()) return;

      setAudit(result);
      setLoading(false);

      const deadline = Date.now() + 120_000;

      while (!cancelled() && result.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => {
          timerRef.current = setTimeout(resolve, 3000);
        });

        if (cancelled()) return;

        result = await getAudit(id);

        if (cancelled()) return;

        setAudit(result);
      }

      if (!cancelled() && result.status === 'running' && Date.now() >= deadline) {
        setTimedOut(true);
      }

      if (!cancelled() && result.status === 'failed') {
        toast.error(result.error || tFailed);
      }
    } catch (err) {
      if (cancelled()) return;

      const message = err instanceof Error ? err.message : tFailed;

      setError(message);
      setLoading(false);
      toast.error(message);
    }
  }, [id, tFailed]);

  useEffect(() => {
    const startPolling = async () => {
      await loadAndPoll();
    };

    startPolling();

    return () => {
      genRef.current++;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [loadAndPoll]);

  // Advance the running-state stage label so the ~30s wait reads as progress.
  const isRunning = !audit || audit.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 8000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleDelete = async () => {
    try {
      await deleteAudit(id);
      router.push('/dashboard/audit');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tFailed);
    }
  };

  // The page and the checks it fails, sent to the Action Center as one Fix action (learning D2).
  const [sendingToAction, setSendingToAction] = useState(false);
  const failing = failingChecks(audit?.signals ?? []);
  const handleSendToAction = async () => {
    if (!audit) return;
    setSendingToAction(true);
    const toastId = toast.loading(t('sendToAction.sending'));
    try {
      const result = await sendAuditToActionCenter(audit.brandId, audit.id);
      if ('error' in result) {
        // An older report of a page audited since: send from its latest report instead.
        const latestAuditId = result.code === 'newer_audit' ? result.latestAuditId : undefined;
        if (latestAuditId) {
          toast.error(t('sendToAction.newerAudit'), {
            id: toastId,
            description: t('sendToAction.newerAuditDescription'),
            duration: 10_000,
            action: {
              label: t('sendToAction.openLatest'),
              onClick: () => router.push(`/dashboard/audit/${latestAuditId}`),
            },
          });
          return;
        }
        toast.error(t('sendToAction.failed'), {
          id: toastId,
          description:
            result.code === 'nothing_to_fix' ? t('sendToAction.nothingToFix') : result.error,
        });
        return;
      }
      const open = {
        label: t('sendToAction.open'),
        onClick: () => router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
      };
      if (result.created) {
        toast.success(t('sendToAction.sent'), {
          id: toastId,
          description: t('sendToAction.sentDescription', {
            number: result.actionNo,
            count: failing,
          }),
          duration: 10_000,
          action: open,
        });
      } else {
        toast.info(t('sendToAction.alreadySent'), {
          id: toastId,
          description: t('sendToAction.alreadySentDescription', { number: result.actionNo }),
          duration: 10_000,
          action: open,
        });
      }
    } catch (err) {
      toast.error(t('sendToAction.failed'), {
        id: toastId,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSendingToAction(false);
    }
  };

  // Re-run the audit on the same URL → navigate to the new audit's detail
  // page (the page's own when one runs already). An audit finished minutes
  // ago asks first: Open it or Audit again.
  const rerun = async (brandId: string, url: string, force = false) => {
    setRerunning(true);

    try {
      const started = force
        ? await runAudit(brandId, url, { force: true })
        : await runAudit(brandId, url);
      if (started.recent) {
        askOne(started.recent, () => void rerun(brandId, url, true));
        return;
      }
      router.push(`/dashboard/audit/${started.audit.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tFailed);
    } finally {
      setRerunning(false);
    }
  };
  const handleRefresh = async () => {
    if (!audit) return;
    await rerun(audit.brandId, audit.url);
  };

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard/audit"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {t('title')}
          </Link>
          {audit && (audit.status !== 'running' || timedOut) && (
            <div className="flex items-center gap-1">
              {audit.status === 'completed' && failing > 0 && (
                <Button
                  variant="outline"
                  className="mr-1 gap-1.5"
                  disabled={sendingToAction}
                  onClick={() => void handleSendToAction()}
                >
                  {sendingToAction ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ListChecks className="h-3.5 w-3.5" />
                  )}
                  {t('sendToAction.button')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                disabled={rerunning}
                onClick={guard(handleRefresh, { action: tActions('runAudit') })}
                aria-label={t('reaudit')}
              >
                {rerunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
              <Dialog
                onOpenChange={(open, details) => {
                  if (!open || !isLocked) return;
                  details.cancel();
                  openUpgrade(tActions('deleteAudits'));
                }}
              >
                <DialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={t('deleteAudit')}
                    />
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t('deleteAudit')}</DialogTitle>
                    <DialogDescription>{t('deleteConfirm')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
                    <DialogClose render={<Button variant="destructive" onClick={handleDelete} />}>
                      {t('deleteAudit')}
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </HeaderWithAiUsage>

      {loading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">{t('stages.fetch')}</div>
            <div className="text-xs text-muted-foreground">~30s</div>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div className="text-base font-semibold">{t('loadFailed')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void loadAndPoll()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'running' && timedOut ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="text-sm font-medium">{t('takingLongerThanExpected')}</div>
            <Button onClick={() => void loadAndPoll()}>{t('checkAgain')}</Button>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'running' ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">
              {[t('stages.fetch'), t('stages.analyze'), t('stages.recommend')][stage]}
            </div>
            <div className="text-xs text-muted-foreground">~30s</div>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'failed' ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">
            {audit.error || tFailed}
          </CardContent>
        </Card>
      ) : audit ? (
        <AuditReport audit={audit} />
      ) : null}
    </div>
  );
}
