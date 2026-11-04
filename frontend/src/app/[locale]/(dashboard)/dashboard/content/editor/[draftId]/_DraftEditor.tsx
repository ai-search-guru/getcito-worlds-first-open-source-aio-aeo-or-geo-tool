'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createDocument, getHTMLFromFragment } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Download,
  MessageSquare,
  PanelRight,
  Send,
  Target,
  X,
} from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { AiUsageBanner } from '@/components/ai-usage/AiUsageBanner';
import { AiUsageMeter } from '@/components/ai-usage/AiUsageMeter';
import { RunsTray } from '@/components/agentic/RunsTray';
import { StatusPill } from '@/components/agentic/StatusPill';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { DraftMethodBadge, DraftStatusBadge } from '@/components/content/DraftBadges';
import { PublishDialog } from '@/components/content/PublishDialog';
import { readLiveUrl } from '@/lib/content/publishClient';
import { SendDialog } from '@/components/content/SendToCmsDialog';
import { CmsSentChip } from '@/components/content/CmsSentChip';
import { readDraftCms, type DraftCms } from '@/lib/content/cmsSendClient';
import { updateBrand } from '@/lib/actions/brand';
import {
  decideDraftSuggestions,
  fixDraftRules,
  handOffDraft,
  type HandOffError,
  getCitedPassages,
  getDraftSuggestions,
  getLastRestoreAt,
  getLastPageRewrite,
  type AgentEmptyWhy,
  keepAgentBeforeVersion,
  markContentDraftReady,
  unmarkContentDraftReady,
  restoreDraftVersion,
  setContentDraftAuthor,
  setContentDraftReviewer,
  confirmDraftAuthor,
  setDraftSchemaLeftOut,
  keepDraftSource,
  confirmDraftItem,
  confirmOwnImage,
  getCatalogMatch,
  getDraftConfirmations,
  getOwnImages,
  setContentDraftPageType,
  startAgentWriting,
  startPageRewrite,
} from '@/lib/actions/contentDrafts';
import { getBrandRules } from '@/lib/actions/contentSettings';
import { getSiteTrust } from '@/lib/actions/audits';
import { getContentAuthors } from '@/lib/actions/contentAuthors';
import { readAgentRun, stopAgentRun } from '@/lib/content/agentRunsClient';
import { agentWriteRequest, useRuleDescriber } from '@/lib/content/agentWrite';
import { authorInitials, canEditAuthor, type AuthorsRead } from '@/lib/content/authors';
import type { SiteTrust } from '@/lib/content/siteTrust';
import {
  AGENT_POLL_MS,
  CONTENT_LIBRARY_PATH,
  isPageType,
  type ContentDraft,
  type PageType,
} from '@/lib/content/drafts';
import { CITED_DAYS, MAX_PASSAGES, type CitedPassage } from '@/lib/content/citedPassages';
import {
  draftExportBlob,
  draftExportFileName,
  type DraftExportFormat,
} from '@/lib/content/draftExport';
import type { DraftVersion } from '@/lib/content/history';
import {
  AGENT_RUN_MAX,
  batchSources,
  type DraftSuggestion,
  type SuggestionSource,
  type SuggestionStatus,
} from '@/lib/content/suggestions';
import { rebuildSources } from '@/lib/content/brief';
import { buildSourceGroups, type DraftSourceKind } from '@/lib/content/sources';
import {
  cleanHtml,
  formatHtmlSource,
  htmlFromSource,
  publishableHtml,
} from '@/lib/content/cleanHtml';
import {
  EDITOR_STARTER_KIT,
  PAGE_READ_DELAY_MS,
  draftTitleFromDoc,
  safeLinkHref,
} from '@/lib/content/editor';
import { JsonLd } from '@/lib/content/jsonLdNode';
import {
  articleSchemaInput,
  firstImage,
  hasArticleSchema,
  isArticlePage,
  pageName,
  listedProducts,
  MIN_LISTED,
  schemaAuthor,
  withArticleSchema,
  type AddedArticleSchema,
} from '@/lib/content/pageSchema';
import { PLACEHOLDER, pagePlaceholders } from '@/lib/content/placeholders';
import { HANDOFF_KEYS, handOffItems } from '@/lib/content/handOff';
import {
  blankCode,
  bylineText,
  disclosureText,
  exportPlaceholders,
  pasteChecks,
  reviewerJsonLd,
  pageFields,
  teamName,
  titlePlaceholders,
  withByline,
  withReviewerJsonLd,
} from '@/lib/content/readyToPublish';
import { estimateDocument } from '@/lib/content/auditEstimate';
import { detectPageType, isSiteType, type SiteType } from '@/lib/content/pageTypes';
import { BAND_CLASSES, qualityAverage, qualityBand, qualityPhase } from '@/lib/content/quality';
import { inputsGiven } from '@/lib/content/draftInputs';
import {
  linksToCheck,
  squeeze,
  trustBlocks,
  unplacedSites,
  type ClaimMark,
} from '@/lib/content/qualityChecks';
import { checkDateText, isCheckDateLine } from '@/lib/content/checkDate';
import { checksOff, profileFor } from '@/lib/content/qualityProfiles';
import { caseConfirmed, caseKey, proofKey, qualityTodos } from '@/lib/content/qualityTodos';
import { introConfirmKeys } from '@/lib/content/introFacts';
import { isByline } from '@/lib/content/readability';
import { normalizeDomain } from '@/lib/citations/classify';
import { brandFactsPath } from '@/lib/content/brandFacts';
import { type CatalogMatch } from '@/lib/content/feedMatch';
import { qualityState } from '@/lib/content/qualityInputs';
import { MAX_PROOF_TODOS, type ProofSpot } from '@/lib/content/pageRead';
import {
  liveSkips,
  nextStep,
  rulesForNext,
  stepState,
  thirdPassOf,
  thirdPassesToRead,
  thirdStepPasses,
  thirdStepTried,
  type NextAction,
  type NextStepId,
  type NextStepState,
  type ThirdStepId,
  type ThirdTry,
} from '@/lib/content/nextStep';
import {
  aiTracesFound,
  fanoutsToUse,
  lengthWarns,
  notForAgentMessage,
  openRulesForAgent,
  overLengthFor,
  lengthBand,
  rewriteAdvice,
  NO_RULE_CONTEXT,
  checkRule,
  heldMessage,
  keptOutOfReach,
  lengthOutOfReach,
  readPage,
  pageTextLength,
  ruleNumber,
  rulesMet,
  type ActiveRule,
  type LastRewrite,
  type RewriteReach,
  type RuleStatus,
} from '@/lib/content/rules';
import { shoppingLinks, type ShoppingLinks } from '@/lib/content/shoppingCheck';
import { aiUsageTone } from '@/lib/billing/aiUsage';
import { saveBlob } from '@/lib/download';
import { exportAuthor, exportFileWord } from '@/lib/white-label/exportName';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { AgentCard } from './_AgentCard';
import { AuthorMenu, MANAGE_AUTHORS_PATH } from './_AuthorMenu';
import { ReviewerMenu } from './_ReviewerMenu';
import { BeforePublish, TRUST_GATE, type ReadyAnyway, type ReadyToPaste } from './_BeforePublish';
import { FlashBlock, findBlock, flashKey } from './_flashBlock';
import { PlaceholderMarks, placeholderRanges, selectPlaceholder } from './_placeholderMarks';
import { useAgentRun } from './_useAgentRun';
import { useAutoHandOff } from './_useAutoHandOff';
import { useLinkChecks } from './_useLinkChecks';
import { WorkingDots } from './_WorkingDots';
import { DropOverlay, useAttachments } from './_attach';
import {
  CITED_EDIT_ALLOWED,
  CitedPassages,
  citedLocks,
  citedPassagesKey,
  lockedPassageCount,
  htmlWithoutLocked,
  lockedKeysLeft,
  lockedPassagesLeft,
  rewriteFloor,
  type HeldEdit,
} from './_citedPassages';
import { ExportDialog, type ExportDestination } from './_ExportDialog';
import { ExportMenu } from './_ExportMenu';
import { sourceDetail } from './_SourcesTab';
import { HistoryMenu } from './_HistoryMenu';
import { pagePillOf } from './_pagePill';
import { HtmlBlock, copyToClipboard } from './_HtmlBlock';
import { OwnCopies, ownCopyHtml } from './_ownCopies';
import { NextNudge, useNextNudge } from './_NextNudge';
import { PageInfoStrip, pageInfoKey } from './_pageInfo';
import { WeakSourcesMarks, weakSourcesKey } from './_weakSources';
import { ClaimMarksExtension, claimMarksKey, textRanges, writingBlock } from './_claimMarks';
import { ProofImageDialog } from './_ProofImageDialog';
import { ProofSpotsExtension, openSpotPlaces, proofSpotsKey } from './_proofSpots';
import { ConfirmImagesDialog } from './_ConfirmImagesDialog';
import { useClaims } from './_useClaims';
import { useBrandFacts } from './_useBrandFacts';
import { usePageRead } from './_usePageRead';
import { useSourceClasses } from './_useSourceClasses';
import { HeaderTip } from './_HeaderTip';
import {
  NextStepButton,
  readSkips,
  readThirdStep,
  type ThirdStepStore,
  stepActor,
  stepName,
  stepReason,
  wordsUnderTitle,
  writeSkips,
  writeThirdStep,
} from './_NextStep';
import {
  NO_TRIED,
  readTried,
  runDecided,
  triedAfter,
  triedOpen,
  triedStill,
  writeTried,
  type TriedRules,
} from '@/lib/content/triedRules';
import {
  qualitySuggestions,
  useTodoCopy,
  type HandOff,
  type QualityFocus,
  type QualityRead,
} from './_QualityTab';
import { AuditEstimateCard, useAuditEstimate } from './_AuditEstimate';
import { PageTypeMenu } from './_PageTypeMenu';
import type { AgentRewrite } from './_BriefTab';
import { ruleStatusDetail, type AgentFix, type PageRewrite } from './_RulesTab';
import { pageChangedSince } from './_PageRewrite';
import { EditorPanelRail, EditorSidePanel, useSidePanelOpen, type PanelTarget } from './_SidePanel';
import {
  AgentSuggestions,
  acceptInto,
  suggestionsKey,
  redoDecision,
  undoInto,
  type SuggestionDecision,
  type SuggestionLabels,
} from './_suggestions';
import { ONE_H1_AS_IS, OneH1 } from './_oneH1';
import { useDraftInputs } from './_useDraftInputs';
import { useDraftReads } from './_useDraftReads';
import { useDraftRules } from './_useDraftRules';
import { EditorToolbar } from './_toolbar';
import { useShoppingCheck } from './_useShoppingCheck';
import { useDraftAutosave, type SaveState } from './_useAutosave';

/**
 * The page as it reads: the app's prose type, links blue and underlined so
 * they read as links, tables with cell borders, a placeholder while empty,
 * and the selected table cells and images marked.
 */
const DOCUMENT_CLASS = cn(
  // Relative: the visual proof spots sit beside their paragraphs, in its margin (CE-049).
  'relative prose prose-neutral max-w-none dark:prose-invert min-h-[50vh] focus:outline-none',
  'prose-a:font-normal prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2 dark:prose-a:text-blue-400',
  // A weak source's amber wavy line takes the place of its link's (CE-046).
  'prose-a:has-[.quality-weak-source]:no-underline!',
  'prose-h1:text-3xl prose-h1:tracking-tight prose-h2:tracking-tight',
  '[&_table]:my-4 [&_table]:w-full [&_table]:table-fixed [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left',
  // Cells and list items hold paragraphs; their margins would pad every row.
  '[&_td>p]:my-0 [&_th>p]:my-0 [&_li>p]:my-0 prose-li:my-1',
  '[&_.selectedCell]:bg-primary/10 [&_img]:rounded-md [&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-ring/50',
  // Locked passages (CE-018): a green line, and what quotes them above.
  '[&_.cited-passage]:rounded-r-md [&_.cited-passage]:border-l-[3px] [&_.cited-passage]:border-emerald-300 [&_.cited-passage]:bg-emerald-50/70 [&_.cited-passage]:py-1 [&_.cited-passage]:pr-2 [&_.cited-passage]:pl-3 dark:[&_.cited-passage]:border-emerald-700 dark:[&_.cited-passage]:bg-emerald-950/30',
  '[&_.cited-passage]:before:mb-0.5 [&_.cited-passage]:before:block [&_.cited-passage]:before:text-[11.5px] [&_.cited-passage]:before:leading-snug [&_.cited-passage]:before:font-medium [&_.cited-passage]:before:tracking-normal [&_.cited-passage]:before:text-emerald-700 [&_.cited-passage]:before:content-[attr(data-cited-label)] dark:[&_.cited-passage]:before:text-emerald-400',
  // An accepted agent suggestion (CE-018): a thin green line, the words it put in underlined.
  '[&_.agent-accepted]:border-l-2 [&_.agent-accepted]:border-emerald-300 [&_.agent-accepted]:pl-2.5 dark:[&_.agent-accepted]:border-emerald-700',
  '[&_.agent-accepted-text]:underline [&_.agent-accepted-text]:decoration-emerald-300 [&_.agent-accepted-text]:decoration-2 [&_.agent-accepted-text]:underline-offset-4 dark:[&_.agent-accepted-text]:decoration-emerald-700',
  '[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
);

/**
 * How long Fix open rules waits for the agent's batch when its answer didn't
 * come back: past the API's model call (contentAgent.js, 60 s) and the
 * batch's save.
 */
const FIX_WAIT_MS = 90_000;

/** The runs the agent card shows: Fix open rules', or the brief's. */
// Fix open rules, and Quality's hand-off (CE-051): the same card, steps and Stop.
const FIX_RUNS = ['fix', 'handoff'] as const;
/** How long after the page's read a third-step pass waits for the rules' deferred read. */
const PASS_SETTLE_MS = 250;
const BRIEF_RUNS = ['brief'] as const;

/** How a run whose answer was lost on the way ended, as the page and the run's row say. */
type AgentOutcome =
  | { batch: DraftSuggestion[] }
  | { nothing: true; why?: AgentEmptyWhy }
  | { stopped: true }
  | { failed: true }
  | null;

/**
 * How Fix open rules' run ended when its answer didn't come back (a timeout
 * on the way), read every few seconds until the deadline: its batch once it
 * lands, or its row once it's finished (content_agent_runs) — done with
 * nothing left, and why (editor test 2026-10-25: read as "couldn't run"
 * after 90 s), stopped, or failed. Fix open rules only runs with none open,
 * so any open suggestion is the agent's. Its row is Fix's kinds' latest that
 * isn't the one there was before it was asked (`before`). Null when neither
 * came in time.
 */
async function agentOutcome(
  draftId: string,
  before: string | null,
  until: number,
): Promise<AgentOutcome> {
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, AGENT_POLL_MS));
    const read = await getDraftSuggestions(draftId).catch(() => null);
    if (read?.some((s) => s.status === 'open')) return { batch: read };
    const run = await readAgentRun(draftId, FIX_RUNS).catch(() => null);
    if (!run || run.id === before || !run.finishedAt) continue;
    if (run.outcome === 'stopped') return { stopped: true };
    if (run.outcome === 'failed') return { failed: true };
    // Done: with what it left (its writing step's count), the batch reads next time round.
    if (run.outcome === 'done' && !run.steps[2]?.count) {
      return { nothing: true, why: run.steps[2]?.why };
    }
  }
  return null;
}

/** What a paragraph Remove empties goes with, when it was all they held (CE-045). */
const EMPTIED_WITH = new Set([
  'listItem',
  'taskItem',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
]);

/**
 * The content editor (Content Editor, CE-004, spec §6): a header with the
 * draft's title, page type and method, whether it's saved, and Mark ready;
 * the toolbar; and the page itself, rich text that saves as you write. The
 * draft's title is its first heading, as the Library lists it.
 *
 * A paste is cleaned on the way in (CE-005): headings, lists, links and
 * tables stay; fonts, colors, styles and tracking parameters go; ⌘/Ctrl +
 * Shift + V pastes plain text. The HTML view (CE-020) shows the page's
 * source, and cleans it the same way when it switches back. HTML blocks
 * carry code as written, as many as the page needs, and Copy HTML puts the
 * whole page, or one block, on the clipboard. The page type follows the page
 * as it is written until the person picks one (CE-023). The side panel, open
 * beside the page or closed from the header, shows what the page earns
 * (Impact, CE-016), its brief and the sources it draws on (CE-007, CE-008)
 * and the rules it is written to (CE-009); the header's chip says how many
 * of those rules the page meets now. History keeps earlier versions (the
 * imported live page, each Mark ready) and restores any of them; passages
 * AI answers quote today are locked: marked, and changed only after a
 * warning; an agent's suggestions sit in the page as cards to accept or
 * reject, with the agent bar over it, and Fix open rules with agent asks the
 * Content Agent for a new batch (CE-018).
 */

