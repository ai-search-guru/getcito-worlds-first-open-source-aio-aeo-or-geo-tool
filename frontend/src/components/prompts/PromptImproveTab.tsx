'use client';

/**
 * Positions panel → Improve tab (PROMPT-003): what to do on each platform
 * where the brand is missing or ranked late, for one prompt and range.
 *
 * The set is generated on the server (one model call, cached per prompt,
 * range and location) and checked there against the evidence, so every card
 * names a real sub-query, URL or answer. Here it becomes an editable draft:
 * check, edit, remove (undoable) or add your own. The draft lives only while
 * the panel is open; sending it to Action Center is PROMPT-004.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';
import { formatDate, formatDateTime } from '@/lib/format';
import { PLANS, hasFeature, type PlanId } from '@/config/plans';
import {
  generateImproveSuggestions,
  getImproveSuggestions,
  sendImproveToActionCenter,
} from '@/lib/actions/promptImprove';
import {
  STATE_LABEL,
  STATE_ORDER,
  actionCenterLink,
  hasUnsentEdits,
  mentionRateLabel,
  selectionSummary,
  sourceChipLabel,
  toDrafts,
  type DraftSuggestion,
  type ImprovePlatform,
  type ImproveQuota,
  type ImproveRangeInput,
  type ImproveSet,
} from '@/lib/promptImprove';

type Status = 'idle' | 'loading' | 'generating' | 'ready' | 'error' | 'locked';

export interface ImproveController {
  status: Status;
  set: ImproveSet | null;
  /** Generations left this period; null while unknown. */
  quota: ImproveQuota | null;
  /** The org's plan: a Starter whose budget is spent is offered an upgrade. */
  planId: PlanId | null;
  drafts: DraftSuggestion[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftSuggestion[]>>;
  error: string | null;
  /** Unsent edits, removals, unchecks or own suggestions. */
  dirty: boolean;
  /** Count for the tab badge: suggestions still in the draft. */
  count: number | null;
  /** Builds (or rebuilds) the set; one metered model call. */
  generate: () => void;
  /** Reads the cached set again; never generates. */
  reload: () => void;
  /** Sends the checked drafts to Action Center as one action (PROMPT-004). */
  send: () => void;
  sending: boolean;
}

/**
 * The Improve state for the open prompt and range. Lives in the panel, not
 * the tab, so the tab badge can show a count before the tab is opened and the
 * range control can ask before discarding unsent edits. Opening the panel
 * only reads the cache. Generating is always the user's click: each one is a
 * metered model call against the plan's monthly quota.
 */
