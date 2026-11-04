'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronDown, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ContentAuthor } from '@/lib/content/authors';
import {
  DRAFT_EXPORT_FORMATS,
  draftExportBlob,
  draftExportFileName,
  draftText,
  type DraftExportFormat,
  type ExportFields,
} from '@/lib/content/draftExport';
import { localDate } from '@/lib/content/pageSchema';
import {
  exportPlaceholders,
  pageFields,
  titlePlaceholders,
  withByline,
  withoutLeadingH1,
  withoutPlaceholders,
  withReviewerJsonLd,
  type PasteChecks,
} from '@/lib/content/readyToPublish';
import { ExportFormatIcon } from '@/components/content/ExportFormatIcon';
import { saveBlob } from '@/lib/download';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { exportAuthor, exportFileWord } from '@/lib/white-label/exportName';
import { cn } from '@/lib/utils';
import { copyToClipboard } from './_HtmlBlock';

/**
 * Where the page goes (Quality spec §7b), and how: a file to save (Word,
 * Excel, CSV, Markdown; HTML copied, or saved), or pasted rich into a
 * platform's editor. The platforms fold away under the files: more come as
 * integrations land.
 */
const PLATFORMS = ['webflow', 'wordpress', 'shopify', 'docs'] as const;
type Platform = (typeof PLATFORMS)[number];
const DESTINATIONS = [...DRAFT_EXPORT_FORMATS, ...PLATFORMS] as const;
export type ExportDestination = (typeof DESTINATIONS)[number];
const FILES: Partial<Record<ExportDestination, DraftExportFormat>> = {
  docx: 'docx',
  xlsx: 'xlsx',
  csv: 'csv',
  md: 'md',
};
/** Each platform's site, for its logo (its favicon, as citations show sites). */
const PLATFORM_SITES: Record<Platform, string> = {
  webflow: 'webflow.com',
  wordpress: 'wordpress.org',
  shopify: 'shopify.com',
  docs: 'docs.google.com',
};
const isPlatform = (d: ExportDestination): d is Platform =>
  (PLATFORMS as readonly string[]).includes(d);
/**
 * Destinations whose title field holds the page's title: its H1 isn't in
 * the content too (Markdown's front matter has it: draftMarkdown leaves it out).
 */
const TITLE_FIELD = new Set<ExportDestination>(['webflow', 'wordpress', 'shopify']);

/** Remembers the destination last picked, across drafts. */
const DESTINATION_KEY = 'aeo:content-export-destination';

function storedDestination(): ExportDestination {
  try {
    const stored = localStorage.getItem(DESTINATION_KEY);
    if (stored && (DESTINATIONS as readonly string[]).includes(stored)) {
      return stored as ExportDestination;
    }
  } catch {
    // Storage unavailable: the first one.
  }
  return 'docx';
}

/** A destination's mark: a file's icon in its colour (the pill's own when picked), a platform's logo. */
function DestinationIcon({
  destination,
  picked,
}: {
  destination: ExportDestination;
  picked: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (isPlatform(destination)) {
    // Its logo didn't load (blocked, offline): a globe, as a site's favicon falls back to.
    if (failed) return <Globe aria-hidden className="h-3.5 w-3.5 shrink-0" />;
    return (
      <Image
        src={getSiteIconUrl(PLATFORM_SITES[destination], 32)}
        alt=""
        width={14}
        height={14}
        unoptimized
        className="h-3.5 w-3.5 rounded-sm bg-white object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return <ExportFormatIcon format={destination} plain={picked} />;
}

/**
 * The page on the clipboard as rich text (and its words as plain text), as
 * a CMS's editor or Google Docs pastes it: through the Clipboard API, else a
 * copy event. Says whether it got there as rich text.
 */
async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Refused (an older browser, no permission): the copy event below.
  }
  const put = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/html', html);
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };
  document.addEventListener('copy', put);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', put);
  }
}

type RowState = 'ok' | 'missing' | 'check';