export function DraftEditor({
  draft,
  onAgentStarted,
  agentFinished = false,
}: {
  draft: ContentDraft;
  /**
   * The Content Agent took the draft again (Try again, Rewrite from brief, or
   * Rewrite the whole page): the page waits for it.
   */
  onAgentStarted?: (run: 'write' | 'rewrite') => void;
  /** The editor opens on what the agent just wrote here: the next-step nudge's moment. */
  agentFinished?: boolean;
}) {
  const t = useTranslations('contentEditor.editor');
  const tNext = useTranslations('contentEditor.editor.nextStep');
  const tPublish = useTranslations('contentEditor.publish');
  // A read-only workspace (plan not active): the page opens read-only and
  // nothing is saved; each action opens the upgrade dialog instead, named.
  // The reads the editor asks the API for by itself after a save (links,
  // sources, claims, the page's proof) are left out; it shows what is stored.
  const { guard, isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  /** Read-only: the upgrade dialog, labeled with what was asked for; true when so. */
  const lockedFor = (action: Parameters<typeof tActions>[0]) => {
    if (isLocked) openUpgrade(tActions(action));
    return isLocked;
  };
  const autosave = useDraftAutosave(draft.id, draft, { off: isLocked });
  const [title, setTitle] = useState(draft.title);
  // The page as written now, for the side panel's Sources.
  const [pageHtml, setPageHtml] = useState(draft.bodyHtml);
  const pageReadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Quality's Show marks a block for a moment: a second Show starts the moment again.
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pageReadTimer.current), []);
  const [status, setStatus] = useState(draft.status);
  // With the new Chat on, the header speaks Chat's language: the page's pill and the runs tray.
  const chatOn = useChatAgentic();
  // Where the page is live (CE-013), and Mark published open.
  const [liveUrl, setLiveUrl] = useState(draft.publishedUrl);
  const [askLive, setAskLive] = useState(false);
  const [preparingLive, setPreparingLive] = useState(false);
  const tDraftStatus = useTranslations('contentEditor.status');
  const [marking, setMarking] = useState(false);
  // The Content Agent couldn't finish the page Start gave it (CE-015).
  const [agentFailed, setAgentFailed] = useState(draft.agentState === 'failed');
  // That run was a rewrite (agent_run, on every device): Try again rewrites again.
  const failedRewrite = draft.agentState === 'failed' && draft.agentRun === 'rewrite';
  const [starting, setStarting] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const describeRule = useRuleDescriber();
  const [restoring, setRestoring] = useState(false);
  // Set at once, not on the next render: two quick clicks restore once
  // (editor test 2026-10-25: two "Before a restore" versions in a minute).
  const restoringNow = useRef(false);
  const format = useFormatter();
  // A change to a locked passage, waiting for the person (CE-018).
  const [held, setHeld] = useState<HeldEdit | null>(null);
  // What quotes each locked passage, for the warning: "ChatGPT 14× and …".
  const citedBy = useRef(new Map<string, string>());
  const [citedCount, setCitedCount] = useState(0);
  // Whether the locked passages have been read: until then the agent would
  // be told none are locked (a new page has none to read).
  const [citedRead, setCitedRead] = useState(!draft.sourceUrl);
  // An agent's suggestions (CE-018): its latest batch, with what was decided.
  const [suggestions, setSuggestions] = useState<DraftSuggestion[]>([]);
  // The agent's last run failed (Fix or hand-off): the card says so over an earlier batch.
  const [lastRunFailed, setLastRunFailed] = useState(false);
  const suggestionsNow = useRef(suggestions);
  // The agent on the Next step basket's third step (Fix open rules, Rewrite
  // page): its run, and the steps it took with what the page read then; and
  // the step as it is now. Once the run's changes are decided, Next moves on
  // (thirdStepTried, thirdStepPasses).
  const [thirdStep, setThirdStep] = useState<ThirdStepStore>(() => readThirdStep(draft.id));
  const thirdStepNow = useRef(thirdStep);
  // What the read of its run (below) found the attempt kept from before to
  // be now: a run begun while the read was out that then doesn't run puts
  // that back, not the attempt as it was.
  const attemptRead = useRef<{ of: ThirdTry; now: ThirdTry | null } | null>(null);
  const nextStepNow = useRef<NextStepId | null>(null);
  // An attempt kept from before the editor opened, not yet taken: whether
  // its run was read (below). Until then no step passes on it.
  const [attemptChecked, setAttemptChecked] = useState(
    () => !thirdStep.attempt || thirdStep.attempt.ended === true,
  );
  const saveThirdStep = (store: ThirdStepStore) => {
    thirdStepNow.current = store;
    setThirdStep(store);
    writeThirdStep(draft.id, store);
  };
  const saveThirdTry = (attempt: ThirdTry | null) =>
    saveThirdStep({ ...thirdStepNow.current, attempt });
  // The rules Fix open rules tried and couldn't close (editor test
  // 2026-11-03): Rules shows them amber, the person's to decide.
  const [triedRules, setTriedRules] = useState<TriedRules>(() => readTried(draft.id));
  const triedNow = useRef(triedRules);
  const saveTried = (store: TriedRules) => {
    triedNow.current = store;
    setTriedRules(store);
    writeTried(draft.id, store);
  };
  /**
   * Notes a run the third step takes, from the batch on the page now, while
   * Next's step (`at`, as it was when the run was asked for) is the third: a
   * rewrite takes the Length, a Fix takes Fix open rules, and only when it's
   * asked for every rule the step counts (Remove AI traces alone isn't the
   * step). The attempt before it, to put back when the run doesn't happen or
   * is stopped; null when it isn't the step's run.
   */
  const beginThirdTry = (
    kind: ThirdTry['kind'],
    { only, at = nextStepNow.current }: { only?: string[]; at?: NextStepId | null } = {},
  ): { prev: ThirdTry | null } | null => {
    if (at !== 'length' && at !== 'fixRules') return null;
    if (
      kind === 'fix' &&
      only &&
      !rulesForNext(rules.rules, heldRules).every((key) => only.includes(key))
    ) {
      return null;
    }
    const prev = thirdStepNow.current.attempt;
    saveThirdTry({
      step: kind === 'rewrite' ? 'length' : 'fixRules',
      kind,
      at: new Date().toISOString(),
      batch: suggestionsNow.current[0]?.batchId ?? null,
    });
    return { prev };
  };
  const [deciding, setDeciding] = useState(false);
  const [barClosed, setBarClosed] = useState(false);
  const [fixing, setFixing] = useState(false);
  // The brief the agent writes from the side panel: the card shows it working too.
  const [briefRebuilding, setBriefRebuilding] = useState(false);
  // Fix (or the brief) is the server's now: the card says the page can be left (Chat on).
  const [fixOnServer, setFixOnServer] = useState(false);
  const [briefOnServer, setBriefOnServer] = useState(false);
  // The run Stop was pressed for: the card waits for it to end (CE-027). Another
  // run under way (one a restarted server left was shown first) can be stopped.
  const [stoppingRun, setStoppingRun] = useState<string | null>(null);
  // The Stop sent, and whether it stopped a run: an answer lost after it is no failure.
  const stopSent = useRef<Promise<boolean> | null>(null);
  // Whether the side panel's brief is rebuilding, as it last said.
  const briefNow = useRef(false);
  const tRules = useTranslations('contentEditor.editor.rules');
  /** A rule's aim and how the page reads now, as the agent is told them (Fix open rules, Hand off). */
  const aimAndNow = (rule: ActiveRule, status: RuleStatus) => [
    rule.current
      ? `${tRules('agent.aim')}: ${rule.current}${rule.unit ? ` ${tRules(`units.${rule.unit}`)}` : ''}`
      : null,
    `${tRules('agent.now')}: ${ruleStatusDetail(tStatus, status)}`,
  ];
  const tStatus = useTranslations('contentEditor.editor.rules.status');
  // History keeps the page before the first suggestion accepted here.
  const agentBeforeKept = useRef(false);
  const onDecide = useRef<(id: string, decision: SuggestionDecision) => void>(() => {});
  // A picked page type, or the one the page shows as it is written. As on
  // a save, a page that shows no type keeps the one it had (the stored one
  // to start with), so the header and the Library agree; read with the
  // existing page's address, as Start read it, so both agree on it too.
  const [picked, setPicked] = useState(draft.pageTypeSource === 'user' ? draft.pageType : null);
  const [detectedType, setDetectedType] = useState(
    () =>
      detectPageType(
        { title: draft.title, html: draft.bodyHtml, url: draft.sourceUrl },
        draft.siteType,
      ) ?? (isPageType(draft.pageType) ? draft.pageType : null),
  );
  // The brand's site type (Quality CE-056, the spec's business type), changed
  // here for the whole brand; a ref too, as the editor's update handler is
  // made once.
  const [siteType, setSiteType] = useState<SiteType>(draft.siteType);
  const siteTypeRef = useRef(draft.siteType);
  const detectType = (title: string, html: string) => {
    const site = siteTypeRef.current;
    setDetectedType((had) => detectPageType({ title, html, url: draft.sourceUrl }, site) ?? had);
  };
  const pageType = picked ?? detectedType;
  // The HTML view's text while it is open; null in the visual editor.
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [htmlEdited, setHtmlEdited] = useState(false);
  // Files dropped on the page go in where they land (CE-006).
  const attachRef = useRef<(files: File[]) => void>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [panelOpen, togglePanel] = useSidePanelOpen();
  // The header's rules chip opens the panel on Rules, and the closed panel's
  // strip on the tab picked there.
  const [tabRequest, setTabRequest] = useState<{
    tab: PanelTarget;
    n: number;
    /** A source to show in Sources: a "Based on" chip or mark clicked (CE-033). */
    source?: { kind: DraftSourceKind; ref: string };
    /** The brief to build, from the Next step basket's Build brief. */
    build?: boolean;
    /** Brief › Your input to show: Quality's Add (CE-048). */
    input?: boolean;
    /** Quality's part to show, from the Next step basket: its to-dos, or what raises Trust. */
    focus?: QualityFocus;
  } | null>(null);
  const openPanelTab = (tab: PanelTarget, source?: { kind: DraftSourceKind; ref: string }) => {
    if (!panelOpen) togglePanel();
    setTabRequest((prev) => ({
      tab,
      n: (prev?.n ?? 0) + 1,
      ...(source ? { source: { kind: source.kind, ref: source.ref } } : {}),
    }));
  };
  const onSource = useRef<(source: SuggestionSource) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure(EDITOR_STARTER_KIT),
      TableKit.configure({ table: { resizable: false } }),
      Image,
      CharacterCount,
      Placeholder.configure({ placeholder: t('placeholder') }),
      JsonLd.configure({
        label: (type) => (type ? t('jsonLd', { type }) : t('jsonLdUntyped')),
      }),
      HtmlBlock,
      OwnCopies,
      CitedPassages.configure({
        // The first change held is the one asked about: some keyboards
        // still send the text of a key whose keydown was held, and the
        // person can't type while the question is open.
        onHeld: (edit) => setHeld((current) => current ?? edit),
      }),
      AgentSuggestions.configure({
        onDecide: (id, decision) => onDecide.current(id, decision),
        onSource: (source) => onSource.current(source),
      }),
      OneH1,
      FlashBlock,
      PlaceholderMarks,
      PageInfoStrip,
      WeakSourcesMarks,
      ClaimMarksExtension,
      ProofSpotsExtension,
    ],
    content: draft.bodyHtml,
    // Read-only: no typing, pasting or dropping into the page.
    editable: !isLocked,
    // Rendered on the client only, so the server's HTML can't disagree with it.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: DOCUMENT_CLASS, 'aria-label': t('documentLabel') },
      transformPastedHTML: (html) => {
        // A copy from this editor keeps its images and HTML blocks, and needs
        // no word about it. Only this tab's copies carry its mark.
        const own = ownCopyHtml(html);
        if (own !== null) {
          return cleanHtml(own, { keepImages: true, keepHtmlBlocks: true }).html;
        }
        // Images from elsewhere wait for attachments (CE-006): Docs' and
        // Word's are temporary addresses or embedded data.
        const cleaned = cleanHtml(html, { keepImages: false });
        toast(cleaned.imagesRemoved ? t('paste.cleanedNoImages') : t('paste.cleaned'));
        return cleaned.html;
      },
      transformPastedText: (text, plain) => {
        if (plain) toast(t('paste.plain'));
        return text;
      },
      // A click on a link puts the cursor in it, to edit it; ⌘/Ctrl + click
      // opens it, as in other editors. A path on the brand's own site has no
      // address here to open.
      handleClick: (_view, _pos, event) => {
        if (!event.metaKey && !event.ctrlKey) return false;
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
        if (!href || !/^https?:/.test(safeLinkHref(href) ?? '')) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))),
          );
        }
        attachRef.current?.(files);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = draftTitleFromDoc(e.getJSON());
      const bodyHtml = e.getHTML();
      setTitle(next);
      autosave.schedule({ title: next, bodyHtml });
      // The panel and the type chip catch up once typing pauses.
      clearTimeout(pageReadTimer.current);
      pageReadTimer.current = setTimeout(() => {
        setPageHtml(bodyHtml);
        detectType(next, bodyHtml);
      }, PAGE_READ_DELAY_MS);
    },
  });

  const attachments = useAttachments(editor);
  // The rules the page is written to, checked as it reads now (CE-009).
  // The brief and sources, read once: the rules check against them, the panel shows them.
  const reads = useDraftReads(draft.id);
  // Phase 3 (CE-053): a product page's product in the brand's catalog, by
  // its URL or its title, read once typing pauses: Trust and the Rules
  // tab's feed rule check the page against it. Undefined while not read.
  const feedOn = profileFor(pageType) === 'product';
  const [catalogRead, setCatalogRead] = useState<{ title: string; read: CatalogMatch | null }>();
  useEffect(() => {
    if (!feedOn) return;
    let live = true;
    const timer = setTimeout(() => {
      getCatalogMatch(draft.id, title)
        .then((read) => live && setCatalogRead({ title, read }))
        .catch((err) => {
          console.error('Failed to read the catalog:', err);
          if (live) setCatalogRead({ title, read: null });
        });
    }, PAGE_READ_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [feedOn, draft.id, title]);
  // A product found by its name is the page's while the title is that name:
  // after a change, it is read again.
  const catalog =
    catalogRead &&
    (catalogRead.read?.product?.via !== 'name' ||
      catalogRead.title.trim().toLowerCase() === title.trim().toLowerCase())
      ? catalogRead.read
      : undefined;
  // The shopping path against the catalog now, for the Shopping rules and
  // Before you publish (shopping path, part 6).
  const shoppingCheck = useShoppingCheck({ draftId: draft.id, siteType, pageType });
  const rules = useDraftRules({
    draft,
    siteType,
    html: pageHtml,
    characters: (editor?.storage.characterCount.characters() as number | undefined) ?? 0,
    pageType,
    reads,
    catalog: feedOn ? (catalog === undefined ? 'reading' : catalog) : null,
    shopping: shoppingCheck.check,
  });
  // What a page rewrite keeps as it is (the passages AI answers quote, tables,
  // images…), read as the characters are, and the least it comes to with the
  // headings and their answers: a Length under that is out of reach.
  const summaryAsked = rules.rules.some(({ rule }) => rule.key === 'summary' && rule.on);
  const { kept: keptChars, floor: floorChars } =
    editor && citedRead
      ? rewriteFloor(editor.state, { summary: summaryAsked })
      : { kept: 0, floor: 0 };
  // A page's characters as the toolbar counts them (the editor's own
  // count), for a rewrite's before and after (editor test 2026-10-25: the
  // card said 6,725 → 5,571 where the counter said 6,617 → 5,468).
  const htmlChars = (html: string) =>
    editor && !editor.isDestroyed
      ? ((editor.storage.characterCount.characters({
          node: createDocument(html, editor.schema),
        }) as number | undefined) ?? pageTextLength(html))
      : pageTextLength(html);
  // The Length the page is written to, for what the agent's rewrite reached.
  const lengthRule = rules.rules.find(({ rule }) => rule.key === 'length' && rule.on)?.rule;
  const lengthTarget = Number(lengthRule?.current);
  const length =
    lengthRule && Number.isFinite(lengthTarget) && lengthTarget > 0
      ? { target: lengthTarget, ...lengthBand(lengthTarget), kept: keptChars }
      : null;
  // How well the page reads as written (Quality spec, CE-036/039): read in the
  // browser, no AI cost; off until Quality's first phase is live. Read in the
  // language the page is written in: its Language rule when that is on (the
  // agent writes in it, and it can differ per draft), else the brand's.
  const brandLanguage = useBrandStore(
    (s) => s.brands.find((b) => b.id === draft.brandId)?.language,
  );
  const languageRule = rules.rules.find(({ rule }) => rule.key === 'language')?.rule;
  const language =
    languageRule?.on && languageRule.current.trim() ? languageRule.current : brandLanguage;
  const qualityOn = qualityPhase() >= 1;

  // Who the page is by (CE-038): page metadata, shown in the header and in a
  // Page info strip outside the page; with Quality's first phase.
  const [authorsRead, setAuthorsRead] = useState<AuthorsRead | null>(null);
  // Read, or failed to: the header's score waits for it either way.
  const [authorsTried, setAuthorsTried] = useState(false);
  const [authorId, setAuthorId] = useState(draft.authorId);
  // The qualified reviewer of a page that advises on health, finance or law (CE-049).
  const [reviewerId, setReviewerId] = useState(draft.reviewerId);
  // The author the database holds, and the latest pick: a slower pick that
  // fails after a later one landed doesn't roll the menu back.
  const savedAuthor = useRef(draft.authorId);
  const authorPick = useRef(0);
  const [authorChangedAt, setAuthorChangedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!qualityOn) return;
    let live = true;
    getContentAuthors()
      .then((read) => live && setAuthorsRead(read))
      .catch((err) => console.error('Failed to load the authors:', err))
      .finally(() => live && setAuthorsTried(true));
    return () => {
      live = false;
    };
  }, [qualityOn]);
  const storeBrandName = useBrandStore((s) => s.brands.find((b) => b.id === draft.brandId)?.name);
  const brandName =
    authorsRead?.brands.find((b) => b.id === draft.brandId)?.name ?? storeBrandName ?? '';
  const pageAuthor = authorsRead?.authors.find((a) => a.id === authorId) ?? null;
  // The brand's rules (Settings › Content, 00450), read once: Rules shows them above the page's own.
  const [brandRules, setBrandRules] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getBrandRules(draft.brandId).then((rules) => live && setBrandRules(rules));
    return () => {
      live = false;
    };
  }, [draft.brandId]);
  const pageBlocks = useMemo(() => (qualityOn ? trustBlocks(pageHtml) : []), [qualityOn, pageHtml]);
  // Brief › Your input (CE-048), with Quality's second phase: what the page
  // uses of it counts once it is read.
  // In that phase the scores wait for it; a read that failed leaves them
  // without it, and Brief offers to read it again.
  const inputsRead = useDraftInputs(draft.id, qualityPhase() >= 2);
  const inputs = inputsRead.status === 'ready' ? inputsRead.inputs : null;
  const inputsPending = inputsRead.status === 'loading';
  // With no author picked, the person's own word for the one their site
  // names (00271): ticked here, saved behind, put back if the save fails.
  const [authorConfirmed, setAuthorConfirmed] = useState(draft.authorConfirmed);
  // One save at a time (the boxes wait): a failed one puts back the pair as saved.
  const [confirming, setConfirming] = useState(false);
  const confirmAuthor = (what: 'real' | 'profile', on: boolean) => {
    if (lockedFor('confirmDetails') || confirming) return;
    const before = authorConfirmed;
    // Unticking the author unticks their profile too, as the database does.
    setAuthorConfirmed(
      what === 'real' && !on ? { real: false, profile: false } : { ...before, [what]: on },
    );
    setConfirming(true);
    confirmDraftAuthor(draft.id, what, on)
      .catch((err) => {
        console.error('Failed to save the author confirmation:', err);
        setAuthorConfirmed(before);
        toast.error(t('quality.confirmFailed'));
      })
      .finally(() => setConfirming(false));
  };
  // Trust from the page's figures and links (their reads from the API).
  const { checks: linkChecks, pending: linksPending } = useLinkChecks(
    draft.id,
    autosave.savedAt,
    linksToCheck(pageBlocks),
    qualityOn && !isLocked,
  );
  const brandDomains = reads.sources?.data?.brandDomains;
  // The site's trust (Site Audit, CE-043), read once: Trust's last 5 points.
  const [siteTrust, setSiteTrust] = useState<SiteTrust | null>(null);
  // Read, or failed to: null alone can't tell "loading" from "none".
  const [siteTrustRead, setSiteTrustRead] = useState(false);
  useEffect(() => {
    if (!qualityOn) return;
    let live = true;
    getSiteTrust(draft.brandId)
      .then((read) => live && setSiteTrust(read))
      .catch((err) => console.error('Failed to read the site trust:', err))
      .finally(() => live && setSiteTrustRead(true));
    return () => {
      live = false;
    };
  }, [qualityOn, draft.brandId]);
  // The Article schema an article page goes out with (customer priorities
  // item 7, 00448): to the CMS and in exports, the author in it, unless the
  // person left it out for a CMS that writes its own. Saved behind, put back
  // if the save fails.
  const [schemaLeftOut, setSchemaLeftOut] = useState(draft.schemaLeftOut);
  const addedSchema: AddedArticleSchema = {
    input: articleSchemaInput({
      title,
      author: schemaAuthor({
        authorsOn: qualityOn,
        authorsRead: authorsRead !== null,
        author: pageAuthor,
        confirmedReal: authorConfirmed.real,
      }),
      siteTrust,
      brandName,
      isNew: draft.method === 'create',
    }),
    pageType,
    leftOut: schemaLeftOut,
  };
  const leaveOutSchema = (leftOut: boolean) => {
    if (lockedFor('leaveOutSchema')) return;
    setSchemaLeftOut(leftOut);
    void setDraftSchemaLeftOut(draft.id, leftOut).then((saved) => {
      if (saved) return;
      setSchemaLeftOut(!leftOut);
      toast.error(t('beforePublish.schema.leaveOutFailed'));
    });
  };
  // Phase 2 (CE-046): what kind of source each link is, competitors' pages
  // by the brand's competitors (read with the sources), less the ones the
  // person kept.
  const sourcesOn = qualityPhase() >= 2;
  const competitorDomains = reads.sources?.data?.competitorDomains;
  // The sites the brand trusts (Settings › Content, 00449): primary sources.
  const trustedDomains = reads.sources?.data?.trustedDomains;
  // Phase 2 (CE-047): the page's prices, trial and founding year against the
  // brand's approved facts, read from its own site.
  const factsState = useBrandFacts(draft.brandId, sourcesOn);
  const brandFacts = factsState.status === 'ready' ? factsState.read.facts : null;
  const pendingFacts = brandFacts?.filter((f) => f.status === 'pending').length ?? 0;
  const [hadPendingFacts, setHadPendingFacts] = useState(false);
  if (pendingFacts > 0 && !hadPendingFacts) setHadPendingFacts(true);
  const [keptSources, setKeptSources] = useState(draft.keptSources);
  // A site the rules can't place, as the model reads it (part b): asked
  // after a save, as the links are.
  const unplaced = useMemo(
    () =>
      sourcesOn && brandDomains
        ? unplacedSites(pageBlocks, brandDomains, {
            competitorDomains: competitorDomains ?? [],
            pageType,
            kept: new Set(keptSources),
            trustedDomains: trustedDomains ?? [],
          })
        : [],
    [sourcesOn, brandDomains, pageBlocks, competitorDomains, pageType, keptSources, trustedDomains],
  );
  const {
    kinds: aiKinds,
    paused: aiPaused,
    reading: sourcesReading,
  } = useSourceClasses(draft.id, autosave.savedAt, unplaced, sourcesOn && !isLocked);
  // A save waiting or under way: the page's reads follow it. Not a failed
  // save (or a conflict, a page too large): no new save is coming till it's fixed.
  const saving = autosave.state === 'unsaved' || autosave.state === 'saving';
  // The claims in the draft's own words, as the model reads them (CE-045):
  // asked after a save, leaving the block the person is writing in.
  const claimsRead = useClaims(draft.id, autosave.savedAt, sourcesOn && !isLocked, saving, () =>
    editor && !editor.isDestroyed && editor.isFocused ? writingBlock(editor) : null,
  );
  const { blocks: claimBlocks, recheck: recheckClaims } = claimsRead;
  // The page's own claims that need the brand's proof (CE-049), read from
  // the whole page after a save: proof to-dos while their paragraph has no
  // link, and its own-site link counts as their source.
  // Asked again when the page type changes too: the checks depend on it
  // (CE-050). Only changes on their way hold the ask, as the claims': not a
  // failed save, a conflict or a page too large.
  const pageRead = usePageRead(
    draft.id,
    `${autosave.savedAt}\n${pageType ?? ''}`,
    sourcesOn && !isLocked,
    saving,
  );
  // The page read's AI checks (CE-050), on the page as it is: left out
  // before the first read, and once the AI budget or the day's reads are
  // used up (Quality says so), as the score can't follow the page then.
  // Read for another page type: unknown until a read for this one lands.
  // An edit holds what was found until the page as it is is read: while it
  // waits for its save too, not only once the ask is out.
  const pageChanging = pageRead.reading || saving;
  // The disclosure line Add line puts in (CE-050) is the disclosure while
  // the page has it: Trust, Quality and Export count it before it is read.
  // Phase 3 (CE-052): what the scores count, and how much, follows the
  // page's type (an article's before, and for most types).
  // A comparison's check date (CE-052): E-E-A-T's check and its to-do.
  // A product page's shipping and returns (CE-052): Trust's check, and a
  // to-do that needs no Trust read.
  // The page type's own rules (the Rules tab's, read from the page): one
  // Readability check on the types that weigh it; not ones read by AI or
  // the product feed, nor ones turned off there.
  const typeRules = useMemo(
    () =>
      rules.rules.flatMap(({ rule, status }) =>
        rule.group === 'type' && rule.check === 'page' && rule.on && status.state !== 'info'
          ? [
              {
                name: tRules(`names.${rule.key}`),
                met: status.state === 'ok',
                detail: aimAndNow(rule, status).filter(Boolean).join(' · '),
              },
            ]
          : [],
      ),
    // aimAndNow reads only tRules and tStatus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules.rules, tRules, tStatus],
  );
  // A proof to-do asked for this session stays, checked once it has a link.
  const [hadProofs, setHadProofs] = useState<ReadonlySet<string>>(() => new Set());
  // The ones shown open: the first MAX_PROOF_TODOS with no link, as the to-dos list them.
  // Phase 3 (CE-052): a customer case is confirmed publishable, not linked.
  const casesOn = sourcesOn && qualityPhase() >= 3;
  const [caseConfirms, setCaseConfirms] = useState<ReadonlySet<string> | null>(null);
  // A category intro's facts the person confirmed (CE-054), read with the cases'.
  const [introConfirms, setIntroConfirms] = useState<ReadonlySet<string> | null>(null);
  // Whether they're read (or failed): until then a case's to-do waits, so
  // one confirmed before doesn't show open.
  const [casesRead, setCasesRead] = useState(false);
  useEffect(() => {
    if (!casesOn) return;
    let live = true;
    void getDraftConfirmations(draft.id)
      .then((rows) => {
        if (!live) return;
        setCasesRead(true);
        // A confirm made before the read lands stays.
        setCaseConfirms(
          (prev) =>
            new Set([
              ...rows.filter((r) => r.kind === 'customer_case').map((r) => r.key),
              ...(prev ?? []),
            ]),
        );
        setIntroConfirms(
          (prev) =>
            new Set([
              ...rows.filter((r) => r.kind === 'intro_fact').map((r) => r.key),
              ...(prev ?? []),
            ]),
        );
      })
      .catch((err) => {
        // A failed call (the network, a deploy): the confirms made so far, so E-E-A-T scores.
        console.error('Failed to read the confirmations:', err);
        if (!live) return;
        setCasesRead(true);
        setCaseConfirms((prev) => prev ?? new Set());
        setIntroConfirms((prev) => prev ?? new Set());
      });
    return () => {
      live = false;
    };
  }, [draft.id, casesOn]);
  // Phase 3 (CE-054): a category intro's counts and prices, in the page's
  // language, and the facts the person confirmed. Trust counts them at once
  // (none confirmed until the confirms are read, as a customer case); the
  // to-do waits for the read.
  // The page's customer cases, and how many are confirmed: E-E-A-T's (CE-052).
  // The page's images the person confirmed are their own, not stock (CE-049,
  // 00270): E-E-A-T's visual proof. Read once; a confirm adds to it at once.
  const [ownImages, setOwnImages] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!sourcesOn) return;
    let live = true;
    // A confirm made before the read lands stays. A failed call (the
    // network, a deploy) counts the confirms made so far: E-E-A-T still scores.
    void getOwnImages(draft.id)
      .then((srcs) => live && setOwnImages((prev) => new Set([...srcs, ...(prev ?? [])])))
      .catch((err) => {
        console.error('Failed to read the own images:', err);
        if (live) setOwnImages((prev) => prev ?? new Set());
      });
    return () => {
      live = false;
    };
  }, [draft.id, sourcesOn]);
  // The visual proof spots still open, as the margin shows them.
  const openSpots =
    editor && pageRead.read ? openSpotPlaces(editor.state.doc, pageRead.read.spots).length : 0;
  // E-E-A-T, Trust and Readability from everything they read (CE-039), as
  // the server's go-live gate computes them (lib/content/qualityInputs.ts):
  // each waits for its reads, as before.
  const scores = useMemo(
    () =>
      qualityState({
        html: pageHtml,
        blocks: pageBlocks,
        language,
        brandName,
        pageType,
        phase: qualityPhase(),
        authorsRead: !!authorsRead,
        author: pageAuthor,
        authorConfirmed,
        inputs,
        inputsPending,
        linkChecks,
        brandDomains: brandDomains ?? null,
        competitorDomains: competitorDomains ?? null,
        trustedDomains: trustedDomains ?? null,
        siteTrust,
        siteTrustRead,
        brandFacts,
        keptSources,
        aiKinds,
        claimBlocks,
        pageRead: {
          read: pageRead.read,
          paused: pageRead.paused,
          limited: pageRead.limited,
          settled: pageRead.settled,
          changing: pageChanging,
        },
        typeRules,
        caseConfirms,
        introConfirms,
        casesRead,
        ownImages,
        openSpots,
        catalog,
        now: Date.now(),
      }),
    [
      pageHtml,
      pageBlocks,
      language,
      brandName,
      pageType,
      authorsRead,
      pageAuthor,
      authorConfirmed,
      inputs,
      inputsPending,
      linkChecks,
      brandDomains,
      competitorDomains,
      trustedDomains,
      siteTrust,
      siteTrustRead,
      brandFacts,
      keptSources,
      aiKinds,
      claimBlocks,
      pageRead.read,
      pageRead.paused,
      pageRead.limited,
      pageRead.settled,
      pageChanging,
      typeRules,
      caseConfirms,
      introConfirms,
      casesRead,
      ownImages,
      openSpots,
      catalog,
    ],
  );
  const {
    profile,
    used,
    proofAsks,
    aiChecks,
    checkDateRead,
    shippingRead,
    readable,
    introConfirmed,
    introAll,
    introRead,
    images,
    visualRead,
    visual,
    eeatScore,
    productSchema,
    trustScore,
  } = scores;
  const isCase = (ask: (typeof proofAsks)[number]) => casesOn && ask.kind === 'customer_case';
  // A case's to-do once the confirms are read: open while not confirmed.
  const caseOpen = (ask: (typeof proofAsks)[number]) =>
    isCase(ask) ? casesRead && !caseConfirmed(caseConfirms ?? new Set(), ask) : !ask.linked;
  const newProofs = proofAsks
    .filter(caseOpen)
    .slice(0, MAX_PROOF_TODOS)
    .map((ask) => (isCase(ask) ? caseKey(ask) : proofKey(ask)))
    .filter((key) => !hadProofs.has(key));
  if (newProofs.length > 0) setHadProofs(new Set([...hadProofs, ...newProofs]));
  // E-E-A-T from the author (and, in phase 2, the person's experience and
  // data, and their own images); with Trust and Readability, the scores and
  // the header chip's average (CE-039).
  // In phase 2 it waits for the visual proof too, so it doesn't move once that lands;
  // on a type that weighs the brand's own information, for the site's trust.
  // A page that advises consumers on health, finance or law (the page's read)
  // asks for a qualified reviewer, one of Authors.
  const regulated = sourcesOn ? (pageRead.read?.regulated ?? null) : null;
  const pageReviewer = authorsRead?.authors.find((a) => a.id === reviewerId) ?? null;
  // Phase 3 (CE-053): a product page's Product schema in Before you publish,
  // from its opening paragraph, its own images (else its first) and the
  // price it states.
  // Phase 3 (CE-054): a category page's ItemList in Before you publish, from
  // its links to the brand's product pages, read against its site.
  // The brand's domains as the sources read them; failing that, its site's.
  const sourcesFailed = !!reads.sources?.failed;
  const categorySchema = useMemo(() => {
    if (profile !== 'category') return null;
    const site = siteTrust?.checks.organizationSchema.url ?? null;
    const siteHost = site ? normalizeDomain(site) : '';
    const domains = brandDomains ?? (sourcesFailed && siteHost ? [siteHost] : null);
    if (!domains) {
      return { items: [], status: sourcesFailed ? ('unknown' as const) : ('reading' as const) };
    }
    return { items: listedProducts(pageHtml, domains, site), status: 'read' as const };
  }, [profile, pageHtml, brandDomains, sourcesFailed, siteTrust]);
  // The page's price, GTIN and stock against its product in the feed (CE-053).
  // Confirm: only the person can tell their own image from stock.
  const [confirmingImages, setConfirmingImages] = useState(false);
  const openConfirmImages = guard(() => setConfirmingImages(true), {
    action: tActions('confirmDetails'),
  });
  // Quality's Confirm on a category intro's facts (CE-054): the person's
  // word that its counts and prices are right, the ones not confirmed yet in
  // one row; put back if it can't be saved.
  const confirmIntro = async () => {
    if (lockedFor('confirmDetails')) return;
    const keys = introConfirmKeys(introAll.filter((fact) => !introConfirmed.has(fact)));
    if (!keys.length) return;
    setIntroConfirms((prev) => new Set([...(prev ?? []), ...keys]));
    const takeBack = (back: string[]) =>
      setIntroConfirms((prev) => new Set([...(prev ?? [])].filter((had) => !back.includes(had))));
    for (const [i, key] of keys.entries()) {
      try {
        if ((await confirmDraftItem(draft.id, 'intro_fact', key)) === 'full') {
          takeBack(keys.slice(i));
          toast.error(t('quality.confirmCaseFull'));
          return;
        }
      } catch (err) {
        console.error('Failed to confirm the intro facts:', err);
        takeBack(keys.slice(i));
        toast.error(t('quality.confirmCaseFailed'));
        return;
      }
    }
  };
  // Quality's Confirm on a customer case (CE-052): the person's statement
  // that the customer may be named; put back if it can't be saved.
  const confirmCase = async (key: string) => {
    if (lockedFor('confirmDetails')) return;
    if (caseConfirms?.has(key)) return;
    setCaseConfirms((prev) => new Set([...(prev ?? []), key]));
    const takeBack = () =>
      setCaseConfirms((prev) => new Set([...(prev ?? [])].filter((had) => had !== key)));
    try {
      if ((await confirmDraftItem(draft.id, 'customer_case', key)) === 'full') {
        takeBack();
        toast.error(t('quality.confirmCaseFull'));
      }
    } catch (err) {
      console.error('Failed to confirm the customer case:', err);
      takeBack();
      toast.error(t('quality.confirmCaseFailed'));
    }
  };
  const confirmImage = async (src: string) => {
    if (lockedFor('confirmDetails')) return;
    // Already confirmed: nothing to take back if the save fails.
    const had = ownImages?.has(src) ?? false;
    setOwnImages((prev) => new Set([...(prev ?? []), src]));
    const takeBack = () => {
      if (!had) setOwnImages((prev) => new Set([...(prev ?? [])].filter((own) => own !== src)));
    };
    try {
      if ((await confirmOwnImage(draft.id, src)) === 'full') {
        takeBack();
        toast.error(t('quality.confirmImageFull'));
      }
    } catch (err) {
      console.error('Failed to confirm the image:', err);
      takeBack();
      toast.error(t('quality.confirmImageFailed'));
    }
  };
  // Out of the editor (to Quality, to Before you publish): the block left
  // for later is read too.
  useEffect(() => {
    if (!editor) return;
    editor.on('blur', recheckClaims);
    return () => {
      editor.off('blur', recheckClaims);
    };
  }, [editor, recheckClaims]);
  // The brand's own links aren't sources: Trust waits for its domains. The
  // page read's balance and disclosure (phase 2) join when it lands.
  // Their links underlined in the draft, Quality's suggestion naming them.
  const weakKey = (trustScore?.weak ?? []).map((w) => w.url).join('\n');
  const weakTitle = t('quality.weakSource');
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const urls = new Set(weakKey ? weakKey.split('\n') : []);
    editor.view.dispatch(
      editor.state.tr
        .setMeta(weakSourcesKey, { urls, title: weakTitle })
        .setMeta('addToHistory', false),
    );
  }, [editor, weakKey, weakTitle]);
  // The claims with no source (CE-045): the model's in their words, the
  // figures' in their sentences, underlined in their blocks with phase 2.
  const claimKey = sourcesOn ? JSON.stringify(trustScore?.marks ?? []) : '[]';
  const claimTitle = t('quality.claimNoSource');
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const marks = JSON.parse(claimKey) as ClaimMark[];
    editor.view.dispatch(
      editor.state.tr
        .setMeta(claimMarksKey, { marks, title: claimTitle })
        .setMeta('addToHistory', false),
    );
  }, [editor, claimKey, claimTitle]);
  // Quality's Add source: the claim's words selected, the link dialog open
  // on them (its Apply links them and comes back to the page).
  const [linkRequest, setLinkRequest] = useState(0);
  const addSource = (mark: ClaimMark) => {
    if (!editor || lockedFor('addSources')) return;
    const [range] = textRanges(editor.state.doc, mark.text, mark.block);
    if (!range) {
      showInPage(mark.sentence);
      return;
    }
    editor.chain().setTextSelection(range).scrollIntoView().run();
    setLinkRequest((n) => n + 1);
  };
  // Quality's Remove: the claim's sentence out of the page, the space after
  // it too, and the paragraph (its list item) if that leaves it empty. Undo
  // brings it back.
  const removeClaim = (mark: ClaimMark) => {
    if (!editor || lockedFor('editContent')) return;
    const [range] = textRanges(editor.state.doc, mark.sentence, mark.block);
    if (!range) {
      showInPage(mark.sentence);
      return;
    }
    editor
      .chain()
      .command(({ tr }) => {
        const next =
          range.to < tr.doc.content.size ? tr.doc.textBetween(range.to, range.to + 1) : '';
        tr.delete(range.from, next === ' ' ? range.to + 1 : range.to);
        const $at = tr.doc.resolve(range.from);
        if ($at.parent.content.size > 0) return true;
        let depth = $at.depth;
        while (depth > 1 && $at.node(depth - 1).childCount === 1) {
          if (!EMPTIED_WITH.has($at.node(depth - 1).type.name)) break;
          depth--;
        }
        if ($at.node(depth - 1).childCount > 1) tr.delete($at.before(depth), $at.after(depth));
        return true;
      })
      .focus(undefined, { scrollIntoView: false })
      .run();
  };
  const keepSource = async (url: string) => {
    if (lockedFor('keepSources')) return;
    setKeptSources((kept) => (kept.includes(url) ? kept : [...kept, url]));
    try {
      setKeptSources(await keepDraftSource(draft.id, url));
    } catch (err) {
      // Only this one goes back: another kept meanwhile stays.
      setKeptSources((kept) => kept.filter((source) => source !== url));
      if (err instanceof Error && err.message === 'full') {
        toast.error(t('quality.keepFull'));
        return;
      }
      console.error('Failed to keep the source:', err);
      toast.error(t('quality.keepFailed'));
    }
  };
  const qualityScore = qualityAverage([
    eeatScore?.score ?? null,
    trustScore?.score ?? null,
    readable?.score ?? null,
  ]);
  const hasAuthors = (authorsRead?.authors.length ?? 0) > 0;
  // Add byline to content (CE-057): the brand's CMS has no author field, so
  // its exports carry one byline line under the H1.
  const bylineInContent =
    authorsRead?.brands.find((b) => b.id === draft.brandId)?.bylineInContent ?? false;
  // What only the person can do (CE-040), and the nudge to the first of it
  // when the agent's run ends, after Accept all and on Mark ready.
  // The placeholders the agent left (CE-044): the person fills them. Once
  // the page has had some, the to-do stays, checked when they are filled.
  const placeholderCount = useMemo(
    () => (qualityOn ? pagePlaceholders(pageHtml).count : 0),
    [qualityOn, pageHtml],
  );
  const [hadPlaceholders, setHadPlaceholders] = useState(false);
  if (placeholderCount > 0 && !hadPlaceholders) setHadPlaceholders(true);
  // The placeholders a send or an export finds that the page's text doesn't
  // show: in an image's alt text, the JSON-LD, an HTML block, or a title the
  // page doesn't hold. The toolbar counts them with the page's (a code
  // block's too, which the marks hold and pagePlaceholders doesn't read).
  const hiddenPlaceholders = useMemo(() => {
    const html = publishableHtml(pageHtml);
    const found = exportPlaceholders(html) + titlePlaceholders(title, html);
    const code = Array.from(
      new DOMParser().parseFromString(pageHtml, 'text/html').querySelectorAll('pre'),
    ).reduce((sum, pre) => sum + (pre.textContent?.match(PLACEHOLDER)?.length ?? 0), 0);
    return Math.max(0, found - pagePlaceholders(pageHtml).count - code);
  }, [pageHtml, title]);
  // Who may edit the page's author: only they get Edit author (CE-037's rule).
  const canEditPageAuthor =
    !!pageAuthor && !!authorsRead && canEditAuthor(pageAuthor, authorsRead.me);
  const todos = qualityOn
    ? qualityTodos({
        eeat: eeatScore,
        author: pageAuthor,
        hasAuthors,
        canEdit: canEditPageAuthor,
        placeholders: { count: placeholderCount, had: hadPlaceholders },
        used,
        given: inputs ? inputsGiven(inputs) : null,
        trust: trustScore,
        brandFacts: brandFacts ? { pending: pendingFacts, had: hadPendingFacts } : null,
        // A case's to-do waits for the confirms' read (CE-052).
        proofs: sourcesOn
          ? {
              asks: casesOn && !casesRead ? proofAsks.filter((ask) => !isCase(ask)) : proofAsks,
              had: hadProofs,
            }
          : null,
        visual,
        // Once the authors are read: who the reviewer is, and whether any can be.
        reviewer: regulated && authorsRead ? { topic: regulated, picked: !!pageReviewer } : null,
        confirmed: authorConfirmed,
        shipping: shippingRead,
        cases: casesOn ? (caseConfirms ?? new Set<string>()) : null,
        intro: introRead,
        checkDate:
          checkDateRead === null ? null : { ...checkDateRead, line: checkDateText(language) },
        off: checksOff(profile),
      })
    : [];
  const quality: QualityRead | null = qualityOn
    ? {
        caseSentences: casesOn
          ? proofAsks.filter((ask) => ask.kind === 'customer_case').map((ask) => ask.sentence)
          : [],
        weightsFor:
          qualityPhase() >= 3
            ? { type: pageType ?? null, detected: picked === null, profile }
            : null,
        feed:
          feedOn && catalog
            ? !catalog.connected
              ? 'none'
              : !catalog.product
                ? 'notFound'
                : null
            : null,
        readability: readable,
        eeat: eeatScore,
        trust: trustScore,
        author: pageAuthor,
        canEdit: canEditPageAuthor,
        hasAuthors,
        brandName,
        team: teamName(language, brandName),
        siteTrust,
        todos,
        // Only while a source waits for its read.
        aiPaused: aiPaused && unplaced.some((site) => !aiKinds.has(site)),
        claimsPaused: claimsRead.paused,
        claimsLimited: claimsRead.limited,
        claimsReading: claimsRead.reading,
        pagePaused: pageRead.paused,
        pageLimited: pageRead.limited,
        aiChecks,
        pageReading: pageRead.reading,
        siteType,
        brandFactsPath: sourcesOn ? brandFactsPath(draft.brandId) : null,
        authorConfirmed,
        authorConfirming: confirming,
      }
    : null;
  // Quality's Pick author opens the header's menu.
  const [authorMenuOpen, setAuthorMenuOpen] = useState(false);
  // Quality's Change opens the header's page type menu (CE-052).
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  // Quality's Pick reviewer opens its menu beside the author's (CE-049).
  const [reviewerMenuOpen, setReviewerMenuOpen] = useState(false);
  // As the author's: a slower pick that fails after a later one landed doesn't roll it back.
  const savedReviewer = useRef(draft.reviewerId);
  const reviewerPick = useRef(0);
  const pickReviewer = async (next: string | null) => {
    if (next === reviewerId || lockedFor('setReviewer')) return;
    const pick = ++reviewerPick.current;
    setReviewerId(next);
    try {
      await setContentDraftReviewer(draft.id, next);
      savedReviewer.current = next;
    } catch (err) {
      console.error('Failed to set the reviewer:', err);
      if (pick === reviewerPick.current) setReviewerId(savedReviewer.current);
      toast.error(t('reviewer.failed'));
    }
  };
  // Quality's Add opens Brief › Your input.
  const addInput = () => {
    if (!panelOpen) togglePanel();
    setTabRequest((prev) => ({ tab: 'brief', n: (prev?.n ?? 0) + 1, input: true }));
  };
  const nudge = useNextNudge(draft.id, todos);
  const { at: nudgeAt } = nudge;
  // The author's to-dos wait for E-E-A-T: the nudge waits for them.
  const todosRead = eeatScore !== null;
  // The score the header and the panel show (CE-039): once the reads that
  // move it are in, or failed (the authors and, in phase 2, Your input for
  // E-E-A-T; the site's trust, the sources, the links and, in phase 2, the
  // claims, the sites' kinds and the brand's facts for Trust). Until the first time it says
  // it's reading; after, it keeps the last settled score while new reads
  // land (a link added, the agent's page), so it never jumps through the
  // partial averages on the way.
  const qualitySettled =
    qualityOn &&
    authorsTried &&
    !inputsPending &&
    siteTrustRead &&
    reads.sources !== null &&
    linksPending === 0 &&
    !claimsRead.reading &&
    !sourcesReading &&
    // Phase 2: the brand's approved facts, which Trust checks the page
    // against, and the page's read (its proof to-dos; what it finds scores).
    !(sourcesOn && factsState.status === 'loading') &&
    !pageRead.reading &&
    // E-E-A-T's visual proof: the page's read and the own images (CE-049).
    (!sourcesOn || visualRead) &&
    // Phase 2 reads the page as saved: an edit's score waits for its save.
    !(sourcesOn && saving);
  const [shownQuality, setShownQuality] = useState<{ score: number | null } | null>(null);
  if (qualitySettled && shownQuality?.score !== qualityScore) {
    setShownQuality({ score: qualityScore });
  }
  const shownScore = shownQuality?.score ?? null;
  const agentNudged = useRef(false);
  useEffect(() => {
    if (!agentFinished || !todosRead || agentNudged.current) return;
    agentNudged.current = true;
    nudgeAt('agent');
  }, [agentFinished, todosRead, nudgeAt]);
  // Accept all's moment waits for the page as read after it: the placeholders
  // the accepted words brought are to-dos by then.
  const acceptedAt = useRef<string | null>(null);
  const nudgeAfterRead = () => {
    acceptedAt.current = pageHtml;
  };
  useEffect(() => {
    if (acceptedAt.current === null || acceptedAt.current === pageHtml) return;
    acceptedAt.current = null;
    nudgeAt('acceptAll');
  }, [pageHtml, nudgeAt]);
  const byline = authorsRead
    ? [
        t('author.by', {
          name: pageAuthor?.name ?? t('author.organization', { brand: brandName }),
        }),
        pageAuthor?.title && t('author.titleAt', { title: pageAuthor.title, brand: brandName }),
        pageReviewer &&
          (pageReviewer.title
            ? t('reviewer.byTitle', { name: pageReviewer.name, title: pageReviewer.title })
            : t('reviewer.by', { name: pageReviewer.name })),
        t('author.updated', {
          date: format.dateTime(
            Math.max(
              new Date(autosave.savedAt).getTime(),
              authorChangedAt ? new Date(authorChangedAt).getTime() : 0,
            ),
            { dateStyle: 'medium' },
          ),
        }),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(
        pageInfoKey,
        byline
          ? {
              label: bylineInContent ? t('author.pageInfoInContent') : t('author.pageInfo'),
              byline,
              initials: authorInitials(pageAuthor?.name ?? brandName),
              photoUrl: pageAuthor?.photoUrl ?? null,
            }
          : null,
      ),
    );
  }, [editor, byline, bylineInContent, pageAuthor?.name, pageAuthor?.photoUrl, brandName, t]);
  const pickAuthor = async (next: string | null) => {
    if (next === authorId || lockedFor('setAuthor')) return;
    const pick = ++authorPick.current;
    setAuthorId(next);
    try {
      await setContentDraftAuthor(draft.id, next);
      savedAuthor.current = next;
      setAuthorChangedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to set the author:', err);
      if (pick === authorPick.current) setAuthorId(savedAuthor.current);
      toast.error(t('author.failed'));
    }
  };
  useEffect(() => {
    attachRef.current = (files) => void attachments.attach(files);
    onDecide.current = (id, decision) => void decide([id], decision);
    // The person's own input opens where they gave it (CE-048): Brief ›
    // Your input, there only with Quality's second phase.
    onSource.current = (source) => {
      if (source.kind !== 'input') openPanelTab('sources', { kind: source.kind, ref: source.ref });
      else if (qualityPhase() >= 2) addInput();
    };
  });

  /** "ChatGPT 14× and Perplexity 6×": the platforms quoting a passage, the most first. */
  const quotedBy = useCallback(
    (passage: CitedPassage) => {
      const byName = new Map<string, number>();
      for (const { platform, answers } of passage.platforms) {
        const name = PLATFORM_LABELS[platform] ?? platform;
        byName.set(name, (byName.get(name) ?? 0) + answers);
      }
      return format.list(
        [...byName]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => t('cited.platform', { name, count })),
        { type: 'conjunction' },
      );
    },
    [format, t],
  );

  // The page's passages AI answers quote, for a draft of an existing page:
  // read when it opens, and again after a restore.
  const loadCited = useCallback(async () => {
    if (!editor || !draft.sourceUrl) return;
    setCitedRead(false);
    const texts = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (!node.isTextblock) return true;
      if (node.textContent.trim()) texts.add(node.textContent.slice(0, 5_000));
      return false;
    });
    try {
      const cited = await getCitedPassages(draft.id, [...texts].slice(0, MAX_PASSAGES));
      if (!cited || editor.isDestroyed) return;
      const labels = new Map<string, string>();
      citedBy.current = new Map();
      for (const passage of cited) {
        const platforms = quotedBy(passage);
        citedBy.current.set(passage.key, platforms);
        labels.set(passage.key, t('cited.label', { platforms, days: CITED_DAYS }));
      }
      editor.view.dispatch(
        editor.state.tr.setMeta(citedPassagesKey, { labels, unlocked: new Set() }),
      );
    } catch (err) {
      console.error('Failed to read the cited passages:', err);
    } finally {
      // Read or not, the editor's locks are what the agent is told.
      if (!editor.isDestroyed) setCitedRead(true);
    }
  }, [editor, draft.id, draft.sourceUrl, quotedBy, t]);

  useEffect(() => {
    void loadCited();
    // Once per editor: a restore reads them again itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The header's count follows the page.
  useEffect(() => {
    if (!editor) return;
    const count = () => setCitedCount(lockedPassageCount(editor.state));
    editor.on('transaction', count);
    return () => {
      editor.off('transaction', count);
    };
  }, [editor]);

  /** "Edit anyway": the passage is the person's to change now. */
  const editAnyway = () => {
    if (!editor || !held) return;
    const locks = citedLocks(editor.state);
    editor.view.dispatch(
      editor.state.tr.setMeta(citedPassagesKey, {
        ...locks,
        unlocked: new Set(locks.unlocked).add(held.key),
      }),
    );
    // The held change goes through: a paste, a cut, or the key pressed.
    if (held.tr && held.tr.before.eq(editor.state.doc)) {
      editor.view.dispatch(held.tr.setMeta(CITED_EDIT_ALLOWED, true));
    }
    setHeld(null);
    editor.commands.focus();
  };

  // The rows of the Sources tab by kind and ref, for a "Based on" chip's hover (CE-033).
  const tDetail = useTranslations('contentEditor.editor.sources.detail');
  const sourceRows = useMemo(() => {
    const read = reads.sources;
    if (!read?.data) return null;
    const groups = buildSourceGroups(read.data, read.choices, {
      title: draft.title,
      sourceUrl: draft.sourceUrl,
    });
    return new Map(groups.flatMap((g) => g.rows.map((row) => [`${row.kind}:${row.ref}`, row])));
  }, [reads.sources, draft.title, draft.sourceUrl]);
  const suggestionLabels = useMemo<SuggestionLabels>(
    () => ({
      agent: t('suggestions.agent'),
      breaks: (names: string) => t('suggestions.breaks', { names }),
      accept: t('suggestions.accept'),
      reject: t('suggestions.reject'),
      accepted: t('suggestions.accepted'),
      rejected: t('suggestions.rejected'),
      undo: t('suggestions.undo'),
      restore: t('suggestions.restore'),
      locked: t('suggestions.locked'),
      stale: t('suggestions.stale'),
      heading: t('suggestions.heading'),
      links: t('suggestions.links'),
      basedOn: t('suggestions.basedOn'),
      sourceKinds: {
        prompt: t('suggestions.sourceKinds.prompt'),
        fanout: t('suggestions.sourceKinds.fanout'),
        cited_page: t('suggestions.sourceKinds.cited_page'),
        gsc_query: t('suggestions.sourceKinds.gsc_query'),
        input: t('suggestions.sourceKinds.input'),
      },
      sourceMark: (n, label) => t('suggestions.sourceMark', { n, label }),
      sourceTip: sourceRows
        ? (source) => {
            const row = sourceRows.get(`${source.kind}:${source.ref}`);
            if (!row) return null;
            const detail = sourceDetail(row, tDetail);
            return detail ? `${row.name} · ${detail}` : row.name;
          }
        : undefined,
    }),
    [t, tDetail, sourceRows],
  );

  // The latest batch, read when the editor opens. One from before the page
  // was last restored was for the page before: its card opens closed, as it
  // closed in the tab that restored it (open ones it still has show).
  useEffect(() => {
    if (!editor) return;
    Promise.all([getDraftSuggestions(draft.id), getLastRestoreAt(draft.id).catch(() => null)])
      .then(([read, restoredAt]) => {
        setSuggestions(read);
        const ranAt = read[0]?.createdAt;
        if (restoredAt && ranAt && Date.parse(ranAt) < Date.parse(restoredAt)) setBarClosed(true);
      })
      .catch((err) => console.error('Failed to read the agent suggestions:', err));
  }, [editor, draft.id]);

  // What the agent's open result would do to the rules (editor test
  // 2026-10-25: a fix run turned 11 of 15 met into 10, a rewrite 4 open into
  // 5): each change, all of them (as Accept all takes them, one after the
  // other), or a whole page rewritten, checked as the page is, against the
  // page as it is now (read here, not the rules' deferred read, so a change
  // just accepted isn't blamed on the rest). A rule met now that it would
  // break is said.
  const ruleEffects = useMemo(() => {
    if (!editor || editor.isDestroyed) return null;
    const open = suggestions.filter((s) => s.status === 'open' && s.kind !== 'page');
    const page = suggestions.find((s) => s.kind === 'page' && s.status === 'open') ?? null;
    if (!open.length && !page) return null;
    const check = (html: string, characters: number) => rules.checkHtml(html, characters);
    const ofDoc = (doc: PmNode) =>
      check(
        getHTMLFromFragment(doc.content, editor.schema),
        (editor.storage.characterCount.characters({ node: doc }) as number | undefined) ?? 0,
      );
    const now = ofDoc(editor.state.doc);
    const metNow = new Set(
      now
        .filter(({ rule, status }) => rule.on && status.state === 'ok')
        .map(({ rule }) => rule.key),
    );
    const effect = (after: ReturnType<typeof check>, leaveOut: string[] = []) => ({
      now: rulesMet(now).met,
      met: rulesMet(after).met,
      broken: after
        .filter(
          ({ rule, status }) =>
            metNow.has(rule.key) && status.state === 'bad' && !leaveOut.includes(rule.key),
        )
        .map(({ rule }) => rule.key),
    });
    // A whole page rewritten: its Length is its own line on the card (read
    // the same way, the editor's count), so it isn't named again as broken.
    if (page) {
      return {
        each: new Map<string, string[]>(),
        all: effect(check(page.afterText, htmlChars(page.afterText)), ['length']),
      };
    }
    const each = new Map<string, string[]>();
    for (const s of open) {
      const one = editor.state.tr;
      if (acceptInto(one, editor.state, s, suggestions))
        each.set(s.id, effect(ofDoc(one.doc)).broken);
    }
    const all = redoDecision(
      editor.state,
      suggestions,
      open.map((s) => s.id),
      'accept',
    ).tr;
    return { each, all: effect(ofDoc(all.doc)) };
    // pageHtml: the page as it changes (the editor's state is read through it).
  }, [editor, suggestions, rules.checkHtml, pageHtml]); // eslint-disable-line react-hooks/exhaustive-deps
  const ruleNames = (keys: string[]) =>
    format.list(
      keys.map((key) => tRules(`names.${key}`)),
      { type: 'conjunction' },
    );

  // The page shows them as they are now.
  useEffect(() => {
    suggestionsNow.current = suggestions;
    if (!editor || editor.isDestroyed) return;
    // A whole page (Rewrite the whole page) has its own bar, not a card; each
    // card says which rules met now it would break.
    const cards = suggestions
      .filter((s) => s.kind !== 'page')
      .map((s) => {
        const broken = ruleEffects?.each.get(s.id);
        return broken?.length ? { ...s, breaks: ruleNames(broken) } : s;
      });
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionsKey, { suggestions: cards, labels: suggestionLabels }),
    );
  }, [editor, suggestions, suggestionLabels, ruleEffects]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Accept, reject, undo (an accepted one) or restore (a rejected one): the
   * page changes first, then the decision is kept. Accepting keeps the page
   * as it was in History before the first agent change.
   */
  const decide = async (ids: string[], decision: SuggestionDecision | 'undo_all') => {
    // Never under a restore: it sets the open ones aside on the page it puts in.
    if (!editor || deciding || restoringNow.current || lockedFor('reviewSuggestions')) return;
    const all = suggestionsNow.current;
    const next = all.map((s) => ({ ...s }));
    const picked = next.filter((s) => ids.includes(s.id));
    const changed: string[] = [];
    let status: SuggestionStatus = 'open';
    // The page's change, applied only once the decision is saved.
    let tr: Transaction | null = null;
    setDeciding(true);
    try {
      if (decision === 'accept') {
        const open = picked.filter((s) => s.status === 'open');
        if (open.length > 0 && !agentBeforeKept.current) {
          await autosave.settle();
          await keepAgentBeforeVersion(draft.id);
          agentBeforeKept.current = true;
        }
        tr = editor.state.tr;
        for (const s of open) {
          if (acceptInto(tr, editor.state, s, next)) {
            s.status = 'accepted';
            changed.push(s.id);
          }
        }
        status = 'accepted';
        if (open.length > changed.length) {
          toast(t('suggestions.notApplied', { count: open.length - changed.length }));
        }
      } else if (decision === 'reject') {
        for (const s of picked.filter((s) => s.status === 'open')) {
          s.status = 'rejected';
          changed.push(s.id);
        }
        status = 'rejected';
      } else {
        // Undo, Restore and Undo all send suggestions back to review.
        tr = editor.state.tr;
        for (const s of [...picked].reverse()) {
          if (s.status === 'accepted' && decision !== 'restore') {
            if (!undoInto(tr, editor.state, s, next)) continue;
          } else if (s.status !== 'rejected' || decision === 'undo') {
            continue;
          }
          s.status = 'open';
          changed.push(s.id);
        }
      }
      if (changed.length === 0) return;
      // The decision is saved first, with the page held still: when it fails,
      // neither the page nor the cards change, so they stay in step.
      const editable = editor.isEditable;
      editor.setEditable(false, false);
      try {
        await decideDraftSuggestions(changed, status);
      } finally {
        if (editable) editor.setEditable(true, false);
      }
      if (tr?.docChanged) {
        if (tr.before.eq(editor.state.doc)) {
          editor.view.dispatch(tr);
        } else {
          // The page changed while the decision was saved: the change is made
          // again on the page as it is now, at once, before the page can
          // change again. What it no longer fits goes back to how it was,
          // saved as well, so the cards and the page agree.
          const redo = redoDecision(
            editor.state,
            all,
            changed,
            decision === 'accept' ? 'accept' : 'undo',
          );
          if (redo.tr.docChanged) editor.view.dispatch(redo.tr);
          if (redo.failed.length > 0) {
            const back: SuggestionStatus = decision === 'accept' ? 'open' : 'accepted';
            await decideDraftSuggestions(redo.failed, back);
            for (const s of next) if (redo.failed.includes(s.id)) s.status = back;
            toast(t('suggestions.notApplied', { count: redo.failed.length }));
          }
        }
      }
      setSuggestions(next);
      // The last open one accepted (Accept all, or one by one): the nudge's moment.
      if (decision === 'accept' && !next.some((s) => s.status === 'open')) nudgeAfterRead();
      if (decision === 'accept')
        toast.success(t('suggestions.acceptedToast', { count: changed.length }));
      else if (decision === 'reject')
        toast(t('suggestions.rejectedToast', { count: changed.length }));
      else toast(t('suggestions.undoneToast', { count: changed.length }));
    } catch (err) {
      console.error('Failed to decide the suggestions:', err);
      toast.error(t('suggestions.saveFailed'));
    } finally {
      setDeciding(false);
    }
  };
  const openSuggestions = suggestions.filter((s) => s.status === 'open').length;
  const pageSuggestion = suggestions.find((s) => s.kind === 'page') ?? null;
  // The page's last rewrite, from any run (00285), read on opening and again
  // whenever the rewrite shown changes: a Length it missed isn't a rewrite's to reach
  // (rules.ts RewriteReach). A later Fix run's batch doesn't hide it.
  const [lastRewrite, setLastRewrite] = useState<(LastRewrite & { html: string }) | null>(null);
  const shownRewriteId = pageSuggestion?.id ?? null;
  // The rewrite shown when it was last read (or failed to be): the Length's
  // state waits for the read for the rewrite shown now.
  const [lastRewriteReadFor, setLastRewriteReadFor] = useState<string | null>();
  const lastRewriteRead = lastRewriteReadFor === shownRewriteId;
  useEffect(() => {
    let cancelled = false;
    getLastPageRewrite(draft.id)
      .then((last) => {
        if (!cancelled) setLastRewrite(last);
      })
      .catch((err) => console.error("Failed to read the page's last rewrite:", err))
      .finally(() => {
        if (!cancelled) setLastRewriteReadFor(shownRewriteId);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.id, shownRewriteId]);
  // A rewrite's characters, before and after, as the toolbar counts them.
  const pageChars = useMemo(
    () =>
      pageSuggestion
        ? {
            before: htmlChars(pageSuggestion.beforeHtml ?? ''),
            after: htmlChars(pageSuggestion.afterText),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rewrite's two pages, once
    [pageSuggestion?.id, pageSuggestion?.afterText, pageSuggestion?.beforeHtml, editor],
  );
  // The last rewrite counted as the toolbar counts it, not as the API did,
  // shown or decided since: its Length band is the editor's, and what it came
  // to reads the same before and after (editor test 2026-10-25).
  const lastCounted = useMemo(
    () =>
      lastRewrite && {
        target: lastRewrite.target,
        kept: lastRewrite.kept,
        chars: lastRewrite.html ? htmlChars(lastRewrite.html) : lastRewrite.chars,
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- its page, once
    [lastRewrite, editor],
  );
  const reach: RewriteReach = { kept: keptChars, floor: floorChars, last: lastCounted };
  // The rules' count stands once My rules and the fan-outs (the fan-out
  // rules' own) are read: before, rules come and go from it.
  const rulesSettled =
    rules.ready &&
    reads.sources !== null &&
    // The keywords rule reads the brief, the feed rule the catalog, the
    // Shopping rules the shopping path.
    reads.brief.status !== 'loading' &&
    (!feedOn || catalog !== undefined) &&
    shoppingCheck.check !== 'reading';
  // Open rules no run can close on this page (editor test 2026-10-25): every
  // long sentence inside a passage AI answers quote, a Length out of a
  // rewrite's reach. They leave the agent's work and Next step; the Rules tab
  // says they're the person's to decide.
  // The Sentence rule read as the rules read the page, without the locked
  // passages: met then, every long sentence is in one.
  const sentenceRule = rules.rules.find(({ rule }) => rule.key === 'sentence' && rule.on)?.rule;
  const sentenceOpen = rules.rules.some(
    ({ rule, status }) => rule.key === 'sentence' && rule.on && status.state === 'bad',
  );
  const lockedNow = editor && citedRead ? lockedKeysLeft(editor.state).join('\n') : '';
  const sentenceHeld = useMemo(() => {
    if (!sentenceRule || !sentenceOpen || !lockedNow) return false;
    const rest = readPage(htmlWithoutLocked(pageHtml, new Set(lockedNow.split('\n'))), 0);
    return checkRule(sentenceRule, rest, NO_RULE_CONTEXT).state === 'ok';
  }, [sentenceRule, sentenceOpen, lockedNow, pageHtml]);
  const lengthHeld = lengthOutOfReach(rules.rules, reach) !== null;
  const heldKey = `${sentenceHeld ? 's' : ''}${lengthHeld ? 'l' : ''}`;
  const heldRules = useMemo(
    () =>
      new Set([
        ...(heldKey.includes('s') ? ['sentence'] : []),
        ...(heldKey.includes('l') ? ['length'] : []),
      ]),
    [heldKey],
  );
  // The rules Fix open rules tried and couldn't close, open now: amber in Rules.
  const triedShown = useMemo(
    () => triedOpen(triedRules.tried, rules.rules),
    [triedRules.tried, rules.rules],
  );
  // The rules as the agent card counts its gain: met now, and the ones still open.
  // The rules as the side panel shows them: their count once it stands.
  const rulesShown = { ...rules, settled: rulesSettled };
  const effect = ruleEffects?.all ?? null;
  const cardRules = useMemo(
    () => ({
      met: rules.met,
      total: rules.total,
      open: new Set(
        rules.rules
          .filter(({ rule, status }) => rule.on && status.state === 'bad')
          .map(({ rule }) => rule.key),
      ),
      // The gain once the count stands: never one a read still to land moves.
      ...(effect && rulesSettled
        ? {
            after: {
              now: effect.now,
              met: effect.met,
              breaks: effect.broken.length ? ruleNames(effect.broken) : null,
            },
          }
        : {}),
    }),
    [rules.met, rules.total, rules.rules, effect, rulesSettled], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Review: the first open suggestion in the page's order, scrolled to,
   * marked for a moment and focused, so the keyboard lands on it too.
   */
  const reviewFirst = () => {
    if (!editor) return;
    const open = new Set(
      suggestions.filter((s) => s.status === 'open' && s.kind !== 'page').map((s) => s.id),
    );
    const card = [...editor.view.dom.querySelectorAll<HTMLElement>('[data-suggestion]')].find(
      (node) => open.has(node.dataset.suggestion ?? ''),
    );
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.querySelector('button')?.focus({ preventScroll: true });
    const mark = ['ring-2', 'ring-amber-300', 'dark:ring-amber-700'];
    card.classList.add(...mark);
    setTimeout(() => card.classList.remove(...mark), 1200);
  };

  /**
   * The page's first placeholder (CE-044), selected to type over: in order,
   * across the marks in its line, its block flashed as Show's are. A
   * heading's are the agent's own forms only (AGENT_PLACEHOLDER).
   */
  const showFirstPlaceholder = (): boolean => {
    if (!editor) return false;
    const [first] = placeholderRanges(editor.state.doc);
    if (!first) return false;
    selectPlaceholder(editor, first);
    editor.view.dispatch(editor.state.tr.setMeta(flashKey, first.block));
    setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(flashKey, null));
    }, 1200);
    return true;
  };

  /**
   * Fill now (Export, CE-057; Send to CMS; Before you publish): the first
   * placeholder, in the HTML view's text while it is open (where
   * exportPlaceholders reads: not in tags, styles or scripts), else in the
   * page. One the page's text doesn't show (an image's alt text, the
   * JSON-LD, an HTML block) is selected in the HTML view, opened for it.
   */
  const htmlSourceRef = useRef<HTMLTextAreaElement>(null);
  // The disclosure line Before you publish offers (CE-050), and whether the
  // page has it already (added, and not read again yet).
  const disclosureLine = aiChecks?.disclosure ? disclosureText(language, brandName) : null;
  const disclosureOnPage =
    !!disclosureLine &&
    squeeze(pageBlocks.map((b) => b.text).join('')).includes(squeeze(disclosureLine));
  // A line the page says of itself (the disclosure, CE-050; a check date,
  // CE-052) under the page's opening paragraph (the answer Answer first
  // reads, past an image, a byline or a date), else under the page's H1,
  // else at the top; never twice. One undo takes it out.
  const addLineUnderAnswer = (line: string) => {
    if (!editor || editor.isDestroyed || lockedFor('editContent')) return;
    const { doc } = editor.state;
    if (squeeze(doc.textContent).includes(squeeze(line))) return;
    let at = 0;
    let index = -1;
    doc.forEach((node, offset, i) => {
      const h1 = node.type.name === 'heading' && node.attrs.level === 1;
      if (index === -1 && h1 && node.textContent.trim()) {
        index = i + 1;
        at = offset + node.nodeSize;
      }
    });
    if (index !== -1) {
      const para = (i: number) =>
        i < doc.childCount && doc.child(i).type.name === 'paragraph' ? doc.child(i) : null;
      // Past what has no words (a hero image, an empty paragraph), as
      // Readability and the page read do, and a byline or a date.
      const skipped = (i: number) =>
        i < doc.childCount &&
        (!doc.child(i).textContent.trim() || (!!para(i) && isByline(doc.child(i).textContent)));
      let next = index;
      while (skipped(next)) next += 1;
      if (para(next)?.textContent.trim()) {
        for (let i = index; i <= next; i++) at += doc.child(i).nodeSize;
      }
    }
    editor
      .chain()
      .insertContentAt(at, { type: 'paragraph', content: [{ type: 'text', text: line }] })
      .run();
  };
  // Quality's Add line for a comparison's check date (CE-052): this month's,
  // over its own line from before (a top-level paragraph that is only that
  // line), else under the answer: a date in the person's words (a byline,
  // the answer) stays theirs. One undo takes it back.
  const addCheckDate = () => {
    const line = checkDateText(language);
    if (!line || !editor || editor.isDestroyed || lockedFor('editContent')) return;
    let found: { pos: number; size: number } | null = null;
    editor.state.doc.forEach((node, pos) => {
      if (!found && node.type.name === 'paragraph' && isCheckDateLine(node.textContent)) {
        found = { pos, size: node.nodeSize };
      }
    });
    const at = found as { pos: number; size: number } | null;
    if (!at) {
      addLineUnderAnswer(line);
      return;
    }
    editor
      .chain()
      .insertContentAt(
        { from: at.pos, to: at.pos + at.size },
        { type: 'paragraph', content: [{ type: 'text', text: line }] },
      )
      .run();
  };
  // Fill now for a placeholder the page's text doesn't show, and the
  // toolbar's Show in HTML: once the HTML view is open (Show in HTML's, the
  // first the page's text doesn't show).
  const [fillInHtml, setFillInHtml] = useState<null | { hidden: boolean }>(null);
  useEffect(() => {
    if (!fillInHtml || htmlSource === null) return;
    setFillInHtml(null);
    selectHtmlPlaceholder(htmlSourceRef.current, htmlSource, fillInHtml);
  }, [fillInHtml, htmlSource]);
  const fillFirstPlaceholder = () => {
    if (htmlSource !== null) {
      selectHtmlPlaceholder(htmlSourceRef.current, htmlSource);
      return;
    }
    if (showFirstPlaceholder()) return;
    if (openHtmlView()) {
      setFillInHtml({ hidden: false });
      toast(t('placeholders.inHtmlView', { html: '</>' }));
    }
  };
  // Show in HTML: straight to the HTML view, past the page's own placeholders.
  const showHiddenPlaceholder = () => {
    if (htmlSource !== null) {
      selectHtmlPlaceholder(htmlSourceRef.current, htmlSource, { hidden: true });
      return;
    }
    if (openHtmlView()) setFillInHtml({ hidden: true });
  };

  /**
   * Quality's Show: the block of the page holding the passage (never a
   * suggestion's card), scrolled to and marked for a moment.
   */
  const showInPage = (text: string, { focus = false } = {}) => {
    if (!editor) return;
    const at = findBlock(editor.state.doc, text);
    if (!at) return;
    // The caret at the passage, to fix it there (Before you publish's Fix first).
    if (focus)
      editor
        .chain()
        .setTextSelection(at.from + 1)
        .focus(undefined, { scrollIntoView: false })
        .run();
    (editor.view.nodeDOM(at.from) as HTMLElement | null)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
    clearTimeout(flashTimer.current);
    editor.view.dispatch(editor.state.tr.setMeta(flashKey, at));
    flashTimer.current = setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(flashKey, null));
    }, 1200);
  };

  /**
   * A whole page rewritten (Rewrite the whole page): Accept puts it
   * in place of the page the agent read (History keeps that first), Reject
   * leaves the page, and Undo puts the page back. A page changed since
   * isn't written over: the person runs the rewrite again.
   */
  const decidePage = async (s: DraftSuggestion, to: SuggestionStatus) => {
    if (!editor || deciding || restoringNow.current || lockedFor('reviewSuggestions')) return;
    const undo = to === 'open' && s.status === 'accepted';
    // What the page must still read as for the change to go in.
    const expected = to === 'accepted' ? (s.beforeHtml ?? '') : undo ? s.afterText : null;
    const changed = () => expected !== null && pageChangedSince(editor.getHTML(), expected);
    const refuse = () =>
      toast(to === 'accepted' ? t('rewrite.changed') : t('rewrite.changedAfter'));
    if (changed()) {
      refuse();
      return;
    }
    setDeciding(true);
    // Held still from here: nothing typed while History and the decision are
    // saved can be written over.
    const editable = editor.isEditable;
    editor.setEditable(false, false);
    try {
      if (to === 'accepted' && !agentBeforeKept.current) {
        await autosave.settle();
        await keepAgentBeforeVersion(draft.id);
        agentBeforeKept.current = true;
      }
      if (changed()) {
        refuse();
        return;
      }
      await decideDraftSuggestions([s.id], to);
      if (expected !== null) {
        editor
          .chain()
          .setMeta(CITED_EDIT_ALLOWED, true)
          // The page as it was, two H1s and all, on Undo.
          .setMeta(ONE_H1_AS_IS, true)
          .setContent(to === 'accepted' ? s.afterText : (s.beforeHtml ?? ''))
          .run();
      }
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: to } : x)));
      if (to === 'accepted') {
        // A page written again, as Start's: the steps passed on the page
        // before are passed no longer (#1556 review). The rewrite's own
        // attempt stays, to pass its step.
        saveThirdStep({ ...thirdStepNow.current, passes: {} });
        // What Fix tried was on the page before: the new page's rules are the agent's again.
        saveTried(NO_TRIED);
        toast.success(t('rewrite.acceptedToast'));
        // The rewrite is the whole batch: as Accept all.
        nudgeAfterRead();
      } else if (to === 'rejected') toast(t('rewrite.rejectedToast'));
      else toast(t('rewrite.undoneToast'));
    } catch (err) {
      console.error('Failed to decide the rewritten page:', err);
      toast.error(t('suggestions.saveFailed'));
    } finally {
      if (editable) editor.setEditable(true, false);
      setDeciding(false);
    }
  };

  // A full batch: the run stopped at its most, so it says to run it again.
  const fixedMessage = (count: number) =>
    count >= AGENT_RUN_MAX
      ? t('suggestions.fixedMax', { count })
      : t('suggestions.fixed', { count });
  /**
   * Fix open rules with agent: the page as it is now is saved, then the
   * Content Agent reads it with the rules still open (or only the ones
   * named), the person's own rules and the locked passages, and leaves a new
   * batch of suggestions for review.
   */
  const fixRules = async (only?: string[]) => {
    if (lockedFor('fixRules')) return;
    // One agent run at a time, never before the locked passages are read,
    // nor while a restore replaces the page it would read.
    if (!editor || fixing || starting || rewriting || !citedRead || restoringNow.current) return;
    if (openSuggestions > 0) {
      toast(t('suggestions.decideFirst', { count: openSuggestions }));
      return;
    }
    const {
      forAgent: open,
      notForAgent,
      held: heldOpen,
    } = openRulesForAgent(rules.rules, only, heldRules);
    if (open.length === 0) {
      // Only rules it can't fix are open: say what to do instead.
      if (notForAgent.length) toast(t(`suggestions.${notForAgentMessage(notForAgent)}`));
      else if (heldOpen.length) toast(tRules(heldMessage(heldOpen)));
      return;
    }
    const pageText = editor.getText({ blockSeparator: '\n' });
    const request = {
      rules: open.map(({ rule, status }) => {
        const fanouts = fanoutsToUse(status);
        return {
          key: rule.key,
          name: tRules(`names.${rule.key}`),
          detail: [
            ...aimAndNow(rule, status),
            rule.key === 'aiTraces'
              ? `${tRules('agent.phrases')}: ${aiTracesFound(pageText).join(', ')}`
              : null,
            // Which fan-outs, so it writes those rather than questions of its own.
            fanouts ? `${tRules('agent.fanouts')}: ${fanouts}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }),
      ...agentContext(editor),
    };
    // A page over a Length it isn't sent: what it adds stays short.
    const overLength = overLengthFor(rules.rules, open);
    await runAgentFix(
      () =>
        fixDraftRules(draft.id, draft.brandId, overLength ? { ...request, overLength } : request),
      undefined,
      false,
      beginThirdTry('fix', { only }),
      open.map(({ rule }) => rule.key),
    );
  };

  /**
   * What every fix by the agent sends besides its rules: the person's own
   * rules, the locked passages, and the sources the Sources tab keeps, which
   * it writes from (CE-033).
   */
  const agentContext = (ed: Editor) => ({
    textRules: rules.textRules.filter(({ rule }) => rule.on).map(({ rule }) => rule.text),
    locked: (() => {
      const locks = citedLocks(ed.state);
      return [...locks.labels.keys()].filter((key) => !locks.unlocked.has(key));
    })(),
    ...(reads.sources?.data
      ? {
          sources: rebuildSources(reads.sources.data, reads.sources.choices, {
            title,
            sourceUrl: draft.sourceUrl,
            html: ed.getHTML(),
            length: rules.length,
          }),
        }
      : {}),
  });

  /**
   * One of the agent's fixes from this page (Fix open rules, Hand off): the
   * page is saved, the agent leaves a new batch of suggestions for review,
   * and Stop or a lost answer is said as such.
   */
  const runAgentFix = async (
    send: () => Promise<{ count: number; why?: AgentEmptyWhy } | { error: HandOffError }>,
    told: (count: number) => string = fixedMessage,
    // The editor's own run (the automatic hand-off): what the person didn't
    // start isn't said when it doesn't run or finds nothing, only logged.
    quiet = false,
    // Fix open rules as Next's third step (beginThirdTry): found nothing, it
    // is taken; failed, stopped or never run, the attempt before it is back.
    third: { prev: ThirdTry | null } | null = null,
    // The rules a Fix was sent: tried once its run is decided (triedAfter).
    tried: string[] | null = null,
  ) => {
    const untried = () => {
      if (tried) saveTried({ ...triedNow.current, pending: null });
      if (!third) return;
      const read = attemptRead.current;
      saveThirdTry(read && read.of === third.prev ? read.now : third.prev);
    };
    const nothing = () => {
      if (tried) saveTried(triedAfter(triedNow.current, tried));
      const now = thirdStepNow.current.attempt;
      if (third && now) saveThirdTry({ ...now, ended: true });
    };
    const failed = (key: string, error: string) => {
      untried();
      if (quiet) {
        console.warn('The automatic hand-off did not run:', error);
        return;
      }
      toast.error(t(key));
      // The card's last run says so, not an earlier batch's review.
      if (error === 'failed') setLastRunFailed(true);
    };
    setLastRunFailed(false);
    setStoppingRun(null);
    stopSent.current = null;
    setFixing(true);
    if (tried) {
      saveTried({
        ...triedNow.current,
        pending: { keys: tried, batch: suggestionsNow.current[0]?.batchId ?? null },
      });
    }
    const asked = Date.now();
    try {
      // The agent reads the page as saved.
      await autosave.settle();
      // The run there was before this one: one whose answer is lost is the next.
      const before = (await readAgentRun(draft.id, FIX_RUNS).catch(() => null))?.id ?? null;
      setFixOnServer(true);
      const result = await send().catch((err) => {
        // The call itself gave up (a timeout on the way): the agent may still finish.
        console.error('Failed to hear back from the Content Agent:', err);
        return { error: 'unconfirmed' as const };
      });
      const stop = stopSent.current;
      if ('error' in result && result.error === 'unconfirmed' && stop && (await stop)) {
        // Stopped, and the answer was lost on the way: nothing it had is kept.
        untried();
        toast(t('agentCard.stopped'));
        return;
      }
      if ('error' in result && result.error === 'unconfirmed') {
        // No answer is not a failure: how its run ended says (its batch, or its row).
        const outcome = await agentOutcome(draft.id, before, asked + FIX_WAIT_MS);
        if (outcome && 'stopped' in outcome) {
          untried();
          toast(t('agentCard.stopped'));
          return;
        }
        if (outcome && 'nothing' in outcome) {
          nothing();
          if (!quiet) {
            toast(
              t(
                outcome.why === 'locked'
                  ? 'suggestions.nothingToFixLocked'
                  : 'suggestions.nothingToFix',
              ),
            );
          }
          return;
        }
        if (!outcome || 'failed' in outcome) {
          failed('suggestions.fixErrors.failed', 'failed');
          return;
        }
        const landed = outcome.batch;
        setSuggestions(landed);
        setBarClosed(false);
        agentBeforeKept.current = false;
        toast.success(told(landed.filter((s) => s.status === 'open').length));
        nudgeAt('agent');
        return;
      }
      if ('error' in result && result.error === 'stopped') {
        // Stopped from the card: no failure, and nothing changed.
        untried();
        toast(t('agentCard.stopped'));
        return;
      }
      if ('error' in result) {
        failed(`suggestions.fixErrors.${result.error}`, result.error);
        // Another tab (or the API) left them: show them here to decide.
        if (result.error === 'open_suggestions') {
          setSuggestions(await getDraftSuggestions(draft.id));
          setBarClosed(false);
        }
        return;
      }
      if (result.count === 0) {
        nothing();
        // Why, so the person knows what to do: every change it had was in a quoted passage.
        if (!quiet) {
          toast(
            t(
              result.why === 'locked'
                ? 'suggestions.nothingToFixLocked'
                : 'suggestions.nothingToFix',
            ),
          );
        }
        return;
      }
      setSuggestions(await getDraftSuggestions(draft.id));
      setBarClosed(false);
      // A new batch: History keeps the page again before its first change.
      agentBeforeKept.current = false;
      toast.success(told(result.count));
      nudgeAt('agent');
    } catch (err) {
      console.error('Failed to run the Content Agent:', err);
      failed('suggestions.fixErrors.failed', 'failed');
    } finally {
      setFixing(false);
      setFixOnServer(false);
      setStoppingRun(null);
      stopSent.current = null;
    }
  };

  // Hand it off to Content Agent (Quality spec §5, CE-051): Quality's open
  // suggestions, each with what it names on the page; the disclosure only
  // with its line in the page's language.
  const tQuality = useTranslations('contentEditor.editor.quality');
  const tBrief = useTranslations('contentEditor.editor.brief');
  const handOffSuggestions = sourcesOn && quality ? qualitySuggestions(tQuality, quality) : [];
  const handOffList = handOffItems(handOffSuggestions, {
    // Added, and not read again yet: never a second one.
    disclosureLine: disclosureOnPage ? null : disclosureLine,
  });
  // What AI read of the page (Answer first, the disclosure, balance) is read
  // again after each save (usePageRead's reading): until then a fix it
  // asked for may be on the page.
  const handOffWaitsForRead = handOffSuggestions.some((s) => s.ai && HANDOFF_KEYS.has(s.key));
  const [handingOff, setHandingOff] = useState(false);
  const handedOff = (count: number) =>
    count >= AGENT_RUN_MAX ? tQuality('handOff.doneMax', { count }) : fixedMessage(count);
  /**
   * The agent fixes the page's open Quality suggestions in one run, as
   * suggestions to review; the to-dos stay the person's (one run, on the
   * workspace's AI usage).
   */
  const handOff = async (origin: 'person' | 'auto' = 'person') => {
    // Read-only, the automatic one isn't due: only the person's asks here.
    if (lockedFor('runAgent')) return;
    if (!editor || fixing || starting || rewriting || !citedRead || restoringNow.current) return;
    if (openSuggestions > 0) {
      toast(t('suggestions.decideFirst', { count: openSuggestions }));
      return;
    }
    if (handOffList.length === 0) {
      toast(t('suggestions.nothingToFix'));
      return;
    }
    const items = handOffList;
    const context = agentContext(editor);
    // The customer cases' paragraphs (CE-052): the person vouches for them,
    // so the agent leaves them as it leaves a locked passage.
    const cases = casesOn
      ? proofAsks.filter((ask) => ask.kind === 'customer_case').map((ask) => ask.block)
      : [];
    // Its checks add text too: on a page over its Length, kept short.
    const overLength = overLengthFor(rules.rules, []);
    setHandingOff(true);
    try {
      await runAgentFix(
        () =>
          handOffDraft(draft.id, draft.brandId, {
            items,
            origin,
            ...context,
            locked: [...context.locked, ...cases],
            ...(overLength ? { overLength } : {}),
          }),
        handedOff,
        origin === 'auto',
      );
    } finally {
      setHandingOff(false);
    }
  };

  // The agent at work from this page: Fix open rules, or the brief. Its run,
  // step by step, and Stop (CE-027/035).
  const agentWorking = fixing || briefRebuilding;
  const pagePill = pagePillOf({ working: agentWorking, openSuggestions, status });
  // Any run the card follows (Fix, a hand-off, the brief): a failed one before it is behind it.
  useEffect(() => {
    if (agentWorking) setLastRunFailed(false);
  }, [agentWorking]);
  // Another run started here (Fix, a hand-off, the brief): the band of the
  // one that couldn't finish goes (editor UX review 2026-11-03: it stayed over
  // a brief built since). Its own Try again keeps it until the page is left
  // for the agent's: a start refused says so under it.
  const otherRun = fixing || briefRebuilding;
  useEffect(() => {
    if (otherRun) setAgentFailed(false);
  }, [otherRun]);
  const agentRun = useAgentRun(draft.id, agentWorking, fixing ? FIX_RUNS : BRIEF_RUNS);
  const stopAgent = async () => {
    if (!agentRun) return;
    setStoppingRun(agentRun.id);
    const request = stopAgentRun(draft.id, draft.brandId, agentRun.id).catch(
      (): { error: 'failed' } => ({
        error: 'failed',
      }),
    );
    const sent = request.then((result) => !('error' in result) && result.stopped);
    stopSent.current = sent;
    const result = await request;
    // Nothing to stop, or it couldn't: the run goes on, and says how it ends.
    if ('error' in result || !result.stopped) {
      if ('error' in result) toast.error(t('agentCard.stopFailed'));
      if (stopSent.current === sent) stopSent.current = null;
      setStoppingRun(null);
    }
  };
  const onBriefRebuilding = useCallback((on: boolean, onServer: boolean) => {
    // Only the brief's end clears its Stop: the panel says "not rebuilding" as
    // it opens and closes, while Fix may be the one stopping.
    if (briefNow.current && !on) {
      setStoppingRun(null);
      stopSent.current = null;
    }
    briefNow.current = on;
    setBriefRebuilding(on);
    setBriefOnServer(on && onServer);
  }, []);
  // One agent run at a time from this page: the others wait for it.
  const agentBusy = fixing || starting || rewriting || briefRebuilding;
  // The month's AI usage used up: each agent button says so before anything
  // else, and runs nothing (AI usage spec §4). A run ending reads the usage
  // again, so the header meter shows what it used.
  const { usage: aiUsage, refresh: refreshAiUsage } = useAiUsage();
  const aiUsedUp =
    aiUsage && aiUsageTone(aiUsage) === 'exhausted'
      ? aiUsage.periodEnd
        ? t('suggestions.aiUsedUp', { date: formatMonthDay(aiUsage.periodEnd) })
        : t('suggestions.aiUsedUpNoDate')
      : null;
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !agentBusy) refreshAiUsage();
    wasBusy.current = agentBusy;
  }, [agentBusy, refreshAiUsage]);
  // The page read's visual proof spots (CE-049), in the draft's margin: not
  // while the agent changes the page. Add image opens their dialog.
  const [spotFor, setSpotFor] = useState<ProofSpot | null>(null);
  // Quality's Add image (CE-049, part d): the first spot still open.
  const addImage = () => {
    if (!editor || !pageRead.read || lockedFor('addImages')) return;
    const [first] = openSpotPlaces(editor.state.doc, pageRead.read.spots);
    if (first) setSpotFor(first.spot);
  };
  const spotList = sourcesOn && !agentBusy ? (pageRead.read?.spots ?? null) : null;
  // A spot's Add, in the page's margin: read-only, the upgrade dialog instead.
  const openSpot = useCallback(
    (spot: ProofSpot) => {
      if (isLocked) openUpgrade(tActions('addImages'));
      else setSpotFor(spot);
    },
    [isLocked, openUpgrade, tActions],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr
        .setMeta(
          proofSpotsKey,
          spotList?.length
            ? {
                spots: spotList,
                title: t('proofSpots.title'),
                add: t('proofSpots.add'),
                forPassage: (passage: string) => t('proofSpots.for', { passage }),
                addFor: (passage: string) => t('proofSpots.addFor', { passage }),
                marker: (image: string) => t('proofSpots.marker', { image }),
                onAdd: openSpot,
              }
            : null,
        )
        .setMeta('addToHistory', false),
    );
  }, [editor, spotList, t, openSpot]);
  // Fix open rules and Hand off share the agent's fix run (fixing): each
  // card runs its own, and the other's run is the agent at work.
  const fixRunning = fixing && !handingOff;
  const handOffRunning = fixing && handingOff;
  /** Why the agent's fix can't run now, said on the card whose run isn't the one under way. */
  const agentFixBlocked = (running: boolean) =>
    aiUsedUp && !running
      ? aiUsedUp
      : restoring
        ? t('history.restoring')
        : openSuggestions > 0
          ? t('suggestions.decideFirst', { count: openSuggestions })
          : !citedRead
            ? t('suggestions.citedLoading')
            : agentBusy && !running
              ? t('suggestions.agentBusy')
              : null;
  const agentFix: AgentFix = {
    run: (only) => void fixRules(only),
    running: fixRunning,
    blocked: agentFixBlocked(fixRunning),
    held: heldRules,
    tried: triedShown,
  };
  const handOffCard: HandOff | null =
    sourcesOn && quality
      ? {
          run: () => void handOff(),
          running: handOffRunning,
          // As Fix's, and not while the page's reads would still move the list:
          // the claims; the page's read before its first answer, or while a
          // fix of what AI read of it may be on the page (it reads each save).
          blocked:
            agentFixBlocked(handOffRunning) ??
            (claimsRead.reading || (pageRead.reading && (!pageRead.read || handOffWaitsForRead))
              ? tQuality('handOff.reading')
              : null),
          count: handOffList.length,
          todos: quality.todos.filter((todo) => !todo.done).length,
        }
      : null;
  // Quality's automatic hand-off (CE-051): once a draft its brand hands off,
  // whose page came from elsewhere (imported to optimize, or the agent's).
  useAutoHandOff({
    draftId: draft.id,
    brandId: draft.brandId,
    // Read-only, nothing runs by itself.
    due:
      !isLocked &&
      sourcesOn &&
      draft.qualityHandoff &&
      status !== 'published' &&
      (draft.method === 'optimize' || draft.author === 'agent'),
    ready:
      qualitySettled &&
      !!handOffCard &&
      !handOffCard.blocked &&
      !handOffCard.running &&
      !agentWorking &&
      htmlSource === null,
    count: handOffList.length,
    run: () => handOff('auto'),
  });
  // The card's Run Agent says why it won't run, as the Rules card does: also
  // when the only rules left open are ones the agent doesn't fix (one H1).
  const agentRules = openRulesForAgent(rules.rules, undefined, heldRules);
  const cardRunBlocked =
    agentFix.blocked ??
    (agentRules.forAgent.length === 0 && agentRules.notForAgent.length > 0
      ? t(`suggestions.${notForAgentMessage(agentRules.notForAgent)}`)
      : agentRules.forAgent.length === 0 && agentRules.held.length > 0
        ? tRules(heldMessage(agentRules.held))
        : null);

  // A drag with files over the page shows where they go; one dropped beside
  // the page (not on its text) goes in at the cursor.
  const withFiles = (e: React.DragEvent) =>
    htmlSource === null && [...e.dataTransfer.types].includes('Files');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!withFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!withFiles(e)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => {
      if (withFiles(e)) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (e.defaultPrevented || !withFiles(e)) return;
      e.preventDefault();
      if (lockedFor('editContent')) return;
      void attachments.attach([...e.dataTransfer.files]);
    },
  };

  /** Opens the HTML view; whether it opened. */
  const openHtmlView = (): boolean => {
    if (!editor) return false;
    // The cards aren't in the HTML: decide them first.
    if (openSuggestions > 0) {
      toast(t('suggestions.htmlBlocked', { count: openSuggestions }));
      return false;
    }
    setHtmlSource(formatHtmlSource(editor.getHTML()));
    setHtmlEdited(false);
    return true;
  };
  const applyHtmlView = () => {
    if (!editor || htmlSource === null) return;
    // Nothing edited: back to the page as it was, with nothing to save.
    if (!htmlEdited) {
      setHtmlSource(null);
      return;
    }
    const cleaned = cleanHtml(htmlFromSource(htmlSource), {
      keepImages: true,
      keepHtmlBlocks: true,
    });
    // Emits an update, so the title and the autosave follow. HTML edited by
    // hand may change locked passages: it was the person's to write.
    editor.chain().setMeta(CITED_EDIT_ALLOWED, true).setContent(cleaned.html).run();
    setHtmlSource(null);
    toast(
      cleaned.unsafeRemoved
        ? t('html.appliedUnsafe', { count: cleaned.unsafeRemoved })
        : t('html.applied'),
    );
  };

  // HTML edited but not applied isn't saved yet: leaving asks first.
  useEffect(() => {
    if (!htmlEdited || htmlSource === null) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [htmlEdited, htmlSource]);

  // The page as HTML to publish; in the HTML view, the source on screen.
  const pageToPublish = () =>
    publishableHtml(
      htmlSource !== null ? htmlFromSource(htmlSource) : (editor?.getHTML() ?? draft.bodyHtml),
    );
  // The byline line a brand with Add byline to content puts under the H1,
  // in the page's language (its Language rule, else the brand's), as
  // Readability reads it: the language the writer writes the page in.
  // An author the person confirmed their site names (00271) isn't the team:
  // no "By {Brand} Team" line goes in for them.
  const contentByline =
    bylineInContent && authorsRead && (pageAuthor || !authorConfirmed.real)
      ? bylineText(language, pageAuthor?.name ?? null, brandName)
      : null;
  // The team for the CMS's author field (Export, Send to CMS), in the page's
  // language; until the authors are read, who it is by isn't known. Not for
  // an author the person confirmed their site names: the CMS keeps its own.
  const teamByline =
    authorsRead && (pageAuthor || !authorConfirmed.real) ? teamName(language, brandName) : '';
  // Site Audit's estimate (customer priorities item 9): the page as Export's
  // HTML file has it, read again once typing pauses, whatever Quality's phase.
  const estimateDoc = useMemo(() => {
    const html = publishableHtml(pageHtml);
    const fields = pageFields({
      title,
      html,
      sourceUrl: draft.sourceUrl,
      author: pageAuthor,
      reviewer: pageReviewer,
      teamByline,
    });
    return estimateDocument({
      title,
      html: withReviewerJsonLd(
        title,
        contentByline ? withByline(html, contentByline) : html,
        pageReviewer,
      ),
      metaDescription: fields.metaDescription,
      author: fields.author,
    });
  }, [pageHtml, title, draft.sourceUrl, pageAuthor, pageReviewer, teamByline, contentByline]);
  const auditEstimate = useAuditEstimate(draft.id, draft.brandId, estimateDoc);
  // Export (CE-057), once Quality is live: where it goes, its checks and fields.
  // The page as it was when Export opened: what it shows stays still while open.
  const [exportOpen, setExportOpen] = useState<{
    html: string;
    destination?: ExportDestination;
  } | null>(null);
  const openExport = (destination?: ExportDestination) =>
    setExportOpen({ html: withArticleSchema(pageToPublish(), addedSchema), destination });
  // Its checks, read again only as the link reads land, not on every render.
  const exportChecks = useMemo(
    () => (exportOpen ? pasteChecks(exportOpen.html, linkChecks) : null),
    [exportOpen, linkChecks],
  );
  const copyPageHtml = () => {
    if (!editor) return;
    const html = withArticleSchema(pageToPublish(), addedSchema);
    // No copy carries a placeholder: Export says so, and offers to leave them out.
    if (quality && exportPlaceholders(html) > 0) {
      setExportOpen({ html, destination: 'html' });
      return;
    }
    void copyToClipboard(
      withReviewerJsonLd(
        title,
        contentByline ? withByline(html, contentByline) : html,
        pageReviewer,
      ),
      t('copyHtmlDone'),
      t('copyHtmlFailed', { html: '</> HTML' }),
    );
  };

  /** Export: the page as Copy HTML gives it, as a Word, Excel, CSV, HTML or Markdown file. */
  const exportPage = async (format: DraftExportFormat) => {
    if (!editor) return;
    const html = withArticleSchema(
      publishableHtml(htmlSource !== null ? htmlFromSource(htmlSource) : editor.getHTML()),
      addedSchema,
    );
    const name = title.trim() || t('untitled');
    try {
      saveBlob(
        await draftExportBlob(format, name, html, undefined, draft.sourceUrl, await exportAuthor()),
        draftExportFileName(name, format, await exportFileWord()),
      );
    } catch (err) {
      console.error('Failed to export the page:', err);
      toast.error(t('export.failed'));
    }
  };

  /**
   * The agent on this draft again (Try again, Rewrite from brief): it takes
   * the page as saved now, with the brief, the sources and the rules in effect
   * here, and the page waits for it.
   */
  const startAgent = async () => {
    if (!editor || restoringNow.current || lockedFor('runAgent')) return;
    setStarting(true);
    try {
      await autosave.settle();
      const request = await agentWriteRequest(
        {
          id: draft.id,
          brandId: draft.brandId,
          title,
          pageType,
          method: draft.method,
          sourceUrl: draft.sourceUrl,
          bodyHtml: editor.getHTML(),
          rules: draft.rules,
        },
        describeRule,
        {
          rules: rules.rules.filter(({ rule }) => rule.on).map(({ rule }) => rule),
          textRules: rules.textRules.filter(({ rule }) => rule.on).map(({ rule }) => rule.text),
        },
      );
      const result = await startAgentWriting(draft.id, draft.brandId, {
        ...request,
        // "Reading N rules" says what the rules chip counts.
        counted: rulesSettled ? rules.total : undefined,
      });
      if ('error' in result) {
        toast.error(t(`agentFailed.errors.${result.error}`));
        return;
      }
      // A page written again: the third step is the new page's, and so are its rules.
      saveThirdStep({ attempt: null, passes: {} });
      saveTried(NO_TRIED);
      onAgentStarted?.('write');
    } catch (err) {
      console.error('Failed to start the Content Agent again:', err);
      toast.error(t('agentFailed.errors.failed'));
    } finally {
      setStarting(false);
    }
  };

  const canMarkReady = status === 'draft' || status === 'in_review';
  // Rewrite from brief, while the page is still open to the agent (not ready
  // or published), as the API allows.
  const agentRewrite: AgentRewrite | undefined = canMarkReady
    ? {
        run: () => void startAgent(),
        running: starting,
        blocked:
          aiUsedUp && !starting
            ? aiUsedUp
            : restoring
              ? t('history.restoring')
              : openSuggestions > 0
                ? t('suggestions.decideFirst', { count: openSuggestions })
                : agentBusy && !starting
                  ? t('suggestions.agentBusy')
                  : null,
      }
    : undefined;

  /**
   * Rewrite the whole page: the page as saved now, the rules in
   * effect here (with how the page reads against each), the person's own
   * rules and the passages still locked go to the Content Agent, which
   * rewrites the whole page in the background; the page waits for it, then
   * opens with the rewrite to compare.
   */
  /**
   * Rewrite the page to these rules. `citedToo`: the passages AI answers
   * quote are rewritten too (the Rules tab's choice when what they keep puts
   * the Length out of reach); the person compares it before anything changes.
   */
  const rewritePage = async ({ citedToo = false }: { citedToo?: boolean } = {}) => {
    // Never before the locked passages are read: the rewrite would be told none are.
    if (!editor || agentBusy || !citedRead || restoringNow.current || lockedFor('rewritePage')) {
      return;
    }
    // Next's step as the person asked for it, before the waits below.
    const stepAsked = nextStepNow.current;
    setRewriting(true);
    try {
      await autosave.settle();
      const inEffect = rules.rules.filter(({ rule }) => rule.on);
      const locks = citedLocks(editor.state);
      const request = await agentWriteRequest(
        {
          id: draft.id,
          brandId: draft.brandId,
          title,
          pageType,
          method: draft.method,
          sourceUrl: draft.sourceUrl,
          bodyHtml: editor.getHTML(),
          rules: draft.rules,
        },
        describeRule,
        {
          rules: inEffect.map(({ rule }) => rule),
          textRules: rules.textRules.filter(({ rule }) => rule.on).map(({ rule }) => rule.text),
        },
        // The passages still locked here, the ones the person didn't unlock.
        citedToo ? [] : [...locks.labels.keys()].filter((key) => !locks.unlocked.has(key)),
      );
      // Each rule says how the page reads now, as Fix open rules' do.
      const statusOf = new Map(inEffect.map(({ rule, status }) => [rule.key, status]));
      request.rules = request.rules.map((rule) => {
        const status = statusOf.get(rule.key);
        if (!status || status.state !== 'bad') return rule;
        const now = `${tRules('agent.now')}: ${ruleStatusDetail(tStatus, status)}`;
        return { ...rule, detail: [rule.detail, now].filter(Boolean).join(' · ').slice(0, 500) };
      });
      const result = await startPageRewrite(draft.id, draft.brandId, {
        ...request,
        // "Reading N rules" says what the rules chip counts.
        counted: rulesSettled ? rules.total : undefined,
      });
      if ('error' in result) {
        toast.error(t(`agentFailed.errors.${result.error}`));
        return;
      }
      // Under way: the page it leaves takes Next's third step, if it is that.
      beginThirdTry('rewrite', { at: stepAsked });
      onAgentStarted?.('rewrite');
    } catch (err) {
      console.error('Failed to start the page rewrite:', err);
      toast.error(t('agentFailed.errors.failed'));
    } finally {
      setRewriting(false);
    }
  };
  const pageRewrite: PageRewrite | undefined = canMarkReady
    ? {
        run: (options) => void rewritePage(options),
        running: rewriting,
        reach,
        cited: editor && citedRead ? lockedPassagesLeft(editor.state) : undefined,
        blocked:
          aiUsedUp && !rewriting
            ? aiUsedUp
            : restoring
              ? t('history.restoring')
              : openSuggestions > 0
                ? t('suggestions.decideFirst', { count: openSuggestions })
                : !citedRead
                  ? t('suggestions.citedLoading')
                  : agentBusy && !rewriting
                    ? t('suggestions.agentBusy')
                    : null,
      }
    : undefined;
  // Before you publish (CE-041) opens on Mark ready once Quality is live,
  // with the nudge to the first open to-do behind it, and on Export (CE-057),
  // with Ready to paste read from the page as it is then (its links as they
  // are read).
  const [publishOpen, setPublishOpen] = useState<{
    mode: 'markReady' | 'export' | 'send';
    html: string;
    /** Export's destination when Review opened it: Continue goes back to it. */
    returnTo?: ExportDestination;
  } | null>(null);
  // Send to CMS (#1331): admins and managers send the page to the brand's
  // webhook, as the page Export makes ready, past Before you publish once
  // Quality is live.
  const { canManage } = useUserRole();
  const [sendOpen, setSendOpen] = useState<{ html: string } | null>(null);
  // The page's last send to a CMS, for the header (#1331): read once, then as sent.
  const [cmsLast, setCmsLast] = useState<DraftCms['last']>(null);
  useEffect(() => {
    let cancelled = false;
    readDraftCms(draft.id)
      .then((read) => {
        if (!cancelled && read?.last) setCmsLast(read.last);
      })
      .catch((err) => console.error('Failed to read the page’s last send:', err));
    return () => {
      cancelled = true;
    };
  }, [draft.id]);
  const [preparing, setPreparing] = useState(false);
  // HTML edited in the HTML view and not applied isn't in the page to save.
  const htmlUnapplied = htmlSource !== null && htmlEdited;
  // What's waiting goes out first, as for Mark ready: the CMS gets the page
  // GetCito holds, the one its callback later marks Published. A page that
  // can't be saved (a teammate or the agent changed it meanwhile) isn't sent.
  const openSend = async () => {
    if (preparing) return;
    if (htmlUnapplied) {
      toast.error(t('send.applyHtml'));
      return;
    }
    setPreparing(true);
    const saved = await autosave.settle().then(
      () => true,
      () => false,
    );
    setPreparing(false);
    if (!saved) {
      toast.error(t('send.unsaved'));
      return;
    }
    setSendOpen({ html: withArticleSchema(pageToPublish(), addedSchema) });
  };
  /**
   * Mark published (CE-013), once the page is saved: the server keeps it in
   * History as published, as it stands in the database.
   */
  const openPublish = async () => {
    if (preparingLive || draft.archivedAt || lockedFor('markPublished')) return;
    if (htmlUnapplied) {
      toast.error(t('send.applyHtml'));
      return;
    }
    setPreparingLive(true);
    const saved = await autosave.settle().then(
      () => true,
      () => false,
    );
    setPreparingLive(false);
    if (!saved) {
      toast.error(tPublish('unsaved'));
      return;
    }
    setAskLive(true);
  };
  const startSend = () => {
    if (lockedFor('sendToCms')) return;
    if (htmlUnapplied) {
      toast.error(t('send.applyHtml'));
      return;
    }
    if (quality) openBeforePublish('send');
    else void openSend();
  };
  const openBeforePublish = (
    mode: 'markReady' | 'export' | 'send',
    returnTo?: ExportDestination,
  ) => {
    setPublishOpen({ mode, html: pageToPublish(), returnTo });
    if (mode === 'markReady') nudgeAt('markReady');
    // A product may have sold out since the check was read.
    shoppingCheck.reload();
  };
  // The page to publish's shopping links against the catalog (shopping path,
  // part 6), as the Shopping rules read them: every link, a product grid's
  // too, and the products the rule asks for (none with it off); and its
  // product cards' prices against the catalog's now. Read fresh:
  // 'reading' meanwhile, for a draft known to have a path. No row while
  // none is known to, so a draft without one never shows it.
  const shopRule = rules.rules.find(({ rule }) => rule.key === 'shopProductLinks')?.rule;
  const shopWant = shopRule?.on ? ruleNumber(shopRule) : 0;
  const { check: shopping, refreshing: shoppingRefreshing } = shoppingCheck;
  const shoppingRead = useMemo((): ShoppingLinks | 'reading' | 'failed' | null => {
    if (!publishOpen || shopping === null || shopping === 'reading') return null;
    if (shoppingRefreshing) return 'reading';
    if (shopping === 'failed') return 'failed';
    const page = readPage(publishOpen.html, 0);
    return shoppingLinks(page.links ?? [], shopping, shopWant, page.cards ?? []);
  }, [publishOpen, shopping, shoppingRefreshing, shopWant]);
  // Read once per change (a link read landing, the title), not on every render.
  const readyToPaste = useMemo((): ReadyToPaste | null => {
    if (!publishOpen) return null;
    const { html } = publishOpen;
    const { links, images } = pasteChecks(html, linkChecks);
    return {
      placeholders: exportPlaceholders(html) + titlePlaceholders(title, html),
      imagesWithoutAlt: images.withoutAlt,
      linksBroken: links.broken,
      linksUnread: links.count - links.read,
    };
  }, [publishOpen, linkChecks, title]);
  // The reviewer's WebPage node as the page goes out, read once Before you
  // publish opens, from the page as it was then (not on every keystroke).
  const reviewerLd = useMemo(
    () => (publishOpen ? reviewerJsonLd(title, publishOpen.html, pageReviewer) : null),
    [publishOpen, title, pageReviewer],
  );
  /** Marks it ready; past Before you publish's warning, logged with its facts. */
  const markReady = async (anyway?: ReadyAnyway) => {
    if (lockedFor('markReady')) return;
    setMarking(true);
    try {
      // What's waiting goes out first, so the ready draft (and the version
      // History keeps of it) is the one on screen; a page that can't be saved
      // isn't marked ready.
      try {
        await autosave.settle();
      } catch {
        toast.error(t('markReadyUnsaved'));
        return;
      }
      const next = await (anyway
        ? markContentDraftReady(draft.id, anyway)
        : markContentDraftReady(draft.id));
      setStatus(next.status);
      toast.success(
        next.tasksDone > 0 && draft.action
          ? t('markedReadyAction', { no: draft.action.number, count: next.tasksDone })
          : t('markedReady'),
      );
    } catch (err) {
      console.error('Failed to mark the draft ready:', err);
      toast.error(t('markReadyFailed'));
    } finally {
      setMarking(false);
    }
  };

  // The Next step basket (Next step spec): the one step to take now, chosen
  // from the draft's state by rules (no AI call), in the header and on the
  // agent card. With Quality's first phase: it reads Trust and the to-dos.
  const router = useRouter();
  const todoCopy = useTodoCopy();
  const [nextOpen, setNextOpen] = useState(false);
  // A click moves focus in; the basket opening by itself on a new page doesn't.
  const [nextFocus, setNextFocus] = useState(true);
  const [skipped, setSkipped] = useState(() => readSkips(draft.id));
  const pageHasWords = useMemo(
    () => !qualityOn || wordsUnderTitle(pageHtml),
    [qualityOn, pageHtml],
  );
  const trustNow = quality?.trust?.score ?? null;
  // Something kept the brief can be built from (the server's no_sources
  // check): a prompt, a fan-out or a Search Console query; null until read.
  const briefSources = useMemo(() => {
    const read = reads.sources;
    if (!read || read.failed || !read.data) return null;
    const kept = rebuildSources(read.data, read.choices, {
      title,
      sourceUrl: draft.sourceUrl,
      html: '',
      length: 0,
    });
    return kept.promptIds.length + kept.fanouts.length + kept.queries.length > 0;
  }, [reads.sources, title, draft.sourceUrl]);
  // Trust low is a step only while Quality names what raises it, or is still
  // reading what may (editor test 2026-11-03: Trust 55 with nothing named
  // left only Skip).
  const trustRaisable =
    !!quality &&
    (qualitySuggestions(tQuality, quality).some((s) => s.score === 'trust') ||
      !!quality.claimsReading ||
      !!quality.pageReading);
  // The agent's latest batch on the page, and whether one works or waits for a decision.
  const batchNow = {
    batch: suggestions[0]?.batchId ?? null,
    open: openSuggestions,
    busy: agentWorking || rewriting,
  };
  // The run's changes decided (or it found nothing): its step is passed once
  // the steps' reads are in (below), with what the page reads then.
  const thirdTaken = thirdStepTried(thirdStep.attempt, batchNow);
  const nextState: NextStepState = {
    method: draft.method,
    open: canMarkReady,
    published: status === 'published',
    hasBrief: reads.brief.status === 'ready' ? reads.brief.brief !== null : null,
    briefSources,
    // The agent's suggestions waiting: Review them, the one step (a rewrite counts one).
    waiting: agentWorking ? 0 : openSuggestions,
    empty: !pageHasWords,
    rewrite: rewriteAdvice(rules.rules, reach, heldRules),
    openRules: rulesForNext(rules.rules, heldRules),
    fixable: openRulesForAgent(rules.rules, undefined, heldRules).forAgent.length,
    openTotal: rules.rules.filter(({ rule, status }) => rule.on && status.state === 'bad').length,
    quality: quality
      ? {
          trust: trustNow,
          trustLow: trustNow !== null && trustNow < TRUST_GATE && trustRaisable,
          todos,
        }
      : null,
    skipped,
    thirdPasses: thirdStep.passes,
    batch: batchNow.batch,
  };
  const next = nextStep(nextState);
  useEffect(() => {
    nextStepNow.current = next.step.id;
  });
  const firstTodo = todos.find((todo) => !todo.done);
  // The bottom nudge names a to-do: only while Next's step is the person's too.
  const nudgeFits = stepActor(next.step) === 'you' && next.step.id !== 'review';
  const todoLine = firstTodo && quality ? todoCopy(firstTodo, quality).next : null;
  // The agent's step, typically (the user, 2026-11-03): its minutes, and its
  // share of the month's AI usage as the server prices it (aiEstimates.js).
  const NEXT_COSTS: Partial<
    Record<
      NextAction,
      { minutes: number; estimate: 'editorBrief' | 'editorFix' | 'editorRewrite' | 'editorWrite' }
    >
  > = {
    buildBrief: { minutes: 1, estimate: 'editorBrief' },
    fixRules: { minutes: 1, estimate: 'editorFix' },
    rewritePage: { minutes: 2, estimate: 'editorRewrite' },
    writeWithAgent: { minutes: 3, estimate: 'editorWrite' },
  };
  const nextCostOf = NEXT_COSTS[next.step.primary];
  const nextCost = nextCostOf
    ? {
        minutes: nextCostOf.minutes,
        percent:
          aiUsage && !aiUsage.unlimited ? (aiUsage.estimates?.[nextCostOf.estimate] ?? null) : null,
      }
    : null;
  // What raises the score on Next's step, for its window (the user, 2026-11-03):
  // the person's to-dos and Quality's suggestions with their points, or the
  // rules the agent's step closes.
  const nextRaises = (() => {
    const id = next.step.id;
    if ((id === 'proof' || id === 'check') && quality) {
      return [
        ...todos
          .filter((todo) => !todo.done)
          .map((todo) => ({
            line: todoCopy(todo, quality).title,
            gain:
              todo.gain > 0
                ? tQuality('gain', { gain: todo.gain, score: tQuality(`names.${todo.score}`) })
                : null,
          })),
        ...qualitySuggestions(tQuality, quality).map((s) => ({
          line: s.line,
          gain: tQuality('gain', { gain: s.gain, score: tQuality(`names.${s.score}`) }),
        })),
      ];
    }
    if (id === 'fixRules' || id === 'length' || id === 'review') {
      return nextState.openRules.map((key) => ({ line: tRules(`names.${key}`), gain: null }));
    }
    return [];
  })();
  const skipStep = (id: NextStepId) => {
    const skips = { ...liveSkips(nextState), [id]: stepState(id, nextState) };
    setSkipped(skips);
    writeSkips(draft.id, skips);
  };
  // A skip whose step's state has changed is dropped, so it can't come back
  // to life; only once what the steps read is in (the brief, the rules, the
  // to-dos), not while a reopened page is still loading.
  // The sources (the fan-out rules read them), and with Quality the site's
  // trust and the link reads (Trust moves as they land).
  const nextRead =
    // The quoted passages: until they're read, no rule is held by them.
    citedRead &&
    reads.brief.status !== 'loading' &&
    reads.sources !== null &&
    rules.ready &&
    (!qualityOn || (todosRead && siteTrustRead && linksPending === 0)) &&
    // In phase 2 the brand's facts too (their first read of the site can take
    // a minute): they move Trust, which a proof skip was made at. Only the
    // dropping waits; the Next step shows meanwhile, each skip held against
    // its step's state as it is.
    factsState.status !== 'loading' &&
    // The proof to-dos (CE-049) come with the page's read, seconds after it opens.
    (!qualityOn || pageRead.settled);
  const staleSkips =
    nextRead && Object.keys(liveSkips(nextState)).length !== Object.keys(skipped).length;
  useEffect(() => {
    if (!staleSkips) return;
    setSkipped((prev) => {
      const live = liveSkips({ ...nextState, skipped: prev });
      writeSkips(draft.id, live);
      return live;
    });
    // nextState is read as it is when a skip goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleSkips, draft.id]);
  // A step the agent took passes with the rules open and the Length as they
  // read once its changes are decided: while they read so, Next moves on; a
  // rule the agent never saw, or a Length that moved (far off, for Fix open
  // rules: thirdStepPasses), brings it back. The
  // rules read the page a beat behind a decision (PAGE_READ_DELAY_MS, then a
  // deferred read), so the pass waits for that, and keeps the page as it
  // reads after; and for an attempt kept from before, for its run to be read.
  // It waits only for what a pass reads (thirdPassOf, #1556 review): the
  // rules, the quoted passages that hold some, and the last rewrite the
  // Length's reach reads; not Quality's reads, which a failed one would hold.
  const thirdRead = rulesSettled && citedRead && lastRewriteRead;
  const nextStateNow = useRef(nextState);
  useEffect(() => {
    nextStateNow.current = nextState;
  });
  useEffect(() => {
    if (!thirdTaken || !thirdRead || !attemptChecked) return;
    const timer = setTimeout(() => {
      const { attempt, passes } = thirdStepNow.current;
      if (!attempt) return;
      saveThirdStep({
        attempt: null,
        passes: { ...passes, [attempt.step]: thirdPassOf(nextStateNow.current) },
      });
    }, PAGE_READ_DELAY_MS + PASS_SETTLE_MS);
    return () => clearTimeout(timer);
    // pageHtml: each read of the page starts the wait again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thirdTaken, thirdRead, attemptChecked, pageHtml]);
  // A batch of the agent's since a pass (a hand-off, a Fix from the Rules
  // tab, a rewrite), decided: the pass reads the page again as it reads
  // then, the same wait over, so what its own changes opened never brings
  // the step back (thirdPassesToRead). The run Next's step began is the
  // attempt's (above).
  const passesToRead = thirdTaken ? '' : thirdPassesToRead(thirdStep.passes, batchNow).join(',');
  useEffect(() => {
    if (!passesToRead || !thirdRead || !attemptChecked) return;
    const timer = setTimeout(() => {
      const { attempt, passes } = thirdStepNow.current;
      const now = nextStateNow.current;
      const ids = passesToRead.split(',') as ThirdStepId[];
      saveThirdStep({
        attempt,
        passes: {
          ...passes,
          ...Object.fromEntries(ids.filter((id) => passes[id]).map((id) => [id, thirdPassOf(now)])),
        },
      });
    }, PAGE_READ_DELAY_MS + PASS_SETTLE_MS);
    return () => clearTimeout(timer);
    // pageHtml: each read of the page starts the wait again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passesToRead, thirdRead, attemptChecked, pageHtml]);
  // A Fix's suggestions decided, or it found nothing: the rules it was sent
  // are tried (triedAfter). Once the rules read the page again, one met
  // since leaves the list (triedStill): if the person's edits open it
  // again, it's the agent's.
  const triedDecided = runDecided(triedRules.pending, batchNow);
  useEffect(() => {
    const { pending } = triedNow.current;
    if (triedDecided && pending) saveTried(triedAfter(triedNow.current, pending.keys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triedDecided]);
  const triedLeft =
    thirdRead && !triedRules.pending ? triedStill(triedRules.tried, rules.rules) : triedRules.tried;
  useEffect(() => {
    if (triedLeft !== triedNow.current.tried) saveTried({ ...triedNow.current, tried: triedLeft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triedLeft]);
  // A pass that no longer holds is dropped, as a stale skip is, so a page
  // that reads as it did again later doesn't bring it back to life.
  const stalePasses =
    thirdRead && Object.keys(thirdStep.passes).length !== thirdStepPasses(nextState).size;
  useEffect(() => {
    if (!stalePasses) return;
    const held = thirdStepPasses(nextStateNow.current);
    const { attempt, passes } = thirdStepNow.current;
    saveThirdStep({
      attempt,
      passes: Object.fromEntries(
        Object.entries(passes).filter(([id]) => held.has(id as ThirdStepId)),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stalePasses]);
  // An attempt whose run failed or was stopped while the editor was closed
  // (a rewrite runs on its waiting page) is none: a later batch from anything
  // else must not pass the step. A Stop writes stopped_at before the run's
  // outcome, so a stopped run with no outcome yet is stopped. A Fix that
  // found nothing left no batch: it ended, as agentOutcome reads it. A run
  // still under way is left to finish: its batch passes the step. Only the
  // attempt read is changed: one begun since is the newer run's (#1556 review).
  useEffect(() => {
    const attempt = thirdStepNow.current.attempt;
    if (!attempt || attempt.ended) return;
    if (attempt.kind === 'rewrite' && failedRewrite) {
      saveThirdTry(null);
      setAttemptChecked(true);
      return;
    }
    let live = true;
    readAgentRun(draft.id, [attempt.kind])
      .then(
        (run) => {
          // Its own run: begun with it (the server's clock may differ a little).
          if (!live || !run || Date.parse(run.startedAt) < Date.parse(attempt.at) - 60_000) {
            return;
          }
          const now =
            run.outcome === 'failed' || run.outcome === 'stopped' || run.stoppedAt
              ? null
              : attempt.kind === 'fix' && run.outcome === 'done' && !run.steps[2]?.count
                ? { ...attempt, ended: true }
                : attempt;
          attemptRead.current = { of: attempt, now };
          if (now !== attempt && thirdStepNow.current.attempt === attempt) saveThirdTry(now);
        },
        () => {},
      )
      .finally(() => {
        if (live) setAttemptChecked(true);
      });
    return () => {
      live = false;
    };
    // Once, as the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);
  // It starts open on a new page, and folds once its first step (the brief)
  // is done; Skip or another step doesn't fold it.
  const nextShownOnce = useRef<'no' | 'open' | 'done'>('no');
  const startsNew = next.step.id === 'plan' && nextState.empty;
  const planned = nextState.hasBrief === true;
  useEffect(() => {
    if (!qualityOn) return;
    // Never by itself while an agent works (the user, 2026-11-03).
    if (nextShownOnce.current === 'no' && startsNew && !agentBusy) {
      nextShownOnce.current = 'open';
      setNextFocus(false);
      setNextOpen(true);
    } else if (nextShownOnce.current === 'open' && planned) {
      nextShownOnce.current = 'done';
      setNextOpen(false);
    }
    // agentBusy: a run that ends lets it open then, once.
  }, [qualityOn, startsNew, planned, agentBusy]);
  /** Why a step's button can't run now, as the buttons it stands for say. */
  const nextBlocked = (action: NextAction): string | null => {
    switch (action) {
      case 'buildBrief':
        return aiUsedUp ?? (agentBusy ? t('suggestions.agentBusy') : null);
      case 'writeWithAgent':
        return agentRewrite?.blocked ?? null;
      case 'rewritePage':
        return pageRewrite?.blocked ?? null;
      case 'fixRules':
        return agentFix.blocked;
      // As the header's Mark ready is held; an archived page is restored first, as in the Library.
      case 'beforePublish':
      case 'markReady':
      case 'markPublished':
        return action === 'markPublished' && draft.archivedAt
          ? tPublish('archived')
          : preparingLive
            ? t('nextStep.saving')
            : marking
              ? t('nextStep.marking')
              : autosave.state === 'conflict'
                ? t('save.conflict')
                : autosave.state === 'too_large'
                  ? t('save.tooLarge')
                  : null;
      default:
        return null;
    }
  };
  /** A step's button: the one the editor already has for it. */
  const runNext = (action: NextAction) => {
    setNextOpen(false);
    switch (action) {
      case 'addSources':
        openPanelTab('sources');
        return;
      case 'review':
        // A rewrite waits in the card above the page, a fix in the page.
        if (pageSuggestion?.status === 'open') {
          document
            .querySelector<HTMLElement>(`[role="region"][aria-label="${t('rewrite.bar')}"] button`)
            ?.focus({ preventScroll: false });
        } else reviewFirst();
        return;
      case 'buildBrief':
        if (!panelOpen) togglePanel();
        setTabRequest((prev) => ({ tab: 'brief', n: (prev?.n ?? 0) + 1, build: true }));
        return;
      case 'writeWithAgent':
        agentRewrite?.run();
        return;
      case 'writeMyself':
        skipStep(next.step.id);
        editor?.commands.focus('end');
        return;
      case 'rewritePage':
        pageRewrite?.run();
        return;
      case 'fixRules':
        agentFix.run();
        return;
      case 'pickAuthor':
        setAuthorMenuOpen(true);
        return;
      case 'addAuthor':
        router.push(MANAGE_AUTHORS_PATH);
        return;
      case 'showTodos':
      case 'showTrust':
        // Shown even with Quality open already: the part it names scrolls in and is marked.
        if (!panelOpen) togglePanel();
        setTabRequest((prev) => ({
          tab: 'quality',
          n: (prev?.n ?? 0) + 1,
          focus: action === 'showTodos' ? 'todos' : 'trust',
        }));
        return;
      case 'beforePublish':
        openBeforePublish('markReady');
        return;
      case 'markReady':
        void markReady();
        return;
      case 'export':
        openExport();
        return;
      case 'markPublished':
        void openPublish();
        return;
    }
  };

  /**
   * Ready, clicked (Next step spec §3b): the page goes back to review, while
   * it is still ready (published meanwhile from the Library, it says so). The
   * task Mark ready completed is open again, unless someone changed it since.
   */
  const [unmarking, setUnmarking] = useState(false);
  const unmarkReady = async () => {
    if (unmarking || lockedFor('changeContentStatus')) return;
    setUnmarking(true);
    try {
      const { status: now, tasksReopened } = await unmarkContentDraftReady(draft.id);
      setStatus(now);
      // Published from the Library meanwhile: its live address, for the Live page tab.
      if (now === 'published') void readLiveUrl(draft.id).then((url) => url && setLiveUrl(url));
      if (now !== 'in_review') toast(t('header.notReady', { status: tDraftStatus(now) }));
      else if (tasksReopened > 0 && draft.action) {
        toast(t('header.backInReviewAction', { no: draft.action.number, count: tasksReopened }));
      } else toast(t('header.backInReview'));
    } catch (err) {
      console.error('Failed to move the draft back to review:', err);
      toast.error(t('header.backInReviewFailed'));
    } finally {
      setUnmarking(false);
    }
  };
  /**
   * The header's title, clicked: the caret at the end of the block the title
   * is read from (draftTitleFromDoc: the first H1 with words, else the first
   * heading, else the first block with words), to rename it there.
   */
  const renameInPage = () => {
    if (!editor || lockedFor('editContent')) return;
    // The HTML view holds the page: the title is renamed in its text there.
    if (htmlSource !== null) {
      toast(t('header.renameInHtml'));
      return;
    }
    const blocks: { node: PmNode; end: number }[] = [];
    editor.state.doc.forEach((node, offset) => {
      if (node.isTextblock && node.textContent.trim()) {
        blocks.push({ node, end: offset + node.nodeSize - 1 });
      }
    });
    const heading = (level?: number) =>
      blocks.find(
        ({ node }) =>
          node.type.name === 'heading' && (level === undefined || node.attrs.level === level),
      );
    const pick = heading(1) ?? heading() ?? blocks[0];
    const { doc } = editor.state;
    const at = pick ? TextSelection.near(doc.resolve(pick.end), -1) : TextSelection.atStart(doc);
    editor.view.dispatch(editor.state.tr.setSelection(at).scrollIntoView());
    editor.commands.focus(undefined, { scrollIntoView: false });
  };

  // A version from History replaces the page: what's waiting is saved first,
  // as the server keeps the page it replaces, and the page can't change
  // while the restore runs.
  const restoreVersion = async (version: DraftVersion, label: string) => {
    if (!editor || restoringNow.current || lockedFor('restoreVersion')) return;
    restoringNow.current = true;
    setRestoring(true);
    editor.setEditable(false, false);
    try {
      await autosave.settle();
      const restored = await restoreDraftVersion(draft.id, version.id);
      const pageBefore = editor.getHTML();
      editor
        .chain()
        .setMeta(CITED_EDIT_ALLOWED, true)
        // The version as it was, its H1s too: the page on the server is it.
        .setMeta(ONE_H1_AS_IS, true)
        .setContent(restored.bodyHtml, { emitUpdate: false })
        .run();
      // The server has this page now: nothing from before it is still to
      // save, and saves go on from the restored version.
      autosave.discard(restored);
      const html = editor.getHTML();
      setTitle(restored.title);
      setPageHtml(html);
      detectType(restored.title, html);
      void loadCited();
      // The agent's open suggestions were for the page before it: they go,
      // so they hold no later run (open_suggestions). Left open when that
      // fails, for the person to decide on the card; and kept when the
      // version is the page it was (nothing was restored).
      // As the server says (00289), or, from a database before it, as the page reads.
      const samePage =
        restored.restored === false ||
        (restored.restored === undefined && html === pageBefore && restored.title === title);
      const stale = samePage
        ? []
        : suggestionsNow.current.filter((s) => s.status === 'open').map((s) => s.id);
      const setAside =
        stale.length === 0 ||
        (await decideDraftSuggestions(stale, 'rejected').then(
          () => true,
          (err) => {
            console.error('Failed to set aside the suggestions for the page before:', err);
            return false;
          },
        ));
      if (stale.length && setAside) {
        setSuggestions((now) =>
          now.map((s) => (stale.includes(s.id) ? { ...s, status: 'rejected' as const } : s)),
        );
      }
      // It says what went: they counted toward AI usage, and many may still apply.
      toast.success(
        samePage
          ? t('history.restoredSame', { version: label })
          : t('history.restored', { version: label, count: setAside ? stale.length : 0 }),
      );
      // Its card goes as if closed, with its Undo all and last run: they were
      // for the page before (editor test 2026-10-25). A new batch opens it.
      // And Next's third step is the restored page's again: its open
      // suggestions set aside are no decision of the agent's.
      if (!samePage) {
        setBarClosed(true);
        saveThirdStep({ attempt: null, passes: {} });
        saveTried(NO_TRIED);
      }
    } catch (err) {
      console.error('Failed to restore the version:', err);
      toast.error(t('history.restoreFailed'));
    } finally {
      editor.setEditable(true, false);
      restoringNow.current = false;
      setRestoring(false);
    }
  };

  const pickPageType = async (type: PageType) => {
    if (type === picked || lockedFor('setPageType')) return;
    const before = picked;
    setPicked(type);
    try {
      await setContentDraftPageType(draft.id, type);
    } catch (err) {
      console.error('Failed to set the page type:', err);
      setPicked(before);
      toast.error(t('pageType.failed'));
    }
  };

  // The site type, for the whole brand as in Brand settings: admins and
  // managers (as the brands table lets them), once Quality's phase 2 is live.
  // The page types offered, My rules and the agent follow it.
  const updateBrandStore = useBrandStore((s) => s.updateBrand);
  const storedSite = useBrandStore((s) => s.brands.find((b) => b.id === draft.brandId)?.siteType);
  const siteGuessed = !isSiteType(storedSite);
  const tSites = useTranslations('brands.siteTypes');
  const [siteSaving, setSiteSaving] = useState(false);
  const pickSite = async (next: SiteType) => {
    if (next === siteType || siteSaving || lockedFor('setSiteType')) return;
    // Taken once saved: My rules are read again for it, and one pick at a time.
    setSiteSaving(true);
    const saved = await updateBrand(draft.brandId, { siteType: next }).catch((err) => {
      console.error('Failed to change the site type:', err);
      return null;
    });
    setSiteSaving(false);
    if (!saved) {
      toast.error(t('pageType.siteFailed'));
      return;
    }
    updateBrandStore(draft.brandId, saved);
    setSiteType(next);
    siteTypeRef.current = next;
    const html = editor?.getHTML() ?? pageHtml;
    detectType(title, html);
    // A detected type is the server's too: a save reads it again for the new
    // site type, so the Library and the agent agree with the header.
    if (picked === null && editor) autosave.schedule({ title, bodyHtml: html });
    toast(t('pageType.siteChanged', { site: tSites(next) }));
  };

  // Why History waits (the HTML view holds the page, a restore runs, the
  // agent's changes land or a decision on them saves), or null.
  const historyWaits =
    htmlSource !== null
      ? t('history.htmlOpen')
      : restoring
        ? t('history.restoring')
        : fixing
          ? t('history.agentWorking')
          : deciding
            ? t('history.deciding')
            : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Two lines: the title and what you do with the page on top, which
          stays light (the title shortens, the save state and Mark ready never
          move), and the page's tags under the title, all of them at any width. */}
      <header className="border-b px-4 pt-2.5 pb-2">
        <div className="flex items-center gap-2.5">
          <Link
            href={CONTENT_LIBRARY_PATH}
            aria-label={t('back')}
            title={t('back')}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {/* The title takes the room left (at least ~140px from 1024px, 96px
              narrower; less while the save state needs its words), ends in "…",
              and never pushes, overlaps or wraps the buttons (Next step spec §3b). */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <h1
              className={cn(
                'shrink text-sm font-medium',
                autosave.state === 'conflict' ||
                  autosave.state === 'too_large' ||
                  autosave.state === 'failed'
                  ? 'min-w-16'
                  : 'min-w-24 lg:min-w-[140px]',
              )}
            >
              <button
                type="button"
                onClick={renameInPage}
                title={t('header.rename', { title: title.trim() || t('untitled') })}
                className="block max-w-full truncate rounded-sm text-left hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {title.trim() || t('untitled')}
              </button>
            </h1>
            {chatOn && <StatusPill state={pagePill} />}
            <span className="shrink-0">
              <SaveIndicator state={autosave.state} onRetry={() => void autosave.retry()} />
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {qualityOn && (
              <NextStepButton
                next={next}
                state={nextState}
                todoLine={todoLine}
                open={nextOpen}
                onOpenChange={(open) => {
                  setNextFocus(true);
                  setNextOpen(open);
                }}
                focusOnOpen={nextFocus}
                onAction={runNext}
                onSkip={skipStep}
                blocked={nextBlocked}
                raises={nextRaises}
                cost={nextCost}
                working={
                  agentWorking
                    ? {
                        run: agentRun,
                        onStop: () => void stopAgent(),
                        stopping: stoppingRun !== null && stoppingRun === agentRun?.id,
                      }
                    : null
                }
              />
            )}
            {/* With Chat on, the person's own Chat runs and this brand's Content Agent runs,
                this page's among them (Chat agentic plan §2–3): the same tray as Chat's header. */}
            {chatOn && (
              <RunsTray
                brandId={draft.brandId}
                // Read again as the page's agent starts, its run is on the server, and it ends.
                readAgain={`${agentWorking}:${agentRun?.id ?? ''}`}
              />
            )}
            {/* The month's AI usage, with this page's share (AI usage spec §3.1). */}
            <AiUsageMeter compact draftId={draft.id} />
            <HeaderTip label={t('history.button')} hint={historyWaits ?? t('history.hint')}>
              <HistoryMenu
                draftId={draft.id}
                disabled={historyWaits}
                onRestore={(version, label) => void restoreVersion(version, label)}
              />
            </HeaderTip>
            <HeaderTip label={t('copyHtml')} hint={t('copyHtmlHint')}>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={copyPageHtml}
                aria-label={t('copyHtml')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </HeaderTip>
            {quality ? (
              <HeaderTip label={t('export.button')} hint={t('export.hint')}>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!editor}
                  aria-label={t('export.button')}
                  onClick={() => openExport()}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </HeaderTip>
            ) : (
              <ExportMenu disabled={!editor} onExport={(format) => void exportPage(format)} />
            )}
            {canManage && (
              <HeaderTip label={t('send.button')} hint={t('send.hint')}>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={
                    !editor ||
                    preparing ||
                    autosave.state === 'conflict' ||
                    autosave.state === 'too_large'
                  }
                  aria-label={t('send.button')}
                  onClick={startSend}
                >
                  {preparing ? <LoadingDots /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </HeaderTip>
            )}
            {/* The one black button. Marked, it reads Ready (a click moves it back
                to review); published, Published (a click changes its live
                address, CE-013). Narrower than 1024px, ✓ alone. */}
            {status === 'ready' || status === 'published' ? (
              <HeaderTip
                label={tDraftStatus(status)}
                hint={
                  status === 'ready'
                    ? t('header.readyHint')
                    : draft.archivedAt
                      ? tPublish('archived')
                      : liveUrl
                        ? t('header.publishedHintAt', { url: liveUrl })
                        : t('header.publishedHint')
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  // An archived page's address waits until it's restored, as in the Library.
                  disabled={unmarking || (status === 'published' && !!draft.archivedAt)}
                  focusableWhenDisabled
                  aria-label={
                    status === 'ready' ? t('header.readyLabel') : tDraftStatus('published')
                  }
                  onClick={() => void (status === 'published' ? openPublish() : unmarkReady())}
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 disabled:opacity-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
                >
                  {unmarking ? <LoadingDots /> : <Check className="h-3.5 w-3.5" />}
                  <span className="hidden lg:inline">{tDraftStatus(status)}</span>
                </Button>
              </HeaderTip>
            ) : (
              <HeaderTip label={t('markReady')} narrowOnly>
                <Button
                  size="sm"
                  // A page that can't be saved can't be marked ready; the save state says why.
                  disabled={
                    marking || autosave.state === 'conflict' || autosave.state === 'too_large'
                  }
                  aria-label={t('markReady')}
                  onClick={guard(
                    () => (quality ? openBeforePublish('markReady') : void markReady()),
                    { action: tActions('markReady') },
                  )}
                >
                  {marking ? <LoadingDots /> : <Check className="h-3.5 w-3.5 lg:hidden" />}
                  <span className="hidden lg:inline">{t('markReady')}</span>
                </Button>
              </HeaderTip>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={panelOpen}
              aria-label={panelOpen ? t('panel.hide') : t('panel.show')}
              title={panelOpen ? t('panel.hide') : t('panel.show')}
              onClick={togglePanel}
              className={cn(panelOpen && 'bg-muted')}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Lined up under the title (the back button's 28px and the 10px gap). */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[38px]">
          <PageTypeMenu
            brandId={draft.brandId}
            siteType={siteType}
            onPickSite={
              canManage && qualityPhase() >= 2 ? (next) => void pickSite(next) : undefined
            }
            sitePending={siteSaving}
            siteGuessed={siteGuessed}
            pageType={pageType}
            detected={picked === null}
            isNew={draft.method === 'create'}
            sourceUrl={draft.sourceUrl}
            onPick={(type) => void pickPageType(type)}
            open={typeMenuOpen}
            onOpenChange={setTypeMenuOpen}
          />
          {authorsRead && (
            <AuthorMenu
              brandId={draft.brandId}
              brandName={brandName}
              authors={authorsRead.authors}
              authorId={authorId}
              onPick={(next) => void pickAuthor(next)}
              open={authorMenuOpen}
              onOpenChange={setAuthorMenuOpen}
              inContent={bylineInContent}
            />
          )}
          {authorsRead && (regulated || pageReviewer) && (
            <ReviewerMenu
              authors={authorsRead.authors}
              reviewerId={pageReviewer?.id ?? null}
              onPick={(next) => void pickReviewer(next)}
              open={reviewerMenuOpen}
              onOpenChange={setReviewerMenuOpen}
            />
          )}
          <DraftMethodBadge method={draft.method} />
          <DraftStatusBadge status={status} />
          {cmsLast && <CmsSentChip last={cmsLast} />}
          <button
            type="button"
            onClick={() => openPanelTab('rules')}
            title={t('rulesChipHint')}
            aria-label={
              rulesSettled
                ? t('rulesChipLabel', { met: rules.met, total: rules.total })
                : t('rulesChipReading')
            }
            className={cn(
              'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium',
              !rulesSettled
                ? 'text-muted-foreground'
                : rules.total > 0 && rules.met === rules.total
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
            )}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {/* One count once the set and the fan-outs are read (editor test
                2026-10-25: 8 of 12 on first paint, then 11 of 15). */}
            {rulesSettled
              ? t('rulesChip', { met: rules.met, total: rules.total })
              : t('rulesChipReading')}
          </button>
          {qualityOn && shownQuality === null && (
            <button
              type="button"
              onClick={() => openPanelTab('quality')}
              title={t('qualityChipHint')}
              className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border bg-muted/40 px-2 text-xs font-medium text-muted-foreground"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
              />
              {t('qualityChipReading')}
            </button>
          )}
          {shownScore !== null && (
            <button
              type="button"
              onClick={() => openPanelTab('quality')}
              title={t('qualityChipHint')}
              className={cn(
                'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium tabular-nums',
                BAND_CLASSES[qualityBand(shownScore)],
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full bg-current',
                  // New reads landing: the score may move once they're in.
                  !qualitySettled && 'animate-pulse motion-reduce:animate-none',
                )}
              />
              {t('qualityChip', { score: shownScore })}
              <span className="sr-only">
                {' · '}
                {t(`quality.bands.${qualityBand(shownScore)}`)}
                {!qualitySettled && ` · ${t('qualityChipUpdating')}`}
              </span>
            </button>
          )}
          {citedCount > 0 && (
            <span
              title={t('cited.chipHint')}
              className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {t('cited.chip', { count: citedCount })}
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* From 80% of the month's AI usage, as on the other pages, as a strip
              like the agent's own notices. */}
          <AiUsageBanner className="rounded-none border-x-0 border-t-0 px-4 py-1.5 text-[13px]" />
          {agentFailed && canMarkReady && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[13px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                {failedRewrite ? t('agentFailed.rewriteText') : t('agentFailed.text')}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  // Used up, as the red strip above says: it would only fail again.
                  disabled={
                    !!aiUsedUp || agentBusy || restoring || !editor || (failedRewrite && !citedRead)
                  }
                  title={aiUsedUp ?? undefined}
                  onClick={() => void (failedRewrite ? rewritePage() : startAgent())}
                >
                  {(starting || rewriting) && <WorkingDots className="ml-0" />}
                  {t('agentFailed.retry')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('agentFailed.dismiss')}
                  title={t('agentFailed.dismiss')}
                  onClick={() => setAgentFailed(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          )}
          {/* The action this draft is the work of (CE-022): under the header,
              which has no room left at 1024px, and Mark ready completes its task. */}
          {draft.action && (
            <p className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-[13px] text-muted-foreground">
              <Target aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                {t.rich(canMarkReady ? 'actionBar' : 'actionBarDone', {
                  no: draft.action.number,
                  link: (chunks) => (
                    <Link
                      href={`/dashboard/action-center/actions?action=${draft.action!.id}`}
                      className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
          {/* The chat it was made in (W4-10): "From chat: {title}", with the new Chat on. */}
          {chatOn && draft.conversation && (
            <p
              data-slot="draft-chat-bar"
              className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-[13px] text-muted-foreground"
            >
              <MessageSquare aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {t.rich('chatBar', {
                  title: draft.conversation.title || t('chatBarUntitled'),
                  link: (chunks) => (
                    <Link
                      href={`/dashboard/chat/${draft.conversation!.id}`}
                      data-action="editor.openChat"
                      className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
          {(agentWorking || (suggestions.length > 0 && !(barClosed && openSuggestions === 0))) && (
            <AgentCard
              suggestions={suggestions}
              rules={cardRules}
              sourceCount={batchSources(suggestions).length}
              onSeeSources={() => openPanelTab('sources')}
              // Not while the HTML view holds the page: it would write over it.
              busy={deciding || restoring || htmlSource !== null}
              working={agentWorking}
              onServer={(fixing && fixOnServer) || (briefRebuilding && briefOnServer)}
              run={agentRun}
              lastRunFailed={lastRunFailed}
              onStop={() => void stopAgent()}
              stopping={stoppingRun !== null && stoppingRun === agentRun?.id}
              onAcceptAll={() =>
                void decide(
                  suggestions.filter((s) => s.status === 'open').map((s) => s.id),
                  'accept',
                )
              }
              onRejectAll={() =>
                void decide(
                  suggestions.filter((s) => s.status === 'open').map((s) => s.id),
                  'reject',
                )
              }
              onUndoAll={() =>
                void decide(
                  suggestions.filter((s) => s.status !== 'open').map((s) => s.id),
                  'undo_all',
                )
              }
              onReview={reviewFirst}
              onRun={() => void fixRules()}
              onClose={() => setBarClosed(true)}
              onDecidePage={(to) => {
                if (pageSuggestion) void decidePage(pageSuggestion, to);
              }}
              runBlocked={cardRunBlocked}
              // Once nothing is left to decide, the basket's step (Next step spec §3).
              next={
                qualityOn
                  ? {
                      label: t(`nextStep.actions.${next.step.primary}`),
                      onRun: () => runNext(next.step.primary),
                      blocked: nextBlocked(next.step.primary),
                      // The card heads with the step and who takes it (Next step spec §3).
                      title: stepName(tNext, next.step.id, nextState),
                      reason: stepReason(tNext, next.step, nextState, todoLine, next.path),
                      actor: stepActor(next.step),
                    }
                  : null
              }
              // The kept blocks are named only when they put the Length out of reach.
              length={length && { ...length, outOfReach: keptOutOfReach(rules.rules, reach) }}
              pageChars={pageChars}
              onAllSteps={() => {
                setNextFocus(true);
                setNextOpen(true);
              }}
            />
          )}
          {editor && (
            <EditorToolbar
              editor={editor}
              target={rules.length}
              lengthWarning={lengthWarns(rules.rules)}
              htmlView={htmlSource !== null}
              onToggleHtml={htmlSource === null ? openHtmlView : applyHtmlView}
              onAttach={attachments.open}
              linkRequest={linkRequest}
              placeholders={{ hidden: hiddenPlaceholders, onShowHidden: showHiddenPlaceholder }}
              // + Insert › Products, from an online shop's catalog (shopping path, part 5).
              productsBrandId={siteType === 'ecommerce' ? draft.brandId : null}
            />
          )}

          {htmlSource !== null && (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{t('html.title')}</span> ·{' '}
                {t('html.hint', { marker: '<!-- html-block -->' })}
              </span>
              <Button size="sm" className="ml-auto h-7" onClick={applyHtmlView}>
                {t('html.back')}
              </Button>
            </div>
          )}

          <div className="relative min-h-0 flex-1" {...dropHandlers}>
            {/* A container: the visual proof spots are cards from 1120 px, markers below. */}
            <div className="@container h-full overflow-y-auto">
              {htmlSource !== null && (
                <textarea
                  ref={htmlSourceRef}
                  value={htmlSource}
                  onChange={(e) => {
                    setHtmlSource(e.target.value);
                    setHtmlEdited(true);
                  }}
                  spellCheck={false}
                  // Read-only: the source shows, and nothing in it changes.
                  readOnly={isLocked}
                  aria-label={t('html.label')}
                  className="block h-full min-h-[600px] w-full resize-none bg-muted/20 px-7 py-5 font-mono text-[12.5px] leading-relaxed outline-none"
                />
              )}
              <div
                className={cn(
                  'mx-auto max-w-[720px] px-7 pt-7 pb-20',
                  htmlSource !== null && 'hidden',
                )}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
            {dragging && <DropOverlay />}
            {quality && (
              <NextNudge
                // Only while Next's step is the person's: never a second step
                // beside the agent's (editor UX review 2026-11-03).
                shown={nudgeFits ? nudge.shown : null}
                quality={quality}
                onShowPlaceholder={showFirstPlaceholder}
                onPickAuthor={() => setAuthorMenuOpen(true)}
                onPickReviewer={() => setReviewerMenuOpen(true)}
                onAddCheckDate={htmlSource === null ? addCheckDate : undefined}
                onConfirmCase={(key) => void confirmCase(key)}
                onConfirmIntro={() => void confirmIntro()}
                onAddInput={addInput}
                onAddSource={sourcesOn ? addSource : undefined}
                onConfirmImages={openConfirmImages}
                onAddImage={addImage}
                onLater={nudge.later}
                onAct={nudge.close}
              />
            )}
          </div>
          {attachments.ui}
        </div>
        {panelOpen ? (
          <EditorSidePanel
            draft={draft}
            liveUrl={liveUrl}
            published={status === 'published'}
            siteType={siteType}
            title={title}
            bodyHtml={pageHtml}
            pageType={pageType}
            rules={rulesShown}
            brandRules={{ rules: brandRules, brandName }}
            reads={reads}
            tabRequest={tabRequest}
            agentFix={agentFix}
            pageRewrite={pageRewrite}
            agentRewrite={agentRewrite}
            // One batch, one run: its first suggestion's time is the run's.
            lastSuggestionAt={suggestions[0]?.createdAt ?? null}
            onSourceShown={() =>
              setTabRequest((prev) => (prev?.source ? { tab: prev.tab, n: prev.n } : prev))
            }
            onBuildStarted={() =>
              setTabRequest((prev) => (prev?.build ? { tab: prev.tab, n: prev.n } : prev))
            }
            onBriefRebuilding={onBriefRebuilding}
            briefBlocked={
              briefRebuilding
                ? null
                : (aiUsedUp ??
                  (agentBusy
                    ? t('suggestions.agentBusy')
                    : // Said where Run Agent is, before it fails (editor UX review 2026-11-03).
                      briefSources === false
                      ? tBrief('rebuildErrors.no_sources')
                      : null))
            }
            quality={quality}
            qualityScore={shownScore}
            onShowInPage={showInPage}
            onShowPlaceholder={showFirstPlaceholder}
            onPickAuthor={() => setAuthorMenuOpen(true)}
            onPickReviewer={() => setReviewerMenuOpen(true)}
            onAddCheckDate={htmlSource === null ? addCheckDate : undefined}
            onConfirmCase={(key) => void confirmCase(key)}
            onConfirmIntro={() => void confirmIntro()}
            onChangeType={() => setTypeMenuOpen(true)}
            handOff={handOffCard}
            auditEstimate={<AuditEstimateCard state={auditEstimate} />}
            yourInput={inputsRead.status === 'off' ? null : inputsRead}
            onAddInput={addInput}
            onConfirmAuthor={confirmAuthor}
            onKeepSource={sourcesOn ? (url) => void keepSource(url) : undefined}
            onAddSource={sourcesOn ? addSource : undefined}
            onRemoveClaim={sourcesOn ? removeClaim : undefined}
            onConfirmImages={openConfirmImages}
            onAddImage={addImage}
            onShoppingPathChange={shoppingCheck.reload}
          />
        ) : (
          <EditorPanelRail onOpen={openPanelTab} />
        )}
      </div>

      {editor && spotFor && (
        <ProofImageDialog
          editor={editor}
          spot={spotFor}
          onClose={() => setSpotFor(null)}
          onOwn={(src) => void confirmImage(src)}
        />
      )}
      {confirmingImages && ownImages && (
        <ConfirmImagesDialog
          images={images}
          own={ownImages}
          onConfirm={(src) => void confirmImage(src)}
          onClose={() => setConfirmingImages(false)}
        />
      )}
      {quality && exportOpen && exportChecks && (
        <ExportDialog
          onClose={() => setExportOpen(null)}
          title={title}
          html={exportOpen.html}
          isNew={draft.method === 'create'}
          sourceUrl={draft.sourceUrl}
          author={pageAuthor}
          reviewer={pageReviewer}
          teamByline={teamByline}
          siteAuthor={!pageAuthor && authorConfirmed.real}
          byline={contentByline}
          checks={exportChecks}
          linksPending={linksPending}
          initialDestination={exportOpen.destination}
          onFillNow={() => {
            setExportOpen(null);
            fillFirstPlaceholder();
          }}
          // Export opens on its options (CE-057); Before you publish is a
          // Review away, and comes back to Export.
          publish={{
            trustBelow:
              quality.trust?.score != null && quality.trust.score < TRUST_GATE
                ? quality.trust.score
                : null,
            // A page type that goes out under the brand (CE-052) wants no author.
            noAuthor:
              quality.eeat !== null &&
              !quality.author &&
              !authorConfirmed.real &&
              !checksOff(profile).has('byline'),
            noDisclosure:
              aiChecks?.disclosure?.found === false && !checksOff(profile).has('disclosure'),
            article: isArticlePage(pageType),
            // Only where Before you publish has its code: a name and one price.
            product:
              !!productSchema?.offer && !('several' in productSchema.offer) && !!pageName(title),
            itemList:
              categorySchema?.status === 'read' && categorySchema.items.length >= MIN_LISTED,
            onReview: () => {
              setExportOpen(null);
              openBeforePublish('export', exportOpen.destination);
            },
          }}
        />
      )}

      {sendOpen && (
        <SendDialog
          draftId={draft.id}
          brandId={draft.brandId}
          title={title}
          html={sendOpen.html}
          sourceUrl={draft.sourceUrl}
          author={pageAuthor}
          reviewer={pageReviewer}
          teamByline={teamByline}
          byline={contentByline}
          onFillNow={() => {
            setSendOpen(null);
            fillFirstPlaceholder();
          }}
          onClose={() => setSendOpen(null)}
          onSent={setCmsLast}
        />
      )}

      {askLive && (
        <PublishDialog
          draftId={draft.id}
          published={status === 'published'}
          onClose={() => setAskLive(false)}
          onPublished={(url) => {
            setStatus('published');
            setLiveUrl(url);
          }}
        />
      )}

      {quality && publishOpen && readyToPaste && (
        <BeforePublish
          mode={publishOpen.mode}
          paste={readyToPaste}
          onFillNow={() => {
            setPublishOpen(null);
            fillFirstPlaceholder();
          }}
          contentByline={contentByline}
          onContinue={() => {
            const next = publishOpen.mode;
            setPublishOpen(null);
            if (next === 'send') void openSend();
            else openExport(publishOpen.returnTo);
          }}
          onClose={() => setPublishOpen(null)}
          quality={quality}
          reviewer={pageReviewer}
          reviewerRequired={regulated !== null}
          reviewerLd={reviewerLd}
          title={title}
          pageType={pageType}
          image={firstImage(pageHtml)}
          articleSchema={addedSchema}
          ownArticleSchema={hasArticleSchema(publishOpen.html)}
          onSchemaLeftOut={leaveOutSchema}
          linksPending={linksPending}
          // Not while the HTML view holds the page: its source is what goes out.
          disclosureLine={htmlSource === null ? disclosureLine : null}
          disclosureAdded={disclosureOnPage}
          onAddDisclosure={addLineUnderAnswer}
          product={productSchema}
          category={categorySchema}
          shopping={shoppingRead}
          onMarkReady={(anyway) => {
            setPublishOpen(null);
            void markReady(anyway ?? undefined);
          }}
          // Decision (a), editor UX review 2026-11-03: Mark ready stays open with work
          // left, and the window counts it rather than saying all is done.
          openWork={{
            rules: rulesSettled ? Math.max(0, rules.total - rules.met) : 0,
            todos: todos.filter((todo) => !todo.done).length,
          }}
          onFixFirst={(show) => {
            setPublishOpen(null);
            openPanelTab('quality');
            if (show) showInPage(show, { focus: true });
          }}
        />
      )}

      <Dialog open={held !== null} onOpenChange={(open) => !open && setHeld(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cited.holdTitle')}</DialogTitle>
            <DialogDescription>
              {t('cited.holdDescription', {
                platforms: (held && citedBy.current.get(held.key)) ?? '',
                days: CITED_DAYS,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={editAnyway}>
              {t('cited.editAnyway')}
            </Button>
            <Button
              onClick={() => {
                setHeld(null);
                editor?.commands.focus();
              }}
            >
              {t('cited.keep')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Where the page's text shows a placeholder in the HTML view's source: in
 * its words, not an alt or title value, the JSON-LD, or an HTML block's code
 * (between its markers).
 */
function shownPlaceholderAt(source: string): Set<number> {
  const blocks = [...source.matchAll(/<!-- html-block -->[\s\S]*?<!-- \/html-block -->/g)];
  const inBlock = (i: number) => blocks.some((b) => i > b.index && i < b.index + b[0].length);
  const words = blankCode(source, { words: true, fields: false });
  return new Set(
    [...words.matchAll(new RegExp(PLACEHOLDER.source, 'giu'))]
      .map((m) => m.index)
      .filter((i) => !inBlock(i)),
  );
}

/**
 * The HTML view's first placeholder, selected and scrolled to. With
 * `hidden`, the first the page's text doesn't show (an image's alt text,
 * the JSON-LD, an HTML block), when there is one.
 */
function selectHtmlPlaceholder(
  area: HTMLTextAreaElement | null,
  source: string,
  { hidden = false } = {},
) {
  const found = [
    ...blankCode(source, { words: true }).matchAll(new RegExp(PLACEHOLDER.source, 'giu')),
  ];
  const shown = hidden ? shownPlaceholderAt(source) : null;
  const m = found.find((f) => !shown?.has(f.index)) ?? found[0];
  if (!m || !area) return;
  area.focus();
  area.setSelectionRange(m.index, m.index + m[0].length);
  // A textarea scrolls to its selection on focus, not on a new range.
  area.blur();
  area.focus();
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations('contentEditor.editor.save');
  if (state === 'conflict') {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-destructive"
        role="status"
        title={t('conflictHint')}
      >
        {t('conflict')}
        <button
          type="button"
          className="font-medium underline"
          onClick={() => window.location.reload()}
        >
          {t('reload')}
        </button>
      </span>
    );
  }
  if (state === 'too_large') {
    return (
      <span className="text-xs text-destructive" role="status" title={t('tooLargeHint')}>
        {t('tooLarge')}
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" role="status">
        {t('failed')}
        <button type="button" className="font-medium underline" onClick={onRetry}>
          {t('retry')}
        </button>
      </span>
    );
  }
  // Narrower than 1024px, a dot: the words stay for screen readers and on hover.
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      title={t(state)}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full lg:hidden',
          state === 'saved' ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-muted-foreground',
        )}
      />
      <span className="sr-only lg:not-sr-only">{t(state)}</span>
    </span>
  );
}
