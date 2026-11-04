'use client';

import { Fragment, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Info, Lock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  getChatSettingsView,
  removeAutoChoice,
  resetToolPolicies,
  setChatSwitch,
  setAutoGoLive,
  setManagerExecute,
  setToolPolicy,
  type ChatSettingsView,
  type PolicyRow,
  type SettingsResult,
} from '@/lib/actions/chatSettings';
import { fullAutoBehaviour } from '@/lib/chat/access';
import { GO_LIVE_TERMS } from '@/lib/chat/goLive';
import { EXECUTE_GROUPS, type ToolArea } from '@/lib/chat/registry/defineTool';
import type { AdminPolicy } from '@/lib/chat/precedence';
import { cn } from '@/lib/utils';
import { ClassBadge } from './ClassBadge';
import { YourPlanCard } from './PlanCard';
import { AskAdminButton } from './AskAdminButton';
import { GoLiveSection } from './GoLiveSection';
import { SettingsSwitch as Switch } from './SettingsSwitch';

const PRECEDENCE = ['hard', 'plan', 'role', 'policy', 'mode', 'dontAsk'] as const;

/**
 * Settings › Chat (CHAT-20 §5, §8b; mockup #g-policy): the rules Chat
 * follows here. Everyone reads them; an Admin changes the workspace's, only
 * to what each tool and the plan allow; everyone removes their own "Don't
 * ask again" ticks. Tools go by their labels, never their names.
 */
