'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import { diffLines } from '@/lib/chat/skills/lineDiff';
import type { SkillUpdate as Update, SkillVersion } from '@/lib/chat/skills/updates';
import { cn } from '@/lib/utils';
import { CARD, CARD_HEAD, PILL, ScanList } from './SkillReview';

const LINE_TONE = {
  same: 'text-muted-foreground',
  removed: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
  added: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
} as const;
const LINE_SIGN = { same: ' ', removed: '−', added: '+' } as const;

/** The fields shown above the steps when they changed. */
const FIELDS = [
  'title',
  'description',
  'license',
] as const satisfies readonly (keyof SkillVersion)[];

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '—');

/**
 * An imported skill's update (CHAT-13 items 16 and 19, W4-31): its source
 * has a new SKILL.md. What changed, field by field, then its steps line by
 * line (− in use, + new); the safety scan of the new version and what its
 * cleanup removed; its source from the commit in use to the new one. An
 * Admin approves it (it is read, cleaned and scanned again first); a
 * blocked scan keeps the version in use. Its creator sees it, waiting on
 * an Admin.
 */
export function SkillUpdate({ id }: { id: string }) {
  const t = useTranslations('chatSkills.update');
  const tReview = useTranslations('chatSkills.reviewPage');
  const router = useRouter();
  const [update, setUpdate] = useState<Update | null | 'failed' | 'missing'>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void fetch(`/api/chat/skills/${encodeURIComponent(id)}/update`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          update?: Update;
        } | null;
        if (!current) return;
        if (res.ok && body?.ok && body.update) setUpdate(body.update);
        else setUpdate(res.status === 404 || res.status === 409 ? 'missing' : 'failed');
      })
      .catch(() => {
        if (current) setUpdate('failed');
      });
    return () => {
      current = false;
    };
  }, [id]);

  const lines = useMemo(
    () =>
      update && typeof update === 'object' ? diffLines(update.current.body, update.next.body) : [],
    [update],
  );

  async function approve() {
    if (!update || typeof update !== 'object' || busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/skills/${encodeURIComponent(update.id)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateSha: update.updateSha }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok) {
      toast.error(body?.error ?? t('failed'));
      return;
    }
    toast.success(t('approved', { name: update.name }));
    router.push('/dashboard/chat/skills');
  }

  const back = (
    <Link
      href="/dashboard/chat/skills"
      data-action="skillUpdate.back"
      className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {tReview('back')}
    </Link>
  );

  if (update === null) {
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
  if (update === 'failed' || update === 'missing') {
    return (
      <div className="max-w-[1100px]">
        {back}
        <p className="rounded-[14px] border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(update === 'missing' ? 'none' : 'loadFailed')}
        </p>
      </div>
    );
  }

  const changed = FIELDS.filter((field) => update.current[field] !== update.next[field]);
  const blocked = update.scan.blocks.length > 0;
  return (
    <div className="max-w-[1100px]" data-slot="skill-update">
      {back}
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title', { name: update.name })}</h1>
        <span
          data-slot="update-badge"
          className="ml-auto rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
        >
          {t('badge')}
        </span>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">{t('subtitle')}</p>

      <div className="grid items-start gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className={CARD} aria-labelledby="update-changes">
          <div className={CARD_HEAD}>
            <span id="update-changes">{t('changes')}</span>
            <span className={PILL}>{tReview('plain')}</span>
          </div>
          {changed.length > 0 && (
            <dl
              data-slot="update-fields"
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-b px-4 py-3 text-[13px]"
            >
              {changed.map((field) => (
                <div key={field} className="contents">
                  <dt className="text-muted-foreground">{t(`fields.${field}`)}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    <span className="text-red-700 line-through dark:text-red-400">
                      {update.current[field] ?? '—'}
                    </span>{' '}
                    → <span>{update.next[field] ?? '—'}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="border-b px-4 py-2 text-xs font-semibold">{t('steps')}</p>
          <pre
            data-slot="update-diff"
            className="max-h-[560px] overflow-auto py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {lines.map((line, i) => (
              <div
                key={i}
                data-kind={line.kind}
                className={cn('flex gap-2 px-4', LINE_TONE[line.kind])}
              >
                <span aria-hidden className="w-3 shrink-0 select-none">
                  {LINE_SIGN[line.kind]}
                </span>
                <span className="sr-only">{t(`line.${line.kind}`)}</span>
                <span className="min-w-0">{line.text || ' '}</span>
              </div>
            ))}
          </pre>
        </section>

        <div className="grid gap-3">
          <section className={CARD} aria-labelledby="update-scan">
            <div className={CARD_HEAD}>
              <span id="update-scan">{tReview('scan')}</span>
            </div>
            <div className="grid gap-2 px-4 py-3 text-[13px]">
              {update.scan.blocks.length === 0 && update.scan.warns.length === 0 ? (
                <p className="text-muted-foreground">{tReview('clean')}</p>
              ) : (
                <>
                  <ScanList
                    title={tReview('blocks')}
                    items={update.scan.blocks}
                    tone="text-red-700 dark:text-red-400"
                    slot="scan-blocks"
                  />
                  <ScanList
                    title={tReview('warns')}
                    items={update.scan.warns}
                    tone="text-amber-700 dark:text-amber-400"
                    slot="scan-warns"
                  />
                </>
              )}
            </div>
          </section>

          <section className={CARD} aria-labelledby="update-removed">
            <div className={CARD_HEAD}>
              <span id="update-removed">{tReview('removed')}</span>
            </div>
            <div className="px-4 py-3 text-[13px]">
              {update.removed.length === 0 ? (
                <p className="text-muted-foreground">{tReview('nothingRemoved')}</p>
              ) : (
                <ul className="list-disc space-y-0.5 pl-4">
                  {update.removed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={CARD} aria-labelledby="update-source">
            <div className={CARD_HEAD}>
              <span id="update-source">{tReview('source')}</span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
              <dt className="text-muted-foreground">{tReview('from')}</dt>
              <dd className="[overflow-wrap:anywhere]">
                <a
                  href={update.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2"
                >
                  {update.sourceUrl.replace(/^https:\/\//, '')}
                </a>
              </dd>
              <dt className="text-muted-foreground">{tReview('commit')}</dt>
              <dd>
                <code className="text-[12px]" data-slot="update-commits">
                  {t('commits', { from: short(update.commitSha), to: short(update.updateSha) })}
                </code>
              </dd>
            </dl>
            <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
              <span className="text-xs text-muted-foreground" data-slot="update-note">
                {blocked
                  ? t('blockedNote', { name: update.name })
                  : update.can.approve
                    ? t('approveNote')
                    : t('waitingNote')}
              </span>
              {update.can.approve && (
                <Button
                  className="ml-auto"
                  data-action="skillUpdate.approve"
                  disabled={busy}
                  onClick={() => void approve()}
                >
                  {t('approve')}
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
