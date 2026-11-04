'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { API_FAILURES, apiFailure, type ApiFailure } from '@/lib/apiFailure';
import type { TrayResponse, TrayResult, TrayRun, TrayRunState } from '@/lib/chat/runsTray';
import { cn } from '@/lib/utils';
import { AgentAvatar, type AgentAvatarState } from './AgentAvatar';
import { ListProgress } from './ListDot';

const isApiFailure = (value: unknown): value is ApiFailure =>
  (API_FAILURES as readonly unknown[]).includes(value);

/** How often the tray reads its runs: often while open, less while closed. */
export const TRAY_POLL_OPEN_MS = 4_000;
export const TRAY_POLL_CLOSED_MS = 15_000;

const AVATAR: Record<TrayRunState, AgentAvatarState> = {
  running: 'working',
  needsYou: 'waiting',
  paused: 'idle',
  done: 'done',
  failed: 'failed',
};

const SMALL_BUTTON =
  'inline-flex h-7 w-full items-center justify-center rounded-lg border bg-background px-2.5 text-xs font-medium';

/** "08:02": a run's end, in the viewer's time. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** One run: avatar, title, where it stands; Review, its progress, or Open. Opens the run (CHAT-23 `runs.open`). */
function TrayRow({ run }: { run: TrayRun }) {
  const t = useTranslations('agentic.runsTray');
  const at = { n: run.step, total: run.steps };
  const line = (() => {
    switch (run.state) {
      case 'needsYou':
        return t('needsYou', at);
      case 'paused':
        return t('paused', at);
      case 'done':
        return t('done', { time: clock(run.finishedAt ?? run.startedAt) });
      case 'failed':
        return t('failed', at);
      default:
        if (run.steps === 0) return t('starting');
        return run.stepLabel ? t('stepOfLabel', { ...at, label: run.stepLabel }) : t('stepOf', at);
    }
  })();
  const progress = run.steps > 0 ? ((run.step - 1) / run.steps) * 100 : 0;
  return (
    <li className="border-t first:border-t-0">
      <Link
        href={run.href}
        data-action="runs.open"
        data-state={run.state}
        className="grid w-full grid-cols-[26px_minmax(0,1fr)_72px] items-center gap-2.5 px-3 py-2.5 text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <AgentAvatar state={AVATAR[run.state]} size="sm" decorative />
        <span className="min-w-0 truncate">
          {run.title ?? t('newChat')}
          <span
            className={cn(
              'block truncate text-[11.5px] text-muted-foreground',
              run.state === 'needsYou' && 'text-amber-700 dark:text-amber-300',
              run.state === 'failed' && 'text-red-700 dark:text-red-300',
            )}
          >
            {line}
          </span>
        </span>
        {run.state === 'needsYou' ? (
          <span className={SMALL_BUTTON}>{t('review')}</span>
        ) : run.state === 'running' || run.state === 'paused' ? (
          <ListProgress value={progress} className="h-1.5 w-full rounded-md" />
        ) : (
          <span className={SMALL_BUTTON}>{t('open')}</span>
        )}
      </Link>
    </li>
  );
}

export type TrayLoad = 'loading' | 'ready' | 'error';

/**
 * The runs pill and its tray (CHAT-mockup-v2 header, CHAT-23 G4
 * `runs.toggleTray`): "1 running" with bouncing dots and an amber count of
 * what needs the person; open, "Your runs" with every run newest first.
 * Esc, a click outside or the pill closes it, focus back on the pill.
 */
