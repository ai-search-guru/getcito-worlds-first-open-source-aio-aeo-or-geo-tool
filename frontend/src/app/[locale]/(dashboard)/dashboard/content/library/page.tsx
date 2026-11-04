'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingDots } from '@/components/ui/loading-dots';
import { NewContentDialog } from '@/components/content/NewContentDialog';
import { PublishDialog } from '@/components/content/PublishDialog';
import { TakeDownDialog, type TakeDownPage } from '@/components/content/TakeDownDialog';
import { SendDialog } from '@/components/content/SendToCmsDialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useRouter } from '@/i18n/navigation';
import {
  archiveContentDraft,
  deleteContentDraft,
  getContentDrafts,
  markContentDraftReady,
  setContentDraftStatus,
} from '@/lib/actions/contentDrafts';
import { CMS_PAGES_PER_SEND, type CmsSource } from '@/lib/content/cmsSend';
import {
  readCmsStatuses,
  refreshFramerPublished,
  refreshWebflowPublished,
  refreshWixPublished,
  refreshWordPressPublished,
  type CmsStatus,
} from '@/lib/content/cmsSendClient';
import {
  AGENT_POLL_MS,
  CREATED_RANGES,
  LIBRARY_TABS,
  MADE_IN_FILTERS,
  SEND_FILTERS,
  contentEditorPath,
  draftsCreatedIn,
  draftsInTab,
  draftsLastSent,
  draftsMadeIn,
  type ContentDraftListItem,
  type CreatedRange,
  type DraftStatus,
  type LibraryTab,
  type MadeInFilter,
  type SendFilter,
} from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/pageTypes';
import {
  SHOPPING_FILTERS,
  draftsByShopping,
  type ShoppingFilter,
} from '@/lib/content/shoppingCheck';
import { formatNumber } from '@/lib/format';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { useBrandStore } from '@/state/useBrandStore';
import { BulkSendDialog } from './_BulkSendDialog';
import { readCmsSources } from '@/lib/content/cmsSources';
import { LibraryExportMenu, useLibraryExport } from './_LibraryExport';
import { LibraryTable, type LibraryRowActions, type LibrarySelection } from './_LibraryTable';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

/** A read of the brand's drafts: null until it comes back. */
interface LibraryRead {
  brandId: string;
  drafts: ContentDraftListItem[] | null;
  /** Each tab's drafts in all: past the Library's cap, more than it lists. */
  counts: Record<LibraryTab, number> | null;
  failed: boolean;
}

/**
 * The Content Library (Content Editor, CE-002): everything a person or the
 * Content Agent wrote or changed in GetCito, by status, and what was
 * archived (00233). A row's menu sets its status; admins and managers also
 * send it to the CMS (#1331), archive, restore and delete. The tab lives in
 * the URL (?tab=in_review), so a link can open "Library › In review";
 * ?new=1 opens New content (Content › Editor with no draft to go back to).
 * An online shop's pages show their shopping path's links, and a filter
 * lists the ones that need attention (?shopping=attention, 00352).
 */