export function useImprove({
  promptId,
  range,
  planId,
}: {
  promptId: string | null;
  range: ImproveRangeInput;
  planId: PlanId | null;
}): ImproveController {
  const locked = planId !== null && !hasFeature(PLANS[planId], 'prompt_improve');
  // A read-only workspace (plan not active): the set isn't read (the API
  // refuses it), the tab opens empty, and Generate (Regenerate) and Send
  // Actions open the upgrade dialog.
  const { isLocked: readOnly, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const key = promptId ? `${promptId}|${JSON.stringify(range)}` : '';
  const [state, setState] = useState<{
    key: string;
    status: Status;
    set: ImproveSet | null;
    error: string | null;
  }>({ key: '', status: 'idle', set: null, error: null });
  const [quota, setQuota] = useState<ImproveQuota | null>(null);
  const [sending, setSending] = useState(false);
  // One key per send: kept across a retry of the same send, so a double click
  // or a repeated request creates one action; cleared once a send lands.
  const sendKeyRef = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSuggestion[]>([]);
  // The latest key, so a response for a range the user already left is dropped.
  const keyRef = useRef(key);
  keyRef.current = key;

  const apply = useCallback(
    (
      forKey: string,
      op: 'read' | 'generate',
      result: Awaited<ReturnType<typeof getImproveSuggestions>>,
    ) => {
      if (keyRef.current !== forKey) return;
      if ('error' in result) {
        // A failed generate keeps the set (and edits) the user already has on
        // screen, and shows the error next to Generate / Regenerate. Only a
        // failed read lands on the error state, whose Retry reads again: a
        // retry should never be a paid call the user didn't ask for.
        if (op === 'generate' && result.code !== 'plan_limit') {
          // A spent budget is said by the quota note, with the way out.
          const spent = result.code === 'quota_exceeded';
          setState((s) => ({
            ...s,
            key: forKey,
            status: 'ready',
            error: spent ? null : result.error,
          }));
          if (spent) {
            setQuota((q) =>
              q ? { ...q, exhausted: true, generationsLeft: 0, percentLeft: 0 } : q,
            );
          }
          return;
        }
        setState({
          key: forKey,
          status: result.code === 'plan_limit' ? 'locked' : 'error',
          set: null,
          error: result.error,
        });
        return;
      }
      setState({ key: forKey, status: 'ready', set: result.improve, error: null });
      setDrafts(toDrafts(result.improve?.suggestions ?? []));
      if (result.quota) setQuota(result.quota);
    },
    [],
  );

  const reload = useCallback(() => {
    if (!promptId) return;
    const forKey = keyRef.current;
    setState({ key: forKey, status: 'loading', set: null, error: null });
    setDrafts([]);
    getImproveSuggestions(promptId, range).then((r) => apply(forKey, 'read', r));
  }, [promptId, range, apply]);

  useEffect(() => {
    if (!promptId || locked || readOnly) return;
    reload();
    // `key` covers the prompt and the range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locked, readOnly]);

  const generate = useCallback(() => {
    if (!promptId) return;
    if (readOnly) {
      openUpgrade(tActions('improvePrompt'));
      return;
    }
    const forKey = keyRef.current;
    setState((s) => ({ ...s, key: forKey, status: 'generating', error: null }));
    generateImproveSuggestions(promptId, range).then((r) => apply(forKey, 'generate', r));
  }, [promptId, range, apply, readOnly, openUpgrade, tActions]);

  const current = state.key === key ? state : null;
  const status: Status = locked ? 'locked' : readOnly ? 'ready' : (current?.status ?? 'idle');
  const set = readOnly ? null : (current?.set ?? null);

  const send = useCallback(() => {
    if (readOnly) {
      openUpgrade(tActions('sendAction'));
      return;
    }
    if (!promptId || !state.set || sending) return;
    const selected = drafts.filter((d) => d.checked && !d.removed && d.title.trim());
    if (selected.length === 0) return;
    const forKey = keyRef.current;
    sendKeyRef.current ??= crypto.randomUUID();
    setSending(true);
    sendImproveToActionCenter(promptId, range, {
      idempotencyKey: sendKeyRef.current,
      suggestions: selected.map((d) => ({
        id: d.id,
        platform: d.platform,
        title: d.title.trim(),
        body: d.body.trim(),
        sources: d.sources,
      })),
    })
      .then((result) => {
        if ('error' in result) {
          toast.error(result.error);
          return;
        }
        sendKeyRef.current = null;
        if (keyRef.current === forKey) {
          setState((s) => (s.set ? { ...s, set: { ...s.set, sent: result.sent } } : s));
        }
        toast.success(
          `Action created with ${result.taskCount} task${result.taskCount === 1 ? '' : 's'}`,
          {
            action: {
              label: 'Open',
              onClick: () => window.open(actionCenterLink(result.actionId), '_self'),
            },
          },
        );
      })
      .finally(() => setSending(false));
  }, [promptId, range, drafts, sending, state.set, readOnly, openUpgrade, tActions]);

  const dirty = useMemo(() => !!set && hasUnsentEdits(drafts, set.suggestions), [drafts, set]);

  return {
    status,
    set,
    quota,
    planId,
    drafts,
    setDrafts,
    error: current?.error ?? null,
    dirty,
    // A locked plan shows no count, even when a set was read before the plan was known.
    count: set && !locked ? drafts.filter((d) => !d.removed).length : null,
    generate,
    reload,
    send,
    sending,
  };
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export function ImproveTab({ improve }: { improve: ImproveController }) {
  const {
    status,
    set,
    quota,
    planId,
    drafts,
    setDrafts,
    error,
    dirty,
    generate,
    reload,
    send,
    sending,
  } = improve;
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const outOfQuota = !!quota?.exhausted;
  // Generating and sending cost AI: admins and managers do them; anyone reads the set.
  const { canManage } = useUserRole();
  const tManagers = useTranslations('managersOnly');

  if (status === 'locked') return <LockedImprove />;
  if (status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900/50 dark:bg-red-950/30">
        <p className="text-red-900 dark:text-red-200">
          {friendlyError(error, 'Failed to load suggestions.')}
        </p>
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    );
  }
  if (status === 'generating') return <Generating />;
  if (status !== 'ready') return <ImproveSkeleton />;
  if (!set) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Get platform-specific suggestions
        </p>
        <p className="text-xs text-muted-foreground">
          Analyzes this period&apos;s answers on every platform (the sub-queries they ran, the
          sources they cited and the competitors ranked above you) and suggests what to do where the
          brand is missing or ranked late.
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{friendlyError(error)}</p>}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={generate} disabled={outOfQuota}>
              <Sparkles />
              Generate suggestions
            </Button>
            <QuotaNote quota={quota} planId={planId} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{tManagers('improvePrompt')}</p>
        )}
      </div>
    );
  }

  const groups = [...set.platforms].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  );
  const tracked = set.platforms.filter((p) => p.state !== 'no_runs');
  const actionable = tracked.filter((p) => p.state !== 'doing_well');
  const summary = selectionSummary(drafts);
  const sentLatest = set.sent?.latest ?? null;

  const update = (id: string, patch: Partial<DraftSuggestion>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const addOwn = (platform: ImprovePlatform) =>
    setDrafts((ds) => [
      ...ds,
      {
        id: `own:${platform.id}:${Date.now()}`,
        platform: platform.id,
        state: platform.state,
        title: '',
        body: '',
        sources: [],
        confidence: 'medium',
        checked: true,
        removed: false,
        own: true,
      },
    ]);

  return (
    <div className="space-y-3">
      {set.stale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs dark:border-sky-900/50 dark:bg-sky-950/30">
          <span className="text-sky-900 dark:text-sky-200">
            New runs have arrived since these suggestions were generated.
          </span>
          {canManage && (
            <Button
              size="xs"
              variant="outline"
              disabled={outOfQuota}
              onClick={() => (dirty ? setConfirmRegenerate(true) : generate())}
            >
              <RefreshCw />
              Regenerate
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{friendlyError(error)}</p>}
      {tracked.length === 0 ? (
        <EmptyNote>No runs in this period, so there is nothing to improve yet.</EmptyNote>
      ) : actionable.length === 0 ? (
        <EmptyNote>
          No improvements needed: the brand is mentioned first and cited early on every platform in
          this period.
        </EmptyNote>
      ) : null}

      <div className="divide-y rounded-lg border">
        {groups.map((p) => (
          <PlatformGroup
            key={p.id}
            platform={p}
            sentIds={set.sent.sentSuggestionIds}
            drafts={drafts.filter((d) => d.platform === p.id)}
            onUpdate={update}
            onAddOwn={() => addOwn(p)}
          />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {summary.selected} of {summary.total} selected · {summary.platforms} platform
          {summary.platforms === 1 ? '' : 's'}
          <span className="ml-2 text-muted-foreground/70">
            Generated {formatDateTime(set.generatedAt)}
          </span>
          <QuotaNote quota={quota} planId={planId} className="ml-2" />
          {sentLatest && (
            <span className="mt-1 flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="h-3.5 w-3.5" />
              Sent {formatDate(sentLatest.sentAt)} · AC-{sentLatest.actionNo}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {!canManage ? (
            !sentLatest && (
              <span className="text-xs text-muted-foreground">{tManagers('improvePrompt')}</span>
            )
          ) : confirmRegenerate ? (
            <span className="flex items-center gap-2 text-xs">
              Discard your edits?
              <Button size="xs" variant="outline" onClick={() => setConfirmRegenerate(false)}>
                Keep editing
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  setConfirmRegenerate(false);
                  generate();
                }}
              >
                Discard & regenerate
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={outOfQuota}
              onClick={() => (dirty ? setConfirmRegenerate(true) : generate())}
            >
              <RefreshCw />
              Regenerate
            </Button>
          )}
          {sentLatest ? (
            <Link
              href={actionCenterLink(sentLatest.actionId)}
              className={buttonVariants({ size: 'sm' })}
            >
              Open in Actions
              <ArrowUpRight />
            </Link>
          ) : (
            canManage && (
              <Button size="sm" onClick={send} disabled={sending || summary.selected === 0}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                Send Actions
              </Button>
            )
          )}
        </span>
      </div>
    </div>
  );
}

function friendlyError(error: string | null, fallback = 'Failed to generate suggestions.'): string {
  if (error && /not configured|api key/i.test(error)) {
    return 'AI suggestions are not set up on this server yet: an AI provider key is missing.';
  }
  return error || fallback;
}

/**
 * "About 185 generations left this month"; nothing on unlimited plans. A
 * spent budget says when it resets, and offers Starter the upgrade, and the
 * free trial starting its plan.
 */
function QuotaNote({
  quota,
  planId,
  className,
}: {
  quota: ImproveQuota | null;
  planId: PlanId | null;
  className?: string;
}) {
  const t = useTranslations('prompts.improve.quota');
  if (!quota || quota.unlimited) return null;
  return (
    <span
      className={cn(
        'text-xs',
        quota.exhausted ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
        className,
      )}
      // The trial credit names no share (trial AI credit, 2026-10-29).
      title={
        quota.percentLeft !== null && !quota.trial
          ? t('percentLeft', { percent: quota.percentLeft })
          : undefined
      }
    >
      {quota.exhausted ? t('usedUp') : t('left', { count: quota.generationsLeft ?? 0 })}
      {quota.exhausted && (quota.trial || planId === 'starter') && (
        <>
          {' '}
          <Link
            href="/dashboard/settings?tab=billing"
            className="font-medium text-foreground underline underline-offset-2"
          >
            {quota.trial ? t('startPlan') : t('upgrade')}
          </Link>
        </>
      )}
    </span>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

const STATE_TONE: Record<ImprovePlatform['state'], string> = {
  not_mentioned: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  mentioned_late: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  not_cited: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  doing_well: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  no_runs: '',
};

/**
 * Why the platform is in the list: how often the brand is mentioned (a
 * platform mentioned in under half its runs counts as not mentioned), and
 * where it ranks.
 */
function stateDetail(p: ImprovePlatform): string | null {
  if (p.state === 'no_runs') return null;
  const rate = mentionRateLabel(p);
  if (p.state === 'mentioned_late' && p.mentionPosition) {
    return `avg #${p.mentionPosition}${p.mentionTotal ? ` of ${p.mentionTotal}` : ''} · ${rate}`;
  }
  if (p.state === 'not_cited') {
    return p.citationRank
      ? `cited at avg #${p.citationRank.rank} of ${p.citationRank.total} sources · ${rate}`
      : `not cited · ${rate}`;
  }
  return rate;
}

const countLabel = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function inputsNote(p: ImprovePlatform): string | null {
  if (!p.inputs) return null;
  const parts: string[] = [];
  if (p.inputs.fanouts) parts.push(countLabel(p.inputs.fanouts, 'fan-out', 'fan-outs'));
  if (p.inputs.citedDomains) {
    parts.push(countLabel(p.inputs.citedDomains, 'cited domain', 'cited domains'));
  }
  if (p.inputs.competitorUrls) {
    parts.push(countLabel(p.inputs.competitorUrls, 'competitor URL', 'competitor URLs'));
  }
  if (p.inputs.answer) parts.push('AI answer');
  const based = parts.length ? `Based on ${parts.join(' · ')}` : 'Based on the AI answer';
  return p.inputs.fanouts ? based : `No fan-outs recorded. ${based}`;
}

function PlatformGroup({
  platform: p,
  sentIds,
  drafts,
  onUpdate,
  onAddOwn,
}: {
  platform: ImprovePlatform;
  /** Suggestions a live send of this set carried. */
  sentIds: string[];
  drafts: DraftSuggestion[];
  onUpdate: (id: string, patch: Partial<DraftSuggestion>) => void;
  onAddOwn: () => void;
}) {
  const detail = stateDetail(p);
  const inputs = inputsNote(p);
  const canSuggest = p.state !== 'no_runs';
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <AIProviderAvatar plain provider={resolveAIProvider('', p.id)} className="h-6 w-6" />
          <span className="truncate text-sm font-medium">{p.label}</span>
        </span>
        <Badge variant="outline" className={cn('text-[11px]', STATE_TONE[p.state])}>
          {STATE_LABEL[p.state]}
        </Badge>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </div>
      {inputs && <p className="text-[11px] text-muted-foreground">{inputs}</p>}

      {p.state === 'doing_well' && drafts.length === 0 && (
        <p className="text-xs text-muted-foreground">Doing well: no suggestions.</p>
      )}
      {(p.state === 'not_mentioned' || p.state === 'mentioned_late' || p.state === 'not_cited') &&
        drafts.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No suggestion held up against this platform&apos;s evidence. Add your own, or
            regenerate.
          </p>
        )}

      {drafts.map((d) => (
        <SuggestionCard
          key={d.id}
          draft={d}
          sent={sentIds.includes(d.id)}
          onUpdate={(patch) => onUpdate(d.id, patch)}
        />
      ))}

      {canSuggest && (
        <button
          type="button"
          onClick={onAddOwn}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add your own suggestion
        </button>
      )}
    </div>
  );
}

function SuggestionCard({
  draft: d,
  sent,
  onUpdate,
}: {
  draft: DraftSuggestion;
  sent: boolean;
  onUpdate: (patch: Partial<DraftSuggestion>) => void;
}) {
  // A new own suggestion opens straight into editing.
  const [editing, setEditing] = useState(!!d.own && !d.title);
  const [title, setTitle] = useState(d.title);
  const [body, setBody] = useState(d.body);

  if (d.removed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">Removed: {d.title || 'your suggestion'}</span>
        <Button size="xs" variant="ghost" onClick={() => onUpdate({ removed: false })}>
          Undo
        </Button>
      </div>
    );
  }

  if (editing) {
    const save = () => {
      if (!title.trim()) return;
      onUpdate({ title: title.trim(), body: body.trim() });
      setEditing(false);
    };
    return (
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="h-8 text-sm"
          maxLength={120}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What to do and why"
          className="min-h-20 text-sm"
          maxLength={600}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              if (d.own && !d.title) onUpdate({ removed: true });
              setTitle(d.title);
              setBody(d.body);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="xs" onClick={save} disabled={!title.trim()}>
            <Check />
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 rounded-md border p-3', !d.checked && 'opacity-60')}>
      <Checkbox
        checked={d.checked}
        onCheckedChange={(v) => onUpdate({ checked: v === true })}
        aria-label={`Select "${d.title}"`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug">{d.title}</p>
          <span className="flex shrink-0 items-center">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Edit suggestion"
              onClick={() => {
                setTitle(d.title);
                setBody(d.body);
                setEditing(true);
              }}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Remove suggestion"
              onClick={() => onUpdate({ removed: true })}
            >
              <X />
            </Button>
          </span>
        </div>
        {d.body && <p className="text-xs leading-relaxed text-muted-foreground">{d.body}</p>}
        {(d.sources.length > 0 || d.own || sent) && (
          <div className="flex flex-wrap gap-1">
            {sent && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
              >
                Already sent
              </Badge>
            )}
            {d.own && (
              <Badge variant="secondary" className="text-[10px]">
                Your suggestion
              </Badge>
            )}
            {d.sources.map((s) => (
              <Badge
                key={`${s.type}:${s.ref}`}
                variant="outline"
                title={s.ref}
                className="max-w-full truncate text-[10px] font-normal text-muted-foreground"
              >
                {sourceChipLabel(s)}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Generating() {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating suggestions from this period&apos;s answers… this can take up to 15 seconds.
      </p>
      <ImproveSkeleton />
    </div>
  );
}

function ImproveSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

function LockedImprove() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4" />
        Improve is available on Growth
      </p>
      <p className="text-xs text-muted-foreground">
        Get platform-specific suggestions to improve this prompt&apos;s position, based on the
        sub-queries, sources and competitors in each AI answer.
      </p>
      <Link href="/dashboard/settings?tab=billing" className={buttonVariants({ size: 'sm' })}>
        <Sparkles />
        Upgrade plan
      </Link>
    </div>
  );
}
