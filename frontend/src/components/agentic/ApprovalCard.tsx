'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { ApprovalPill } from './ApprovalPill';
import {
  AgentCard,
  AgentCardBody,
  AgentCardFooter,
  AgentCardHeader,
  CardPill,
  DoneLine,
  SourceChips,
} from './AgentCard';

/**
 * Where an approval stands: waiting for the person; saving their answer;
 * approved (it collapses to a green line); skipped; or the change failed,
 * with the reason and Retry.
 */
export type ApprovalCardStatus = 'pending' | 'saving' | 'approved' | 'skipped' | 'error';

export const APPROVAL_CARD_STATUSES: readonly ApprovalCardStatus[] = [
  'pending',
  'saving',
  'approved',
  'skipped',
  'error',
];

/** A line of what a change carries ("FAQ block · 6 questions" / "New section on /pricing"). */
export interface ApprovalItem {
  /** A short glyph for its tile: "≡", "{ }", "↗". */
  icon?: string;
  title: string;
  detail?: string;
}

/** What the person answered: the text as they left it, and their "Don't ask again" tick. */
export interface ApprovalAnswer {
  /** The edited new text, when they edited it (an edit is new arguments: CHAT-20 §6). */
  text?: string;
  dontAskAgain: boolean;
}

const spinner = <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />;

/**
 * The approval card (CHAT-mockup-v2 `#s-need`, `#s-done`; CHAT-20 §6; CHAT-23
 * G7, G8). A WRITE (`kind="write"`) shows the step, the change as before and
 * after, why, its sources, and Skip · Edit · Approve; "Don't ask again for
 * this kind of change" only when the precedence allows it (`canDontAskAgain`,
 * CHAT-20 §5 step 6). An EXECUTE (`kind="execute"`) is the click that goes
 * live: the dark "Needs your click" pill, the only dark one, and a button that
 * names the outside effect ("Publish"); never a "Don't ask again". Approve,
 * Save & approve and the click go through the read-only gate.
 */
