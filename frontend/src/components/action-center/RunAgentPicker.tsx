'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, MessageSquare, Plus } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useChatPanel } from '@/components/chat/panel/chatPanelContext';
import { AgentDenial, StatusDot } from '@/components/chat/agents/AgentParts';
import {
  readCompatibleAgents,
  runAgentOnAction,
  runChatOnAction,
  type AgentRefused,
} from '@/components/chat/agents/agentRequests';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { ActionItem } from '@/lib/actions/actionCenter';
import type { CompatibleAgents } from '@/lib/chat/agentAction';
import type { ChatDenialCard } from '@/lib/chat/events';
import { PANEL_FROM_PARAM } from '@/lib/chat/panel';
import { PickerLoading } from './RunAgentButton';

/**
 * Run agent's picker (CHAT-21 §F item 27), inside the button's popover
 * (RunAgentButton.tsx) and loaded the first time it opens: the agents for
 * the action, read as it opens; Run with Chat; "Create an agent for this
 * kind of action". A pick starts a Chat run scoped to the action and opens
 * its chat in the side panel beside the action (§F item 29), or Chat's own
 * page where the panel isn't; a run that waits for a slot says so. A
 * refusal shows its answer here: the out-of-permission card (CHAT-20 §4c),
 * the upgrade dialog for a read-only workspace, or its words.
 */

type Picker =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string | null }
  | { kind: 'denied'; denial: ChatDenialCard }
  | ({ kind: 'ready' } & CompatibleAgents);

/** A run's states once it ended (chat_agent_runs.status). */
const ENDED = ['stopped', 'failed', 'skipped'];

/** What a pick is doing: an agent's run, or Run with Chat. */
type Busy = { kind: 'agent'; id: string } | { kind: 'chat' } | null;

const ROW =
  'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50';