/**
 * Export (Content Editor Quality spec §7b, CE-057): the page ready to paste
 * or to save, for the destination picked. Its placeholders are filled first
 * or left out with their sentences (no export carries one; the title's and
 * the headings' are filled first); what it checks is listed (clean HTML,
 * links that answer, images with alt text); the page fields go next to it,
 * read from the page as it goes out, each with Copy. Rendered only while
 * open, on the page as it was when it opened.
 */
export function ExportDialog({
  onClose,
  title,
  html,
  isNew,
  sourceUrl,
  author,
  reviewer,
  teamByline,
  siteAuthor = false,
  byline,
  checks,
  linksPending,
  initialDestination,
  onFillNow,
  publish = null,
}: {
  onClose: () => void;
  title: string;
  /** The page as Copy HTML gives it (publishableHtml). */
  html: string;
  /** A new page; an optimized one is already live, with its published date. */
  isNew: boolean;
  /** The live page an optimized draft is for: its address is the slug. */
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** The qualified reviewer, separate from the page author. */
  reviewer: ContentAuthor | null;
  /** The team byline; empty while the authors aren't read, or for the site's own author. */
  teamByline: string;
  /** No author picked, the one the site names confirmed (00271): the CMS keeps its own. */
  siteAuthor?: boolean;
  /** The byline line the brand puts in the content (Add byline to content), or null. */
  byline: string | null;
  checks: PasteChecks;
  /** The page's links whose read may still come. */
  linksPending: number;
  /** Copy HTML's: the HTML destination. */
  initialDestination?: ExportDestination;
  /** Goes to the first placeholder, to fill it. */
  onFillNow: () => void;
  /**
   * What Before you publish has for this page (CE-041), with Review: Export
   * opens on its options, and names Trust under 60 or a missing author.
   */
  publish?: {
    trustBelow: number | null;
    noAuthor: boolean;
    /** The page puts the brand forward without saying the brand makes it (CE-050). */
    noDisclosure?: boolean;
    /** An article: Before you publish has its dates and JSON-LD too. */
    article: boolean;
    /** A product page (Phase 3, CE-053): Before you publish has its Product JSON-LD. */
    product?: boolean;
    /** A category page (Phase 3, CE-054): Before you publish has its ItemList JSON-LD. */
    itemList?: boolean;
    onReview: () => void;
  } | null;
}) {
  const t = useTranslations('contentEditor.editor.exportDialog');
  const [destination, setDestination] = useState<ExportDestination>(
    () => initialDestination ?? storedDestination(),
  );
  const [skipPlaceholders, setSkipPlaceholders] = useState(false);
  // Open when the page goes to a platform; folded away otherwise.
  const [platformsOpen, setPlatformsOpen] = useState(() => isPlatform(destination));
  const platformsId = useId();
  const radios = useRef<Partial<Record<ExportDestination, HTMLButtonElement | null>>>({});
  // Fill now: the editor selects the placeholder, so focus stays there.
  const filling = useRef(false);
  const fillNow = () => {
    filling.current = true;
    onFillNow();
  };
  const placeholders = useMemo(
    () => exportPlaceholders(html) + titlePlaceholders(title, html),
    [html, title],
  );
  const content = useMemo(
    () => (skipPlaceholders && placeholders ? withoutPlaceholders(html) : html),
    [skipPlaceholders, placeholders, html],
  );
  // What is still open once left out: the title's and the headings'.
  const left = useMemo(
    () =>
      skipPlaceholders
        ? exportPlaceholders(content) + titlePlaceholders(title, content)
        : placeholders,
    [skipPlaceholders, content, title, placeholders],
  );
  const ready = left === 0;
  const fields = useMemo(
    () => pageFields({ title, html: content, sourceUrl, author, reviewer, teamByline }),
    [title, content, sourceUrl, author, reviewer, teamByline],
  );
  // The brand's byline line under the H1; the qualified reviewer is page metadata,
  // with a WebPage.reviewedBy node once the page names them, never as article text.
  const withLine = useMemo(
    () => withReviewerJsonLd(title, byline ? withByline(content, byline) : content, reviewer),
    [byline, content, reviewer, title],
  );
  const out = TITLE_FIELD.has(destination) ? withoutLeadingH1(withLine) : withLine;

  const pick = (next: ExportDestination) => {
    setDestination(next);
    try {
      localStorage.setItem(DESTINATION_KEY, next);
    } catch {
      // The choice just won't be remembered.
    }
  };
  // Arrow keys move along a row's destinations, as in any radio group.
  const onRadioKey = (event: KeyboardEvent, row: readonly ExportDestination[], i: number) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const)[
      event.key as 'ArrowRight'
    ];
    if (!step) return;
    event.preventDefault();
    const next = row[(i + step + row.length) % row.length];
    pick(next);
    radios.current[next]?.focus();
  };
  // A row of destinations: one radio group, its picked one (else its first) the tab stop.
  const radioRow = (row: readonly ExportDestination[], label: string) => (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {row.map((d, i) => (
        <button
          key={d}
          ref={(el) => void (radios.current[d] = el)}
          type="button"
          role="radio"
          aria-checked={d === destination}
          tabIndex={(row.includes(destination) ? d === destination : i === 0) ? 0 : -1}
          onClick={() => pick(d)}
          onKeyDown={(event) => onRadioKey(event, row, i)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
            d === destination
              ? 'border-foreground bg-foreground text-background'
              : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <DestinationIcon destination={d} picked={d === destination} />
          {t(`destinations.${d}`)}
        </button>
      ))}
    </div>
  );
  const exportFields: ExportFields = {
    table: {
      note: t('fields.note'),
      rows: [
        [t('fields.metaTitle'), fields.metaTitle],
        [t('fields.metaDescription'), fields.metaDescription],
        ...(fields.slug ? [[t('fields.slug'), fields.slug] as [string, string]] : []),
        ...(fields.author ? [[t('fields.author'), fields.author] as [string, string]] : []),
        ...(fields.reviewer ? [[t('fields.reviewer'), fields.reviewer] as [string, string]] : []),
        ...(fields.featuredImage
          ? [[t('fields.featuredImage'), fields.featuredImage] as [string, string]]
          : []),
      ],
    },
    front: {
      title: fields.metaTitle,
      description: fields.metaDescription,
      slug: fields.slug,
      author: fields.author,
      ...(fields.reviewer ? { reviewed_by: fields.reviewer } : {}),
      // As Before you publish's JSON-LD: a live page keeps its published
      // date (a site's "date"), and today is when it was updated.
      ...(isNew ? { date: localDate(new Date()) } : { lastmod: localDate(new Date()) }),
      ...(fields.featuredImage ? { image: fields.featuredImage } : {}),
    },
    head: {
      title: fields.metaTitle,
      description: fields.metaDescription,
      author: fields.author,
      reviewer: fields.reviewer,
    },
  };
  const download = async (format: DraftExportFormat) => {
    const name = title.trim() || t('untitled');
    try {
      saveBlob(
        await draftExportBlob(format, name, withLine, exportFields, null, await exportAuthor()),
        draftExportFileName(name, format, await exportFileWord()),
      );
    } catch (err) {
      console.error('Failed to export the page:', err);
      toast.error(t('failed'));
    }
  };
  const act = async () => {
    const file = FILES[destination];
    if (file) return download(file);
    if (destination === 'html') return copyToClipboard(out, t('copiedHtml'), t('copyFailed'));
    if (await copyRich(out, draftText('', out))) {
      toast.success(t('copied', { destination: t(`destinations.${destination}`) }));
      return;
    }
    // No rich text here: the HTML, said as such, for the editor's code view.
    await copyToClipboard(out, t('copiedAsHtml'), t('copyFailed'));
  };

  const rows: { state: RowState; title: string; detail: string }[] = [
    checks.ownCode
      ? {
          state: 'check',
          title: t('checks.ownCode.title'),
          detail: t('checks.ownCode.detail', { count: checks.ownCode }),
        }
      : { state: 'ok', title: t('checks.clean.title'), detail: t('checks.clean.detail') },
  ];
  if (checks.links.count) {
    const { count, read, broken } = checks.links;
    // The reads still coming are for some of the unread links at most, as
    // Before you publish counts them: the rest couldn't be read.
    const reading = Math.min(linksPending, count - read);
    const notRead = count - read - reading;
    rows.push(
      broken
        ? {
            state: 'missing',
            title: t('checks.links.broken', { broken, count }),
            detail: t('checks.links.brokenDetail'),
          }
        : reading && notRead
          ? {
              state: 'check',
              title: t('checks.links.readingAndUnread', { reading, unread: notRead, count }),
              detail: t('checks.links.unreadDetail'),
            }
          : reading
            ? {
                state: 'check',
                title: t('checks.links.reading', { reading, count }),
                detail: t('checks.links.readingDetail'),
              }
            : notRead
              ? {
                  // Some couldn't be read: no word on whether they answer.
                  state: 'check',
                  title: t('checks.links.unread', { unread: notRead, count }),
                  detail: t('checks.links.unreadDetail'),
                }
              : {
                  state: 'ok',
                  title: t('checks.links.ok', { count }),
                  detail: t('checks.links.okDetail'),
                },
    );
  }
  if (checks.images.count) {
    rows.push(
      checks.images.withoutAlt
        ? {
            state: 'missing',
            title: t('checks.images.missing', {
              missing: checks.images.withoutAlt,
              count: checks.images.count,
            }),
            detail: t('checks.images.missingDetail'),
          }
        : {
            state: 'ok',
            title: t('checks.images.ok', { count: checks.images.count }),
            detail: t('checks.images.okDetail'),
          },
    );
  }
  const fieldRows: { label: string; value: string | null; shown?: string }[] = [
    { label: t('fields.metaTitle'), value: fields.metaTitle },
    { label: t('fields.metaDescription'), value: fields.metaDescription },
    {
      label: t('fields.slug'),
      value: fields.slug || null,
      shown: fields.slug || t('fields.noSlug'),
    },
    {
      label: t('fields.author'),
      value: fields.author || null,
      shown: fields.author
        ? t(byline ? 'fields.authorInContent' : 'fields.authorValue', { name: fields.author })
        : t(siteAuthor ? 'fields.siteAuthor' : 'fields.noAuthor'),
    },
    {
      label: t('fields.reviewer'),
      value: fields.reviewer || null,
      shown: fields.reviewer || t('fields.noReviewer'),
    },
    {
      label: t('fields.featuredImage'),
      value: fields.featuredImage,
      shown: fields.featuredImage ?? t('fields.noImage'),
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        // Focus starts on the destination picked, as a radio group's does:
        // Enter or Space then keeps it, not the first file's.
        initialFocus={() => radios.current[destination] ?? true}
        finalFocus={() => !filling.current}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        {publish && <PublishLine {...publish} />}

        <div className="space-y-2">
          {radioRow(DRAFT_EXPORT_FORMATS, t('formats'))}
          <section
            aria-labelledby={`${platformsId}-title`}
            className="overflow-hidden rounded-xl border"
          >
            {/* The whole bar opens it: "Show" and a chevron pointing down say so. */}
            <h3 className="text-xs font-medium">
              <button
                type="button"
                aria-expanded={platformsOpen}
                aria-controls={platformsId}
                onClick={() => setPlatformsOpen((open) => !open)}
                className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
              >
                <span id={`${platformsId}-title`}>{t('platforms')}</span>
                {/* Folded, the platform picked is still named. */}
                {!platformsOpen && isPlatform(destination) && (
                  <span className="font-normal text-muted-foreground">
                    {t(`destinations.${destination}`)}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-foreground group-hover:underline">
                  {platformsOpen ? t('hide') : t('show')}
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform',
                      platformsOpen && 'rotate-180',
                    )}
                  />
                </span>
              </button>
            </h3>
            <div id={platformsId} hidden={!platformsOpen} className="px-3 pb-2.5">
              {radioRow(PLATFORMS, t('platforms'))}
            </div>
          </section>
          <DialogDescription className="text-xs">{t(`hints.${destination}`)}</DialogDescription>
        </div>

        {placeholders > 0 &&
          (skipPlaceholders ? (
            <div
              role="status"
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2.5 text-sm',
                !ready &&
                  'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
              )}
            >
              <span className="min-w-0 flex-1">
                {ready
                  ? t('placeholders.left', { count: placeholders })
                  : t('placeholders.headings', { count: left })}
              </span>
              {!ready && (
                <Button variant="outline" size="sm" className="h-7" onClick={fillNow}>
                  {t('placeholders.fill')}
                </Button>
              )}
              <button
                type="button"
                className="text-xs font-medium underline-offset-2 hover:underline"
                onClick={() => setSkipPlaceholders(false)}
              >
                {t('placeholders.undo')}
              </button>
            </div>
          ) : (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">{t('placeholders.open', { count: placeholders })}</p>
              <div className="flex w-full justify-end gap-2">
                <Button variant="outline" size="sm" className="h-7" onClick={fillNow}>
                  {t('placeholders.fill')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setSkipPlaceholders(true)}
                >
                  {t('placeholders.skip')}
                </Button>
              </div>
            </div>
          ))}

        <section aria-label={t('checks.label')} className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{t('checks.label')}</h3>
          <ul className="divide-y rounded-xl border text-sm">
            {rows.map((row) => (
              <li key={row.title} className="flex items-start gap-2.5 px-3 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    row.state === 'ok'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : row.state === 'missing'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {row.state === 'ok' ? (
                    <Check className="h-3 w-3" />
                  ) : row.state === 'missing' ? (
                    '!'
                  ) : (
                    '?'
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {row.title}
                    <span className="sr-only">
                      {' · '}
                      {t(`states.${row.state}`)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{row.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label={t('fields.label')} className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('fields.label')} <span className="font-normal">· {t('fields.where')}</span>
          </h3>
          <dl className="divide-y rounded-xl border text-sm">
            {fieldRows.map((row) => (
              <div key={row.label} className="flex items-start gap-2.5 px-3 py-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">
                  {row.shown ?? row.value}
                </dd>
                {row.value && (
                  <button
                    type="button"
                    aria-label={t('fields.copyLabel', { field: row.label })}
                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      void copyToClipboard(
                        row.value!,
                        t('fields.copied', { field: row.label }),
                        t('copyFailed'),
                      )
                    }
                  >
                    {t('fields.copy')}
                  </button>
                )}
              </div>
            ))}
          </dl>
        </section>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          {destination === 'html' && (
            <Button variant="outline" disabled={!ready} onClick={() => void download('html')}>
              {t('actions.downloadHtml')}
            </Button>
          )}
          <Button disabled={!ready} onClick={() => void act()}>
            {t(`actions.${destination}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Before you publish, one line over Export's options: amber with what it
 * warns about (Trust under 60, no author, no disclosure), else quiet;
 * Review opens it.
 */
function PublishLine({
  trustBelow,
  noAuthor,
  noDisclosure = false,
  article,
  product = false,
  itemList = false,
  onReview,
}: {
  trustBelow: number | null;
  noAuthor: boolean;
  noDisclosure?: boolean;
  article: boolean;
  product?: boolean;
  itemList?: boolean;
  onReview: () => void;
}) {
  const t = useTranslations('contentEditor.editor.exportDialog.publish');
  const warnings = [
    ...(trustBelow !== null ? [t('trust', { trust: trustBelow })] : []),
    ...(noAuthor ? [t('noAuthor')] : []),
    ...(noDisclosure ? [t('noDisclosure')] : []),
  ];
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
        warnings.length
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-muted/40 text-muted-foreground',
      )}
    >
      {warnings.length > 0 && <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      <p className="min-w-0 flex-1">
        {warnings.length
          ? t('warnings', { list: warnings.join(' · ') })
          : t(
              article
                ? 'quiet'
                : product
                  ? 'quietProduct'
                  : itemList
                    ? 'quietItemList'
                    : 'quietOther',
            )}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        aria-label={t('reviewLabel')}
        onClick={onReview}
      >
        {t('review')}
      </Button>
    </div>
  );
}
