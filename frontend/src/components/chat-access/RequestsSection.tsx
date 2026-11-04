'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  decideAccessRequest,
  listAccessRequests,
  withdrawAccessRequest,
  type DecideAccessResult,
} from '@/lib/actions/chatAccessRequests';
import type { AccessRequest } from '@/lib/chat/accessRequests';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<AccessRequest['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  rejected: 'bg-muted text-muted-foreground',
  withdrawn: 'bg-muted text-muted-foreground',
};

/**
 * Roles & access › Requests (CHAT-20 §4c, P0 decision 12): an Admin sees the
 * workspace's Ask your Admin requests and approves or dismisses them; anyone
 * else sees their own and may withdraw one while it waits. `version` reads
 * them again (a request just sent); `onChanged` tells the page a count moved.
 */
export function RequestsSection({
  version = 0,
  onChanged,
}: {
  version?: number;
  onChanged?: () => void;
}) {
  const t = useTranslations('chatAccess.requests');
  const format = useFormatter();
  const [data, setData] = useState<
    { isAdmin: boolean; requests: AccessRequest[] } | 'failed' | null
  >(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listAccessRequests()
      .then((read) => {
        if (!live) return;
        if (read.ok) setData({ isAdmin: read.isAdmin, requests: read.requests });
        // Chat off: nothing to list; a failed read says so.
        else setData(read.failure === 'failed' ? 'failed' : null);
      })
      .catch(() => {
        if (live) setData('failed');
      });
    return () => {
      live = false;
    };
  }, [version, reload]);

  if (!data) return null;
  if (data === 'failed') {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('loadError')}</span>
        <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  const pending = data.requests.filter((r) => r.status === 'pending').length;

  async function act(id: string, run: () => Promise<DecideAccessResult>, done: string) {
    setBusy(id);
    try {
      const result = await run();
      if (result.ok) toast.success(done);
      else if (result.reason === 'not_saved')
        toast.error(t('notSaved', { reason: result.message }));
      else toast.info(t('alreadyDecided'));
      setReload((n) => n + 1);
      onChanged?.();
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="chat-access-requests">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="chat-access-requests" className="text-sm font-semibold">
          {data.isAdmin ? t('title') : t('yours')}
        </h3>
        {pending > 0 && (
          <Badge className="tabular-nums" aria-label={t('status.pending')}>
            {pending}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {data.isAdmin ? t('lead') : t('leadYours')}
        </span>
      </div>
      {data.requests.length === 0 ? (
        <p className="rounded-xl border px-3.5 py-3 text-sm text-muted-foreground">
          {data.isAdmin ? t('empty') : t('emptyYours')}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {data.requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-col gap-2 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{request.asked}</p>
                {request.draftedText && (
                  <p className="text-xs break-words text-muted-foreground">
                    {t('saves', { text: request.draftedText })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {[
                    data.isAdmin && t('from', { name: request.requester }),
                    request.ruleDetail,
                    format.relativeTime(new Date(request.createdAt)),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[request.status])}
                >
                  {t(`status.${request.status}`)}
                </span>
                {request.status === 'pending' && data.isAdmin && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy === request.id}
                      onClick={() =>
                        void act(
                          request.id,
                          () => decideAccessRequest(request.id, 'approved'),
                          request.draftedText ? t('approvedSaved') : t('approved'),
                        )
                      }
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === request.id}
                      onClick={() =>
                        void act(
                          request.id,
                          () => decideAccessRequest(request.id, 'rejected'),
                          t('dismissed'),
                        )
                      }
                    >
                      {t('dismiss')}
                    </Button>
                  </>
                )}
                {request.status === 'pending' && !data.isAdmin && request.isYours && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === request.id}
                    onClick={() =>
                      void act(
                        request.id,
                        async () =>
                          (await withdrawAccessRequest(request.id))
                            ? { ok: true }
                            : { ok: false, reason: 'already_decided' },
                        t('withdrawn'),
                      )
                    }
                  >
                    {t('withdraw')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
