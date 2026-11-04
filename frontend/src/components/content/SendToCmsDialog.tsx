'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Textarea } from '@/components/ui/textarea';
import type { ContentAuthor } from '@/lib/content/authors';
import {
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  cmsFields,
  cmsFieldsProblem,
  cmsPage,
  cmsPageProblem,
  type CmsFields,
} from '@/lib/content/cmsSend';
import {
  readDraftCms,
  sendPagesToCms,
  type CmsSendError,
  type CmsTarget,
  type DraftCms,
} from '@/lib/content/cmsSendClient';
import { exportPlaceholders, pageFields, titlePlaceholders } from '@/lib/content/readyToPublish';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { CmsTargetPicker, CmsTargetUnchecked, useCmsTarget } from './CmsTarget';

/**
 * Send to CMS (#1331): the page to the brand's webhook, for the workspace's
 * CMS or automation to publish, to its Webflow or Framer collection as a
 * draft item, or to its WordPress site as a draft post (phase 2, when
 * Settings has them ready). Its slug and meta are filled from the page,
 * or what the draft kept, and editable; they stay on the draft. The page
 * goes as Export makes it ready (CE-057): no placeholder goes, so they are
 * filled first. From the editor's header and a Library row; rendered only
 * while open, on the page as it was then.
 */
