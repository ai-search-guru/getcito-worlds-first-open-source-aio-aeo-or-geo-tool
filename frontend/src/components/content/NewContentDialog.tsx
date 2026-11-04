'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, FileText, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  createContentDraft,
  getContentOverlap,
  getContentStartOptions,
  importContentPage,
  sendContentDraftToActionCenter,
  startAgentWriting,
} from '@/lib/actions/contentDrafts';
import { assignAction } from '@/lib/actions/actionCenter';
import { listBrandMembers, type TeamMember } from '@/lib/actions/team';
import { memberLabel } from '@/lib/action-center/display';
import { agentWriteRequest, useRuleDescriber } from '@/lib/content/agentWrite';
import { MAX_ATTACHMENT_BYTES, textToHtml } from '@/lib/content/attachments';
import { cleanHtml } from '@/lib/content/cleanHtml';
import { oneH1Html } from '@/lib/content/oneH1';
import { startingRules } from '@/lib/content/rules';
import {
  contentEditorPath,
  type ContentOverlap,
  type DraftMethod,
  type DraftSource,
  type DraftStartOptions,
  type OverlapPage,
  type PageImportError,
  type PageType,
} from '@/lib/content/drafts';
import { DOCUMENT_ACCEPT, readDocumentFile } from '@/lib/content/importDocument';
import {
  overlapOptions,
  pagePath,
  samePage,
  type OverlapChoice,
  type OverlapOption,
} from '@/lib/content/overlap';
import { opportunityPageType } from '@/lib/content/assetTypes';
import { SITE_PAGE_TYPES, detectPageType, type SiteType } from '@/lib/content/pageTypes';
import {
  fileTitle,
  startPageType,
  summarizeContent,
  type ContentSummary,
} from '@/lib/content/start';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { useUpgradeGate } from '@/components/context/upgradeGate';

type SourceKind = 'opportunity' | 'prompt' | 'topic';
const SOURCE_KINDS: SourceKind[] = ['opportunity', 'prompt', 'topic'];

interface PickerItem {
  value: string;
  label: string;
  meta?: string;
  /** The page's title, when it isn't the label (an opportunity's brief title). */
  pageTitle?: string;
  /** The page type an opportunity names for its page, when the site writes it. */
  pageType?: PageType;
}

/** Content brought to optimize: cleaned HTML, what it holds, and where it came from. */
interface BroughtContent extends ContentSummary {
  html: string;
  /** The file's name; none for a paste. */
  fileName?: string;
  /** The page's address, for content read from a URL. */
  sourceUrl?: string;
  imagesRemoved: number;
}

/** Where content to optimize comes from. */
type ContentFrom = 'url' | 'paste' | 'file';

/** Where Start's first page type came from, if it was read from somewhere. */
type DetectedFrom = 'title' | 'content' | 'page' | 'opportunity' | null;

/** What Start opens the editor with. */
interface StartChoice {
  method: DraftMethod;
  title: string;
  source: DraftSource;
  bodyHtml?: string;
  /** The page the content was read from, for content brought by URL. */
  sourceUrl?: string;
  pageType: PageType;
  detectedFrom: DetectedFrom;
  /** The person picked the type from the chips; otherwise it follows the page. */
  picked: boolean;
  /** The page type for a new page, to go back to from optimizing an existing one. */
  newPageType: { pageType: PageType; detectedFrom: DetectedFrom; picked: boolean };
  /** The Overview's pick: write the new page, or optimize an existing one. */
  choice: OverlapChoice;
  /** The page the Content plan named for this opportunity, offered beside the check's options. */
  givenPage?: OverlapPage;
}

/**
 * What the dialog opens on, from the Content plan (CE-014): an opportunity
 * (for an existing page, Start optimizes that page), or a page to read. From
 * Tracked Prompts: a prompt, to write a page for or, with `method`
 * 'optimize', to optimize its cited `page`; with no page, the Overview's
 * first page to optimize is picked once its read lands (the person picked
 * Optimize), and they can pick another.
 */
export type DialogPreset = (
  | { kind: 'opportunity'; id: string; page?: { url: string; title: string | null } | null }
  | { kind: 'page'; url: string }
  | {
      kind: 'prompt';
      id: string;
      text: string;
      method: 'create' | 'optimize';
      page?: { url: string; title: string | null } | null;
    }
) & {
  /** Opened to assign the work (the Plan's "Assign to…"): Start chooses Team. */
  who?: 'team';
};