export function RunsTrayView({
  data,
  load = 'ready',
  failure,
  open,
  onOpenChange,
  className,
}: {
  data: TrayResponse | null;
  load?: TrayLoad;
  /** Why the last read failed, said in the app's plain words under "Couldn't load your runs." */
  failure?: ApiFailure | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const t = useTranslations('agentic.runsTray');
  const tFailure = useTranslations('apiFailure');
  const running = data?.running ?? 0;
  const needsYou = data?.needsYou ?? 0;
  const summary = needsYou ? t('summary', { running, needsYou }) : t('summaryRunning', { running });
  const runs = data?.runs ?? [];
  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <PopoverTrigger
        data-action="runs.toggleTray"
        aria-label={`${t('label')}: ${summary}`}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border bg-card px-2.5 text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
          className,
        )}
      >
        {running > 0 && (
          <span aria-hidden className="inline-flex gap-[3px]">
            {[0, 1, 2].map((i) => (
              <i
                key={i}
                className="size-1 animate-agent-dot rounded-full bg-current opacity-25 motion-reduce:animate-none motion-reduce:opacity-60"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
        )}
        <span>{t('button', { count: running })}</span>
        {needsYou > 0 && (
          <span
            title={t('needsYouTip', { count: needsYou })}
            className="rounded-md bg-amber-600 px-[5px] text-[11px] text-white tabular-nums dark:bg-amber-500 dark:text-amber-950"
          >
            {needsYou}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] max-w-[calc(100vw-32px)] rounded-[14px] p-0 shadow-[0_14px_36px_rgba(0,0,0,.14)] motion-reduce:animate-none!"
      >
        <div className="flex border-b px-3 py-2.5 text-xs text-muted-foreground">
          <PopoverTitle className="text-xs font-normal text-muted-foreground">
            {t('title')}
          </PopoverTitle>
          {runs.length > 0 && <span className="ml-auto">{summary}</span>}
        </div>
        {load === 'error' && runs.length === 0 ? (
          <p role="alert" className="m-0 px-3 py-4 text-[13px] text-muted-foreground">
            {t('failedToLoad')}
            {failure && failure !== 'failed' && (
              <span className="mt-1 block text-xs">{tFailure(failure)}</span>
            )}
          </p>
        ) : load === 'loading' && runs.length === 0 ? (
          <div aria-hidden className="grid gap-2 px-3 py-3">
            <span className="h-[26px] rounded-md bg-muted" />
            <span className="h-[26px] rounded-md bg-muted" />
          </div>
        ) : runs.length === 0 ? (
          <p className="m-0 px-3 py-4 text-[13px] text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="m-0 max-h-[60vh] list-none overflow-y-auto p-0">
            {runs.map((run) => (
              <TrayRow key={run.href} run={run} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The runs tray with its runs (`/api/chat/runs/tray`): the person's Chat
 * runs and the brand's Content Agent runs, read again every few seconds
 * while it is open (less often while closed, not while the tab is hidden),
 * so a run's step and state keep up.
 */
export function RunsTray({
  brandId,
  readAgain,
  className,
}: {
  brandId?: string | null;
  /**
   * A value that changes when a run starts or ends on the page (the Content
   * Editor's own agent): the tray reads at once, not at its next poll.
   */
  readAgain?: string;
  className?: string;
}) {
  const [data, setData] = useState<TrayResponse | null>(null);
  const [load, setLoad] = useState<TrayLoad>('loading');
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const call = ++latest.current;
    // A failure is a value (TrayResult), never thrown: the route says why,
    // and a body that isn't one says it by its status.
    let result: TrayResult;
    try {
      const query = brandId ? `?brand=${encodeURIComponent(brandId)}` : '';
      const res = await fetch(`/api/chat/runs/tray${query}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as Partial<TrayResult>;
      result =
        res.ok && body.ok === true
          ? (body as TrayResult)
          : {
              ok: false,
              failure:
                body.ok === false && isApiFailure(body.failure)
                  ? body.failure
                  : apiFailure(res.status, body),
              error: `runs tray ${res.status}`,
            };
    } catch {
      // No answer: the next read tries again.
      result = { ok: false, failure: 'failed', error: 'no answer' };
    }
    if (call !== latest.current) return;
    if (result.ok) {
      setData(result);
      setFailure(null);
      setLoad('ready');
    } else {
      setFailure(result.failure);
      setLoad('error');
    }
  }, [brandId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'hidden') await read();
      if (!stopped) timer = setTimeout(tick, open ? TRAY_POLL_OPEN_MS : TRAY_POLL_CLOSED_MS);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [read, open, readAgain]);

  return (
    <RunsTrayView
      data={data}
      load={load}
      failure={failure}
      open={open}
      onOpenChange={setOpen}
      className={className}
    />
  );
}
