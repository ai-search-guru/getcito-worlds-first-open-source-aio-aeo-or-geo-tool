'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ClassBadge } from '@/components/chat-access/ClassBadge';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { CHOOSE_PLAN_HREF, useUpgradeGate } from '@/components/context/upgradeGate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';
import type { AccessClass } from '@/lib/chat/access';
import {
  AGENT_FORM_STEPS,
  FAST_MODEL,
  LAST_STEP,
  MAX_INSTRUCTIONS,
  WRITING_MODEL,
  createBody,
  defaultAgentName,
  firstStepWithProblems,
  formFromAgent,
  formFromPreset,
  hasProblems,
  newForm,
  newTriggerDraft,
  patchBody,
  refusalPlace,
  stepProblems,
  syncConnections,
  triggerInputOf,
  type AgentFormSetup,
  type AgentFormState,
  type AgentFormStep,
  type FormField,
  type TriggerDraft,
  type TriggerKind,
} from '@/lib/chat/agentForm';
import {
  GETCITO_SKILLS,
  MAX_FOLLOW_ON_SKILLS,
  OPTIONAL_CONNECTIONS,
  requiredBy as skillNeeding,
  type SkillConnection,
} from '@/lib/chat/agentSkills';
import { engineName, nextRunOf, percentOf, writesAgents } from '@/lib/chat/agentView';
import type { AgentDetail } from '@/lib/chat/agents';
import type { AgentPreset } from '@/lib/chat/agents/catalog';
import type { ChatDenialCard } from '@/lib/chat/events';
import { GO_LIVE_LIMIT_DEFAULT } from '@/lib/chat/goLive';
import { CHAT_MODES, type ChatMode } from '@/lib/chat/precedence';
import { viewerTimeZone } from '@/lib/timeZone';
import { useBrandStore } from '@/state/useBrandStore';
import { cn } from '@/lib/utils';
import { AgentDenial, CHIP } from './AgentParts';
import {
  BOX,
  EM,
  FieldError,
  FormSwitch,
  OPT,
  OPT_OFF,
  OPT_ON,
  SectionTitle,
  TOK,
  TriggerStep,
  errorId,
  radioKeys,
  radioTab,
} from './AgentFormTriggers';
import { AgentGoLiveBox, goLiveBlock, goLiveLimitOf } from './AgentGoLiveBox';
import {
  changeAgent,
  createAgent,
  setAgentGoLive,
  updateAgent,
  type AgentRefused,
} from './agentRequests';
import { useAgentWords } from './agentWords';

/**
 * Create an agent, or edit one (CHAT-21 §D, §C item 14; governance mockup
 * `#g-agent-new`; CHAT-27 item 19): four steps on one page — Skill ·
 * Trigger · Mode & approvals · Connections & model — with Back and Next,
 * the live summary on the right, and on the last step the agent's name,
 * sharing, Max per run and (an Admin's) monthly cap, then **Save as draft**
 * and **Turn on** (Save changes for an agent that is on or paused). Each
 * step is checked before the next opens; what the server refuses (a name
 * taken, the plan's active agents, a one-off in the past…) is shown on the
 * step it belongs to. Analysts and Agency partners, and a Manager on an
 * agent that isn't theirs, see a read-only line with Ask your Admin. Under
 * the Approvals table, an Admin's "Publish and send on its own" box
 * (AUTONOMOUS-GO-LIVE §7.2), saved after the agent as its own request. From a
 * ready-to-use agent (Agent Center › Ready to use), the steps open filled
 * with it and named after it; it is saved only as the person saves it.
 */

/** Steps' problems shown once Next (or a save) was tried on them. */
type Shown = Record<AgentFormStep, boolean>;

/** What the server refused, on its step. */
interface ServerProblem {
  step: AgentFormStep;
  field: FormField;
  code: string | null;
  message: string;
  denial: ChatDenialCard | null;
  /** The new agent was saved as a draft before its activation was refused. */
  savedDraft: boolean;
}

/** Fields whose refusal is shown under them; the rest on the step's own line. */
const INLINE_FIELDS: readonly FormField[] = ['name', 'visibility', 'maxMonth'];

const noSubscribe = () => () => {};

/** Fresh keys for triggers added while the form is open. */
let triggerSeq = 0;
const freshKey = () => `n${++triggerSeq}`;

/** The Approvals table (mockup `#nAppr`): what each class of step does under the mode. */
const APPROVAL_ROWS: readonly { row: string; cls: AccessClass }[] = [
  { row: 'read', cls: 'read' },
  { row: 'draft', cls: 'write' },
  { row: 'cms', cls: 'write' },
  { row: 'check', cls: 'write' },
  { row: 'publish', cls: 'execute' },
];

function approvalOf(row: string, mode: ChatMode): string {
  const full = mode === 'full_auto';
  switch (row) {
    case 'read':
      return 'free';
    case 'cms':
      return full ? 'cmsFull' : 'card';
    case 'check':
      return full ? 'auto' : 'oneClick';
    case 'publish':
      return 'click';
    default:
      return full ? 'auto' : 'card';
  }
}

/** The mockup's `.nyc` pill: "Needs your click". */
function NeedsClick({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-full bg-foreground px-2.5 text-[11.5px] font-medium whitespace-nowrap text-background">
      {children}
    </span>
  );
}

