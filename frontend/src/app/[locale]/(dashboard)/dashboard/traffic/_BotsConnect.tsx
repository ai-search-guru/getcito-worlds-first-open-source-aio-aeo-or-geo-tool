'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, Loader2, TriangleAlert } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { formatRelative } from '@/lib/formatRelative';
import {
  botsCardState,
  hasLogSender,
  lastBotEvent,
  logsPausedUntil,
  rowsPausedUntil,
} from '@/lib/aiBots';
import {
  createBotConnection,
  revokeBotConnection,
  type BotConnectionKind,
  type BotConnections,
  type NewBotConnection,
} from '@/lib/actions/aiBots';
import { SourceCard } from './_SourceCard';
import { getBotConnections } from '@/lib/trafficReads';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { usePlanContext } from '@/components/context/PlanProvider';

const KINDS: BotConnectionKind[] = ['cloudflare_worker', 'cloudflare_logpush', 'vercel_drain'];

/** Where Upgrade goes, as on the Prompts page's usage cards. */
const PLAN_PAGE = '/dashboard/settings?tab=billing';

/**
 * A value to copy, in a box that scrolls rather than overflowing the dialog.
 * Each holds the connection's secret or settings with it: left out of replays.
 */
function CopyBlock({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  const t = useTranslations('traffic.bots');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 break-words text-xs font-medium">{label}</p>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <pre
        className={cn(
          'ph-no-capture max-h-56 overflow-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px]',
          code ? 'whitespace-pre' : 'whitespace-pre-wrap break-all',
        )}
      >
        {value}
      </pre>
    </div>
  );
}

