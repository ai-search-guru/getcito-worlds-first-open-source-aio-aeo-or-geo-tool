'use client';

import { useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { Input } from '@/components/ui/input';
import type { AgentFormSetup } from '@/lib/chat/agentForm';
import type { AgentGoLiveView } from '@/lib/chat/agentGoLive';
import { GO_LIVE_LIMIT_DEFAULT, GO_LIVE_LIMIT_MAX, GO_LIVE_LIMIT_MIN } from '@/lib/chat/goLive';
import type { ChatMode } from '@/lib/chat/precedence';
import { cn } from '@/lib/utils';
import { BOX, EM, FormSwitch } from './AgentFormTriggers';

/**
 * "Publish and send on its own" (AUTONOMOUS-GO-LIVE §7.2), under the agent
 * form's Approvals table: an Admin lets this agent go live without a click,
 * at most its daily limit (1–20, 5 unless set), in Full auto, while the
 * workspace's switch is on in Settings › Chat. Off and disabled, it says
 * why: Full auto not picked, the switch off, or the plan. A Manager reads it,
 * with Ask your Admin. Saved with the agent, as its own request.
 */

/** Why the box can't be ticked now, or null when it can. */
export function goLiveBlock(
  setup: AgentFormSetup,
  mode: ChatMode,
): 'locked' | 'offInSettings' | 'needFullAuto' | null {
  if (setup.fullAuto === 'plan') return 'locked';
  if (setup.goLive !== 'on') return 'offInSettings';
  if (mode !== 'full_auto' || setup.fullAuto !== 'open') return 'needFullAuto';
  return null;
}

/** A daily limit as typed: its number, or null when it isn't 1 to 20. */
export function goLiveLimitOf(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const limit = Number(text);
  return limit >= GO_LIVE_LIMIT_MIN && limit <= GO_LIVE_LIMIT_MAX ? limit : null;
}

export function AgentGoLiveBox({
  setup,
  mode,
  on,
  limit,
  permission,
  showProblem,
  onChange,
}: {
  setup: AgentFormSetup;
  mode: ChatMode;
  on: boolean;
  /** The limit as typed. */
  limit: string;
  /** What the agent was given, as saved: who and when, or "off since the agent changed". */
  permission: AgentGoLiveView | null;
  /** A save was tried: a limit that isn't 1 to 20 says so. */
  showProblem: boolean;
  onChange: (next: { on: boolean; limit: string }) => void;
}) {
  const t = useTranslations('chatAgents.form.goLive');
  const format = useFormatter();
  const id = useId();
  const admin = setup.role === 'admin';
  const block = goLiveBlock(setup, mode);
  const ticked = on && !block;
  const shownLimit = goLiveLimitOf(limit) ?? GO_LIVE_LIMIT_DEFAULT;
  const limitBad = ticked && showProblem && goLiveLimitOf(limit) === null;
  const date = (at: string) => format.dateTime(new Date(at), { dateStyle: 'medium' });

  // The line under the note: why it's off, or who allowed it, as saved.
  const status = !admin
    ? t('readOnly')
    : block
      ? t(block, { plan: setup.fullAutoPlan, current: setup.planName })
      : permission?.on && on
        ? permission.by
          ? t('onBy', { name: permission.by, date: date(permission.at) })
          : t('onByFormer', { date: date(permission.at) })
        : permission?.changed && !on
          ? t('resetByChange')
          : null;

  return (
    <section
      data-slot="agent-go-live"
      data-on={ticked || undefined}
      aria-labelledby={`${id}-label`}
      className={cn(BOX, 'mt-3')}
    >
      <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3.5 py-3 text-[13px]">
        <Send aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0">
          <b id={`${id}-label`} className="font-semibold">
            {t('label')}
          </b>
          <em className={cn(EM, 'mt-0.5')}>
            {t('note', { limit: ticked ? shownLimit : GO_LIVE_LIMIT_DEFAULT })}
          </em>
          <em className={cn(EM, 'mt-1')}>{t('covers')}</em>
          {status && (
            <p
              id={`${id}-status`}
              data-slot="agent-go-live-status"
              className="mt-1.5 text-xs font-medium text-foreground/80"
            >
              {status}
            </p>
          )}
        </div>
        <FormSwitch
          checked={ticked}
          label={t('label')}
          action="agentNew.goLive"
          disabled={!admin || !!block}
          describedBy={status ? `${id}-status` : undefined}
          onChange={(next) => onChange({ on: next, limit })}
        />
      </div>
      {admin && ticked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3.5 py-2.5 text-[13px] min-[640px]:pl-[42px]">
          <label htmlFor={`${id}-limit`} className="font-medium">
            {t('limit')}
          </label>
          <Input
            id={`${id}-limit`}
            data-field="goLiveLimit"
            inputMode="numeric"
            value={limit}
            aria-invalid={limitBad || undefined}
            aria-describedby={limitBad ? `${id}-limit-error` : undefined}
            onChange={(e) => onChange({ on, limit: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            className="h-8 w-16 tabular-nums"
          />
          <span className="text-xs text-muted-foreground">
            {t('limitRange', { min: GO_LIVE_LIMIT_MIN, max: GO_LIVE_LIMIT_MAX })}
          </span>
          {limitBad && (
            <span
              id={`${id}-limit-error`}
              role="alert"
              className="basis-full text-xs text-red-700 dark:text-red-400"
            >
              {t('limitError', { min: GO_LIVE_LIMIT_MIN, max: GO_LIVE_LIMIT_MAX })}
            </span>
          )}
        </div>
      )}
      {!admin && (
        <div className="flex justify-end border-t px-3.5 py-2.5">
          <AskAdminButton asked={t('ask')} ruleKind="role" />
        </div>
      )}
    </section>
  );
}
