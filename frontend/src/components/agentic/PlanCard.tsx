'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { cn } from '@/lib/utils';
import type { ApprovalPillKind } from './ApprovalPill';
import {
  AgentCard,
  AgentCardBody,
  AgentCardFooter,
  AgentCardHeader,
  AgentHead,
  CardPill,
} from './AgentCard';
import { StepList, type StepRow } from './StepList';

/** A step's action class (CHAT-20 §3): READ runs, WRITE changes, EXECUTE goes live or leaves. */
export type PlanStepClass = 'read' | 'write' | 'execute';

/** How much the agent does alone (Chat agentic plan §2, CHAT-20 §5). */
export type ChatRunMode = 'ask_first' | 'auto' | 'full_auto';

export interface PlanStep {
  label: string;
  /** The grey line: what it uses, or what it changes. */
  detail?: string;
  cls: PlanStepClass;
  /** The precedence's own answer for this step, when the server has it; else from the class and mode. */
  pill?: ApprovalPillKind;
}

export interface PlanConnection {
  name: string;
  connected: boolean;
}

/**
 * The pill a plan step wears (the mockup's tagFor, CHAT-23 P10): an EXECUTE
 * always needs a click; a WRITE asks, or runs and is logged in Full auto; a
 * READ runs by itself, but asks in Ask me first.
 */
export function planStepPill(cls: PlanStepClass, mode: ChatRunMode): ApprovalPillKind {
  if (cls === 'execute') return 'click';
  if (cls === 'write') return mode === 'full_auto' ? 'logged' : 'asks';
  return mode === 'ask_first' ? 'asks' : 'auto';
}

/**
 * The plan card (CHAT-mockup-v2 `#s-plan`): before anything runs, the steps
 * with how each one runs, what the run uses and connects to, about how long
 * and how much of the monthly AI limit, and what it makes; then Edit plan and
 * Start. Nothing changes before Start (CHAT-23 `plan.start`, through the
 * read-only gate). Edit plan lets the person move or remove steps; Start runs
 * the edited plan. A role that can't start runs gets Ask your Admin instead.
 */
export function PlanCard({
  title,
  due,
  steps,
  mode,
  uses,
  connections = [],
  time,
  aiUsage,
  outputs,
  canStart = true,
  onStart,
  onAskAdmin,
  onConnect,
}: {
  title: string;
  /** "Due Fri, Oct 30" */
  due?: string;
  steps: PlanStep[];
  mode: ChatRunMode;
  /** "Action Center · 52 sources · 2 live pages" */
  uses?: string;
  connections?: PlanConnection[];
  /** "6 min" */
  time?: string;
  /** "~2%" */
  aiUsage?: string;
  /** "FAQ draft, schema code, report" */
  outputs?: string;
  /** False for a role that can't start runs: Ask your Admin instead of Start. */
  canStart?: boolean;
  /** Starts the run with the steps as the person left them. */
  onStart?: (steps: PlanStep[]) => void;
  onAskAdmin?: () => void;
  /** Connect a tool the plan needs (an Admin's: CHAT-23 `integrations.connect`). */
  onConnect?: (name: string) => void;
}) {
  const t = useTranslations('agentic.planCard');
  const { guard } = useUpgradeGate();
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState(steps);

  const move = (from: number, to: number) =>
    setPlan((current) => {
      const next = [...current];
      const [step] = next.splice(from, 1);
      next.splice(to, 0, step);
      return next;
    });
  const remove = (index: number) => setPlan((current) => current.filter((_, i) => i !== index));

  const rows: StepRow[] = plan.map((step, i) => ({
    n: i + 1,
    label: step.label,
    detail: step.detail,
    state: 'pending',
    pill: step.pill ?? planStepPill(step.cls, mode),
  }));
  // A missing tool's line goes once skipped: the run does the rest without it.
  const [skipped, setSkipped] = useState<string[]>([]);
  const missing = connections.filter((c) => !c.connected && !skipped.includes(c.name));

  return (
    <div data-slot="plan-card">
      <AgentHead state="idle" title={t('head')} />
      <AgentCard aria-label={title}>
        <AgentCardHeader title={title} end={due ? <CardPill>{due}</CardPill> : undefined} />
        <AgentCardBody>
          <StepList
            rows={rows}
            controls={
              editing
                ? (_, i) => (
                    <span className="flex gap-0.5 self-center">
                      <Button
                        data-action="plan.moveStepUp"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('moveUp')}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        data-action="plan.moveStepDown"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('moveDown')}
                        disabled={i === plan.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        data-action="plan.removeStep"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('remove')}
                        disabled={plan.length === 1}
                        onClick={() => remove(i)}
                      >
                        <X />
                      </Button>
                    </span>
                  )
                : undefined
            }
          />
          {missing.map((c) => (
            <div
              key={c.name}
              className="mt-1.5 flex flex-wrap items-center gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {t('missingOptional', { name: c.name })}
              <span className="ml-auto flex gap-1.5">
                {onConnect && (
                  <Button
                    data-action="integrations.connect"
                    variant="outline"
                    size="sm"
                    onClick={() => onConnect(c.name)}
                  >
                    {t('connect', { name: c.name })}
                  </Button>
                )}
                <Button
                  data-action="integrations.skip"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSkipped((was) => [...was, c.name])}
                >
                  {t('skip')}
                </Button>
              </span>
            </div>
          ))}
        </AgentCardBody>
        <div className="flex flex-wrap gap-3.5 border-t bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
          {uses && (
            <span>
              {t('uses')} <b className="font-medium text-foreground">{uses}</b>
            </span>
          )}
          {connections.map((c) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-1"
              title={c.connected ? t('connected') : t('notConnected', { name: c.name })}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  c.connected ? 'bg-green-600 dark:bg-green-400' : 'bg-foreground/20',
                )}
              />
              <b className={cn('font-medium', c.connected && 'text-foreground')}>{c.name}</b>
            </span>
          ))}
          {time && (
            <span>
              {t('about')} <b className="font-medium text-foreground">{time}</b>
            </span>
          )}
          {aiUsage && (
            <span>
              {t('aiUsage')}{' '}
              <b className="font-medium text-foreground">{t('aiUsageValue', { value: aiUsage })}</b>
            </span>
          )}
          {outputs && (
            <span>
              {t('outputs')} <b className="font-medium text-foreground">{outputs}</b>
            </span>
          )}
        </div>
        <AgentCardFooter
          note={
            <>
              {t('mode')} <b className="font-medium text-foreground">{t(`modes.${mode}`)}</b>
            </>
          }
        >
          {canStart && (
            <Button
              data-action="plan.edit"
              variant="outline"
              aria-pressed={editing}
              onClick={() => setEditing((on) => !on)}
            >
              {editing ? t('doneEditing') : t('edit')}
            </Button>
          )}
          {canStart ? (
            <Button
              data-action="plan.start"
              onClick={guard(() => onStart?.(plan), { action: t('startNeedsPlan') })}
            >
              {t('start')}
            </Button>
          ) : (
            <Button
              data-action="access.askAdmin"
              onClick={guard(() => onAskAdmin?.(), { action: t('askNeedsPlan') })}
            >
              {t('askAdmin')}
            </Button>
          )}
        </AgentCardFooter>
      </AgentCard>
    </div>
  );
}
