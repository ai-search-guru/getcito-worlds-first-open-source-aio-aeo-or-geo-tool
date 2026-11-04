'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, ChevronDown, Search } from 'lucide-react';
import { FormSwitch } from '@/components/chat/agents/AgentFormTriggers';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import { connectionKindOf, skillOf } from '@/lib/chat/agentSkills';
import { composeHref } from '@/lib/chat/composeParam';
import { SKILL_FILTERS, type SkillFilter } from '@/lib/chat/skills/library';
import type { LibrarySkillView, SkillList, WorkspaceSkillView } from '@/lib/chat/skills/store';
import { startChatRun } from '@/lib/chat/startChat';
import { ImportSkillDialog, type ImportMode } from './ImportSkillDialog';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * Skills (CHAT-13 items 8–10; Chat Wave 3 W3-07; mockup `#s-skills`, its
 * Library tab hidden until Wave 4): GetCito's skills and the workspace's
 * own, with search and the library's filter chips. A card shows its
 * /command, what it does and the connections it uses on the brand open
 * (green when connected, grey with Connect when not), and Run (a new chat
 * with the skill), Schedule (Chat Home's box filled with "Every Monday at
 * 9:00, /{name} "), Create agent (an GetCito skill's) and its on/off
 * switch for an Admin, or the skill's creator. Its details open on its
 * title: where it came from, its review, and Share or Delete.
 */

type Tab = 'getcito' | 'mine';
type T = ReturnType<typeof useTranslations<'chatSkills.page'>>;
type Filter = 'all' | SkillFilter;

const INTEGRATIONS_HREF = '/dashboard/settings/integrations';

/** A card's shared look (mockup `.skc`). */
const CARD =
  'flex min-w-0 flex-col gap-2 rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]';
const CHIP = 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]';