export function ApprovalCard({
  kind = 'write',
  step,
  title,
  badge,
  why,
  change,
  items,
  summary,
  sources = [],
  note,
  canDontAskAgain = false,
  dontAskAgainLabel,
  actionLabel,
  busyLabel,
  disabledReason,
  previewLabel,
  onPreview,
  status = 'pending',
  error,
  doneLabel,
  onApprove,
  onSkip,
  children,
}: {
  kind?: 'write' | 'execute';
  /** The step it stops at, and the run's step count. */
  step: { n: number; total: number };
  title: string;
  /** A WRITE's amber pill on the right: "Cited 12× last month". */
  badge?: string;
  /** Why the change: "ChatGPT cites this passage, but it says…". */
  why?: string;
  change?: { before: string; after: string };
  items?: ApprovalItem[];
  /** An EXECUTE's one line of what goes live. */
  summary?: string;
  sources?: string[];
  /** The footer's note: "Draft only · nothing goes live", "Goes live on getcito.com/pricing · same in every mode". */
  note?: string;
  /** The precedence's offerDontAskAgain (A3): Growth+, policy allows auto, not always_card, never an EXECUTE. */
  canDontAskAgain?: boolean;
  /** "Don't ask again for brand-fact fixes"; else the generic words. */
  dontAskAgainLabel?: string;
  /** An EXECUTE's button, naming the outside effect: "Publish", "Send to jane@client.com". */
  actionLabel?: string;
  /** An EXECUTE's button while it works: "Publishing…". */
  busyLabel?: string;
  /** Why the click can't be made yet ("After the draft is approved"): the button is off, with it as its tooltip. */
  disabledReason?: string;
  previewLabel?: string;
  onPreview?: () => void;
  status?: ApprovalCardStatus;
  /** The plain reason a change failed (CHAT-23 P9). */
  error?: string;
  /** The green line once approved: "Cited passage changed", "Published to getcito.com/pricing · 14:32". */
  doneLabel?: string;
  onApprove?: (answer: ApprovalAnswer) => void;
  onSkip?: () => void;
  /** More of what the change carries, under its items (Send to Action Center's goal and targets). */
  children?: ReactNode;
}) {
  const t = useTranslations('agentic.approvalCard');
  const { guard } = useUpgradeGate();
  const titleId = useId();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(change?.after ?? '');
  const [editedText, setEditedText] = useState<string | undefined>(undefined);
  const execute = kind === 'execute';
  const busy = status === 'saving';
  const offerDontAsk = canDontAskAgain && !execute;
  const stepOf = t('stepOf', step);

  if (status === 'approved') {
    return (
      <DoneLine>
        {execute
          ? (doneLabel ?? t('done'))
          : [t('approved', { n: step.n }), doneLabel].filter(Boolean).join(' · ')}
      </DoneLine>
    );
  }
  if (status === 'skipped') {
    return (
      <p
        role="status"
        data-slot="approval-skipped"
        className="my-2 rounded-xl border border-dashed px-3 py-[9px] text-[13px] text-muted-foreground"
      >
        {t('skipped', { n: step.n })} · {title}
      </p>
    );
  }

  const approve = guard(
    (answer: ApprovalAnswer) => {
      setEditing(false);
      onApprove?.(answer);
    },
    { action: execute ? t('clickNeedsPlan') : t('approveNeedsPlan') },
  );
  const answer = (): ApprovalAnswer => ({
    ...(editedText !== undefined ? { text: editedText } : {}),
    dontAskAgain: offerDontAsk && dontAskAgain,
  });

  return (
    <AgentCard
      tone={execute ? 'click' : 'needsYou'}
      aria-labelledby={titleId}
      data-kind={kind}
      data-status={status}
    >
      <AgentCardHeader
        titleId={titleId}
        lead={
          execute ? (
            <ApprovalPill kind="click" />
          ) : (
            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-px text-[11px] leading-[14px] whitespace-nowrap text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {stepOf}
            </span>
          )
        }
        title={title}
        end={
          execute ? (
            <CardPill>{stepOf}</CardPill>
          ) : badge ? (
            <CardPill tone="amber">{badge}</CardPill>
          ) : undefined
        }
      />
      <AgentCardBody className={execute ? 'pt-2.5 text-[13px]' : undefined}>
        {why && <p className="mt-2 mb-1 text-[13px] text-muted-foreground">{why}</p>}
        {summary && <p className="m-0">{summary}</p>}
        {change && (
          <div className="my-2 overflow-hidden rounded-xl border text-[13px]">
            <p className="m-0 bg-red-50 px-2.5 py-1.5 text-red-900 line-through decoration-red-900/40 dark:bg-red-950/40 dark:text-red-200 dark:decoration-red-200/40">
              <span className="sr-only">{t('before')}: </span>
              {change.before}
            </p>
            {editing ? (
              <div className="bg-green-50 px-2.5 py-1.5 dark:bg-green-950/40">
                <textarea
                  data-action="approval.editText"
                  aria-label={t('newText')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-16 w-full resize-y rounded-lg border border-green-200 bg-card px-2 py-1.5 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-green-900"
                />
              </div>
            ) : (
              <p className="m-0 bg-green-50 px-2.5 py-1.5 text-green-900 dark:bg-green-950/40 dark:text-green-200">
                <span className="sr-only">{t('after')}: </span>
                {editedText ?? change.after}
              </p>
            )}
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="m-0 my-2 grid list-none gap-1.5 p-0">
            {items.map((item) => (
              <li
                key={item.title}
                className="grid min-h-[50px] grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 rounded-xl border px-2.5 py-2 text-[13px]"
              >
                <span
                  aria-hidden
                  className="flex size-[30px] items-center justify-center rounded-lg border bg-muted text-[13px]"
                >
                  {item.icon ?? '≡'}
                </span>
                <span className="min-w-0 truncate">
                  {item.title}
                  {item.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {children}
        <SourceChips label={t('sources')} sources={sources} />
        {status === 'error' && error && (
          <p role="alert" className="mt-2 mb-0 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </AgentCardBody>
      <AgentCardFooter
        note={
          offerDontAsk ? (
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title={t('dontAskAgainTip')}
            >
              <input
                data-action="approval.dontAskAgain"
                type="checkbox"
                checked={dontAskAgain}
                disabled={busy}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="size-3.5 accent-foreground"
              />
              {dontAskAgainLabel ?? t('dontAskAgain')}
            </label>
          ) : (
            (disabledReason ?? note)
          )
        }
      >
        {execute ? (
          <>
            {onPreview && (
              <Button data-action="exec.preview" variant="outline" onClick={onPreview}>
                {previewLabel ?? t('preview')}
              </Button>
            )}
            <Button
              data-action="exec.publish"
              disabled={busy || !!disabledReason}
              aria-busy={busy || undefined}
              title={disabledReason}
              onClick={() => approve({ dontAskAgain: false })}
            >
              {busy && spinner}
              {busy ? (busyLabel ?? t('working')) : status === 'error' ? t('retry') : actionLabel}
            </Button>
          </>
        ) : editing ? (
          <>
            <Button
              data-action="approval.cancelEdit"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setText(editedText ?? change?.after ?? '');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              data-action="approval.saveAndApprove"
              disabled={busy || !text.trim()}
              onClick={() => {
                setEditedText(text);
                approve({ text, dontAskAgain: offerDontAsk && dontAskAgain });
              }}
            >
              {t('saveAndApprove')}
            </Button>
          </>
        ) : (
          <>
            <Button data-action="approval.skip" variant="outline" disabled={busy} onClick={onSkip}>
              {t('skip')}
            </Button>
            {change && (
              <Button
                data-action="approval.edit"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                {t('edit')}
              </Button>
            )}
            <Button
              data-action="approval.approve"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => approve(answer())}
            >
              {busy && spinner}
              {status === 'error' ? t('retry') : t('approve')}
            </Button>
          </>
        )}
      </AgentCardFooter>
    </AgentCard>
  );
}