export function ChatSettingsSection() {
  const t = useTranslations('chatAccess.settings');
  const tAccess = useTranslations('chatAccess');
  const tTools = useTranslations('chatTools');
  const tActions = useTranslations('readOnly.actions');
  // A read-only workspace opens the upgrade dialog instead, as Team does.
  const { guard } = useUpgradeGate();
  const [view, setView] = useState<ChatSettingsView | 'failed' | null>(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getChatSettingsView()
      .then((result) => {
        if (live) setView(result.ok ? result.view : 'failed');
      })
      .catch(() => {
        if (live) setView('failed');
      });
    return () => {
      live = false;
    };
  }, [version]);

  if (view === null) return <Skeleton className="h-96 w-full" />;
  if (view === 'failed') {
    return (
      <div role="status" className="space-y-2 text-sm text-muted-foreground">
        <p>{t('loadError')}</p>
        <Button size="sm" variant="outline" onClick={() => setVersion((n) => n + 1)}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const isAdmin = view.role === 'admin';
  const fullAutoOpen = view.fullAutoLocked === null;
  const current = view.plan?.planName ?? '';

  async function save(run: () => Promise<SettingsResult>, done = t('saved')) {
    setSaving(true);
    try {
      const result = await run();
      if (result.ok) toast.success(done);
      else toast.error(t(`failures.${result.failure}`));
    } catch {
      toast.error(t('failures.failed'));
    } finally {
      setSaving(false);
      setVersion((n) => n + 1);
    }
  }
  const change = (run: () => Promise<SettingsResult>, done?: string) =>
    guard(() => void save(run, done), { action: tActions('changeChatSettings') })();

  const byArea = new Map<ToolArea, PolicyRow[]>();
  for (const row of view.rows) byArea.set(row.area, [...(byArea.get(row.area) ?? []), row]);

  const policyLabel = (row: PolicyRow) => t(`policy.choices.${row.policy}`);

  return (
    <div className="space-y-6">
      {view.plan && <YourPlanCard plan={view.plan} isAdmin={isAdmin} />}

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('lead')}</p>
        <Link
          href="/dashboard/chat/activity"
          className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          {tAccess('activity.seeLog')}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {!isAdmin && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t('readOnly')}</span>
          <span className="text-muted-foreground">{t('readOnlyNote')}</span>
          <span className="ml-auto">
            <AskAdminButton
              asked={tAccess('askAdmin.defaults.role')}
              ruleKind="policy"
              ruleDetail={t('readOnly')}
            />
          </span>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('switches.title')}</h3>
        <ul className="divide-y rounded-xl border">
          {(
            [
              ['fullAutoForMembers', 'fullAuto', view.fullAutoForMembers],
              ['dontAskAgain', 'dontAskAgain', view.dontAskAgain],
            ] as const
          ).map(([name, label, on]) => (
            <li key={name} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t(`switches.${label}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`switches.${label}Note`)}
                </span>
              </span>
              {!fullAutoOpen ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden />
                  {t('switches.locked', { current })}
                </span>
              ) : isAdmin ? (
                <Switch
                  checked={on}
                  label={t(`switches.${label}`)}
                  disabled={saving}
                  onChange={(next) => change(() => setChatSwitch(name, next))}
                />
              ) : (
                <span className="text-xs font-medium">
                  {on ? t('switches.on') : t('switches.off')}
                </span>
              )}
            </li>
          ))}
          {(['mcp', 'untrusted'] as const).map((key) => (
            <li key={key} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t(`switches.${key}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`switches.${key}Note`)}
                </span>
              </span>
              <span className="text-xs font-medium">
                {key === 'untrusted' && view.goLive
                  ? t('switches.untrustedValueGoLive')
                  : t(`switches.${key}Value`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold">{t('precedence.title')}</h3>
          <span className="text-xs text-muted-foreground">{t('precedence.note')}</span>
        </div>
        <ol className="divide-y rounded-xl border">
          {PRECEDENCE.map((step, i) => (
            <li key={step} className="flex items-start gap-3 px-3.5 py-2 text-sm">
              <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <span>
                <span className="font-medium">{t(`precedence.steps.${step}.name`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {step === 'hard' && view.goLive
                    ? t('precedence.steps.hard.detailGoLive')
                    : t(`precedence.steps.${step}.detail`)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t('policy.title')}</h3>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={saving || view.rows.every((row) => !row.changed)}
              onClick={() => change(resetToolPolicies, t('policy.resetDone'))}
            >
              {t('policy.reset')}
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('policy.columns.tool')}</TableHead>
                <TableHead>{t('policy.columns.class')}</TableHead>
                <TableHead>{t('policy.columns.policy')}</TableHead>
                <TableHead>{t('policy.columns.fullAuto')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byArea].map(([area, rows]) => (
                <Fragment key={area}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={4}
                      className="bg-muted/30 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {tAccess(`capabilities.areaNames.${area}`)}
                    </TableCell>
                  </TableRow>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="whitespace-normal">
                        {tTools(`${row.key}.name`)}
                      </TableCell>
                      <TableCell>
                        <ClassBadge cls={row.class} />
                      </TableCell>
                      <TableCell>
                        {isAdmin && row.choices.length > 0 ? (
                          <PolicyPicker
                            row={row}
                            disabled={saving}
                            onPick={(policy) => change(() => setToolPolicy(row.key, policy))}
                          />
                        ) : (
                          <span className="text-xs">{policyLabel(row)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t(`policy.behaviour.${fullAutoBehaviour(row, fullAutoOpen)}`)}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{t('execute.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {t(view.goLive ? 'execute.noteGoLive' : 'execute.note')}
          </p>
        </div>
        <ul className="divide-y rounded-xl border">
          {EXECUTE_GROUPS.map((group) => {
            const allowed = !view.managerExecuteOff.includes(group);
            return (
              <li key={group} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{t(`execute.groups.${group}`)}</span>
                {isAdmin ? (
                  <Switch
                    checked={allowed}
                    label={t(`execute.groups.${group}`)}
                    disabled={saving}
                    onChange={(next) => change(() => setManagerExecute(group, next))}
                  />
                ) : (
                  <span className="text-xs font-medium">
                    {allowed ? t('switches.on') : t('switches.off')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {view.goLive && (
        <GoLiveSection
          view={view.goLive}
          isAdmin={isAdmin}
          lockedOn={fullAutoOpen ? null : current}
          saving={saving}
          onChange={(on) =>
            change(
              () => setAutoGoLive(on, GO_LIVE_TERMS),
              t(on ? 'goLive.turnedOn' : 'goLive.turnedOff'),
            )
          }
        />
      )}

      <section className="space-y-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{t('autoChoices.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('autoChoices.note')}</p>
        </div>
        {view.autoChoices.length === 0 ? (
          <p className="rounded-xl border px-3.5 py-3 text-sm text-muted-foreground">
            {t('autoChoices.empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {view.autoChoices.map((key) => (
              <li key={key} className="flex items-center gap-3 px-3.5 py-2 text-sm">
                <span className="min-w-0 flex-1">{tTools(`${key}.name`)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  // Removing a tick takes a right back: open on a read-only workspace too.
                  onClick={() => void save(() => removeAutoChoice(key), t('autoChoices.removed'))}
                >
                  {t('autoChoices.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** An Admin's choice for one tool: its default first, then what the row offers. */
function PolicyPicker({
  row,
  disabled,
  onPick,
}: {
  row: PolicyRow;
  disabled: boolean;
  onPick: (policy: AdminPolicy | 'default') => void;
}) {
  const t = useTranslations('chatAccess.settings.policy');
  const options: { value: AdminPolicy | 'default'; label: string; locked: boolean }[] = [
    {
      value: 'default',
      label: `${t(`choices.${row.defaultPolicy}`)} · ${t('default')}`,
      locked: false,
    },
    ...row.choices
      .filter((choice) => choice.policy !== row.defaultPolicy)
      .map((choice) => ({
        value: choice.policy,
        label: t(`choices.${choice.policy}`),
        locked: choice.locked,
      })),
  ];
  const selected = row.changed ? row.policy : 'default';
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected === option.value}
          disabled={disabled || option.locked}
          title={option.locked ? t('lockedChoice') : undefined}
          onClick={() => selected !== option.value && onPick(option.value)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            selected === option.value
              ? 'border-foreground bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {option.locked && <Lock className="h-3 w-3" aria-hidden />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