export function SendDialog({
  draftId,
  brandId,
  title,
  html,
  sourceUrl,
  author,
  reviewer,
  teamByline,
  byline,
  onFillNow,
  onClose,
  onSent,
}: {
  draftId: string;
  brandId: string;
  title: string;
  /** The page as Copy HTML gives it (publishableHtml). */
  html: string;
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** The qualified reviewer, distinct from the page author. */
  reviewer: ContentAuthor | null;
  /** The brand's team in the page's language (teamName); empty while the authors aren't read. */
  teamByline: string;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
  /** Goes to the first placeholder, to fill it. */
  onFillNow: () => void;
  onClose: () => void;
  /** The page went: where, and how it stands (the editor's header says so). */
  onSent?: (last: NonNullable<DraftCms['last']>) => void;
}) {
  const t = useTranslations('contentEditor.editor.send');
  const tFailure = useTranslations('apiFailure');
  const { openUpgrade } = useUpgradeGate();
  const format = useFormatter();
  const page = useMemo(
    () => pageFields({ title, html, sourceUrl, author, reviewer, teamByline }),
    [title, html, sourceUrl, author, reviewer, teamByline],
  );
  const placeholders = useMemo(
    () => exportPlaceholders(html) + titlePlaceholders(title, html),
    [html, title],
  );
  const pageProblem = useMemo(() => cmsPageProblem(title, html), [title, html]);
  // Undefined while the draft's kept fields are read; null when they couldn't be.
  const [kept, setKept] = useState<DraftCms | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [fields, setFields] = useState<CmsFields>(() => cmsFields(page, null));
  // The fields the person changed: a ref, so the read that comes in after a
  // change sees it. The rest take what the draft kept (its slug above all,
  // or the CMS could get the page twice).
  const touched = useRef(new Set<keyof CmsFields>());
  const [sending, setSending] = useState(false);
  // Fill now: the editor selects the placeholder, so focus stays there.
  const filling = useRef(false);
  // With the target it went to: picking another clears it, a read again may not.
  const [problem, setProblem] = useState<
    | { code: CmsSendError; field: string | null; target: CmsTarget }
    | { status: number }
    | { failed: string; target: CmsTarget }
    | null
  >(null);
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
  const collection = webflow?.ready ? webflow.collection || t('target.webflow.collection') : '';
  const site = wordpress?.ready ? wordpress.site : '';
  const framerCollection = framer?.ready ? framer.collection || t('target.framer.collection') : '';
  const wixSite = wix?.ready ? wix.site : '';

  useEffect(() => {
    let cancelled = false;
    readDraftCms(draftId)
      .then((read) => {
        if (cancelled) return;
        setKept(read);
        setRetrying(false);
        // What the draft kept, in each field the person hasn't changed.
        if (!read) return;
        const fromKept = cmsFields(page, read.fields);
        setFields((prev) => ({
          slug: touched.current.has('slug') ? prev.slug : fromKept.slug,
          metaTitle: touched.current.has('metaTitle') ? prev.metaTitle : fromKept.metaTitle,
          metaDescription: touched.current.has('metaDescription')
            ? prev.metaDescription
            : fromKept.metaDescription,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setKept(null);
        setRetrying(false);
      });
    return () => {
      cancelled = true;
    };
    // Read as it opens, and on Try again; the fields it fills are the person's after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, attempt]);

  const change = (key: keyof CmsFields, value: string) => {
    touched.current.add(key);
    setProblem(null);
    setFields((prev) => ({ ...prev, [key]: value }));
  };
  const wrong = cmsFieldsProblem(fields);
  // An empty slug (a title in another script gives none) asks for one, not a fix.
  const slugEmpty = fields.slug.trim() === '';
  const slugWrong = wrong === 'slug' && !slugEmpty;

  const send = async () => {
    if (!target) return;
    setSending(true);
    setProblem(null);
    const result = await sendPagesToCms(
      brandId,
      [cmsPage({ draftId, title, html, fields, page, byline, reviewer })],
      target,
    );
    setSending(false);
    if (!result.ok) {
      // A read-only workspace: the upgrade dialog, with the reason kept here.
      if (result.code === 'subscription') openUpgrade();
      setProblem({ code: result.code, field: result.field, target });
      return;
    }
    const [delivery] = result.deliveries;
    if (delivery?.status === 'failed') {
      // What the webhook answered when it refused the page; else why it
      // failed: not reached, or the workflow's own reason in a callback
      // after it took the page (a 2xx).
      const refused =
        delivery.http_status && (delivery.http_status < 200 || delivery.http_status > 299);
      setProblem(
        refused
          ? { status: delivery.http_status! }
          : { failed: delivery.error ?? t('errors.failed'), target },
      );
      // The header says it failed too, with why, as the page's last send.
      onSent?.({
        status: 'failed',
        target,
        at: new Date().toISOString(),
        error:
          delivery.error ??
          (refused
            ? t('errors.webhookStatus', { status: delivery.http_status! })
            : t('errors.failed')),
      });
      return;
    }
    keepTarget(target);
    onSent?.({
      status: delivery?.status ?? 'sent',
      target,
      at: new Date().toISOString(),
      error: null,
    });
    if (target === 'webflow') {
      // What of the page Webflow's rich text couldn't keep: tables went as lists, images not yet.
      const changed = delivery?.changed;
      toast.success(delivery?.updated ? t('sentWebflowUpdated') : t('sentWebflow'), {
        description:
          changed && (changed.tables || changed.images)
            ? t('webflowChanged', { tables: changed.tables ?? 0, images: changed.images ?? 0 })
            : undefined,
      });
    } else if (target === 'wordpress') {
      // A live post isn't written to: the page went as a new draft. Its
      // JSON-LD stays out (WordPress would keep it as text).
      const notes = [
        delivery?.live ? t('wordpressLive') : null,
        delivery?.changed?.jsonLd ? t('wordpressJsonLd') : null,
      ].filter((note) => note !== null);
      toast.success(delivery?.updated ? t('sentWordPressUpdated') : t('sentWordPress'), {
        description: notes.length ? notes.join(' ') : undefined,
      });
    } else if (target === 'framer') {
      // Images don't go to Framer's formatted text yet. An item updated that
      // isn't a draft is published there: the change goes live with the
      // site's next publish.
      const images = delivery?.changed?.images ?? 0;
      const notes = [
        images ? t('framerImages', { images }) : null,
        delivery?.live ? t('framerLive') : null,
      ].filter((note) => note !== null);
      toast.success(delivery?.updated ? t('sentFramerUpdated') : t('sentFramer'), {
        description: notes.length ? notes.join(' ') : undefined,
      });
    } else if (target === 'wix') {
      // Images don't go to Wix (only its Media Manager's show).
      const images = delivery?.changed?.images ?? 0;
      toast.success(delivery?.updated ? t('sentWixUpdated') : t('sentWix'), {
        description: images ? t('wixImages', { images }) : undefined,
      });
    } else {
      toast.success(t('sent'));
    }
    onClose();
  };

  const problemText = (shown: NonNullable<typeof problem>) => {
    if ('status' in shown) return t('errors.webhookStatus', { status: shown.status });
    if ('failed' in shown) {
      const failed = {
        webflow: 'errors.webflowFailed',
        wordpress: 'errors.wordpressFailed',
        framer: 'errors.framerFailed',
        wix: 'errors.wixFailed',
        webhook: 'errors.webhookFailed',
      } as const;
      return t(failed[shown.target], { reason: shown.failed });
    }
    const { code, field } = shown;
    if (code === 'session' || code === 'workspace' || code === 'busy' || code === 'subscription') {
      return tFailure(code);
    }
    // No CMS ready sent the page to the webhook: what to fix is the one connected.
    if (
      code === 'no_webhook' &&
      !webflow?.ready &&
      !wordpress?.ready &&
      !framer?.ready &&
      !wix?.ready
    ) {
      if (webflow) return t('errors.no_webhookWebflow');
      if (wordpress) return t('errors.no_webhookWordPress');
      if (framer) return t('errors.no_webhookFramer');
      if (wix) return t('errors.no_webhookWix');
    }
    if (code === 'in_progress' && shown.target === 'wordpress') {
      return t('errors.in_progressWordPress');
    }
    if (code === 'in_progress' && shown.target === 'framer') {
      return t('errors.in_progressFramer');
    }
    if (code === 'in_progress' && shown.target === 'wix') {
      return t('errors.in_progressWix');
    }
    // The server names the path ("pages.0.slug"); the field is its last part.
    if (code === 'invalid' && field) {
      return t('errors.invalidField', { field: field.split('.').pop() ?? 'other' });
    }
    return t(`errors.${code}`);
  };

  const live = kept?.publishedUrl ?? null;
  const last = kept?.last ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        finalFocus={() => !filling.current}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {!target
              ? t('descriptionReading')
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

        {(webflow || wordpress || framer || wix) && target && (
          <CmsTargetPicker
            value={target}
            webflow={webflow}
            wordpress={wordpress}
            framer={framer}
            wix={wix}
            disabled={sending}
            onChange={(next) => {
              pick(next);
              setProblem(null);
            }}
          />
        )}
        {targetUnchecked && (
          <CmsTargetUnchecked
            target={targetUnchecked}
            reading={targetReading}
            onRetry={retryTarget}
            disabled={sending}
          />
        )}

        {pageProblem && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="min-w-0 flex-1">{t(pageProblem)}</span>
          </div>
        )}

        {placeholders > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="min-w-0 flex-1">{t('placeholders', { count: placeholders })}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                filling.current = true;
                onFillNow();
              }}
            >
              {t('fillNow')}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('fields.title')}</p>
            <p className="text-sm [overflow-wrap:anywhere]">{title.trim() || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('fields.author')}</p>
            <p className="text-sm [overflow-wrap:anywhere]">{page.author || '—'}</p>
          </div>
          {page.reviewer && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('fields.reviewer')}</p>
              <p className="text-sm [overflow-wrap:anywhere]">{page.reviewer}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="cms-slug">{t('fields.slug')}</Label>
            <Input
              id="cms-slug"
              required
              value={fields.slug}
              onChange={(e) => change('slug', e.target.value)}
              aria-invalid={slugWrong || undefined}
              aria-describedby="cms-slug-hint"
            />
            <p
              id="cms-slug-hint"
              className={
                slugWrong
                  ? 'text-xs text-red-700 dark:text-red-400'
                  : 'text-xs text-muted-foreground'
              }
            >
              {slugWrong
                ? t('fields.slugInvalid')
                : slugEmpty
                  ? t('fields.slugEmpty')
                  : t('fields.slugHint')}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cms-meta-title">{t('fields.metaTitle')}</Label>
            <Input
              id="cms-meta-title"
              value={fields.metaTitle}
              maxLength={META_TITLE_MAX}
              onChange={(e) => change('metaTitle', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cms-meta-description">{t('fields.metaDescription')}</Label>
            <Textarea
              id="cms-meta-description"
              value={fields.metaDescription}
              maxLength={META_DESCRIPTION_MAX}
              rows={3}
              onChange={(e) => change('metaDescription', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('fields.characters', { count: fields.metaDescription.trim().length })}
            </p>
          </div>
        </div>

        {(live || last) && (
          <p className="text-xs text-muted-foreground">
            {live ? (
              <>
                {t('live')}{' '}
                <a
                  href={live}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-foreground underline underline-offset-2 [overflow-wrap:anywhere]"
                >
                  {live}
                </a>
              </>
            ) : (
              last &&
              t(
                last.target === 'webflow'
                  ? `lastWebflow.${last.status}`
                  : last.target === 'wordpress'
                    ? `lastWordPress.${last.status}`
                    : last.target === 'framer'
                      ? `lastFramer.${last.status}`
                      : last.target === 'wix'
                        ? `lastWix.${last.status}`
                        : `last.${last.status}`,
                {
                  when: format.dateTime(new Date(last.at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                },
              )
            )}
          </p>
        )}

        {/* Unread, a page sent before under another slug could land in the
            CMS twice: the send waits for the read (as the bulk send does). */}
        {kept === null && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-red-700 dark:text-red-400"
          >
            <span className="min-w-0 flex-1">{t('readFailed')}</span>
            {/* Kept in place while it reads again, so focus stays on it. */}
            <Button
              size="sm"
              variant="outline"
              disabled={retrying}
              aria-label={t('retry')}
              onClick={() => {
                setRetrying(true);
                setAttempt((n) => n + 1);
              }}
            >
              {retrying ? <LoadingDots /> : t('retry')}
            </Button>
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problemText(problem)}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={sending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={
              sending ||
              pageProblem !== null ||
              placeholders > 0 ||
              wrong !== null ||
              !kept ||
              !target
            }
            onClick={() => void send()}
          >
            {sending && <LoadingDots className="mr-1" />}
            {sending ? t('sending') : t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
