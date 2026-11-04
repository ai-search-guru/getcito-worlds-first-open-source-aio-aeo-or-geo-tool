'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getChatAccess, type ChatAccess } from '@/lib/actions/chatAccess';
import type { YourAccessRow } from '@/lib/chat/access';
import { ClassBadge } from './ClassBadge';
import { AskAdminButton } from './AskAdminButton';

export const ROLES_ACCESS_PATH = '/dashboard/settings/roles-access';
export const CAPABILITIES_PATH = '/dashboard/chat/capabilities';

/**
 * Settings › Account › Your access (CHAT-20 §4b, mockup #g-my-access): the
 * person's role, their brands, what Chat may do as them, and the way to
 * every role's card.
 */
export function YourAccessCard({ access }: { access: ChatAccess }) {
  const t = useTranslations('chatAccess');
  const value = (row: YourAccessRow) =>
    row.value === 'after_click_except'
      ? t('yourAccess.values.after_click_except', {
          groups: (row.off ?? []).map((g) => t(`roles.switches.groups.${g}`)).join(', '),
        })
      : t(`yourAccess.values.${row.value}`);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('yourAccess.title')}</CardTitle>
        <Badge variant="secondary">{t(`roleNames.${access.role}`)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">{t('yourAccess.brands')}</span>
          <span>
            {access.brands.scope === 'all' ? (
              t('roles.allBrands')
            ) : (
              <>
                {(access.brands.names ?? []).join(', ') || t('yourAccess.noBrands')}
                <span className="block text-xs text-muted-foreground">
                  {t('yourAccess.selectedNote')}
                </span>
              </>
            )}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t('yourAccess.actsAsYou')}
          </p>
          <ul className="divide-y">
            {access.yourAccess.map((row) => (
              <li key={row.key} className="flex items-center gap-2 py-1.5">
                <ClassBadge cls={row.class} className="w-16" />
                <span className="min-w-0 flex-1">{t(`yourAccess.rows.${row.key}`)}</span>
                <span
                  className={
                    row.value === 'ask_admin' || row.value === 'execute_off'
                      ? 'text-right text-xs text-muted-foreground'
                      : 'text-right text-xs font-medium'
                  }
                >
                  {value(row)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {access.role !== 'admin' && (
            <AskAdminButton
              asked={t('askAdmin.defaults.role')}
              ruleKind="role"
              ruleDetail={t('askAdmin.roleDetail', { role: t(`roleNames.${access.role}`) })}
            />
          )}
          <Link
            href={ROLES_ACCESS_PATH}
            className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t('yourAccess.seeRoles')}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
          <Link
            href={CAPABILITIES_PATH}
            className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t('yourAccess.seeCapabilities')}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** The card, read for the signed-in person; nothing while Chat is off or the read fails. */
export function YourAccessSlot({ className }: { className?: string }) {
  const [access, setAccess] = useState<ChatAccess | null>(null);
  useEffect(() => {
    let live = true;
    getChatAccess()
      .then((read) => {
        if (live && read.ok) setAccess(read.access);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!access) return null;
  return (
    <div className={className}>
      <YourAccessCard access={access} />
    </div>
  );
}
