'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import { hiddenCount, markHidden } from '@/lib/chat/skills/hiddenMarks';
import type { SkillReview as Review } from '@/lib/chat/skills/store';
import { cn } from '@/lib/utils';

/** A review card's look (mockup `#s-skill-review .card`). */
export const CARD = 'rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]';
export const CARD_HEAD = 'flex items-center gap-2 border-b px-4 py-2.5 text-[13px] font-semibold';
export const PILL =
  'ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground';

/** The status pill's colors, as the Skills page's badges. */
const STATUS_TONE: Record<Review['status'], string> = {
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  rejected: 'bg-muted text-muted-foreground',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
};

/**
 * Reviewing an imported skill (CHAT-13 items 15–18, W3-09; mockup
 * `#s-skill-review`): its cleaned SKILL.md as plain text, each hidden
 * character marked where it sits; what the safety scan found (Blocks it,
 * Worth a look); what was removed before review; and where it came from,
 * its commit and license. An Admin approves or rejects it; a blocked one
 * can only be rejected. Its creator sees it too, waiting on an Admin.
 */
export function SkillReview({ id }: { id: string }) {
  const t = useTranslations('chatSkills.reviewPage');
  const format = useFormatter();
  const router = useRouter();
  const [review, setReview] = useState<Review | null | 'failed' | 'missing'>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void fetch(`/api/chat/skills/${encodeURIComponent(id)}/review`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          review?: Review;
        } | null;
        if (!current) return;
        if (res.ok && body?.ok && body.review) setReview(body.review);
        else setReview(res.status === 404 ? 'missing' : 'failed');
      })
      .catch(() => {
        if (current) setReview('failed');
      });
    return () => {
      current = false;
    };
  }, [id, version]);

  const pieces = useMemo(
    () => (review && typeof review === 'object' ? markHidden(review.body) : []),
    [review],
  );

  async function decide(decision: 'approve' | 'reject') {
    if (!review || typeof review !== 'object' || busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/skills/${encodeURIComponent(review.id)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok) {
      toast.error(body?.error ?? t('failed'));
      return;
    }
    toast.success(t(decision === 'approve' ? 'approved' : 'rejected', { name: review.name }));
    if (decision === 'approve') router.push('/dashboard/chat/skills');
    else setVersion((v) => v + 1);
  }

  const back = (
    <Link
      href="/dashboard/chat/skills"
      data-action="skillReview.back"
      className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {t('back')}
    </Link>
  );

  if (review === null) {
    return (
      <div className="max-w-[1100px]" aria-busy>
        {back}
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 grid gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-[420px] rounded-[14px]" />
          <Skeleton className="h-[420px] rounded-[14px]" />
        </div>
      </div>
    );
  }
  if (review === 'failed' || review === 'missing') {
    return (
      <div className="max-w-[1100px]">
        {back}
        <p className="rounded-[14px] border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(review === 'missing' ? 'notFound' : 'loadFailed')}
        </p>
      </div>
    );
  }

  const hidden = hiddenCount(pieces);
  const decided = review.status === 'approved' || review.status === 'rejected';
  return (
    <div className="max-w-[1100px]" data-slot="skill-review" data-status={review.status}>
      {back}
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
        <span
          data-slot="review-status"
          className={cn(
            'ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium',
            STATUS_TONE[review.status],
          )}
        >
          {t(`status.${review.status}`)}
        </span>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
        {t('subtitle', { name: review.name, description: review.description })}
      </p>

      <div className="grid items-start gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className={CARD} aria-labelledby="review-cleaned">
          <div className={CARD_HEAD}>
            <span id="review-cleaned">{t('cleaned')}</span>
            <span className={PILL}>{t('plain')}</span>
          </div>
          {hidden > 0 && (
            <p className="border-b bg-red-50/60 px-4 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300">
              {t('hidden', { count: hidden })}
            </p>
          )}
          <pre
            data-slot="review-body"
            className="max-h-[560px] overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {pieces.map((piece, i) =>
              'hidden' in piece ? (
                <mark
                  key={i}
                  data-slot="hidden-char"
                  title={piece.code}
                  className="mx-px rounded bg-red-100 px-1 text-[11px] text-red-800 dark:bg-red-950/60 dark:text-red-300"
                >
                  {piece.code}
                </mark>
              ) : (
                <span key={i}>{piece.text}</span>
              ),
            )}
          </pre>
        </section>

        <div className="grid gap-3">
          <section className={CARD} aria-labelledby="review-scan">
            <div className={CARD_HEAD}>
              <span id="review-scan">{t('scan')}</span>
            </div>
            <div className="grid gap-2 px-4 py-3 text-[13px]">
              {review.scan.blocks.length === 0 && review.scan.warns.length === 0 ? (
                <p className="text-muted-foreground">{t('clean')}</p>
              ) : (
                <>
                  <ScanList
                    title={t('blocks')}
                    items={review.scan.blocks}
                    tone="text-red-700 dark:text-red-400"
                    slot="scan-blocks"
                  />
                  <ScanList
                    title={t('warns')}
                    items={review.scan.warns}
                    tone="text-amber-700 dark:text-amber-400"
                    slot="scan-warns"
                  />
                </>
              )}
            </div>
          </section>

          <section className={CARD} aria-labelledby="review-removed">
            <div className={CARD_HEAD}>
              <span id="review-removed">{t('removed')}</span>
            </div>
            <div className="px-4 py-3 text-[13px]" data-slot="review-removed">
              {review.removed.length === 0 ? (
                <p className="text-muted-foreground">{t('nothingRemoved')}</p>
              ) : (
                <ul className="list-disc space-y-0.5 pl-4">
                  {review.removed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={CARD} aria-labelledby="review-source">
            <div className={CARD_HEAD}>
              <span id="review-source">{t('source')}</span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
              <dt className="text-muted-foreground">{t('from')}</dt>
              <dd className="[overflow-wrap:anywhere]">
                {review.sourceUrl ? (
                  <a
                    href={review.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-2"
                  >
                    {review.sourceUrl.replace(/^https:\/\//, '')}
                  </a>
                ) : (
                  t('upload')
                )}
              </dd>
              {review.commitSha && (
                <>
                  <dt className="text-muted-foreground">{t('commit')}</dt>
                  <dd>
                    <code className="text-[12px]">{review.commitSha.slice(0, 7)}</code>
                  </dd>
                </>
              )}
              {review.license && (
                <>
                  <dt className="text-muted-foreground">{t('license')}</dt>
                  <dd>{review.license}</dd>
                </>
              )}
            </dl>
            {review.licenseText && (
              <details className="border-t px-4 py-2.5 text-[12.5px]">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('licenseText')}
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap">
                  {review.licenseText}
                </pre>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
              <span className="text-xs text-muted-foreground" data-slot="review-note">
                {decided && review.approvedAt
                  ? t('decided', {
                      status: t(`status.${review.status}`),
                      date: format.dateTime(new Date(review.approvedAt), { dateStyle: 'medium' }),
                    })
                  : review.status === 'blocked'
                    ? t('blockedNote')
                    : review.status === 'pending_review' && !review.can.approve
                      ? t('waitingNote')
                      : null}
              </span>
              <div className="ml-auto flex gap-2">
                {review.can.reject && (
                  <Button
                    variant="outline"
                    data-action="skillReview.reject"
                    disabled={busy}
                    onClick={() => void decide('reject')}
                  >
                    {t('reject')}
                  </Button>
                )}
                {review.can.approve && (
                  <Button
                    data-action="skillReview.approve"
                    disabled={busy}
                    onClick={() => void decide('approve')}
                  >
                    {t('approve')}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One list of what the safety scan found, under its title; nothing when it is empty. */
export function ScanList({
  title,
  items,
  tone,
  slot,
}: {
  title: string;
  items: string[];
  tone: string;
  slot: string;
}) {
  if (items.length === 0) return null;
  return (
    <div data-slot={slot}>
      <p className={cn('text-xs font-semibold', tone)}>{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
