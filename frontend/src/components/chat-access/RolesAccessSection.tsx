'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowUpRight, Check, Info, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { TeamRole } from '@/components/context/RoleProvider';
import { PLANS } from '@/config/plans';
import { updateMemberRole } from '@/lib/actions/team';
import {
  getChatAccess,
  listRoleMembers,
  type ChatAccess,
  type MemberBrands,
  type RoleMember,
} from '@/lib/actions/chatAccess';
import { ROLE_MATRIX, ROLE_ORDER, type RoleCell } from '@/lib/chat/access';
import { cn } from '@/lib/utils';
import { ClassBadge } from './ClassBadge';
import { YourPlanCard } from './PlanCard';
import { AskAdminButton } from './AskAdminButton';
import { RequestsSection } from './RequestsSection';
import { CAPABILITIES_PATH } from './YourAccessCard';

/**
 * Settings › Team › Roles & access (CHAT-20 §4a, mockup #g-roles): every
 * member's role, what each role may do in the app and through Chat, and
 * the Admin switches that change a role's rights. Everyone reads it; only
 * Admins change a role here (the rest of the team's management stays in
 * Team).
 */
export function RolesAccessSection({
  onRequestsChanged,
}: {
  /** A request was decided or sent: Settings' count reads again. */
  onRequestsChanged?: () => void;
} = {}) {
  const t = useTranslations('chatAccess');
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [access, setAccess] = useState<ChatAccess | null | 'failed' | undefined>(undefined);
  const [members, setMembers] = useState<RoleMember[]>([]);

  // Bumped after a role change, to read the members and access again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([getChatAccess(), listRoleMembers()])
      .then(([accessRead, membersRead]) => {
        if (!live) return;
        if (!accessRead.ok || !membersRead.ok) {
          setAccess('failed');
          return;
        }
        setAccess(accessRead.access);
        setMembers(membersRead.members);
      })
      .catch(() => {
        if (live) setAccess('failed');
      });
    return () => {
      live = false;
    };
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  if (access === undefined) return <Skeleton className="h-96 w-full" />;
  if (access === 'failed' || access === null) {
    return (
      <div role="status" className="space-y-2 text-sm text-muted-foreground">
        <p>{t('roles.loadError')}</p>
        <Button size="sm" variant="outline" onClick={reload}>
          {t('roles.retry')}
        </Button>
      </div>
    );
  }

  const isAdmin = access.role === 'admin';
  return (
    <div className="space-y-6">
      {access.plan && <YourPlanCard plan={access.plan} isAdmin={isAdmin} />}

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('roles.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('roles.lead')}</p>
        <Link
          href={CAPABILITIES_PATH}
          className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          {t('yourAccess.seeCapabilities')}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {!isAdmin && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t('roles.readOnly', { role: access.role })}</span>
          <span className="text-muted-foreground">{t('roles.readOnlyNote')}</span>
          <span className="ml-auto">
            <AskAdminButton
              asked={t('askAdmin.defaults.role')}
              ruleKind="role"
              ruleDetail={t('askAdmin.roleDetail', { role: t(`roleNames.${access.role}`) })}
              onSent={() => setRequestsVersion((n) => n + 1)}
            />
          </span>
        </div>
      )}

      <RequestsSection version={requestsVersion} onChanged={onRequestsChanged} />

      <MembersTable members={members} isAdmin={isAdmin} onChanged={reload} />
      <RoleMatrix role={access.role} />
      <AdminSwitches access={access} />
    </div>
  );
}