/**
 * Who does the page (Start, CE-015): the Content Agent, the person, or the
 * team. The agent is offered first; the person stays the default, as the
 * agent's run is metered from the AI usage.
 */
type Who = 'me' | 'agent' | 'team';
const WHO: Who[] = ['agent', 'me', 'team'];

/** The Overview's read for one source: null while it runs. */
interface OverlapRead {
  key: string;
  overlap: ContentOverlap | null;
  failed: boolean;
}

/**
 * New content and Start (Content Editor CE-003, CE-015; spec §5, §9). First,
 * how the page starts: a new page from an opportunity, a tracked prompt or a
 * topic, or content to optimize, pasted or from a file. Then Start: the page
 * type, picked first from what the title or content shows, and Open editor.
 */
export function NewContentDialog({
  open,
  onOpenChange,
  brandId,
  siteType,
  onSent,
  preset = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  siteType: SiteType;
  /** A draft was sent to the Action Center: the Library lists it. */
  onSent?: () => void;
  /**
   * What the Content plan (CE-014) opens it on: Start for an opportunity, or
   * an existing page read to optimize.
   */
  preset?: DialogPreset | null;
}) {
  const t = useTranslations('contentEditor.newContent');
  // The Language rule's default for the agent: the brand's language.
  const brandLanguage = useBrandStore((s) => s.brands.find((b) => b.id === brandId)?.language);
  const tTypes = useTranslations('contentEditor.pageTypes');
  const router = useRouter();
  const describeRule = useRuleDescriber();
  // A read-only workspace (plan not active): what opens this dialog opens the
  // upgrade dialog instead; should it be open, reading a page by its URL and
  // Open editor do too.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const [options, setOptions] = useState<DraftStartOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [method, setMethod] = useState<DraftMethod>('create');
  const [kind, setKind] = useState<SourceKind>('opportunity');
  const [picked, setPicked] = useState<PickerItem | null>(null);
  const [from, setFrom] = useState<ContentFrom>('url');
  const [pageUrl, setPageUrl] = useState('');
  const [urlError, setUrlError] = useState<{ code: PageImportError; status?: number } | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [content, setContent] = useState<BroughtContent | null>(null);
  const [reading, setReading] = useState(false);
  const [start, setStart] = useState<StartChoice | null>(null);
  const [opening, setOpening] = useState(false);
  const [who, setWho] = useState<Who>('me');
  // Team's assignee: the task goes to this teammate once it is sent. The
  // teammates are the people who can see the brand, read for it.
  const [team, setTeam] = useState<{ brandId: string; members: TeamMember[] } | null>(null);
  const members = team && team.brandId === brandId ? team.members : [];
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [overlapRead, setOverlapRead] = useState<OverlapRead | null>(null);
  const [overlapAttempt, setOverlapAttempt] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Each opening starts over and reads what there is to start from.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getContentStartOptions(brandId)
      .then((read) => {
        if (cancelled) return;
        setOptions(read);
        setOptionsFailed(false);
      })
      .catch((err) => {
        console.error('Failed to load what New content starts from:', err);
        if (!cancelled) setOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, brandId, attempt]);

  // The team, for Team's assignee: read once per brand, when Team is first chosen.
  const membersRead = useRef<string | null>(null);
  useEffect(() => {
    if (who !== 'team' || membersRead.current === brandId) return;
    membersRead.current = brandId;
    listBrandMembers(brandId)
      .then((list) => setTeam({ brandId, members: list }))
      .catch((err) => console.error('Failed to load the team:', err));
  }, [who, brandId]);

  // From the Content plan: Start for its opportunity once the options are in
  // (one no longer open is left to pick), or its page read to optimize.
  const presetApplied = useRef(false);
  // Opened to optimize a prompt with no cited page: the Overview's first page
  // to optimize is picked once, when its read lands. A pick of the person's
  // own, or a retry, leaves the choice to them.
  const optimizeOnce = useRef(false);
  useEffect(() => {
    if (!open || !preset || presetApplied.current) return;
    if (preset.who === 'team') setWho('team');
    if (preset.kind === 'page') {
      presetApplied.current = true;
      setMethod('optimize');
      setFrom('url');
      setPageUrl(preset.url);
      void readPage(preset.url);
      return;
    }
    if (preset.kind === 'prompt') {
      presetApplied.current = true;
      optimizeOnce.current = preset.method === 'optimize' && !preset.page;
      const item = { value: preset.id, label: preset.text };
      setKind('prompt');
      setPicked(item);
      startFrom(item, 'prompt', preset.page ? givenPage(preset.page) : undefined);
      return;
    }
    if (!options) return;
    presetApplied.current = true;
    const opportunity = options.opportunities.find((o) => o.id === preset.id);
    if (!opportunity) return;
    const item = opportunityItem(opportunity, siteType);
    setKind('opportunity');
    setPicked(item);
    startFrom(item, 'opportunity', preset.page ? givenPage(preset.page) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, preset, options]);

  // Start reads the brand's pages AI already cites for a new page's prompts
  // (the Overview). Content brought to optimize has no prompts to read for. A
  // page type picked in Start keeps the same source, so it reads once per
  // source.
  const startSource = start?.source;
  const overlapKey = startSource && startSource.kind !== 'content' ? sourceKey(startSource) : null;
  useEffect(() => {
    if (!startSource || startSource.kind === 'content') return;
    const key = sourceKey(startSource);
    let cancelled = false;
    getContentOverlap(brandId, startSource)
      .then((overlap) => {
        if (cancelled) return;
        setOverlapRead({ key, overlap, failed: false });
        if (optimizeOnce.current && overlap) {
          optimizeOnce.current = false;
          const optimize = overlapOptions(overlap, null).find((o) => o.choice.kind === 'optimize');
          if (optimize) setStart((s) => (s ? withChoice(s, optimize.choice, siteType) : s));
        }
      })
      .catch((err) => {
        console.error('Failed to read the pages cited for these prompts:', err);
        if (!cancelled) setOverlapRead({ key, overlap: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, startSource, siteType, overlapAttempt]);

  const reset = () => {
    presetApplied.current = false;
    optimizeOnce.current = false;
    setMethod('create');
    setKind('opportunity');
    setPicked(null);
    setFrom('url');
    setPageUrl('');
    setUrlError(null);
    setPastedText('');
    setContent(null);
    setStart(null);
    setOpening(false);
    setOverlapRead(null);
    setWho('me');
    setAssigneeId(null);
  };
  const changeOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const items: PickerItem[] = !options
    ? []
    : kind === 'opportunity'
      ? options.opportunities.map((o) => opportunityItem(o, siteType))
      : kind === 'prompt'
        ? // A prompt the brand is already named in or cited for needs no new page.
          options.prompts.filter((p) => !p.seen).map((p) => ({ value: p.id, label: p.text }))
        : options.topics.map((topic) => ({
            value: topic.id,
            label: topic.name,
            meta: t('topicPrompts', { count: topic.promptCount }),
          }));

  const bring = (
    incoming: string,
    imagesRemoved: number,
    origin: { fileName?: string; sourceUrl?: string; title?: string } = {},
  ) => {
    // One H1 per page, its title, whichever way the page comes in.
    const html = oneH1Html(incoming);
    const fallback = origin.title || (origin.fileName ? fileTitle(origin.fileName) : '');
    const summary = summarizeContent(html, fallback);
    if (!summary.characters) {
      toast.error(t('content.empty'));
      return;
    }
    setContent({ ...summary, html, imagesRemoved, ...origin });
  };

  /** A page of the brand's, read by its URL and cleaned like a paste. */
  const readPage = async (address = pageUrl.trim()) => {
    if (!address) return;
    setReading(true);
    setUrlError(null);
    try {
      const read = await importContentPage(brandId, address);
      if ('error' in read) {
        setUrlError({ code: read.error, status: read.status });
        return;
      }
      const cleaned = cleanHtml(read.page.html, { keepImages: true });
      bring(cleaned.html, cleaned.imagesRemoved, {
        sourceUrl: read.page.url,
        title: read.page.title,
      });
    } finally {
      setReading(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    // Plain text goes into the box as typed text would; formatted text is
    // cleaned like a paste in the editor and shown as what it holds.
    if (!html) return;
    e.preventDefault();
    const cleaned = cleanHtml(html, { keepImages: false });
    bring(cleaned.html, cleaned.imagesRemoved);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('content.tooLarge', { name: file.name }));
      return;
    }
    setReading(true);
    try {
      const doc = await readDocumentFile(file);
      if (!doc) toast.error(t('content.unsupported', { name: file.name }));
      else bring(doc.html, doc.imagesRemoved, { fileName: file.name });
    } catch (err) {
      console.error('Failed to read a file for New content:', err);
      toast.error(t('content.readFailed', { name: file.name }));
    } finally {
      setReading(false);
    }
  };

  const typed = pastedText.trim();
  const canContinue =
    method === 'create' ? picked !== null : content !== null || (from === 'paste' && !!typed);

  /**
   * Start for a new page from what was picked: its title, and the page type
   * its opportunity names, else the one it reads as. With a page (an
   * opportunity for an existing page, from the plan), Start optimizes that
   * page, and it stays chosen.
   */
  const startFrom = (item: PickerItem, from: SourceKind, page?: OverlapPage) => {
    const title = item.pageTitle ?? item.label;
    const type = startPageType({ title }, siteType);
    const newPageType = item.pageType
      ? { pageType: item.pageType, detectedFrom: 'opportunity' as const, picked: false }
      : {
          pageType: type.pageType,
          detectedFrom: type.detected ? ('title' as const) : null,
          picked: false,
        };
    const next: StartChoice = {
      method: 'create',
      title,
      source: { kind: from, id: item.value },
      ...newPageType,
      newPageType,
      choice: { kind: 'create' },
      givenPage: page,
    };
    setStart(page ? withChoice(next, { kind: 'optimize', page }, siteType) : next);
  };

  const toStart = () => {
    if (method === 'create') {
      if (picked) startFrom(picked, kind);
      return;
    }
    const brought =
      content ??
      (typed ? { ...summarizeContent(textToHtml(typed)), html: textToHtml(typed) } : null);
    if (!brought) return;
    const sourceUrl = 'sourceUrl' in brought ? brought.sourceUrl : undefined;
    const type = startPageType(
      { title: brought.title, html: brought.html, url: sourceUrl },
      siteType,
    );
    const newPageType = {
      pageType: type.pageType,
      detectedFrom: type.detected ? (sourceUrl ? ('page' as const) : ('content' as const)) : null,
      picked: false,
    };
    setStart({
      method,
      title: brought.title,
      source: { kind: 'content' },
      bodyHtml: brought.html,
      sourceUrl,
      ...newPageType,
      newPageType,
      choice: { kind: 'create' },
    });
  };

  // Optimizing an existing page instead: the draft is that page's.
  const existing = start?.choice.kind === 'optimize' ? start.choice.page : null;
  const startMethod: DraftMethod = existing ? 'optimize' : (start?.method ?? 'create');
  const startTitle = existing ? existing.title || pagePath(existing.url) : (start?.title ?? '');

  const openEditor = async () => {
    if (!start) return;
    setOpening(true);
    try {
      // An existing page Start chose to optimize brings its live text; if it
      // can't be read, the draft starts with its title, and says so.
      let bodyHtml = start.bodyHtml;
      if (existing) {
        const read = await importContentPage(brandId, existing.url);
        if ('page' in read) bodyHtml = cleanHtml(read.page.html, { keepImages: true }).html;
        else {
          bodyHtml = undefined;
          toast.warning(t('start.pageUnread', { page: pagePath(existing.url) }));
        }
      }
      const id = await createContentDraft(brandId, {
        method: startMethod,
        title: startTitle,
        pageType: start.pageType,
        typePicked: start.picked,
        source: start.source,
        bodyHtml,
        sourceUrl: existing?.url ?? start.sourceUrl,
      });
      if (who === 'team') {
        await sendToTeam(id);
        return;
      }
      if (who === 'agent') {
        await sendToAgent(id, bodyHtml);
        return;
      }
      router.push(contentEditorPath(id));
    } catch (err) {
      console.error('Failed to start a draft:', err);
      toast.error(t('start.failed'));
      setOpening(false);
    }
  };

  /**
   * Agent: the Content Agent does the page in the background — a new page
   * written, an existing one's suggestions left — and the editor opens at
   * once, showing the agent at work until the page is there to review; the
   * dialog stays until it does. It stays in the Library as a draft if it
   * can't start.
   */
  const sendToAgent = async (id: string, bodyHtml: string | undefined) => {
    const openDraft = {
      label: t('start.openDraft'),
      onClick: () => router.push(contentEditorPath(id)),
    };
    let started: Awaited<ReturnType<typeof startAgentWriting>>;
    try {
      const request = await agentWriteRequest(
        {
          id,
          brandId,
          title: startTitle,
          pageType: start?.pageType ?? null,
          method: startMethod,
          sourceUrl: existing?.url ?? start?.sourceUrl ?? null,
          bodyHtml: bodyHtml ?? '',
          // As the draft started: a page brought in aims at its own length.
          rules: startingRules(startMethod, bodyHtml),
          language: brandLanguage,
        },
        describeRule,
      );
      started = await startAgentWriting(id, brandId, request);
    } catch (err) {
      console.error('Failed to hand the draft to the Content Agent:', err);
      started = { error: 'failed' };
    }
    onSent?.();
    if ('error' in started) {
      changeOpen(false);
      toast.error(t(`start.agentErrors.${started.error}`), { action: openDraft });
      return;
    }
    // As Me does: the dialog stays, its button busy, until the editor shows
    // the agent at work, rather than the page under it for a few seconds.
    router.push(contentEditorPath(id));
  };

  /**
   * Team: the draft goes to the Action Center as an action for someone to
   * write; it stays in the Library either way.
   */
  const sendToTeam = async (id: string) => {
    const sent = await sendContentDraftToActionCenter(brandId, id);
    changeOpen(false);
    onSent?.();
    if ('error' in sent) {
      toast.error(t('start.sendFailed'), {
        description: sent.error,
        action: { label: t('start.openDraft'), onClick: () => router.push(contentEditorPath(id)) },
      });
      return;
    }
    if (assigneeId) {
      try {
        await assignAction(brandId, sent.actionId, assigneeId);
      } catch (err) {
        // The task is sent all the same; it can be assigned in the Action Center.
        console.error('Failed to assign the sent draft:', err);
        toast.warning(t('who.assignFailed'));
      }
    }
    toast.success(t('start.sent'), {
      description: t('start.sentDescription', { number: sent.actionNo }),
      duration: 10_000,
      action: {
        label: t('start.openAction'),
        onClick: () => router.push(`/dashboard/action-center/actions?action=${sent.actionId}`),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {/*
        One column no wider than the dialog: a long title or pick truncates
        instead of widening it. No taller than the window: Start scrolls,
        its buttons kept in view. Held at the top, not centred: what Start
        reads after it opens (the Overview) grows it downwards, and the
        choices above don't move.
      */}
      <DialogContent className="top-[6dvh] max-h-[88dvh] translate-y-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        {start ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8" title={startTitle}>
                {t(startMethod === 'create' ? 'start.titleCreate' : 'start.titleOptimize', {
                  title: startTitle || t('start.untitled'),
                })}
              </DialogTitle>
              <DialogDescription>{t('start.description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label id="start-page-type">{t('start.pageType')}</Label>
              <div
                role="radiogroup"
                aria-labelledby="start-page-type"
                className="flex flex-wrap gap-1.5"
              >
                {SITE_PAGE_TYPES[siteType].map((type) => (
                  <ChoiceChip
                    key={type}
                    selected={start.pageType === type}
                    onSelect={() =>
                      setStart({
                        ...start,
                        pageType: type,
                        detectedFrom: null,
                        picked: true,
                        ...(start.choice.kind === 'create' && {
                          newPageType: { pageType: type, detectedFrom: null, picked: true },
                        }),
                      })
                    }
                  >
                    {tTypes(type)}
                  </ChoiceChip>
                ))}
              </div>
              {start.detectedFrom && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    {
                      title: 'start.detectedTitle',
                      content: 'start.detectedContent',
                      page: 'start.detectedPage',
                      opportunity: 'start.detectedOpportunity',
                    }[start.detectedFrom],
                  )}
                </p>
              )}
            </div>
            {/*
              Who does it comes before the Overview: the Overview is read
              after the dialog opens and grows as it lands, and nothing the
              person may be about to click sits under it.
            */}
            <div className="space-y-2">
              <Label id="start-who">{t('who.label')}</Label>
              <div
                role="radiogroup"
                aria-labelledby="start-who"
                className="grid grid-cols-3 gap-1.5"
              >
                {WHO.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={who === value}
                    onClick={() => setWho(value)}
                    className={cn(
                      'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      who === value && 'border-foreground ring-1 ring-inset ring-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/50',
                        who === value && 'border-[5px] border-foreground',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t(`who.${value}.title`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`who.${value}.hint`)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {who === 'team' && (
                <div className="space-y-1.5">
                  <Label htmlFor="start-assignee" className="text-xs text-muted-foreground">
                    {t('who.assignTo')}
                  </Label>
                  <Select
                    value={assigneeId}
                    onValueChange={(value) => setAssigneeId(value as string | null)}
                    items={members.map((member) => ({
                      value: member.userId,
                      label: memberLabel(member),
                    }))}
                  >
                    <SelectTrigger id="start-assignee" className="w-full">
                      <SelectValue placeholder={t('who.assignNone')} />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          {memberLabel(member)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {overlapKey && (
              <OverlapCheck
                read={overlapRead?.key === overlapKey ? overlapRead : null}
                choice={start.choice}
                given={start.givenPage ?? null}
                givenCited={start.source.kind === 'prompt'}
                onChoose={(choice) => {
                  optimizeOnce.current = false;
                  setStart(withChoice(start, choice, siteType));
                }}
                onRetry={() => {
                  optimizeOnce.current = false;
                  setOverlapRead(null);
                  setOverlapAttempt((n) => n + 1);
                }}
              />
            )}
            <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
              <Button variant="ghost" onClick={() => setStart(null)} disabled={opening}>
                <ArrowLeft className="h-4 w-4" />
                {t('back')}
              </Button>
              <Button
                onClick={guard(() => void openEditor(), {
                  action: tActions(
                    startMethod === 'optimize' ? 'optimizeContent' : 'createContent',
                  ),
                })}
                disabled={opening}
              >
                {opening && <LoadingDots />}
                {t(
                  who === 'team'
                    ? 'start.sendToTeam'
                    : who === 'agent'
                      ? 'start.startAgent'
                      : 'start.openEditor',
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div role="radiogroup" aria-label={t('methodLabel')} className="grid grid-cols-2 gap-2">
              {(['create', 'optimize'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                    method === value && 'border-foreground ring-1 ring-inset ring-foreground',
                  )}
                >
                  <span className="block text-sm font-medium">{t(`methods.${value}.title`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`methods.${value}.hint`)}
                  </span>
                </button>
              ))}
            </div>

            {method === 'create' ? (
              <div className="space-y-2">
                <Label>{t('startFrom')}</Label>
                <Tabs
                  value={kind}
                  onValueChange={(value) => {
                    setKind(value as SourceKind);
                    setPicked(null);
                  }}
                >
                  <TabsList>
                    {SOURCE_KINDS.map((value) => (
                      <TabsTrigger key={value} value={value}>
                        {t(`sources.${value}.tab`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {optionsFailed ? (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    {t('loadError')}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setAttempt((n) => n + 1)}
                    >
                      {t('retry')}
                    </button>
                  </div>
                ) : (
                  <Combobox
                    items={items}
                    value={picked}
                    onValueChange={(item: PickerItem | null) => setPicked(item)}
                    disabled={!options}
                  >
                    <ComboboxTrigger
                      className="w-full"
                      aria-label={t(`sources.${kind}.placeholder`)}
                      title={picked?.label}
                    >
                      {options ? (
                        <span className="min-w-0 flex-1 truncate text-left">
                          <ComboboxValue placeholder={t(`sources.${kind}.placeholder`)} />
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <LoadingDots />
                          {t('loading')}
                        </span>
                      )}
                    </ComboboxTrigger>
                    <ComboboxContent>
                      <ComboboxInput placeholder={t(`sources.${kind}.search`)} />
                      <ComboboxList>
                        <ComboboxEmpty>
                          {/* "All seen" only when nothing is left to list, not on a search miss. */}
                          {kind === 'prompt' && items.length === 0 && options?.promptsSeen
                            ? t('sources.prompt.allSeen')
                            : t(`sources.${kind}.empty`)}
                        </ComboboxEmpty>
                        <ComboboxCollection>
                          {(item: PickerItem) => (
                            <ComboboxItem key={item.value} value={item} title={item.label}>
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {item.meta && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {item.meta}
                                </span>
                              )}
                            </ComboboxItem>
                          )}
                        </ComboboxCollection>
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                )}
                {kind === 'prompt' && options && options.promptsSeen > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('sources.prompt.seen', { count: options.promptsSeen })}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t('content.label')}</Label>
                <Tabs
                  value={from}
                  onValueChange={(value) => {
                    setFrom(value as ContentFrom);
                    setUrlError(null);
                    setContent(null);
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="url">{t('content.url')}</TabsTrigger>
                    <TabsTrigger value="paste">{t('content.paste')}</TabsTrigger>
                    <TabsTrigger value="file">{t('content.file')}</TabsTrigger>
                  </TabsList>
                </Tabs>
                {content ? (
                  <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={content.title}>
                        {content.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          content.fileName ?? (content.sourceUrl && pagePath(content.sourceUrl)),
                          t('content.summary', {
                            headings: content.headings,
                            characters: formatNumber(content.characters),
                          }),
                          content.imagesRemoved
                            ? t('content.imagesLeftOut', { count: content.imagesRemoved })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('content.clear')}
                      title={t('content.clear')}
                      onClick={() => {
                        setContent(null);
                        setPastedText('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : from === 'url' ? (
                  <div className="space-y-1.5">
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        guard(() => void readPage(), { action: tActions('importPage') })();
                      }}
                    >
                      <Input
                        value={pageUrl}
                        onChange={(e) => {
                          setPageUrl(e.target.value);
                          setUrlError(null);
                        }}
                        placeholder={t('content.urlPlaceholder')}
                        aria-label={t('content.url')}
                        aria-invalid={urlError !== null}
                        inputMode="url"
                        autoComplete="off"
                        disabled={reading}
                      />
                      <Button type="submit" variant="outline" disabled={reading || !pageUrl.trim()}>
                        {reading && <LoadingDots />}
                        {t(reading ? 'content.importing' : 'content.import')}
                      </Button>
                    </form>
                    {urlError ? (
                      <p className="text-xs text-destructive" role="alert">
                        {urlError.code === 'http_error' && urlError.status
                          ? t('content.urlErrors.http_status', { status: urlError.status })
                          : t(`content.urlErrors.${urlError.code}`)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('content.urlHint')}</p>
                    )}
                  </div>
                ) : from === 'paste' ? (
                  <Textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    onPaste={onPaste}
                    rows={5}
                    aria-label={t('content.paste')}
                    placeholder={t('content.pastePlaceholder')}
                  />
                ) : (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={DOCUMENT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        void readFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void readFile(e.dataTransfer.files[0]);
                      }}
                      disabled={reading}
                      className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-sm transition-colors hover:bg-muted/50"
                    >
                      {reading ? (
                        <LoadingDots
                          label={t('content.reading')}
                          className="text-muted-foreground"
                        />
                      ) : (
                        <span className="font-medium">{t('content.choose')}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{t('content.fileHint')}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
              <Button variant="ghost" onClick={() => changeOpen(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={toStart} disabled={!canContinue}>
                {t('continue')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A page a preset names, as Start's overlap options carry one. */
function givenPage(page: { url: string; title: string | null }): OverlapPage {
  return { url: page.url, title: page.title, promptsInCommon: 0, citations: 0, gscPosition: null };
}

/** An opportunity to pick, with the page type it names when the site writes it. */
function opportunityItem(
  opportunity: DraftStartOptions['opportunities'][number],
  siteType: SiteType,
): PickerItem {
  return {
    value: opportunity.id,
    label: opportunity.title,
    pageTitle: opportunity.pageTitle ?? undefined,
    pageType: opportunityPageType(opportunity.assetType, siteType) ?? undefined,
  };
}

function sourceKey(source: Exclude<DraftSource, { kind: 'content' }>) {
  return `${source.kind}:${source.id}`;
}

/**
 * Start with this overlap pick: an existing page brings its own title and
 * the type its address or title shows; when they show none, the type its
 * opportunity names, unless the person picked one.
 */
function withChoice(start: StartChoice, choice: OverlapChoice, siteType: SiteType): StartChoice {
  if (choice.kind === 'create') return { ...start, choice, ...start.newPageType };
  const detected = detectPageType({ url: choice.page.url, title: choice.page.title }, siteType);
  if (!detected && !start.picked && start.newPageType.detectedFrom === 'opportunity') {
    return { ...start, choice, ...start.newPageType };
  }
  return {
    ...start,
    choice,
    pageType: detected ?? start.pageType,
    detectedFrom: detected ? 'page' : null,
    picked: detected ? false : start.picked,
  };
}

/**
 * Start's Overview (CE-015): the brand's pages AI already cites for these
 * prompts, as information, and the choice between a new page and one of
 * them. The action the person picked stays chosen.
 */
function OverlapCheck({
  read,
  choice,
  given,
  givenCited,
  onChoose,
  onRetry,
}: {
  read: OverlapRead | null;
  choice: OverlapChoice;
  given: OverlapPage | null;
  /** The given page is the one AI cites for the prompt (Tracked Prompts), not the plan's pick. */
  givenCited: boolean;
  onChoose: (choice: OverlapChoice) => void;
  onRetry: () => void;
}) {
  const t = useTranslations('contentEditor.newContent.overlap');
  const overlap = read?.overlap ?? null;
  const shown = overlap?.pages.slice(0, 3) ?? [];
  const top = overlap?.pages[0];
  const options = overlap ? overlapOptions(overlap, given) : [];
  const nothingCited = !overlap || overlap.totalPrompts === 0 || overlap.pages.length === 0;
  const isChosen = (option: OverlapOption) =>
    option.choice.kind === choice.kind &&
    (option.choice.kind === 'create' ||
      (choice.kind === 'optimize' && samePage(option.choice.page.url, choice.page.url)));

  const optionText = (option: OverlapOption) => {
    const page = top ? pagePath(top.url) : '';
    switch (option.key) {
      case 'optimizeGiven':
        return {
          title: t('options.optimizeGiven.title', { page: given ? pagePath(given.url) : '' }),
          reason: t(
            givenCited ? 'options.optimizeGiven.reasonCited' : 'options.optimizeGiven.reason',
          ),
        };
      case 'optimizeInstead':
        return {
          title: t('options.optimizeInstead.title', { page }),
          reason: t(
            top?.gscPosition != null
              ? 'options.optimizeInstead.reasonRanked'
              : 'options.optimizeInstead.reason',
            {
              count: top?.promptsInCommon ?? 0,
              total: overlap?.totalPrompts ?? 0,
              citations: formatNumber(top?.citations ?? 0),
              position: Math.round(top?.gscPosition ?? 0),
            },
          ),
        };
      case 'createNew':
        return {
          title: t('options.createNew.title'),
          reason: t('options.createNew.reason'),
        };
    }
  };

  const optionGroup = options.length > 0 && (
    <div role="radiogroup" aria-label={t('label')} className="grid gap-1.5">
      {options.map((option) => {
        const text = optionText(option);
        const chosen = isChosen(option);
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => onChoose(option.choice)}
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
              chosen && 'border-foreground ring-1 ring-inset ring-foreground',
            )}
          >
            <span
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/50',
                chosen && 'border-[5px] border-foreground',
              )}
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {text.title}
              </span>
              <span className="block text-xs text-muted-foreground">{text.reason}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-2">
      <Label>{t('label')}</Label>
      {!read ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true">
          <LoadingDots />
          {t('checking')}
        </p>
      ) : read.failed || !overlap ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('failed')}
          <button type="button" className="font-medium underline" onClick={onRetry}>
            {t('retry')}
          </button>
        </p>
      ) : (
        <>
          <div className="rounded-lg border px-3 py-2.5 text-sm">
            {nothingCited ? (
              <p>{overlap.totalPrompts ? t('none') : t('noPrompts')}</p>
            ) : (
              <>
                <p className="font-medium">{t('cited', { count: overlap.pages.length })}</p>
                <table className="mt-2 w-full table-fixed text-xs">
                  <thead className="text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
                    <tr>
                      <th className="py-1 text-left font-medium">{t('columns.page')}</th>
                      <th className="w-28 py-1 pl-3 text-right font-medium">
                        {t('columns.prompts')}
                      </th>
                      <th className="w-28 py-1 pl-3 text-right font-medium">
                        {t('columns.citations')}
                      </th>
                      <th className="w-24 py-1 pl-3 text-right font-medium">
                        {t('columns.google')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((page) => (
                      <tr key={page.url} className="border-t">
                        <td className="truncate py-1.5 pr-2" title={page.url}>
                          {pagePath(page.url)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {t('promptsValue', {
                            count: page.promptsInCommon,
                            total: overlap.totalPrompts,
                          })}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {formatNumber(page.citations)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {page.gscPosition == null ? '—' : `#${Math.round(page.gscPosition)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          {optionGroup}
        </>
      )}
    </div>
  );
}

function ChoiceChip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'rounded-lg border px-2.5 py-1 text-sm transition-colors hover:bg-muted/50',
        selected && 'border-foreground font-medium ring-1 ring-inset ring-foreground',
      )}
    >
      {children}
    </button>
  );
}