/** A setting on the last step: its name and a muted line, the control beside. */
function SettingRow({
  label,
  note,
  noteId,
  htmlFor,
  children,
}: {
  label: string;
  note?: string;
  /** Its note's id, for the control's aria-describedby. */
  noteId?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-x-4 gap-y-2 px-3.5 py-3 text-[13px] min-[640px]:grid-cols-[200px_minmax(0,1fr)]">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="font-medium">
            {label}
          </label>
        ) : (
          <span className="font-medium">{label}</span>
        )}
        {note && (
          <em id={noteId} className={cn(EM, 'mt-0.5 text-xs')}>
            {note}
          </em>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The read-only line (mockup `.robar`): why the form isn't there, and Ask your Admin. */
function ReadOnlyNote({
  title,
  detail,
  asked,
}: {
  title: string;
  detail: string;
  asked: string | null;
}) {
  return (
    <div
      role="note"
      data-slot="agent-form-read-only"
      className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-[13px]"
    >
      <Lock className="size-4 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <b className="font-semibold">{title}</b>
        <em className="ml-1.5 text-muted-foreground not-italic">{detail}</em>
      </div>
      {asked ? <AskAdminButton asked={asked} ruleKind="role" /> : <span />}
    </div>
  );
}

export function AgentForm({
  setup,
  agent = null,
  initialSkill = null,
  preset = null,
  now,
  timeZone,
}: {
  setup: AgentFormSetup;
  /** The agent to edit; none for a new one. */
  agent?: AgentDetail | null;
  /** A skill to start from (`?skill=` from a skill's Create agent). */
  initialSkill?: string | null;
  /** A ready-to-use agent to start from (`?preset=`, "Use this agent"). */
  preset?: AgentPreset | null;
  now?: Date;
  timeZone?: string;
}) {
  const t = useTranslations('chatAgents.form');
  const tRoles = useTranslations('chatAccess.roleNames');
  const tDetail = useTranslations('chatAgents.detail');
  // The viewer's clock, read in the browser: the server renders the skeleton.
  const zone = useSyncExternalStore(
    noSubscribe,
    () => timeZone ?? viewerTimeZone(),
    () => timeZone ?? null,
  );
  // Back where it was opened from: the agent, Ready to use, or Your agents.
  const back = agent
    ? `/dashboard/agents/${agent.id}`
    : preset
      ? '/dashboard/agents?tab=ready'
      : '/dashboard/agents?tab=yours';
  // Editing, the agent's name: "Edit · Citation win-back".
  const title = agent ? t('titleEdit', { name: agent.name }) : t('titleNew');

  const header = (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="min-w-0 truncate text-2xl font-bold tracking-[-.4px]" title={agent?.name}>
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-2">
        <Link
          href={back}
          data-action="agentNew.cancel"
          className={buttonVariants({ variant: 'ghost' })}
        >
          {t('cancel')}
        </Link>
      </div>
    </div>
  );

  // Who may change it (§K item 51): Admins and Managers; on an agent, as the server's `can` says.
  const readOnly: { title: string; detail: string; asked: string | null } | null = !writesAgents(
    setup.role,
  )
    ? {
        title: t('readOnly.title', { role: tRoles(setup.role) }),
        detail: t('readOnly.detail'),
        asked: agent ? t('readOnly.askedEdit') : t('readOnly.askedCreate'),
      }
    : agent && !agent.can.edit
      ? agent.status === 'archived'
        ? { title: t('readOnly.archivedTitle'), detail: t('readOnly.archivedDetail'), asked: null }
        : agent.mine && agent.visibility === 'workspace' && setup.workspaceAgentsAdminsOnly
          ? {
              title: t('readOnly.notOwnerTitle'),
              detail: t('agent.adminsOnlyNote'),
              asked: t('readOnly.askedEdit'),
            }
          : {
              title: t('readOnly.notOwnerTitle'),
              detail: t('readOnly.notOwnerDetail'),
              asked: t('readOnly.askedEdit'),
            }
      : null;

  if (readOnly) {
    return (
      <div className="max-w-[1100px]">
        {header}
        <ReadOnlyNote {...readOnly} />
        <p className="mt-3 text-[13px]">
          <Link
            href={back}
            data-action="agentNew.back"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {agent ? t('readOnly.backToAgent') : t('readOnly.back')}
          </Link>
        </p>
      </div>
    );
  }
  if (agent && !agent.settings) {
    return (
      <div className="max-w-[1100px]">
        {header}
        <p
          role="alert"
          data-slot="agent-error"
          className="rounded-[14px] border px-3.5 py-7 text-center text-[13px] text-muted-foreground"
        >
          {tDetail('loadFailed')}
        </p>
      </div>
    );
  }
  if (!zone) {
    return (
      <div className="max-w-[1100px]">
        {header}
        <div aria-hidden className="space-y-3">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-[14px]" />
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[1100px]">
      {header}
      <AgentFormBody
        setup={setup}
        agent={agent}
        initialSkill={initialSkill}
        preset={preset}
        now={now}
        zone={zone}
        back={back}
      />
    </div>
  );
}

function AgentFormBody({
  setup,
  agent,
  initialSkill,
  preset,
  now: nowProp,
  zone,
  back,
}: {
  setup: AgentFormSetup;
  agent: AgentDetail | null;
  initialSkill: string | null;
  preset: AgentPreset | null;
  now?: Date;
  zone: string;
  back: string;
}) {
  const t = useTranslations('chatAgents.form');
  const tAgents = useTranslations('chatAgents');
  const tSkills = useTranslations('chatAgents.skills');
  const tErrors = useTranslations('chatAgents.form.errors');
  const tRoles = useTranslations('chatAccess.roleNames');
  const tProviders = useTranslations('settings.agent_providers');
  const router = useRouter();
  const { isLocked, openUpgrade } = useUpgradeGate();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  const skillTitle = (id: string) => (tSkills.has(id) ? tSkills(id) : id);
  const presetName = preset ? tAgents(`presets.${preset.id}.name`) : null;
  /** The title a new agent is named by (§O): its ready-to-use agent's, while it keeps its skill. */
  const autoTitle = (skills: readonly string[]) => {
    const primary = skills[0];
    if (!primary) return null;
    return presetName && primary === preset?.skills[0] ? presetName : skillTitle(primary);
  };
  /** The name a new agent gets while the person hasn't typed one (§O). */
  const named = (next: AgentFormState): AgentFormState => {
    if (next.nameEdited) return next;
    const title = autoTitle(next.skills);
    const brand =
      !next.allBrands && next.brandIds.length === 1
        ? (setup.brands.find((b) => b.id === next.brandIds[0])?.name ?? null)
        : null;
    return {
      ...next,
      name: title ? defaultAgentName(title, brand, setup.takenNames) : '',
    };
  };

  const [state, setState] = useState<AgentFormState>(() => {
    if (agent) {
      return formFromAgent(agent, setup, { timeZone: zone, triggerKey: (i) => `k${i}` })!;
    }
    if (preset) {
      return named(formFromPreset(setup, preset, { timeZone: zone, brandId: activeBrandId }));
    }
    const skill = initialSkill && GETCITO_SKILLS.some((s) => s.id === initialSkill);
    return named(
      newForm(setup, {
        timeZone: zone,
        brandId: activeBrandId,
        skill: skill ? initialSkill : null,
        triggerKey: 'k0',
      }),
    );
  });
  const [step, setStep] = useState<AgentFormStep>(0);
  const [shown, setShown] = useState<Shown>({ 0: false, 1: false, 2: false, 3: false });
  const [selected, setSelected] = useState<string | null>(state.triggers[0]?.key ?? null);
  const [source, setSource] = useState<'getcito' | 'mine' | 'marketplace'>('getcito');
  const [server, setServer] = useState<ServerProblem | null>(null);
  const [busy, setBusy] = useState<'draft' | 'on' | 'save' | null>(null);
  // What a save patches: the agent being edited, or the draft a first save made.
  const [base, setBase] = useState<AgentDetail | null>(agent);
  // The Admin's go-live box (AUTONOMOUS-GO-LIVE §7.2): ticked, and its daily limit as typed.
  const [goLive, setGoLive] = useState(() => {
    const given = agent?.goLive?.permission;
    return {
      on: !!given?.on,
      limit: String(given?.on ? given.dailyLimit : GO_LIVE_LIMIT_DEFAULT),
    };
  });
  const [goLiveTried, setGoLiveTried] = useState(false);
  // Where the focus goes after a render: a new step's title, or the first problem.
  const [focusAsk, setFocusAsk] = useState<{ to: 'title' | 'problem'; n: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  // A trigger switched to another kind and back keeps what it had (selection follows the arrows).
  const kindsSeen = useRef(new Map<string, TriggerDraft>());

  useEffect(() => {
    if (!focusAsk) return;
    if (focusAsk.to === 'title') {
      titleRef.current?.focus();
      return;
    }
    const pane = paneRef.current;
    const target =
      pane?.querySelector<HTMLElement>(
        ':is(input, select, textarea, button)[aria-invalid="true"]',
      ) ??
      pane?.querySelector<HTMLElement>('[data-slot="agent-form-alert"]') ??
      pane?.querySelector<HTMLElement>(
        '[data-slot="agent-denial"] button:not([data-action="denial.close"])',
      ) ??
      titleRef.current;
    target?.focus();
  }, [focusAsk]);

  // A fresh clock with every change, so "Next run" and a one-off's time stay right.
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useAgentWords(now, zone);
  const ctx = { setup, agent: base, now };
  const problems = stepProblems(step, state, ctx);
  const isAdmin = setup.role === 'admin';
  // The go-live box shows while CHAT_AUTO_GO_LIVE is on (AUTONOMOUS-GO-LIVE §7.2).
  const goLiveBoxShown = !!setup.goLive && setup.goLive !== 'hidden';
  // Edit of an agent that is on or paused saves in place; a draft can be saved or turned on.
  const savesInPlace = !!base && base.status !== 'draft';

  const update = (patch: Partial<AgentFormState>) => {
    setServer(null);
    setState((was) => named({ ...was, ...patch }));
  };
  const setTrigger = (key: string, patch: Partial<TriggerDraft>) => {
    setServer(null);
    setState((was) => ({
      ...was,
      triggers: was.triggers.map((d) =>
        d.key === key
          ? ({
              ...d,
              ...patch,
              // A changed field writes its settings anew; switching it on or off keeps them.
              raw: Object.keys(patch).every((k) => k === 'enabled') ? d.raw : null,
            } as TriggerDraft)
          : d,
      ),
    }));
  };

  const show = (at: AgentFormStep) => setShown((was) => ({ ...was, [at]: true }));
  /** Opens a step with the focus on its title (read out), or on its first problem. */
  const moveTo = (target: AgentFormStep, focus: 'title' | 'problem' = 'title') => {
    setStep(target);
    setFocusAsk((was) => ({ to: focus, n: (was?.n ?? 0) + 1 }));
  };
  /** A step that isn't ready: its problems shown, and the focus on the first. */
  const stopAt = (at: AgentFormStep) => {
    show(at);
    moveTo(at, 'problem');
  };
  const goTo = (target: AgentFormStep) => {
    if (target > step) {
      const bad = firstStepWithProblems(state, ctx, target);
      if (bad !== null) return stopAt(bad);
    }
    moveTo(target);
  };
  const next = () => {
    if (hasProblems(problems)) return stopAt(step);
    moveTo((step + 1) as AgentFormStep);
  };

  // ─── Skills ──────────────────────────────────────────────────────────────

  const primary = state.skills[0] ?? null;
  const setSkills = (skills: string[]) =>
    update({ skills, connections: syncConnections(state.connections, skills) });
  const pickPrimary = (id: string) =>
    setSkills([id, ...state.skills.slice(1).filter((s) => s !== id)]);

  // ─── Triggers ────────────────────────────────────────────────────────────

  const onKind = (kind: TriggerKind) => {
    setServer(null);
    if (kind === 'watch_rule') return;
    const current = state.triggers.find((d) => d.key === selected);
    if (current) kindsSeen.current.set(`${current.key}:${current.kind}`, current);
    const key = selected ?? freshKey();
    const draft = kindsSeen.current.get(`${key}:${kind}`) ?? newTriggerDraft(kind, key, zone);
    setState((was) => ({
      ...was,
      triggers: selected
        ? was.triggers.map((d) => (d.key === selected ? draft : d))
        : [...was.triggers, draft],
    }));
    setSelected(draft.key);
  };
  const onAdd = () => {
    const draft = newTriggerDraft('schedule', freshKey(), zone);
    setServer(null);
    setState((was) => ({ ...was, triggers: [...was.triggers, draft] }));
    setSelected(draft.key);
  };
  const onRemove = (key: string) => {
    const rest = state.triggers.filter((d) => d.key !== key);
    setServer(null);
    setState((was) => ({ ...was, triggers: rest }));
    if (selected === key) setSelected(rest[0]?.key ?? null);
  };

  // ─── Saving ──────────────────────────────────────────────────────────────

  const refuse = (answer: AgentRefused, savedDraft: boolean) => {
    // A read-only workspace: the upgrade dialog, not a line.
    if (answer.failure === 'subscription' && answer.code !== 'demo_brand') {
      openUpgrade(tAgents(`asked.${base ? 'edit' : 'create'}`));
      return;
    }
    const place = refusalPlace(answer.code, answer.asked);
    moveTo(place.step, 'problem');
    setServer({
      ...place,
      code: answer.code,
      message: answer.message ?? t('failed'),
      denial: answer.denial,
      savedDraft,
    });
  };

  /**
   * What the go-live box asks of a save: the daily limit to give, null to
   * take it away, or undefined to leave it as it is (not an Admin, no box,
   * or a box that can't be changed now: kept as it is, inert).
   */
  const goLiveWanted = (): number | null | undefined => {
    if (!isAdmin || !goLiveBoxShown || goLiveBlock(setup, state.mode)) return undefined;
    return goLive.on ? goLiveLimitOf(goLive.limit) : null;
  };
  /** Whether the saved agent's permission differs from what the box asks. */
  const goLiveDiffers = (saved: AgentDetail | null) => {
    const wanted = goLiveWanted();
    if (wanted === undefined) return false;
    const given = saved?.goLive?.permission;
    return wanted === null ? !!given?.on : !(given?.on && given.dailyLimit === wanted);
  };

  const submit = async (intent: 'draft' | 'on' | 'save') => {
    if (busy) return;
    const bad = firstStepWithProblems(state, ctx);
    if (bad !== null) return stopAt(bad);
    // A ticked box needs a limit of 1 to 20.
    if (goLiveWanted() === null && goLive.on) {
      setGoLiveTried(true);
      return moveTo(2, 'problem');
    }
    if (isLocked) {
      openUpgrade(tAgents(`asked.${base ? 'edit' : 'create'}`));
      return;
    }
    setBusy(intent);
    setServer(null);
    try {
      let saved = base;
      const created = !agent;
      if (!saved) {
        const answer = await createAgent(createBody(state, setup.role, autoTitle(state.skills)));
        if (!answer.ok) return refuse(answer, false);
        const draft = answer.agent;
        saved = draft;
        setBase(draft);
        // The name the server gave it (§O, against every agent) is its name from now on.
        setState((was) => ({ ...was, name: draft.name, nameEdited: true }));
        // The address is the draft's Edit: a reload opens it, never a second agent.
        if (/\/agents\/new\/?$/.test(window.location.pathname)) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname.replace(/\/new\/?$/, `/${draft.id}/edit`),
          );
        }
      } else {
        const patch = patchBody(state, saved, setup.role);
        if (patch) {
          const answer = await updateAgent(saved.id, patch);
          if (!answer.ok) return refuse(answer, false);
          saved = answer.agent;
          setBase(saved);
        } else if (intent !== 'on' && !created && !goLiveDiffers(saved)) {
          toast(tAgents('toast.nothingChanged'));
          router.push(back);
          return;
        }
      }
      // The go-live box: its own request, for the version this save left the agent on.
      if (goLiveDiffers(saved)) {
        const answer = await setAgentGoLive(saved.id, goLiveWanted() ?? null);
        if (!answer.ok) return refuse(answer, created || saved.status === 'draft');
      }
      const href = `/dashboard/agents/${saved.id}`;
      if (intent === 'on') {
        const answer = await changeAgent(saved.id, 'activate');
        // Saved as a draft, but not on: the reason on its step; a save again patches the draft.
        if (!answer.ok) return refuse(answer, created || saved.status === 'draft');
        const at = nextRunOf(answer.agent.triggers);
        toast(
          at.kind === 'at'
            ? tAgents('toast.activated', { when: words.when(at.at, at.zone) })
            : at.kind === 'event'
              ? tAgents('toast.activatedEvent')
              : tAgents('toast.activatedManual'),
        );
      } else {
        toast(
          tAgents(saved.status === 'draft' ? 'toast.savedDraft' : 'toast.saved', {
            name: saved.name,
          }),
        );
      }
      router.push(href);
    } finally {
      setBusy(null);
    }
  };

  // ─── Pieces ──────────────────────────────────────────────────────────────

  /** The server's refusal of a field on this step, said under it. */
  const serverOn = (field: FormField) =>
    !!server && server.step === step && server.field === field && !server.denial;
  /** Whether a field shows a problem now: its aria-invalid and aria-describedby follow. */
  const invalid = (field: FormField) =>
    serverOn(field) || (shown[step] && !!problems.fields[field]);
  const described = (field: FormField, ...more: (string | false)[]) =>
    [...more, invalid(field) && errorId(field)].filter(Boolean).join(' ') || undefined;
  const fieldError = (field: FormField) => {
    if (serverOn(field)) return <FieldError field={field}>{server!.message}</FieldError>;
    const code = shown[step] ? problems.fields[field] : undefined;
    return code ? (
      <FieldError field={field}>{tErrors(code, { plan: setup.fullAutoPlan })}</FieldError>
    ) : null;
  };

  // One alert a step (read once): the server's refusal, or how many problems the step has.
  const ALERT =
    'mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  const problemCount =
    (shown[step]
      ? Object.keys(problems.fields).length + Object.keys(problems.triggers).length
      : 0) + (server && server.step === step && INLINE_FIELDS.includes(server.field) ? 1 : 0);
  const alertLine =
    server && server.step === step && server.denial ? (
      <AgentDenial denial={server.denial} onClose={() => setServer(null)} />
    ) : server && server.step === step && !INLINE_FIELDS.includes(server.field) ? (
      <div
        role="alert"
        tabIndex={-1}
        data-slot="agent-form-alert"
        data-refusal={server.code ?? ''}
        className={ALERT}
      >
        <span data-slot="agent-form-refusal" className="min-w-0 flex-1">
          {server.savedDraft && <b className="mr-1 font-semibold">{t('savedNotOn')}</b>}
          {server.message}
        </span>
        {server.code === 'version_conflict' && (
          <Button
            size="sm"
            variant="outline"
            data-action="agentNew.reload"
            onClick={() => router.refresh()}
          >
            {t('reload')}
          </Button>
        )}
      </div>
    ) : problemCount > 0 ? (
      <div role="alert" tabIndex={-1} data-slot="agent-form-alert" className={ALERT}>
        {t('alert', { count: problemCount })}
      </div>
    ) : null;

  const brandsLine = state.allBrands
    ? t('scope.allBrands')
    : state.brandIds.length === 0
      ? t('summary.none')
      : state.brandIds.length <= 2
        ? state.brandIds
            .map((id) => setup.brands.find((b) => b.id === id)?.name)
            .filter(Boolean)
            .join(', ')
        : t('scope.brandCount', { count: state.brandIds.length });
  const enabledTriggers = state.triggers
    .filter((d) => d.enabled)
    .map(triggerInputOf)
    .filter((input) => input !== null);
  const triggerLine =
    enabledTriggers.length === 0
      ? t('summary.manual')
      : `${words.trigger(enabledTriggers[0])}${
          enabledTriggers.length > 1 ? ` · +${enabledTriggers.length - 1}` : ''
        }`;
  const modelLabel = (id: string) =>
    id === 'auto'
      ? t('model.options.auto')
      : id === FAST_MODEL
        ? t('model.options.fast')
        : id === WRITING_MODEL
          ? t('model.options.writing')
          : words.model(id);
  const runShare = /^\d{1,2}$/.test(state.maxRun.trim())
    ? Number(state.maxRun) / 100
    : setup.runShareDefault;
  const fullAutoShown = setup.fullAuto !== 'policy' || state.mode === 'full_auto';
  const modes = CHAT_MODES.filter((m) => m !== 'full_auto' || fullAutoShown);
  const required = state.connections.filter((c) => c.required);
  const optional = [
    ...new Set([
      ...OPTIONAL_CONNECTIONS,
      ...state.connections.filter((c) => !c.required).map((c) => c.key),
    ]),
  ].filter((key) => !required.some((c) => c.key === key));
  const requiredBy = (key: string) => skillNeeding(state.skills, key);
  const models = [
    'auto',
    FAST_MODEL,
    WRITING_MODEL,
    ...([FAST_MODEL, WRITING_MODEL, 'auto'].includes(state.model) ? [] : [state.model]),
  ];
  const workspaceLocked =
    !isAdmin && setup.workspaceAgentsAdminsOnly && base?.visibility !== 'workspace';
  // Going live on its own (AUTONOMOUS-GO-LIVE §7.2): what the box makes of publishing.
  const goLiveLimit =
    goLiveBoxShown && goLive.on && !goLiveBlock(setup, state.mode)
      ? goLiveLimitOf(goLive.limit)
      : null;
  const publishing =
    goLiveLimit !== null ? (
      <span data-slot="agent-go-live-approval" className="text-foreground">
        {t('goLive.approval', { limit: goLiveLimit })}
      </span>
    ) : (
      <NeedsClick key="nyc">{t('summary.publishing')}</NeedsClick>
    );

  const summaryRows: [string, ReactNode][] = [
    ['name', state.name.trim() || t('summary.none')],
    [
      'skill',
      state.skills.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {state.skills.map((id) => (
            <code key={id} className="font-mono text-xs">
              /{id}
            </code>
          ))}
        </span>
      ) : (
        t('summary.none')
      ),
    ],
    ['trigger', triggerLine],
    [
      'scope',
      state.engines.length > 0
        ? `${brandsLine} · ${state.engines.map(engineName).join(', ')}`
        : brandsLine,
    ],
    ['mode', tAgents(`modes.${state.mode}`)],
    [
      'connections',
      state.connections.length > 0
        ? state.connections.map((c) => words.connection(c.key)).join(', ')
        : tAgents('connections.none'),
    ],
    ['model', modelLabel(state.model)],
    ['shared', t(`agent.visibilityOptions.${state.visibility}`)],
    ['runsAs', t('summary.runsAs', { role: tRoles(setup.role) })],
    ['approvals', t('summary.approvals')],
    ['outcome', t('summary.outcome')],
    ['publishing', publishing],
    ['cost', t('summary.cost', { share: percentOf(runShare) })],
  ];

  const spinner = (intent: 'draft' | 'on' | 'save') =>
    busy === intent ? (
      <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
    ) : null;

  return (
    <div data-slot="agent-form" data-step={step}>
      <ol
        aria-label={t('stepsLabel')}
        className="mb-4 flex overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]"
      >
        {AGENT_FORM_STEPS.map((name, i) => (
          <li key={name} className={cn('min-w-0 flex-1', i > 0 && 'border-l')}>
            <button
              type="button"
              data-action="agentNew.step"
              data-step-button={i}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => goTo(i as AgentFormStep)}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 px-3.5 py-2.5 text-[13px] text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
                i === step && 'bg-muted/60 font-medium text-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-foreground/20 bg-card text-[11px] font-semibold',
                  i === step && 'border-foreground text-foreground',
                  i < step &&
                    'border-green-100 bg-green-100 text-green-700 dark:border-green-950 dark:bg-green-950 dark:text-green-400',
                )}
              >
                {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="truncate">{t(`steps.${name}`)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <section ref={paneRef} data-step-pane={step} aria-labelledby="agent-form-step-title">
            {/* The step's title, read out and focused when the step opens (the stepper shows it). */}
            <h2
              id="agent-form-step-title"
              ref={titleRef}
              tabIndex={-1}
              data-slot="agent-form-step-title"
              className="sr-only"
            >
              {t('stepTitle', { step: step + 1, name: t(`steps.${AGENT_FORM_STEPS[step]}`) })}
            </h2>
            {alertLine}

            {step === 0 && (
              <>
                <div
                  role="group"
                  aria-label={t('skill.sourcesLabel')}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {(['getcito', 'mine', 'marketplace'] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      data-action="agentNew.skillSource"
                      aria-pressed={source === src}
                      onClick={() => setSource(src)}
                      className={cn(
                        'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        source === src &&
                          'border-foreground bg-foreground text-background hover:bg-foreground/90',
                      )}
                    >
                      {t(`skill.sources.${src}`)}
                    </button>
                  ))}
                </div>
                {source === 'getcito' ? (
                  <div
                    role="radiogroup"
                    aria-label={t('steps.skill')}
                    aria-invalid={invalid('skills') || undefined}
                    aria-describedby={described('skills')}
                    onKeyDown={radioKeys}
                    className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2"
                  >
                    {[
                      // A skill kept from elsewhere (a library skill) shows first.
                      ...(primary && !GETCITO_SKILLS.some((s) => s.id === primary)
                        ? [{ id: primary, uses: [] as readonly SkillConnection[] }]
                        : []),
                      ...GETCITO_SKILLS,
                    ].map((skill, i) => {
                      const on = primary === skill.id;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          tabIndex={radioTab(on, i === 0, !!primary)}
                          data-action="agentNew.pickSkill"
                          data-skill={skill.id}
                          onClick={() => pickPrimary(skill.id)}
                          className={cn(OPT, on && OPT_ON)}
                        >
                          <code className="font-mono text-xs text-muted-foreground">
                            /{skill.id}
                          </code>
                          <b className="font-semibold">{skillTitle(skill.id)}</b>
                          <em className={EM}>
                            {skill.uses.length > 0
                              ? t('skill.uses', {
                                  connections: skill.uses
                                    .map((use) => words.connection(use.key))
                                    .join(', '),
                                })
                              : t('skill.noConnection')}
                          </em>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-[14px] border border-dashed px-3.5 py-6 text-center text-[13px] text-muted-foreground">
                    {t(`skill.empty.${source}`)}
                  </p>
                )}
                {fieldError('skills')}

                {primary && (
                  <>
                    <SectionTitle title={t('skill.followOn')} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {state.skills.slice(1).map((id) => (
                        <span key={id} className={cn(CHIP, 'h-7 px-2 text-[12.5px]')}>
                          <code className="font-mono">/{id}</code>
                          <button
                            type="button"
                            data-action="agentNew.removeSkill"
                            aria-label={t('skill.removeSkill', { skill: id })}
                            onClick={() => setSkills(state.skills.filter((s) => s !== id))}
                            className="ml-0.5 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {state.skills.length <= MAX_FOLLOW_ON_SKILLS && (
                        <select
                          aria-label={t('skill.addFollowOn')}
                          data-action="agentNew.addFollowOn"
                          value=""
                          onChange={(event) =>
                            event.target.value && setSkills([...state.skills, event.target.value])
                          }
                          className={TOK}
                        >
                          <option value="">{t('skill.addFollowOn')}</option>
                          {GETCITO_SKILLS.filter((s) => !state.skills.includes(s.id)).map((s) => (
                            <option key={s.id} value={s.id}>
                              /{s.id} · {skillTitle(s.id)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                      {t('skill.followOnNote', { skill: primary })}
                    </p>
                  </>
                )}

                <SectionTitle title={t('skill.instructions')} />
                <Textarea
                  id="agent-instructions"
                  aria-label={t('skill.instructions')}
                  data-action="agentNew.instructions"
                  rows={3}
                  value={state.instructions}
                  placeholder={t('skill.instructionsPlaceholder')}
                  aria-invalid={invalid('instructions') || undefined}
                  aria-describedby={described('instructions', 'agent-form-note-instructions')}
                  onChange={(event) => update({ instructions: event.target.value })}
                  className="text-[13px]"
                />
                <div className="mt-1 flex gap-3 text-[11.5px] text-muted-foreground">
                  <span id="agent-form-note-instructions" className="min-w-0 flex-1">
                    {t('skill.instructionsNote')}
                  </span>
                  <span
                    className={cn(
                      'tabular-nums',
                      state.instructions.length > MAX_INSTRUCTIONS && 'text-destructive',
                    )}
                  >
                    {t('skill.count', {
                      count: state.instructions.length.toLocaleString('en-US'),
                    })}
                  </span>
                </div>
                {fieldError('instructions')}
              </>
            )}

            {step === 1 && (
              <TriggerStep
                state={state}
                update={update}
                setup={setup}
                words={words}
                now={now}
                problems={problems}
                shown={shown[1]}
                selected={selected}
                onSelect={setSelected}
                onKind={onKind}
                onAdd={onAdd}
                onRemove={onRemove}
                onTrigger={setTrigger}
              />
            )}

            {step === 2 && (
              <>
                <div
                  role="radiogroup"
                  aria-label={tAgents('detail.fields.mode')}
                  aria-invalid={invalid('mode') || undefined}
                  aria-describedby={described('mode')}
                  onKeyDown={radioKeys}
                  className="grid grid-cols-3 gap-2 max-[640px]:grid-cols-1"
                >
                  {modes.map((mode, i) => {
                    const locked = mode === 'full_auto' && setup.fullAuto !== 'open';
                    const on = state.mode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-disabled={locked || undefined}
                        tabIndex={locked ? -1 : radioTab(on, i === 0, true)}
                        data-action="agentNew.mode"
                        data-mode={mode}
                        onClick={() => !locked && update({ mode })}
                        className={cn(OPT, on && !locked && OPT_ON, locked && OPT_OFF)}
                      >
                        <b className="font-semibold">{tAgents(`modes.${mode}`)}</b>
                        <em className={EM}>{t(`mode.notes.${mode}`)}</em>
                        {locked && (
                          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-px text-[11px] text-foreground/70">
                            <Lock className="size-3" aria-hidden />
                            {setup.fullAuto === 'plan'
                              ? t('mode.lockTag', {
                                  plan: setup.fullAutoPlan,
                                  current: setup.planName,
                                })
                              : tAgents('asked.fullAuto')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {fieldError('mode')}
                {setup.fullAuto === 'plan' && (
                  <div
                    data-slot="agent-form-gate"
                    className="relative mt-2.5 overflow-hidden rounded-xl border bg-card"
                  >
                    <div
                      aria-hidden
                      className="grid gap-1.5 px-3 py-2.5 opacity-55 blur-[3px] select-none"
                    >
                      <i className="block h-2.5 rounded-md bg-muted-foreground/25" />
                      <i className="block h-2.5 w-[72%] rounded-md bg-muted-foreground/25" />
                      <i className="block h-2.5 w-[48%] rounded-md bg-muted-foreground/25" />
                    </div>
                    <div className="absolute inset-0 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 bg-gradient-to-r from-card/95 to-card/80 px-3">
                      <Lock className="size-4" aria-hidden />
                      <span
                        className="truncate text-[12.5px]"
                        title={t('mode.gate', {
                          plan: setup.fullAutoPlan,
                          current: setup.planName,
                        })}
                      >
                        {t('mode.gate', { plan: setup.fullAutoPlan, current: setup.planName })}
                      </span>
                      <Link
                        href={CHOOSE_PLAN_HREF}
                        data-action="plan.upgrade"
                        className={buttonVariants({ size: 'sm' })}
                      >
                        {t('mode.upgrade')}
                      </Link>
                    </div>
                  </div>
                )}
                <div
                  role="table"
                  aria-label={t('mode.for', { skill: primary ? `/${primary}` : '' })}
                  className={cn(BOX, 'mt-3')}
                >
                  <div
                    role="row"
                    className="grid grid-cols-[minmax(0,1fr)_80px_minmax(0,200px)] gap-3 bg-muted/50 px-3.5 py-2 text-[11px] tracking-[.3px] text-muted-foreground uppercase"
                  >
                    <span role="columnheader">
                      {t('mode.for', { skill: primary ? `/${primary}` : '' })}
                    </span>
                    <span role="columnheader">{t('mode.class')}</span>
                    <span role="columnheader">{t('mode.approval')}</span>
                  </div>
                  {APPROVAL_ROWS.map(({ row, cls }) => {
                    const outcome = approvalOf(row, state.mode);
                    return (
                      <div
                        key={row}
                        role="row"
                        data-approval={row}
                        className="grid grid-cols-[minmax(0,1fr)_80px_minmax(0,200px)] items-center gap-3 border-t px-3.5 py-2.5 text-[13px]"
                      >
                        <b role="cell" className="min-w-0 font-medium">
                          {t(`mode.rows.${row}`)}
                        </b>
                        <span role="cell">
                          <ClassBadge cls={cls} />
                        </span>
                        <span role="cell" className="text-[11.5px] text-muted-foreground">
                          {outcome === 'click' ? (
                            goLiveLimit !== null ? (
                              publishing
                            ) : (
                              <NeedsClick>{t('mode.outcome.click')}</NeedsClick>
                            )
                          ) : (
                            t(`mode.outcome.${outcome}`)
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {goLiveBoxShown && (
                  <AgentGoLiveBox
                    setup={setup}
                    mode={state.mode}
                    on={goLive.on}
                    limit={goLive.limit}
                    permission={base?.goLive?.permission ?? null}
                    showProblem={goLiveTried}
                    onChange={(next) => {
                      setServer(null);
                      setGoLive(next);
                    }}
                  />
                )}
              </>
            )}

            {step === 3 && (
              <>
                <SectionTitle first title={t('connections.title')} />
                <div data-slot="agent-form-connections" className={BOX}>
                  {[...required.map((c) => c.key), ...optional].map((key, i) => {
                    const need = required.some((c) => c.key === key);
                    const by = requiredBy(key);
                    const on = state.connections.some((c) => c.key === key);
                    return (
                      <div
                        key={key}
                        data-connection={key}
                        className={cn(
                          'flex items-center gap-3 px-3.5 py-3 text-[13px]',
                          i > 0 && 'border-t',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <b className="font-medium">{words.connection(key)}</b>
                          {/* "Any CMS": which ones count. */}
                          {tAgents.has(`connections.counts.${key}`) && (
                            <em data-slot="connection-counts" className={cn(EM, 'text-xs')}>
                              {tAgents(`connections.counts.${key}`)}
                            </em>
                          )}
                          <em className={cn(EM, 'text-xs')}>
                            {need
                              ? by
                                ? t('connections.requiredBy', { skill: by })
                                : tAgents('connections.required')
                              : tAgents('connections.optional')}
                          </em>
                        </div>
                        {need ? (
                          <span className="inline-flex items-center rounded-full border bg-card px-2.5 py-px text-xs text-muted-foreground">
                            {tAgents('connections.required')}
                          </span>
                        ) : (
                          <FormSwitch
                            checked={on}
                            label={t('connections.use', { name: words.connection(key) })}
                            action="agentNew.toggleConnection"
                            onChange={(use) =>
                              update({
                                connections: use
                                  ? [...state.connections, { key, required: false }]
                                  : state.connections.filter((c) => c.key !== key),
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <SectionTitle title={t('model.title')} />
                <div
                  role="radiogroup"
                  aria-label={t('model.title')}
                  onKeyDown={radioKeys}
                  className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2"
                >
                  {models.map((id) => {
                    const kind =
                      id === 'auto'
                        ? 'auto'
                        : id === FAST_MODEL
                          ? 'fast'
                          : id === WRITING_MODEL
                            ? 'writing'
                            : 'picked';
                    const on = state.model === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={radioTab(on, false, true)}
                        data-action="agentNew.model"
                        data-model={kind}
                        onClick={() => update({ model: id })}
                        className={cn(OPT, on && OPT_ON)}
                      >
                        <b className="font-semibold">
                          {kind === 'picked' ? words.model(id) : t(`model.options.${kind}`)}
                        </b>
                        <em className={EM}>{t(`model.notes.${kind}`)}</em>
                      </button>
                    );
                  })}
                </div>
                <p data-slot="agent-form-key" className="mt-2 text-xs text-muted-foreground">
                  {setup.ownKeyProvider
                    ? t('model.ownKey', {
                        provider: tProviders.has(`${setup.ownKeyProvider}.name`)
                          ? tProviders(`${setup.ownKeyProvider}.name`)
                          : setup.ownKeyProvider,
                      })
                    : t('model.limit')}
                </p>

                <SectionTitle title={t('agent.title')} />
                <div className={cn(BOX, 'divide-y')}>
                  <SettingRow
                    label={t('agent.name')}
                    note={t('agent.nameNote')}
                    noteId="agent-form-note-name"
                    htmlFor="agent-name"
                  >
                    <Input
                      id="agent-name"
                      data-action="agentNew.name"
                      value={state.name}
                      aria-invalid={invalid('name') || undefined}
                      aria-describedby={described('name', 'agent-form-note-name')}
                      onChange={(event) => update({ name: event.target.value, nameEdited: true })}
                      className="max-w-[360px]"
                    />
                    {fieldError('name')}
                  </SettingRow>

                  <SettingRow
                    label={t('agent.visibility')}
                    note={workspaceLocked ? t('agent.adminsOnlyNote') : undefined}
                  >
                    <div
                      role="radiogroup"
                      aria-label={t('agent.visibility')}
                      aria-invalid={invalid('visibility') || undefined}
                      aria-describedby={described('visibility')}
                      onKeyDown={radioKeys}
                      className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1"
                    >
                      {(['private', 'workspace'] as const).map((visibility) => {
                        const locked = visibility === 'workspace' && workspaceLocked;
                        const on = state.visibility === visibility;
                        return (
                          <button
                            key={visibility}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-disabled={locked || undefined}
                            tabIndex={locked ? -1 : radioTab(on, false, true)}
                            data-action="agentNew.visibility"
                            data-visibility={visibility}
                            onClick={() => !locked && update({ visibility })}
                            className={cn(OPT, on && !locked && OPT_ON, locked && OPT_OFF)}
                          >
                            <b className="font-semibold">
                              {t(`agent.visibilityOptions.${visibility}`)}
                            </b>
                            <em className={EM}>{t(`agent.visibilityNotes.${visibility}`)}</em>
                            {locked && (
                              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-px text-[11px] text-foreground/70">
                                <Lock className="size-3" aria-hidden />
                                {t('agent.adminsOnly')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {fieldError('visibility')}
                  </SettingRow>

                  <SettingRow
                    label={t('agent.maxRun')}
                    note={t(setup.ownKeyProvider ? 'agent.maxRunNoteOwnKey' : 'agent.maxRunNote')}
                    noteId="agent-form-note-max-run"
                    htmlFor="agent-max-run"
                  >
                    <div className="flex items-center gap-1.5">
                      <Input
                        id="agent-max-run"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={50}
                        step={1}
                        data-action="agentNew.maxRun"
                        value={state.maxRun}
                        aria-invalid={invalid('maxRun') || undefined}
                        aria-describedby={described('maxRun', 'agent-form-note-max-run')}
                        onChange={(event) => update({ maxRun: event.target.value })}
                        className="w-20 tabular-nums"
                      />
                      {/* Read from the note ("…of the monthly AI limit, 1–50%"). */}
                      <span aria-hidden className="text-muted-foreground">
                        %
                      </span>
                    </div>
                    {fieldError('maxRun')}
                  </SettingRow>

                  {isAdmin ? (
                    <SettingRow
                      label={t('agent.monthCap')}
                      note={t('agent.monthCapNote')}
                      noteId="agent-form-note-month-cap"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <FormSwitch
                          checked={state.monthCapOn}
                          label={t('agent.monthCap')}
                          action="agentNew.monthCap"
                          onChange={(on) => update({ monthCapOn: on })}
                        />
                        {state.monthCapOn && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={100}
                              step={1}
                              aria-label={t('agent.monthCap')}
                              data-action="agentNew.maxMonth"
                              value={state.maxMonth}
                              aria-invalid={invalid('maxMonth') || undefined}
                              aria-describedby={described('maxMonth', 'agent-form-note-month-cap')}
                              onChange={(event) => update({ maxMonth: event.target.value })}
                              className="w-20 tabular-nums"
                            />
                            <span aria-hidden className="text-muted-foreground">
                              %
                            </span>
                          </div>
                        )}
                      </div>
                      {fieldError('maxMonth')}
                    </SettingRow>
                  ) : (
                    base?.maxMonthShare != null && (
                      <SettingRow label={t('agent.monthCap')}>
                        <span data-slot="agent-form-month-cap" className="text-muted-foreground">
                          {t('agent.monthCapSet', { cap: percentOf(base.maxMonthShare) })}
                        </span>
                      </SettingRow>
                    )
                  )}
                </div>
              </>
            )}
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3.5">
            <Button
              variant="outline"
              data-action="agentNew.back"
              disabled={step === 0}
              onClick={() => moveTo((step - 1) as AgentFormStep)}
            >
              {t('back')}
            </Button>
            <span className="text-[11.5px] text-muted-foreground">
              {t('stepOf', { step: step + 1 })}
            </span>
            {/*
              Each button its own (keyed): Next never turns into Save under the
              focus, so Enter pressed again can't save past the last step unseen.
            */}
            <div className="ml-auto flex items-center gap-2">
              {step < LAST_STEP ? (
                <Button key="next" data-action="agentNew.next" onClick={next}>
                  {t('next')}
                </Button>
              ) : savesInPlace ? (
                <Button
                  key="save"
                  data-action="agentNew.save"
                  disabled={!!busy}
                  onClick={() => void submit('save')}
                >
                  {spinner('save')}
                  {t('saveChanges')}
                </Button>
              ) : (
                <>
                  <Button
                    key="draft"
                    variant="outline"
                    data-action="agentNew.saveDraft"
                    disabled={!!busy}
                    onClick={() => void submit('draft')}
                  >
                    {spinner('draft')}
                    {t('saveDraft')}
                  </Button>
                  <Button
                    key="on"
                    data-action="agentNew.turnOn"
                    disabled={!!busy}
                    onClick={() => void submit('on')}
                  >
                    {spinner('on')}
                    {t('turnOn')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        <aside
          aria-label={t('summary.title')}
          data-slot="agent-form-summary"
          className="rounded-[14px] border bg-card p-3.5 shadow-[0_1px_2px_rgba(10,10,10,.04)] min-[1200px]:sticky min-[1200px]:top-0"
        >
          <h3 className="mb-2.5 text-[13.5px] font-semibold">{t('summary.title')}</h3>
          <dl className="m-0">
            {summaryRows.map(([row, value], i) => (
              <div
                key={row}
                data-row={row}
                className={cn(
                  'flex gap-2 py-[7px] text-[12.5px]',
                  i > 0 && 'border-t border-dashed',
                )}
              >
                <dt className="w-24 shrink-0 text-muted-foreground">{t(`summary.rows.${row}`)}</dt>
                <dd className="m-0 min-w-0 flex-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