/** The list as the API answers it, or why it couldn't. */
async function readSkills(): Promise<SkillList | null> {
  const res = await fetch('/api/chat/skills', { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as ({ ok: true } & SkillList) | null;
  return res?.ok && body?.ok ? body : null;
}

/** The kinds of connection the brand has, or null when they can't be read. */
async function readConnected(brandId: string): Promise<Set<string> | null> {
  const res = await fetch(`/api/chat/skills/connections?brand=${encodeURIComponent(brandId)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    connected?: string[];
  } | null;
  return res?.ok && body?.ok && Array.isArray(body.connected) ? new Set(body.connected) : null;
}

/** Turns a skill on or off; the API's words when it refused. */
async function patchEnabled(url: string, enabled: boolean): Promise<string | null> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).catch(() => null);
  if (res?.ok) return null;
  const body = (await res?.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? '';
}

const matches = (query: string, skill: { name: string; title: string; description: string }) => {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    skill.name.includes(q.replace(/^\//, '')) ||
    skill.title.toLowerCase().includes(q) ||
    skill.description.toLowerCase().includes(q)
  );
};

export function ChatSkills() {
  const t = useTranslations('chatSkills.page');
  const router = useRouter();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { isLocked, openUpgrade } = useUpgradeGate();
  const [list, setList] = useState<SkillList | null | 'failed'>(null);
  const [connected, setConnected] = useState<{ brandId: string; kinds: Set<string> } | null>(null);
  const [tab, setTab] = useState<Tab>('getcito');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const [open, setOpen] = useState<WorkspaceSkillView | LibrarySkillView | null>(null);
  const [importing, setImporting] = useState<ImportMode | null>(null);

  // Each change reads the list again; only the newest read lands.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    void readSkills().then((read) => {
      if (current) setList(read ?? 'failed');
    });
    return () => {
      current = false;
    };
  }, [version]);

  useEffect(() => {
    if (!brandId) return;
    let current = true;
    void readConnected(brandId).then((kinds) => {
      if (current && kinds) setConnected({ brandId, kinds });
    });
    return () => {
      current = false;
    };
  }, [brandId]);

  // The brand open's connections only: another brand's never show.
  const kinds = connected && connected.brandId === brandId ? connected.kinds : null;

  async function run(name: string) {
    if (starting) return;
    // A read-only workspace, or the demo brand, starts no run: the upgrade dialog opens.
    if (isLocked) {
      openUpgrade();
      return;
    }
    setStarting(name);
    const started = await startChatRun(`/${name}`, brandId ?? null);
    if (!started.ok) {
      setStarting(null);
      // A read-only workspace, or a skill run on the demo brand: the plans.
      if (started.code === 'subscription_inactive' || started.code === 'demo_brand') openUpgrade();
      else toast.error(started.error ?? t('runFailed'));
      return;
    }
    router.push(`/dashboard/chat/${started.chatId}`);
  }

  const schedule = (name: string) => router.push(composeHref(t('scheduleText', { name })));

  async function toggleLibrary(skill: LibrarySkillView, enabled: boolean) {
    const refused = await patchEnabled(
      `/api/chat/skills/library/${encodeURIComponent(skill.name)}`,
      enabled,
    );
    if (refused !== null) {
      toast.error(refused || t('changeFailed'));
      return;
    }
    toast.success(t(enabled ? 'turnedOn' : 'turnedOff', { name: skill.name }));
    load();
  }

  async function toggleOwn(skill: WorkspaceSkillView, enabled: boolean) {
    const refused = await patchEnabled(`/api/chat/skills/${skill.id}`, enabled);
    if (refused !== null) {
      toast.error(refused || t('changeFailed'));
      return;
    }
    toast.success(t(enabled ? 'turnedOn' : 'turnedOff', { name: skill.name }));
    load();
  }

  const library = useMemo(
    () =>
      list && list !== 'failed'
        ? list.library.filter(
            (skill) =>
              matches(query, skill) && (filter === 'all' || skill.filters.includes(filter)),
          )
        : [],
    [list, query, filter],
  );
  const mine = useMemo(
    () => (list && list !== 'failed' ? list.skills.filter((skill) => matches(query, skill)) : []),
    [list, query],
  );

  return (
    <div className="max-w-[1100px]" data-slot="chat-skills">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dashboard/agents"
            data-action="skills.openAgents"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {t('agents')}
          </Link>
          {/* New skill (W3-09): an upload or a GitHub link, for an Admin's review. */}
          {list && list !== 'failed' && list.can.save && (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-action="skills.newSkill"
                className={cn(buttonVariants(), 'gap-1')}
              >
                {t('newSkill')}
                <ChevronDown aria-hidden className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  data-action="skills.upload"
                  onClick={() => setImporting('upload')}
                >
                  {t('upload')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="skills.github"
                  onClick={() => setImporting('github')}
                >
                  {t('github')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {list === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-[14px]" />
          ))}
        </div>
      ) : list === 'failed' ? (
        <div className="rounded-[14px] border bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">{t('loadFailed')}</p>
          <Button
            variant="outline"
            className="mt-3"
            data-action="skills.retry"
            onClick={() => {
              setList(null);
              load();
            }}
          >
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label={t('title')} className="mb-3 flex gap-1 border-b">
            {(['getcito', 'mine'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                data-action="skills.tab"
                data-tab={key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === key
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tabs.${key}`)}{' '}
                <span className="text-muted-foreground tabular-nums">
                  {key === 'getcito' ? list.library.length : list.skills.length}
                </span>
              </button>
            ))}
            {tab === 'mine' && list.limit.max !== null && (
              <span className="ml-auto self-center text-xs text-muted-foreground tabular-nums">
                {t('limit', { used: list.limit.used, max: list.limit.max })}
              </span>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-[260px]">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                data-action="skills.search"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            {tab === 'getcito' &&
              (['all', ...SKILL_FILTERS] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  data-action="skills.filter"
                  data-filter={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'h-8 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    filter === key
                      ? 'border-foreground bg-foreground text-background'
                      : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`filters.${key}`)}
                </button>
              ))}
          </div>

          {tab === 'getcito' ? (
            library.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {library.map((skill) => (
                  <LibraryCard
                    key={skill.name}
                    skill={skill}
                    kinds={kinds}
                    canToggle={list.can.manageLibrary}
                    starting={starting === skill.name}
                    onRun={() => void run(skill.name)}
                    onSchedule={() => schedule(skill.name)}
                    onToggle={(enabled) => void toggleLibrary(skill, enabled)}
                    onOpen={() => setOpen(skill)}
                  />
                ))}
              </div>
            )
          ) : mine.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {list.skills.length === 0 ? t('mineEmpty') : t('empty')}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {mine.map((skill) => (
                <OwnCard
                  key={skill.id}
                  skill={skill}
                  canReview={skill.mine || list.can.manageLibrary}
                  starting={starting === skill.name}
                  onRun={() => void run(skill.name)}
                  onSchedule={() => schedule(skill.name)}
                  onToggle={(enabled) => void toggleOwn(skill, enabled)}
                  onOpen={() => setOpen(skill)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {importing && (
        <ImportSkillDialog
          mode={importing}
          onClose={() => setImporting(null)}
          // Kept for review: its review opens, where an Admin decides.
          onImported={(skill) => {
            setImporting(null);
            router.push(`/dashboard/chat/skills/${skill.id}`);
          }}
        />
      )}
      {open && (
        <SkillDetails
          skill={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** A card's head: the skill's mark, its /command and a badge. */
function CardHead({ name, badge }: { name: string; badge?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <Bot className="size-3.5" />
      </span>
      <code className="truncate text-[12.5px] font-semibold">/{name}</code>
      {badge}
    </div>
  );
}

const BADGE = 'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium';

/** The card's title: it opens the skill's details. */
function CardTitle({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-action="skills.details"
      onClick={onOpen}
      className="text-left text-[14px] font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {title}
    </button>
  );
}

function LibraryCard({
  skill,
  kinds,
  canToggle,
  starting,
  onRun,
  onSchedule,
  onToggle,
  onOpen,
}: {
  skill: LibrarySkillView;
  /** The brand's connections; null while they're read, or with no brand open. */
  kinds: Set<string> | null;
  canToggle: boolean;
  starting: boolean;
  onRun: () => void;
  onSchedule: () => void;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const t = useTranslations('chatSkills.page');
  const tNames = useTranslations('chatAgents.connections.names');
  const uses = skillOf(skill.name)?.uses ?? [];
  // A Required connection the brand lacks: Connect stands in for Run and Schedule (mockup).
  const missing = kinds
    ? uses.find((use) => use.required && !kinds.has(connectionKindOf(use.key) ?? use.key))
    : undefined;
  return (
    <div
      className={cn(CARD, !skill.enabled && 'opacity-70')}
      data-slot="skill-card"
      data-skill={skill.name}
    >
      <CardHead
        name={skill.name}
        badge={
          !skill.enabled && (
            <span className={cn(BADGE, 'bg-muted text-muted-foreground')}>{t('badges.off')}</span>
          )
        }
      />
      <CardTitle title={skill.title} onOpen={onOpen} />
      <p className="line-clamp-3 text-[13px] text-muted-foreground">{skill.description}</p>
      {uses.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-slot="skill-connections">
          {uses.map((use) => {
            const on = kinds?.has(connectionKindOf(use.key) ?? use.key);
            const name = tNames.has(use.key) ? tNames(use.key) : use.key;
            return (
              <span
                key={use.key}
                data-connected={on === undefined ? undefined : on}
                className={cn(CHIP, on === false && 'text-muted-foreground')}
              >
                <i
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    on ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-muted-foreground/50',
                  )}
                />
                {on === false ? t('notConnected', { name }) : name}
              </span>
            );
          })}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {missing ? (
          <Link
            href={INTEGRATIONS_HREF}
            data-action="skills.connect"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {t('connect', {
              name: tNames.has(missing.key) ? tNames(missing.key) : missing.key,
            })}
          </Link>
        ) : (
          skill.enabled && (
            <>
              <Button size="sm" data-action="skills.run" disabled={starting} onClick={onRun}>
                {starting ? t('starting') : t('run')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-action="skills.schedule"
                onClick={onSchedule}
              >
                {t('schedule')}
              </Button>
            </>
          )
        )}
        <Link
          href={`/dashboard/agents/new?skill=${encodeURIComponent(skill.name)}`}
          data-action="skills.createAgent"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          {t('createAgent')}
        </Link>
        {canToggle && (
          <span className="ml-auto">
            <FormSwitch
              checked={skill.enabled}
              label={t('toggle', { name: skill.name })}
              action="skills.toggle"
              onChange={onToggle}
            />
          </span>
        )}
      </div>
    </div>
  );
}

function OwnCard({
  skill,
  canReview,
  starting,
  onRun,
  onSchedule,
  onToggle,
  onOpen,
}: {
  skill: WorkspaceSkillView;
  /** An Admin, or its creator: an import's review opens from its card. */
  canReview: boolean;
  starting: boolean;
  onRun: () => void;
  onSchedule: () => void;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const t = useTranslations('chatSkills.page');
  const usable = skill.status === 'approved' && skill.enabled;
  const badge =
    skill.status !== 'approved' ? (
      <span
        className={cn(
          BADGE,
          skill.status === 'pending_review'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
        )}
      >
        {t(`badges.${skill.status}`)}
      </span>
    ) : !skill.enabled ? (
      <span className={cn(BADGE, 'bg-muted text-muted-foreground')}>{t('badges.off')}</span>
    ) : (
      <span className={cn(BADGE, 'bg-muted text-foreground/80')}>
        {t(`badges.${skill.visibility}`)}
      </span>
    );
  return (
    <div
      className={cn(CARD, !usable && 'opacity-80')}
      data-slot="skill-card"
      data-skill={skill.name}
    >
      <CardHead name={skill.name} badge={badge} />
      <CardTitle title={skill.title} onOpen={onOpen} />
      <p className="line-clamp-3 text-[13px] text-muted-foreground">{skill.description}</p>
      <p className="text-[11.5px] text-muted-foreground">{sourceLine(t, skill)}</p>
      {/* The weekly check found a new SKILL.md at its source (W4-31). */}
      {skill.updateAvailable && (
        <p className="flex items-center gap-1.5 text-[11.5px]" data-slot="update-available">
          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
            {t('updateAvailable')}
          </span>
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {usable && (
          <>
            <Button size="sm" data-action="skills.run" disabled={starting} onClick={onRun}>
              {starting ? t('starting') : t('run')}
            </Button>
            <Button size="sm" variant="outline" data-action="skills.schedule" onClick={onSchedule}>
              {t('schedule')}
            </Button>
          </>
        )}
        {/* An import's review: the cleaned file, the scan and its source (W3-09). */}
        {skill.source === 'import' && skill.status !== 'approved' && canReview && (
          <Link
            href={`/dashboard/chat/skills/${skill.id}`}
            data-action="skills.review"
            className={cn(
              buttonVariants({
                variant: skill.status === 'pending_review' ? 'default' : 'outline',
                size: 'sm',
              }),
            )}
          >
            {t('review')}
          </Link>
        )}
        {skill.updateAvailable && canReview && (
          <Link
            href={`/dashboard/chat/skills/${skill.id}/update`}
            data-action="skills.reviewUpdate"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {t('reviewUpdate')}
          </Link>
        )}
        {skill.can.toggle && skill.status === 'approved' && (
          <span className="ml-auto">
            <FormSwitch
              checked={skill.enabled}
              label={t('toggle', { name: skill.name })}
              action="skills.toggle"
              onChange={onToggle}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** Where a workspace skill came from, in words. */
function sourceLine(t: T, skill: WorkspaceSkillView): string {
  if (skill.source === 'import') {
    const repo = skill.sourceUrl ? repoOf(skill.sourceUrl) : null;
    return repo ? t('source.repo', { repo }) : t('source.upload');
  }
  return skill.mine ? t('source.you') : t('source.workspace');
}

/** "owner/repo" of a GitHub address, or null. */
function repoOf(url: string): string | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * A skill's details: what it does, where it came from, its license and
 * review notes; for a workspace skill, Share (an Admin) or Ask an Admin
 * to share (a Manager), and Delete (an Admin or its creator).
 */
function SkillDetails({
  skill,
  onClose,
  onChanged,
}: {
  skill: WorkspaceSkillView | LibrarySkillView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('chatSkills.page');
  const own = 'id' in skill ? skill : null;
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function share() {
    if (!own) return;
    setBusy(true);
    const res = await fetch(`/api/chat/skills/${own.id}/share`, { method: 'POST' }).catch(
      () => null,
    );
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      shared?: boolean;
      requested?: boolean;
      error?: string;
    } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok) {
      toast.error(body?.error ?? t('changeFailed'));
      return;
    }
    toast.success(body.requested ? t('details.requested') : t('details.shared'));
    onChanged();
  }

  async function remove() {
    if (!own) return;
    setBusy(true);
    const res = await fetch(`/api/chat/skills/${own.id}`, { method: 'DELETE' }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) {
      toast.error(body?.error ?? t('changeFailed'));
      return;
    }
    toast.success(t('details.deleted', { name: own.name }));
    onChanged();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg" data-slot="skill-details">
        <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
          {skill.title} <code className="text-[13px] text-muted-foreground">/{skill.name}</code>
        </DialogTitle>
        <DialogDescription>{skill.description}</DialogDescription>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">{t('details.source')}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {own ? sourceLine(t, own) : t('source.library')}
          </dd>
          {own?.license && (
            <>
              <dt className="text-muted-foreground">{t('details.license')}</dt>
              <dd>{own.license}</dd>
            </>
          )}
          {own && (
            <>
              <dt className="text-muted-foreground">{t('details.status')}</dt>
              <dd>
                {t(`badges.${own.status}`)}
                {own.status === 'approved' && ` · ${t(`badges.${own.visibility}`)}`}
              </dd>
            </>
          )}
        </dl>
        {own && own.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[12.5px] dark:border-amber-900 dark:bg-amber-950/30">
            <p className="font-medium">{t('details.warnings')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {own.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {deleting && own && (
          <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">
            {t('details.deleteConfirm', { name: own.name })}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" data-action="skills.closeDetails" onClick={onClose}>
            {t('details.close')}
          </Button>
          {own?.can.share && own.visibility === 'private' && own.status === 'approved' && (
            <Button
              variant="outline"
              data-action="skills.share"
              disabled={busy}
              onClick={() => void share()}
            >
              {own.can.share === 'share' ? t('details.share') : t('details.askShare')}
            </Button>
          )}
          {own?.can.remove &&
            (deleting ? (
              <Button
                data-action="skills.confirmDelete"
                disabled={busy}
                onClick={() => void remove()}
                className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
              >
                {t('details.delete')}
              </Button>
            ) : (
              <Button
                variant="outline"
                data-action="skills.delete"
                className="text-red-700 dark:text-red-400"
                onClick={() => setDeleting(true)}
              >
                {t('details.delete')}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
