'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { bulkCmsItems, cmsSendGroups, type BulkItem } from '@/lib/content/cmsSend';
import {
  readDeliveries,
  readKeptFields,
  sendPagesToCms,
  type CmsDelivery,
  type CmsSendError,
  type CmsTarget,
} from '@/lib/content/cmsSendClient';
import type { ContentDraftListItem } from '@/lib/content/drafts';
import { CmsTargetPicker, CmsTargetUnchecked, useCmsTarget } from '@/components/content/CmsTarget';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { readCmsSources } from '@/lib/content/cmsSources';

/** How often the sends going on in the background are read. */
const POLL_MS = 2_000;
/** After this long, the Library takes over showing them. */
const POLL_FOR_MS = 3 * 60_000;

/**
 * How long the next request waits for the last one's pages: as long as the
 * server lets a send stay queued (00262), past which it reads as interrupted.
 */
const GROUP_WAIT_MS = 30 * 60_000;

/**
 * Waits until these sends aren't queued any more, reading them every
 * POLL_MS (a read that fails is read again), for up to GROUP_WAIT_MS: one
 * page at a time (#1331), so the next request goes once the last one's
 * pages have gone. Each read goes to `onRead`. 'out' when the wait ran out,
 * 'closed' once `closed()` says the dialog was.
 */
async function gone(
  ids: string[],
  onRead: (read: CmsDelivery[]) => void,
  closed: () => boolean,
): Promise<'gone' | 'out' | 'closed'> {
  const until = Date.now() + GROUP_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (closed()) return 'closed';
    const read = await readDeliveries(ids).catch(() => null);
    if (!read) continue;
    onRead(read);
    if (!read.some((delivery) => delivery.status === 'queued')) return 'gone';
  }
  return 'out';
}

interface Refusal {
  code: CmsSendError;
  field: string | null;
  title: string | null;
  /** Where the pages were going. */
  target: CmsTarget;
}

type Phase =
  | { kind: 'reading' }
  | { kind: 'readFailed' }
  | { kind: 'ready' }
  | { kind: 'sending' }
  /** `waiting`: the pages of requests still to post, as their draft ids. */
  | { kind: 'going'; since: number; waiting: string[] }
  | { kind: 'done'; stillGoing: boolean; waitedOut: number };

/**
 * Send to CMS for the Library's selected rows (#1331): each page as the Send
 * dialog would send it unchanged, its slug and meta from its last send or the
 * page; one that can't go says why, to fix in the editor. The pages go in as
 * few requests as their size allows; the server sends each request's one by
 * one in the background, read here until they have gone. Closing leaves them
 * going, and the Library's rows follow them.
 */