function MembersTable({
  members,
  isAdmin,
  onChanged,
}: {
  members: RoleMember[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('chatAccess');
  const format = useFormatter();
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t('roles.members')}</h3>
        <Badge variant="secondary" className="tabular-nums">
          {members.length}
        </Badge>
        {isAdmin && (
          <Link
            href="/dashboard/settings/team"
            className="ml-auto text-xs font-medium underline-offset-2 hover:underline"
          >
            {t('roles.manageInTeam')}
          </Link>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('roles.columns.member')}</TableHead>
              <TableHead>{t('roles.columns.role')}</TableHead>
              <TableHead>{t('roles.columns.brands')}</TableHead>
              <TableHead>{t('roles.columns.throughChat')}</TableHead>
              <TableHead>{t('roles.columns.lastActive')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell>
                  <span className="font-medium">{member.name}</span>
                  {member.isYou && (
                    <Badge variant="secondary" className="ml-1.5 text-[10px]">
                      {t('roles.you')}
                    </Badge>
                  )}
                  {member.email && (
                    <span className="block text-xs text-muted-foreground">{member.email}</span>
                  )}
                </TableCell>
                <TableCell>
                  {isAdmin && !member.isYou ? (
                    <RoleSelect member={member} onChanged={onChanged} />
                  ) : (
                    t(`roleNames.${member.role}`)
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <MemberBrandsCell brands={member.brands} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t(`roles.throughChat.${member.role}`)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {member.lastActiveAt
                    ? format.relativeTime(new Date(member.lastActiveAt))
                    : t('roles.neverSignedIn')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * A member's brands (BRAND-ACCESS §3.2): All brands, or how many, with
 * their names when the viewer may see them (an admin, or the person).
 */
export function MemberBrandsCell({ brands }: { brands: MemberBrands }) {
  const t = useTranslations('chatAccess');
  if (brands.scope === 'all') return <>{t('roles.allBrands')}</>;
  if (!brands.names) return <>{t('roles.selectedBrands')}</>;
  return (
    <span title={brands.names.join(', ')}>
      {t('roles.brandCount', { count: brands.names.length })}
      <span className="block max-w-48 truncate text-xs">{brands.names.join(', ')}</span>
    </span>
  );
}

function RoleSelect({ member, onChanged }: { member: RoleMember; onChanged: () => void }) {
  const t = useTranslations('chatAccess');
  const tActions = useTranslations('readOnly.actions');
  // A read-only workspace opens the upgrade dialog instead, as Team does.
  const { guard } = useUpgradeGate();
  const [pending, setPending] = useState(false);
  const items = ROLE_ORDER.map((role) => ({ value: role, label: t(`roleNames.${role}`) }));

  async function change(role: TeamRole) {
    if (role === member.role) return;
    setPending(true);
    try {
      await updateMemberRole(member.userId, role);
      toast.success(t('roles.roleChanged'));
      onChanged();
    } catch {
      toast.error(t('roles.roleChangeFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Select
      items={items}
      value={member.role}
      onValueChange={guard((v: string | null) => void change(v as TeamRole), {
        action: tActions('changeRoles'),
      })}
      disabled={pending}
    >
      <SelectTrigger size="sm" className="w-36" aria-label={t('roles.columns.role')}>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Cell({ cell }: { cell: RoleCell }) {
  const t = useTranslations('chatAccess.roles.matrix.cells');
  if (cell === 'yes') {
    return (
      <>
        <Check className="mx-auto h-4 w-4" aria-hidden />
        <span className="sr-only">{t('yes')}</span>
      </>
    );
  }
  if (cell === 'no') {
    return (
      <>
        <span aria-hidden className="text-muted-foreground">
          –
        </span>
        <span className="sr-only">{t('no')}</span>
      </>
    );
  }
  return <span className="text-xs text-muted-foreground">{t(cell)}</span>;
}

function RoleMatrix({ role }: { role: TeamRole }) {
  const t = useTranslations('chatAccess');
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('roles.matrix.title')}</h3>
        <span className="text-xs text-muted-foreground">{t('roles.matrix.count')}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {(['read', 'write', 'execute', 'never'] as const).map((cls) => (
            <ClassBadge key={cls} cls={cls} />
          ))}
          <Badge variant="outline" className="text-[11px]">
            {t('roles.matrix.actsAsUser')}
          </Badge>
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('roles.matrix.capability')}</TableHead>
              {ROLE_ORDER.map((r) => (
                <TableHead key={r} className={cn('w-28 text-center', r === role && 'bg-muted/60')}>
                  {t(`roleNames.${r}`)}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {r === role ? t('roles.you') : r === 'admin' ? t('roles.matrix.adminNote') : ''}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROLE_MATRIX.map((group) => [
              <TableRow key={group.key} className="hover:bg-transparent">
                <TableCell
                  colSpan={1 + ROLE_ORDER.length}
                  className="bg-muted/30 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {t(`roles.matrix.groups.${group.key}`)}
                </TableCell>
              </TableRow>,
              ...group.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-normal">
                    <span className="flex items-start gap-2">
                      <ClassBadge cls={row.class} className="mt-0.5 w-16" />
                      <span>
                        {t(`roles.matrix.rows.${row.key}.name`)}
                        <span className="block text-xs text-muted-foreground">
                          {t(`roles.matrix.rows.${row.key}.scope`)}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  {ROLE_ORDER.map((r) => (
                    <TableCell key={r} className={cn('text-center', r === role && 'bg-muted/60')}>
                      <Cell cell={row.cells[r]} />
                    </TableCell>
                  ))}
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function AdminSwitches({ access }: { access: ChatAccess }) {
  const t = useTranslations('chatAccess.roles.switches');
  const { managerExecuteOff, fullAutoForMembers, fullAutoLocked, setBy } = access.switches;
  const execute =
    managerExecuteOff.length === 0
      ? t('on')
      : managerExecuteOff.length >= 4
        ? t('off')
        : t('offFor', { groups: managerExecuteOff.map((g) => t(`groups.${g}`)).join(', ') });
  const fullAuto = fullAutoLocked
    ? t('needsPlan', { plan: PLANS[fullAutoLocked].name })
    : fullAutoForMembers
      ? t('on')
      : t('off');
  const rows = [
    {
      key: 'managerExecute',
      name: t('managerExecute'),
      note: t('managerExecuteNote'),
      value: execute,
    },
    { key: 'fullAuto', name: t('fullAuto'), note: t('fullAutoNote'), value: fullAuto },
  ];
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {t('onlyAdmins')}
        </span>
      </div>
      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{row.name}</span>
              <span className="block text-xs text-muted-foreground">{row.note}</span>
            </span>
            <span className="shrink-0 text-right text-xs font-medium">
              {row.value}
              {setBy && (
                <span className="block font-normal text-muted-foreground">
                  {t('setBy', { name: setBy })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