export function RunAgentPicker({
  action,
  onClose,
}: {
  action: Pick<ActionItem, 'id' | 'actionNo'>;
  /** Closes the popover. */
  onClose: () => void;
}) {
  const t = useTranslations('actionCenter.actionsPage.runAgent');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tModes = useTranslations('chatAgents.modes');
  const tActions = useTranslations('readOnly.actions');
  const { openUpgrade } = useUpgradeGate();
  const panel = useChatPanel();
  const router = useRouter();
  const pathname = usePathname();
  const [picker, setPicker] = useState<Picker>({ kind: 'loading' });
  const [busy, setBusy] = useState<Busy>(null);

  // Read each time it opens: agents change, and so does what was last used. A
  // workspace gone read-only since the page loaded gets the upgrade dialog.
  useEffect(() => {
    let live = true;
    void readCompatibleAgents(action.id).then((answer) => {
      if (!live) return;
      if (answer.ok) setPicker({ kind: 'ready', ...answer });
      else if (answer.failure === 'subscription') {
        onClose();
        openUpgrade(tActions('runAgentOnAction'));
      } else if (answer.denial) setPicker({ kind: 'denied', denial: answer.denial });
      else setPicker({ kind: 'failed', message: answer.message });
    });
    return () => {
      live = false;
    };
  }, [action.id, onClose, openUpgrade, tActions]);

  /** The run's chat: in the side panel beside the action, else on Chat's own page. */
  const showChat = useCallback(
    (chatId: string) => {
      if (panel?.available) {
        panel.openChat(chatId);
        return;
      }
      const from = `${pathname}${window.location.search}`;
      router.push(`/dashboard/chat/${chatId}?${PANEL_FROM_PARAM}=${encodeURIComponent(from)}`);
    },
    [panel, pathname, router],
  );

  const refused = useCallback(
    (answer: AgentRefused) => {
      if (answer.failure === 'subscription') {
        onClose();
        openUpgrade(tActions('runAgentOnAction'));
      } else if (answer.denial) {
        setPicker({ kind: 'denied', denial: answer.denial });
      } else {
        toast.error(answer.message ?? t('toast.failed'));
      }
    },
    [onClose, openUpgrade, t, tActions],
  );

  const runAgent = useCallback(
    async (agent: { id: string; name: string }) => {
      if (busy) return;
      setBusy({ kind: 'agent', id: agent.id });
      try {
        const answer = await runAgentOnAction(agent.id, action.id);
        if (!answer.ok) return refused(answer);
        onClose();
        const run = answer.runs[0];
        const words = { agent: agent.name, no: action.actionNo };
        // Ended before it started (the action closed meanwhile): say why, not "queued".
        if (run && ENDED.includes(run.status)) {
          toast.error(t('toast.didntStart', { reason: answer.stopReason ?? 'other' }));
        } else if (answer.chatId) {
          toast(run?.repeated ? t('toast.repeated') : t('toast.started', words));
          showChat(answer.chatId);
        } else if (run?.coalesced) {
          toast(t('toast.coalesced', words));
        } else if (run?.repeated) {
          toast(t('toast.repeated'));
        } else {
          toast(t('toast.queued', words));
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, action.id, action.actionNo, refused, onClose, showChat, t],
  );

  const runChat = useCallback(async () => {
    if (busy) return;
    setBusy({ kind: 'chat' });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const answer = await runChatOnAction(action.id, timezone);
      if (!answer.ok) return refused(answer);
      onClose();
      const words = { no: action.actionNo };
      toast(
        answer.repeated
          ? t('toast.repeated')
          : answer.queued
            ? t('toast.chatQueued', words)
            : t('toast.chatStarted', words),
      );
      showChat(answer.chatId);
    } finally {
      setBusy(null);
    }
  }, [busy, action.id, action.actionNo, refused, onClose, showChat, t]);

  if (picker.kind === 'denied') return <AgentDenial denial={picker.denial} onClose={onClose} />;

  return (
    <>
      <p className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {t('agents')}
      </p>
      <div role="group" aria-label={t('agents')} className="max-h-[240px] overflow-y-auto">
        {picker.kind === 'loading' && <PickerLoading />}
        {picker.kind === 'failed' && (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {picker.message ?? t('failed')}
          </p>
        )}
        {picker.kind === 'ready' && picker.agents.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('noAgents')}</p>
        )}
        {picker.kind === 'ready' &&
          picker.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              data-run-agent-item
              data-action="runAgent.pickAgent"
              disabled={!!busy}
              onClick={() => void runAgent(agent)}
              className={ROW}
            >
              <StatusDot status={agent.status} className="mt-[5px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{agent.name}</span>
                  {agent.status === 'paused' && (
                    <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                      {t('paused')}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    agent.skills[0] ? `/${agent.skills[0]}` : null,
                    tModes(agent.mode),
                    agent.usedOnCategoryAt
                      ? t('usedHere', { category: tCategories(picker.action.category) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {busy?.kind === 'agent' && busy.id === agent.id && (
                <Loader2 className="mt-0.5 size-3.5 animate-spin" aria-hidden />
              )}
            </button>
          ))}
      </div>

      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        data-run-agent-item
        data-action="runAgent.runWithChat"
        disabled={!!busy}
        onClick={() => void runChat()}
        className={ROW}
      >
        <MessageSquare className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('runWithChat')}</span>
          <span className="block text-xs text-muted-foreground">{t('runWithChatHint')}</span>
        </span>
        {busy?.kind === 'chat' && <Loader2 className="mt-0.5 size-3.5 animate-spin" aria-hidden />}
      </button>
      {picker.kind === 'ready' && (
        <Link
          href={`/dashboard/agents/new?skill=${encodeURIComponent(picker.createSkill)}`}
          data-run-agent-item
          data-action="runAgent.createAgent"
          onClick={onClose}
          className={ROW}
        >
          <Plus className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t('createAgent')}</span>
        </Link>
      )}
    </>
  );
}