export function BulkSendDialog({
  brandId,
  drafts,
  brandName,
  brandLanguage,
  onClose,
}: {
  brandId: string;
  /** The selected rows, at most CMS_PAGES_PER_SEND. */
  drafts: ContentDraftListItem[];
  brandName: string;
  brandLanguage: string | null | undefined;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.library.bulk');
  const tEditor = useTranslations('contentEditor.editor');
  const tFailure = useTranslations('apiFailure');
  const { openUpgrade } = useUpgradeGate();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const [items, setItems] = useState<BulkItem[]>([]);
  // The sends made, as last read, by draft.
  const [sent, setSent] = useState<Map<string, CmsDelivery>>(new Map());
  // Pages past the workspace's sends for the day.
  const [skipped, setSkipped] = useState(0);
  // Why a request was refused; with the page its `pages.N` named, when it named one.
  const [failure, setFailure] = useState<Refusal | null>(null);
  const [attempt, setAttempt] = useState(0);
  const {
    webflow,
    wordpress,
    framer,
    wix,
    target,
    pick,
    sent: keepTarget,
    unchecked: targetUnchecked,
    reading: targetReading,
    retry: retryTarget,
  } = useCmsTarget(brandId);
  const collection = webflow?.ready
    ? webflow.collection || tEditor('send.target.webflow.collection')
    : '';
  const site = wordpress?.ready ? wordpress.site : '';
  const framerCollection = framer?.ready
    ? framer.collection || tEditor('send.target.framer.collection')
    : '';
  const wixSite = wix?.ready ? wix.site : '';

  useEffect(() => {
    let cancelled = false;
    const ids = drafts.map((draft) => draft.id);
    Promise.all([
      readCmsSources({
        brandId,
        draftIds: ids,
        brandName,
        brandLanguage,
      }),
      readKeptFields(ids),
    ])
      .then(([sources, kept]) => {
        if (cancelled) return;
        // In the Library's order; a page gone meanwhile is left out.
        const ordered = ids.flatMap((id) => {
          const source = sources.get(id);
          return source ? [source] : [];
        });
        setItems(bulkCmsItems(ordered, kept));
        setPhase({ kind: 'ready' });
      })
      .catch((err) => {
        console.error('Failed to read the pages to send:', err);
        if (!cancelled) setPhase({ kind: 'readFailed' });
      });
    return () => {
      cancelled = true;
    };
    // Read as it opens, for the rows selected then, and on Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // While the server sends them, they are read now and then.
  const going = phase.kind === 'going' ? phase : null;
  useEffect(() => {
    // While a request waits for the last one's pages, send() reads them.
    if (!going || going.waiting.length) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const read = await readDeliveries([...sent.values()].map((d) => d.id)).catch(() => null);
      if (cancelled) return;
      // By the send's id: a page deleted meanwhile reads back with no draft.
      const byId = new Map((read ?? []).map((delivery) => [delivery.id, delivery]));
      const next = new Map(
        [...sent].map(([draftId, delivery]) => {
          const now = byId.get(delivery.id);
          return [draftId, now ? { ...now, draftId } : delivery] as const;
        }),
      );
      setSent(next);
      const left = [...next.values()].some((d) => d.status === 'queued');
      if (!left) setPhase({ kind: 'done', stillGoing: false, waitedOut: 0 });
      else if (Date.now() - going.since > POLL_FOR_MS) {
        setPhase({ kind: 'done', stillGoing: true, waitedOut: 0 });
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [going, sent]);

  const ready = items.filter((item) => item.page !== null);

  // Closed (or left) while a request waits: the requests after it don't go.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const send = async () => {
    if (!target) return;
    setPhase({ kind: 'sending' });
    setFailure(null);
    const made = new Map<string, CmsDelivery>();
    let notSent = 0;
    let stopped: Refusal | null = null;
    // The day's sends used up: the requests after it would get none either.
    let capped = false;
    // Pages left unposted because the ones before them were still going.
    let waitedOut = 0;
    const groups = cmsSendGroups(ready.flatMap((item) => (item.page ? [item.page] : [])));
    for (const [i, group] of groups.entries()) {
      // Closed since the last request (a page sent at once, or a read in
      // flight): the rest don't go.
      if (i > 0 && closed.current) {
        toast(t('closedUnsent', { count: groups.slice(i).flat().length }));
        return;
      }
      // Once a send was refused (the day's sends used up), the rest wait too.
      if (stopped || capped) {
        notSent += group.length;
        continue;
      }
      const result = await sendPagesToCms(brandId, group, target);
      if (!result.ok) {
        // A read-only workspace: the upgrade dialog, and the rest wait too.
        if (result.code === 'subscription') openUpgrade();
        // The page a refusal names ("pages.2.html"), as the group's own.
        const index = Number(/^pages\.(\d+)\./.exec(result.field ?? '')?.[1] ?? NaN);
        stopped = {
          code: result.code,
          field: result.field,
          title: Number.isInteger(index) ? (group[index]?.title ?? null) : null,
          target,
        };
        notSent += group.length;
        continue;
      }
      for (const delivery of result.deliveries) made.set(delivery.draftId, delivery);
      notSent += result.skipped;
      if (result.skipped > 0) capped = true;
      const queued = result.deliveries.filter((d) => d.status === 'queued').map((d) => d.id);
      const rest = groups.slice(i + 1);
      if (!queued.length || !rest.length || capped) continue;
      // Pages too long for one request: the next waits for this one's to go,
      // what went shown meanwhile. Closing the dialog stops the rest: else
      // they'd go up to half an hour later with nothing showing it.
      setSent(new Map(made));
      setSkipped(notSent);
      setPhase({
        kind: 'going',
        since: Date.now(),
        waiting: rest.flat().map((page) => page.draftId),
      });
      const went = await gone(
        queued,
        (read) => {
          const byId = new Map(read.map((delivery) => [delivery.id, delivery]));
          for (const [draftId, delivery] of made) {
            const now = byId.get(delivery.id);
            if (now) made.set(draftId, { ...now, draftId });
          }
          setSent(new Map(made));
        },
        () => closed.current,
      );
      const unposted = rest.reduce((count, later) => count + later.length, 0);
      if (went === 'closed') {
        toast(t('closedUnsent', { count: unposted }));
        return;
      }
      // Still going past the server's own limit: the rest aren't posted beside them.
      if (went === 'out') {
        waitedOut = unposted;
        break;
      }
    }
    setSent(made);
    setSkipped(notSent);
    setFailure(stopped);
    if (made.size === 0) {
      // Nothing went: what was refused, and the pages as they were.
      setPhase({ kind: 'ready' });
      return;
    }
    keepTarget(target);
    const left = [...made.values()].some((d) => d.status === 'queued');
    setPhase(
      left && !waitedOut
        ? { kind: 'going', since: Date.now(), waiting: [] }
        : { kind: 'done', stillGoing: left, waitedOut },
    );
  };

  const failureText = ({ code, field, title, target: to }: Refusal) => {
    if (code === 'session' || code === 'workspace' || code === 'busy' || code === 'subscription') {
      return tFailure(code);
    }
    // A page archived or deleted since the dialog read it.
    if (code === 'not_found') return t('notFound');
    if (code === 'invalid' && field) {
      const named = field.split('.').pop() ?? 'other';
      return title
        ? t('invalidPage', { title, field: named })
        : tEditor('send.errors.invalidField', { field: named });
    }
    // No page named: any of them may be the one on its way.
    if (code === 'in_progress') {
      return t(
        to === 'wordpress'
          ? 'inProgressWordPress'
          : to === 'framer'
            ? 'inProgressFramer'
            : to === 'wix'
              ? 'inProgressWix'
              : 'inProgress',
      );
    }
    // No CMS ready sent the pages to the webhook: what to fix is the one connected.
    if (
      code === 'no_webhook' &&
      !webflow?.ready &&
      !wordpress?.ready &&
      !framer?.ready &&
      !wix?.ready
    ) {
      if (webflow) return tEditor('send.errors.no_webhookWebflow');
      if (wordpress) return tEditor('send.errors.no_webhookWordPress');
      if (framer) return tEditor('send.errors.no_webhookFramer');
      if (wix) return tEditor('send.errors.no_webhookWix');
    }
    return tEditor(`send.errors.${code}`);
  };

  const counts = {
    sent: [...sent.values()].filter((d) => d.status === 'sent' || d.status === 'published').length,
    failed: [...sent.values()].filter((d) => d.status === 'failed').length,
    going: [...sent.values()].filter((d) => d.status === 'queued').length,
  };
  const busy = phase.kind === 'reading' || phase.kind === 'sending';
  const after = phase.kind === 'going' || phase.kind === 'done';

  return (
    <Dialog open onOpenChange={(open) => !open && phase.kind !== 'sending' && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          {/* The pages read, once read: one deleted meanwhile is left out. */}
          <DialogTitle>
            {t('title', { count: phase.kind === 'reading' ? drafts.length : items.length })}
          </DialogTitle>
          <DialogDescription>
            {!target
              ? tEditor('send.descriptionReading')
              : target === 'webflow'
                ? t('descriptionWebflow', { collection })
                : target === 'wordpress'
                  ? t('descriptionWordPress', { site })
                  : target === 'framer'
                    ? t('descriptionFramer', { collection: framerCollection })
                    : target === 'wix'
                      ? t('descriptionWix', { site: wixSite })
                      : t('description')}
          </DialogDescription>
        </DialogHeader>

        {/* Where the pages go, before they go: a CMS once Settings has it ready. */}
        {(webflow || wordpress || framer || wix) && target && !after && (
          <CmsTargetPicker
            value={target}
            webflow={webflow}
            wordpress={wordpress}
            framer={framer}
            wix={wix}
            disabled={phase.kind === 'sending'}
            onChange={(next) => {
              pick(next);
              setFailure(null);
            }}
          />
        )}
        {targetUnchecked && !after && (
          <CmsTargetUnchecked
            target={targetUnchecked}
            reading={targetReading}
            onRetry={retryTarget}
            disabled={phase.kind === 'sending'}
          />
        )}

        {phase.kind === 'reading' ? (
          <div className="flex items-center justify-center py-8" aria-busy="true">
            <LoadingDots size="md" className="text-muted-foreground" />
          </div>
        ) : phase.kind === 'readFailed' ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {t('readFailed')}
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {items.map((item) => (
              <li key={item.draftId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {item.title.trim() || t('untitled')}
                </span>
                <ItemState
                  item={item}
                  delivery={sent.get(item.draftId)}
                  after={after}
                  sending={phase.kind === 'sending'}
                  waiting={going?.waiting.includes(item.draftId) ?? false}
                />
              </li>
            ))}
          </ul>
        )}

        {phase.kind === 'ready' && items.some((item) => item.problem) && (
          <p className="text-xs text-muted-foreground">{t('fixHint')}</p>
        )}
        {after && (
          <p role="status" className="text-sm">
            {going
              ? t('progress', {
                  done: counts.sent + counts.failed,
                  total: sent.size + going.waiting.length,
                })
              : t('summary', { sent: counts.sent, failed: counts.failed })}
            {phase.kind === 'done' && phase.stillGoing && (
              <span className="text-muted-foreground"> {t('stillGoing')}</span>
            )}
          </p>
        )}
        {phase.kind === 'done' && phase.waitedOut > 0 && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t('waitedOut', { count: phase.waitedOut })}
          </p>
        )}
        {skipped > 0 && !failure && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t('skipped', { count: skipped })}
          </p>
        )}
        {failure && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {failureText(failure)}
          </p>
        )}

        <DialogFooter className="gap-2">
          {after ? (
            <Button onClick={onClose}>{t('close')}</Button>
          ) : phase.kind === 'readFailed' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setPhase({ kind: 'reading' });
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={phase.kind === 'sending'} onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button disabled={busy || ready.length === 0 || !target} onClick={() => void send()}>
                {phase.kind === 'sending' && <LoadingDots className="mr-1" />}
                {phase.kind === 'sending' ? t('sending') : t('send', { count: ready.length })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A page's line: why it can't go, or how its send went. */
function ItemState({
  item,
  delivery,
  after,
  sending,
  waiting,
}: {
  item: BulkItem;
  delivery: CmsDelivery | undefined;
  after: boolean;
  sending: boolean;
  /** Its request waits for the last one's pages to go. */
  waiting: boolean;
}) {
  const t = useTranslations('contentEditor.library.bulk');
  const muted = 'shrink-0 text-xs text-muted-foreground';
  if (item.problem) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {t(`problems.${item.problem}`)}
      </span>
    );
  }
  if (sending) return <LoadingDots className="shrink-0 text-muted-foreground" />;
  if (!after) {
    return (
      <span className={`flex items-center gap-1 ${muted}`}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ready')}
      </span>
    );
  }
  if (!delivery) return <span className={muted}>{t(waiting ? 'waiting' : 'notSent')}</span>;
  if (delivery.status === 'queued') return <span className={muted}>{t('queued')}</span>;
  if (delivery.status === 'failed') {
    return (
      <span
        className="shrink-0 text-right text-xs text-red-700 dark:text-red-400"
        title={delivery.error ?? undefined}
      >
        {/* What the webhook answered when it refused the page; a workflow's
            failure after a 2xx is Failed, its reason on hover. */}
        {delivery.http_status && (delivery.http_status < 200 || delivery.http_status > 299)
          ? t('answered', { status: delivery.http_status })
          : t('failed')}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-green-700 dark:text-green-400">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      {t('sent')}
    </span>
  );
}