/** What to do in Cloudflare or Vercel with the new connection's secret, shown once. */
function SetupSteps({ created }: { created: NewBotConnection }) {
  const t = useTranslations('traffic.bots');
  const kind = created.connection.kind;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t('secretOnce')}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {(t.raw(`steps.${kind}`) as string[]).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {kind === 'cloudflare_worker' && created.workerScript && (
        <CopyBlock label={t('copyWorker')} value={created.workerScript} code />
      )}
      {kind === 'cloudflare_worker' && created.workerSecretName && (
        // Added as a Worker Secret, so it isn't in the code anyone with the Worker can read.
        <CopyBlock
          label={t('copyWorkerSecret', { name: created.workerSecretName })}
          value={created.secret}
        />
      )}
      {kind === 'cloudflare_logpush' && created.logpushJob && (
        <>
          <CopyBlock
            label={t('copyDestination')}
            value={String(created.logpushJob.destination_conf)}
          />
          <CopyBlock
            label={t('copyLogpushJob')}
            value={JSON.stringify(created.logpushJob, null, 2)}
            code
          />
        </>
      )}
      {kind === 'vercel_drain' && created.vercelDrain && (
        <>
          <CopyBlock label={t('copyEndpoint')} value={created.vercelDrain.endpoint} />
          <CopyBlock label={t('copyHeader')} value={created.vercelDrain.headers.join('\n')} />
          <p className="text-xs text-muted-foreground">
            {t('vercelFormat', { sources: created.vercelDrain.sources.join(', ') })}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Connect or manage the brand's AI-bot senders (AT-010, spec §6.1, §6.4):
 * pick a Cloudflare Worker, a Logpush job or a Vercel drain, with what each
 * costs on the customer's own bill said before connecting; then copy the
 * settings, with the secret in them once. Existing connections can be
 * revoked; the month's use shows, and when the cap paused detailed rows.
 */
export function BotsDialog({
  brandId,
  open,
  info,
  canConnect,
  onOpenChange,
  onChanged,
}: {
  brandId: string;
  open: boolean;
  info: BotConnections;
  canConnect: boolean;
  onOpenChange: (open: boolean) => void;
  /** A connection was made or revoked: read them again. */
  onChanged: () => void;
}) {
  const t = useTranslations('traffic.bots');
  const tCommon = useTranslations('common');
  const [kind, setKind] = useState<BotConnectionKind>('cloudflare_worker');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<NewBotConnection | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // A read-only workspace (plan not active): a new connection opens the
  // upgrade dialog instead; revoking one stays open (it ends an access).
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tReadOnly = useTranslations('readOnly');

  const close = (next: boolean) => {
    if (!next) {
      setCreated(null);
      setConfirming(null);
    }
    onOpenChange(next);
  };

  const create = guard(
    async () => {
      setCreating(true);
      const result = await createBotConnection(brandId, kind);
      setCreating(false);
      if ('error' in result) {
        toast.error(result.code === 'plan_limit' ? t('planLimit') : result.error);
        return;
      }
      setCreated(result);
      onChanged();
    },
    { action: tActions('connectBotLogs') },
  );

  const revoke = async (id: string) => {
    setRevoking(id);
    const result = await revokeBotConnection(brandId, id);
    setRevoking(null);
    setConfirming(null);
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    toast.success(t('revoked'));
    onChanged();
  };

  const { usage, connections } = info;
  const pausedUntil = rowsPausedUntil(usage);
  const logsPaused = logsPausedUntil(info);
  const shortDay = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {/* min-w-0: the dialog is a grid, and a long code line would widen its cell. */}
        {created ? (
          <div className="min-w-0 space-y-4">
            <SetupSteps created={created} />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => close(false)}>
                {t('done')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {connections.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold">{t('connected')}</h3>
                <ul className="divide-y rounded-md border">
                  {connections.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t(`kinds.${c.kind}.name`)}</p>
                        <p className="text-muted-foreground">
                          {c.lastEventAt
                            ? t('lastEvent', { when: formatRelative(c.lastEventAt, tCommon) })
                            : t('waiting')}
                        </p>
                      </div>
                      {canConnect &&
                        (confirming === c.id ? (
                          <span className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 gap-1.5 text-xs"
                              disabled={revoking === c.id}
                              onClick={() => void revoke(c.id)}
                            >
                              {revoking === c.id && <Loader2 className="h-3 w-3 animate-spin" />}
                              {t('revokeConfirm')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setConfirming(null)}
                            >
                              {t('cancel')}
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setConfirming(c.id)}
                          >
                            {t('revoke')}
                          </Button>
                        ))}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {/* Without an active plan the cap reads 0: the month's rows, not "of 0". */}
                  {usage.cap < 0 || usage.noPlan
                    ? t('usageNoCap', { stored: formatNumber(usage.stored), count: usage.stored })
                    : t('usage', {
                        stored: formatNumber(usage.stored),
                        cap: formatNumber(usage.cap),
                      })}
                  {usage.noPlan && ` · ${tReadOnly('noPlan')}`}
                  {pausedUntil && ` ${t('paused', { day: shortDay(pausedUntil) })}`}
                </p>
                {/* Log senders' records count against their own cap (§6.3). */}
                {hasLogSender(info) && usage.rawCap > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('rawUsage', {
                      raw: formatNumber(usage.raw),
                      cap: formatNumber(usage.rawCap),
                    })}
                    {logsPaused && ` ${t('logsPaused', { day: shortDay(logsPaused) })}`}
                  </p>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold">
                {connections.length > 0 ? t('addAnother') : t('choose')}
              </h3>
              <div role="radiogroup" aria-label={t('choose')} className="grid gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      kind === k ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {t(`kinds.${k}.name`)}
                      {k === 'cloudflare_worker' && (
                        <span className="rounded border px-1.5 text-[10px] font-medium text-muted-foreground">
                          {t('recommended')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{t(`kinds.${k}.what`)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t(`kinds.${k}.cost`)}</p>
                  </button>
                ))}
              </div>
            </section>

            <div className="flex items-center justify-end gap-2">
              {!canConnect && <p className="text-xs text-muted-foreground">{t('notAllowed')}</p>}
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!canConnect || creating}
                onClick={() => void create()}
              >
                {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                {t('create')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The sources strip's AI bots card (AT-001, AT-010): locked with Upgrade on
 * a plan without the bot report (Starter), Connect when nothing sends yet,
 * waiting until the first request, then the last request's time; Manage
 * opens the same dialog.
 */
export function BotsSource({
  brandId,
  canConnect,
  revision = 0,
  onChanged,
}: {
  brandId: string;
  canConnect: boolean;
  /** Bumped when a connection is made or revoked anywhere on the page. */
  revision?: number;
  /** A connection was made or revoked here. */
  onChanged?: () => void;
}) {
  const t = useTranslations('traffic.sources');
  const tCommon = useTranslations('common');
  // A failed read keeps the last connections read, as the report section
  // does: the dialog reads them again after a create, and taken down it
  // would lose the new connection's one-time secret. Kept per brand.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    info: BotConnections | null;
    failed: boolean;
  } | null>(null);
  const [open, setOpen] = useState(false);
  // Without an active plan the caps read 0: the plan it was on decides the lock.
  const { isLocked } = useUpgradeGate();
  const { planId } = usePlanContext();

  const load = useCallback(() => {
    const done = (next: BotConnections | null) =>
      setLoaded((prev) => ({
        brandId,
        info: next ?? (prev?.brandId === brandId ? prev.info : null),
        failed: next === null,
      }));
    getBotConnections(brandId)
      .then((result) => done('error' in result ? null : result))
      .catch(() => done(null));
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const current = loaded?.brandId === brandId ? loaded : null;
  const info = current?.info ?? null;
  const title = t('bots');
  if (!info) {
    return (
      <SourceCard
        tone="off"
        title={title}
        line={current?.failed ? t('botsFailed') : t('botsLoading')}
      />
    );
  }

  const state = botsCardState(info, { isLocked, planId });
  const button = (label: string, primary: boolean) => (
    <Button
      size="sm"
      variant={primary ? 'default' : 'outline'}
      className="h-7 text-xs"
      onClick={() => setOpen(true)}
    >
      {label}
    </Button>
  );

  return (
    <>
      {current?.failed ? (
        <SourceCard tone="off" title={title} line={t('botsFailed')} />
      ) : state === 'locked' ? (
        <SourceCard
          tone="off"
          title={title}
          line={t('botsLocked')}
          action={
            <Link
              href={PLAN_PAGE}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
            >
              {t('upgrade')}
            </Link>
          }
        />
      ) : state === 'off' ? (
        <SourceCard
          tone="off"
          title={title}
          line={t('botsNotConnected')}
          action={
            // A span carries the tooltip: a disabled button gets no hover.
            <span title={canConnect ? undefined : t('connectNotAllowed')}>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!canConnect}
                onClick={() => setOpen(true)}
              >
                {t('connect')}
              </Button>
            </span>
          }
        />
      ) : (
        <SourceCard
          tone={state === 'on' ? 'on' : 'sync'}
          title={title}
          line={
            state === 'on'
              ? t('botsActive', { when: formatRelative(lastBotEvent(info.connections), tCommon) })
              : t('botsWaiting')
          }
          action={button(t('manage'), false)}
        />
      )}
      {state !== 'locked' && (
        <BotsDialog
          brandId={brandId}
          open={open}
          info={info}
          canConnect={canConnect}
          onOpenChange={setOpen}
          onChanged={() => (onChanged ? onChanged() : load())}
        />
      )}
    </>
  );
}