export default function ContentLibraryPage() {
  const t = useTranslations('contentEditor.library');
  const tMadeIn = useTranslations('contentEditor.library.madeIn');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const [tab, setTab] = useState<LibraryTab>('all');
  // When the drafts listed (and exported) were created: ?created=30d.
  const [created, setCreated] = useState<CreatedRange>('all');
  const [madeIn, setMadeIn] = useState<MadeInFilter>('all');
  // How the listed drafts' last send to the CMS stands (#1331): ?sent=failed.
  const [sent, setSent] = useState<SendFilter>('all');
  // Which shopping paths are listed, on an online shop: ?shopping=attention.
  const [shoppingFilter, setShoppingFilter] = useState<ShoppingFilter>('all');
  const [read, setRead] = useState<LibraryRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): the reads the Library asks for
  // by itself are left out, and it lists what is stored. New content, Send
  // and the row menu's changes open the upgrade dialog instead; tabs, the
  // date filter and Export stay open.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The draft whose Delete waits for a confirmation.
  const [deleting, setDeleting] = useState<ContentDraftListItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Send to CMS: while the row's page is read, then the dialog's page.
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState<{ brandId: string; source: CmsSource } | null>(null);
  // Mark published open, on a draft (CE-013).
  const [publishing, setPublishing] = useState<string | null>(null);
  // Take down open, on a page published through GetCito (AUTONOMOUS-GO-LIVE PR 10).
  const [takingDown, setTakingDown] = useState<TakeDownPage | null>(null);
  // Each draft's last send, beside its status; read with the list.
  const [cms, setCms] = useState<ReadonlyMap<string, CmsStatus>>(new Map());
  // The drafts the sends above were read for, in any order.
  const [cmsReadFor, setCmsReadFor] = useState<ReadonlySet<string>>(new Set());
  // The rows picked to send together, for the brand they were picked in.
  const [picked, setPicked] = useState<{ brandId: string | null; ids: ReadonlySet<string> }>({
    brandId: null,
    ids: new Set(),
  });
  // The bulk Send dialog's rows, as they were picked when it opened, and their brand.
  const [bulk, setBulk] = useState<{
    brandId: string;
    brandName: string;
    brandLanguage: string | null | undefined;
    drafts: ContentDraftListItem[];
  } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTab(readUrlChoice('tab', LIBRARY_TABS, 'all'));
    setCreated(readUrlChoice('created', CREATED_RANGES, 'all'));
    setMadeIn(readUrlChoice('madeIn', MADE_IN_FILTERS, 'all'));
    setSent(readUrlChoice('sent', SEND_FILTERS, 'all'));
    setShoppingFilter(readUrlChoice('shopping', SHOPPING_FILTERS, 'all'));
    // Once: closed, it doesn't open again on a reload. Read-only, it doesn't open.
    if (readUrlParam('new') === '1') {
      if (!isLocked) setStarting(true);
      writeUrlParams({ new: null });
    }
  }, [isLocked]);
  const { exporting, exportList, exportDraft } = useLibraryExport(activeBrandId);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    getContentDrafts(activeBrandId)
      .then(({ drafts, counts }) => {
        if (!cancelled) setRead({ brandId: activeBrandId, drafts, counts, failed: false });
      })
      .catch((err) => {
        console.error('Failed to load the content library:', err);
        if (!cancelled) {
          setRead({ brandId: activeBrandId, drafts: null, counts: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, attempt]);

  // While the Content Agent writes a draft (CE-015), the list is read again
  // now and then, so it moves to In review without a reload.
  const agentWriting = !!read?.drafts?.some((draft) => draft.agentState === 'writing');
  useEffect(() => {
    if (!agentWriting) return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), AGENT_POLL_MS);
    return () => clearTimeout(timer);
  }, [agentWriting, read]);

  // The sends of the drafts read, after each read of the list.
  const readIds = read?.drafts?.map((draft) => draft.id).join(',') ?? '';
  const [cmsAttempt, setCmsAttempt] = useState(0);
  useEffect(() => {
    if (!readIds) return;
    let cancelled = false;
    readCmsStatuses(readIds.split(','))
      .then((statuses) => {
        if (cancelled) return;
        setCms(statuses);
        setCmsReadFor(new Set(readIds.split(',')));
      })
      .catch((err) => {
        console.error('Failed to read the pages’ sends:', err);
        // The filter lists what it has rather than wait for good.
        if (!cancelled) setCmsReadFor(new Set(readIds.split(',')));
      });
    return () => {
      cancelled = true;
    };
  }, [readIds, cmsAttempt]);
  // While a page is on its way to the CMS (a bulk send going on), its row's
  // send is read again now and then, as the list is while the agent writes.
  const cmsGoing = [...cms.values()].some((status) => status.status === 'queued');
  useEffect(() => {
    if (!cmsGoing) return;
    const timer = setTimeout(() => setCmsAttempt((n) => n + 1), AGENT_POLL_MS);
    return () => clearTimeout(timer);
  }, [cmsGoing, cms]);

  // Pages in Webflow or Framer as draft items, or in WordPress or Wix as
  // draft posts: the CMS says when one goes live, so the API reads them once as
  // the Library opens for the brand (and daily); the list is read again when
  // it marked any published.
  const sentTo = (target: CmsStatus['target']) =>
    [...cms.values()].some((status) => status.target === target && status.status === 'sent');
  const inWebflow = sentTo('webflow');
  const inWordPress = sentTo('wordpress');
  const inFramer = sentTo('framer');
  const inWix = sentTo('wix');
  const webflowRead = useRef(new Set<string>());
  const wordpressRead = useRef(new Set<string>());
  const framerRead = useRef(new Set<string>());
  const wixRead = useRef(new Set<string>());
  useEffect(() => {
    if (isLocked || !inWebflow || !activeBrandId || webflowRead.current.has(activeBrandId)) return;
    webflowRead.current.add(activeBrandId);
    // Not cancelled with the effect: a filter or search changing meanwhile
    // still reads the list again, the brand's pages marked.
    void refreshWebflowPublished(activeBrandId).then((published) => {
      if (published.length) setAttempt((n) => n + 1);
    });
  }, [isLocked, inWebflow, activeBrandId]);
  useEffect(() => {
    if (isLocked || !inWordPress || !activeBrandId || wordpressRead.current.has(activeBrandId)) {
      return;
    }
    wordpressRead.current.add(activeBrandId);
    // As Webflow's: not cancelled with the effect.
    void refreshWordPressPublished(activeBrandId).then((published) => {
      if (published.length) setAttempt((n) => n + 1);
    });
  }, [isLocked, inWordPress, activeBrandId]);
  useEffect(() => {
    if (isLocked || !inFramer || !activeBrandId || framerRead.current.has(activeBrandId)) return;
    framerRead.current.add(activeBrandId);
    // As Webflow's: not cancelled with the effect.
    void refreshFramerPublished(activeBrandId).then((published) => {
      if (published.length) setAttempt((n) => n + 1);
    });
  }, [isLocked, inFramer, activeBrandId]);
  useEffect(() => {
    if (isLocked || !inWix || !activeBrandId || wixRead.current.has(activeBrandId)) return;
    wixRead.current.add(activeBrandId);
    // As Webflow's: not cancelled with the effect.
    void refreshWixPublished(activeBrandId).then((published) => {
      if (published.length) setAttempt((n) => n + 1);
    });
  }, [isLocked, inWix, activeBrandId]);

  const reload = () => setAttempt((n) => n + 1);
  const titleOf = (draft: ContentDraftListItem) => draft.title.trim() || t('untitled');
  const failed = (err: unknown) => {
    console.error('Failed to change the Library draft:', err);
    toast.error(
      t(
        err instanceof Error && err.message === 'forbidden'
          ? 'rowMenu.forbidden'
          : err instanceof Error && err.message === 'newer_draft'
            ? 'rowMenu.newerDraft'
            : 'rowMenu.failed',
      ),
    );
  };

  const archive = async (draft: ContentDraftListItem, archived: boolean) => {
    try {
      await archiveContentDraft(draft.id, archived);
      reload();
      toast(t(archived ? 'rowMenu.archived' : 'rowMenu.restored', { title: titleOf(draft) }), {
        action: archived
          ? { label: t('rowMenu.undo'), onClick: () => void archive(draft, false) }
          : undefined,
      });
    } catch (err) {
      failed(err);
    }
  };

  const openSend = async (draft: ContentDraftListItem) => {
    if (!activeBrandId || preparing) return;
    // The draft's brand stays the send's, should the brand switch meanwhile.
    const brandId = activeBrandId;
    setPreparing(true);
    const source = await readCmsSources({
      brandId,
      draftIds: [draft.id],
      brandName: activeBrand?.name ?? '',
      brandLanguage: activeBrand?.language,
    }).then(
      (sources) => sources.get(draft.id) ?? null,
      (err) => {
        console.error('Failed to read the page to send:', err);
        return null;
      },
    );
    setPreparing(false);
    if (source) setSending({ brandId, source });
    else toast.error(t('rowMenu.sendFailed'));
  };

  const changeStatus = (draft: ContentDraftListItem, status: DraftStatus) => {
    // Published asks where the page is live (CE-013): tracking starts there.
    if (status === 'published') {
      setPublishing(draft.id);
      return;
    }
    // Ready keeps a History version and completes the draft's task, as the editor's Mark ready.
    const change =
      status === 'ready'
        ? markContentDraftReady(draft.id)
        : setContentDraftStatus(draft.id, status);
    change.then(reload, failed);
  };
  const rowActions: LibraryRowActions = {
    canManage,
    onStatus: (draft, status) =>
      guard(changeStatus, {
        action: tActions(
          status === 'published'
            ? 'markPublished'
            : status === 'ready'
              ? 'markReady'
              : 'changeContentStatus',
        ),
      })(draft, status),
    onArchive: (draft, archived) =>
      guard(() => void archive(draft, archived), {
        action: tActions(archived ? 'archiveContent' : 'restoreContent'),
      })(),
    onDelete: guard(setDeleting, { action: tActions('deleteContent') }),
    onExport: (draft, format) => void exportDraft(draft, format),
    onSend: guard((draft: ContentDraftListItem) => void openSend(draft), {
      action: tActions('sendToCms'),
    }),
    // Open while read-only, as the API keeps it: it only lowers what is live.
    onTakeDown: (draft, sent) =>
      setTakingDown({
        draftId: draft.id,
        title: titleOf(draft),
        url: sent.publishedUrl,
        target: sent.target,
      }),
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await deleteContentDraft(deleting.id);
      toast.success(t('rowMenu.deleted', { title: titleOf(deleting) }));
      setDeleting(null);
      reload();
    } catch (err) {
      failed(err);
    }
    setDeletePending(false);
  };

  const clearPicked = () => setPicked({ brandId: null, ids: new Set() });
  const changeTab = (next: LibraryTab) => {
    setTab(next);
    clearPicked();
    writeUrlParams({ tab: next }, { tab: 'all' });
  };
  const changeCreated = (next: CreatedRange) => {
    setCreated(next);
    clearPicked();
    writeUrlParams({ created: next }, { created: 'all' });
  };
  const changeMadeIn = (next: MadeInFilter) => {
    setMadeIn(next);
    clearPicked();
    writeUrlParams({ madeIn: next }, { madeIn: 'all' });
  };
  const changeSent = (next: SendFilter) => {
    setSent(next);
    clearPicked();
    writeUrlParams({ sent: next }, { sent: 'all' });
  };
  const changeShopping = (next: ShoppingFilter) => {
    setShoppingFilter(next);
    clearPicked();
    writeUrlParams({ shopping: next }, { shopping: 'all' });
  };

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  // A read for another brand (just switched) counts as still loading.
  const current = read?.brandId === activeBrandId ? read : null;
  const drafts = current?.drafts ?? null;
  const counts = current?.counts ?? null;
  const inTab = drafts ? draftsInTab(drafts, tab) : [];
  const createdIn = draftsMadeIn(draftsCreatedIn(inTab, created), madeIn);
  // Made in shows once the brand's drafts come from more than one place, or while the URL names one.
  const anyMadeElsewhere = !!drafts?.some((draft) => draft.origin !== 'editor');
  // Shopping paths are an online shop's (shopping path, 00351).
  const isShop = siteTypeOf(activeBrand ?? {}) === 'ecommerce';
  const shopped = isShop ? draftsByShopping(createdIn, shoppingFilter) : createdIn;
  // Filtered by their last send only once these drafts' sends are read (a
  // list read again in another order needn't wait); till then, none listed
  // to export or pick.
  const sendsRead = sent === 'all' || !drafts || drafts.every((draft) => cmsReadFor.has(draft.id));
  const listed = sendsRead ? draftsLastSent(shopped, cms, sent) : [];
  // Any of this brand's drafts sent: the sends of the last brand don't count.
  const anySent = !!drafts?.some((draft) => cms.has(draft.id));
  // Picked rows still listed (a read may have moved some), never archived ones.
  const pickedIds = picked.brandId === activeBrandId ? picked.ids : new Set<string>();
  const pickedDrafts = listed.filter((draft) => pickedIds.has(draft.id) && !draft.archivedAt);
  const selection: LibrarySelection | undefined =
    canManage && tab !== 'archived'
      ? {
          selected: pickedIds,
          onToggle: (ids, on) => {
            const next = new Set(pickedIds);
            for (const id of ids) {
              if (on) next.add(id);
              else next.delete(id);
            }
            setPicked({ brandId: activeBrandId, ids: next });
          },
        }
      : undefined;
  const tooMany = pickedDrafts.length > CMS_PAGES_PER_SEND;

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LibraryExportMenu
              disabled={listed.length === 0}
              exporting={exporting}
              onExport={(format) => void exportList(listed, tab, format)}
            />
            <Button
              className="gap-2"
              onClick={guard(() => setStarting(true), { action: tActions('createContent') })}
            >
              <Plus className="h-4 w-4" />
              {t('newContent')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>
      <NewContentDialog
        open={starting}
        onOpenChange={setStarting}
        brandId={activeBrandId}
        siteType={siteTypeOf(activeBrand ?? {})}
        onSent={() => setAttempt((n) => n + 1)}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => changeTab(v as LibraryTab)}>
          <TabsList variant="line" aria-label={t('tabsLabel')}>
            {LIBRARY_TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`tabs.${id}`)}
                {counts && <TabCount count={counts[id]} />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* On the tabs' line when they fit, else on their own, on the right. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Once a page of the brand's was sent, or while the URL names one. */}
          {(anySent || sent !== 'all') && (
            <Select
              value={sent}
              onValueChange={(value) => changeSent(value as SendFilter)}
              items={SEND_FILTERS.map((filter) => ({
                value: filter,
                label: `${t('lastSend.label')}: ${t(`lastSend.${filter}`)}`,
              }))}
            >
              <SelectTrigger size="sm" aria-label={t('lastSend.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SEND_FILTERS.map((filter) => (
                  <SelectItem key={filter} value={filter}>
                    {t(`lastSend.${filter}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(anyMadeElsewhere || madeIn !== 'all') && (
            <Select
              value={madeIn}
              onValueChange={(value) => changeMadeIn(value as MadeInFilter)}
              items={MADE_IN_FILTERS.map((filter) => ({
                value: filter,
                label: `${tMadeIn('label')}: ${tMadeIn(filter)}`,
              }))}
            >
              <SelectTrigger size="sm" aria-label={tMadeIn('label')} data-action="library.madeIn">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {MADE_IN_FILTERS.map((filter) => (
                  <SelectItem key={filter} value={filter}>
                    {tMadeIn(filter)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={created}
            onValueChange={(value) => changeCreated(value as CreatedRange)}
            items={CREATED_RANGES.map((range) => ({
              value: range,
              label: `${t('created.label')}: ${t(`created.${range}`)}`,
            }))}
          >
            <SelectTrigger size="sm" aria-label={t('created.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {CREATED_RANGES.map((range) => (
                <SelectItem key={range} value={range}>
                  {t(`created.${range}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isShop && (
            <Select
              value={shoppingFilter}
              onValueChange={(value) => changeShopping(value as ShoppingFilter)}
              items={SHOPPING_FILTERS.map((filter) => ({
                value: filter,
                label: `${t('shopping.label')}: ${t(`shopping.filters.${filter}`)}`,
              }))}
            >
              <SelectTrigger size="sm" aria-label={t('shopping.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SHOPPING_FILTERS.map((filter) => (
                  <SelectItem key={filter} value={filter}>
                    {t(`shopping.filters.${filter}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <Card className="py-0">
        {selection && pickedDrafts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {t('bulk.selected', { count: pickedDrafts.length })}
            </span>
            {tooMany && (
              <span className="text-xs text-amber-800 dark:text-amber-300">
                {t('bulk.tooMany', { max: CMS_PAGES_PER_SEND })}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={tooMany}
                onClick={guard(
                  () =>
                    setBulk({
                      brandId: activeBrandId,
                      brandName: activeBrand?.name ?? '',
                      brandLanguage: activeBrand?.language,
                      drafts: pickedDrafts,
                    }),
                  { action: tActions('sendToCms') },
                )}
              >
                <Send className="h-3 w-3" />
                {t('bulk.sendSelected')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearPicked}>
                {t('bulk.clear')}
              </Button>
            </div>
          </div>
        )}
        <CardContent className="px-0">
          {current?.failed ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('loadError')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRead(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            </div>
          ) : drafts === null || !sendsRead ? (
            <div className="flex items-center justify-center py-12" aria-busy="true">
              <LoadingDots size="md" className="text-muted-foreground" />
            </div>
          ) : listed.length === 0 && inTab.length > 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              {t(
                createdIn.length === 0
                  ? 'created.empty'
                  : shopped.length === 0
                    ? 'shopping.empty'
                    : 'lastSend.empty',
              )}
            </p>
          ) : (
            <LibraryTable
              drafts={listed}
              tab={tab}
              actions={rowActions}
              cms={cms}
              selection={selection}
              shopping={isShop}
            />
          )}
        </CardContent>
      </Card>
      {bulk && (
        <BulkSendDialog
          brandId={bulk.brandId}
          drafts={bulk.drafts}
          brandName={bulk.brandName}
          brandLanguage={bulk.brandLanguage}
          // The sends going on show in the rows as they land.
          onClose={() => {
            setBulk(null);
            clearPicked();
            setCmsAttempt((n) => n + 1);
          }}
        />
      )}
      {publishing && (
        <PublishDialog
          draftId={publishing}
          // The row menu offers Published only to a page that isn't.
          published={false}
          onClose={() => setPublishing(null)}
          onPublished={reload}
        />
      )}

      {takingDown && (
        <TakeDownDialog
          page={takingDown}
          onClose={() => setTakingDown(null)}
          // A draft in its CMS again: the row's status and send are read again.
          onDone={() => {
            reload();
            setCmsAttempt((n) => n + 1);
          }}
        />
      )}
      {sending && (
        <SendDialog
          draftId={sending.source.draftId}
          brandId={sending.brandId}
          title={sending.source.title}
          html={sending.source.html}
          sourceUrl={sending.source.sourceUrl}
          author={sending.source.author}
          reviewer={sending.source.reviewer}
          teamByline={sending.source.teamByline}
          byline={sending.source.byline}
          // Placeholders are filled in the editor.
          onFillNow={() => router.push(contentEditorPath(sending.source.draftId))}
          // A send that went or failed is the row's last: its sends are read again.
          onClose={() => {
            setSending(null);
            setCmsAttempt((n) => n + 1);
          }}
        />
      )}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">
              {t('deleteDialog.title', { title: deleting ? titleOf(deleting) : '' })}
            </DialogTitle>
            <DialogDescription>{t('deleteDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletePending}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletePending}
            >
              {t('deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* The cap's note: a filter that narrows the list isn't the cap. */}
      {counts &&
        created === 'all' &&
        sent === 'all' &&
        (!isShop || shoppingFilter === 'all') &&
        listed.length < counts[tab] && (
          <p className="text-xs text-muted-foreground">
            {t('latestOnly', {
              shown: formatNumber(listed.length),
              count: formatNumber(counts[tab]),
            })}
          </p>
        )}
    </div>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}
