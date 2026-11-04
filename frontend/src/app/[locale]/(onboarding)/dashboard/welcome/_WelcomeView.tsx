'use client';

import { useTranslations } from 'next-intl';
import { WorkAreasStep } from '@/components/onboarding/WorkAreasStep';
import { DASHBOARD_HOME } from '@/config/home';
import type { TeamRole } from '@/components/context/RoleProvider';

/**
 * The welcome step's copy: an invited person is welcomed to the workspace by
 * name; an admin is asked what they work on.
 */
export function WelcomeView({
  role,
  workspace,
  firstName,
  hiddenByAdmin,
}: {
  role: TeamRole;
  workspace: string;
  firstName: string;
  hiddenByAdmin: string[];
}) {
  const t = useTranslations('welcome');
  const tSettings = useTranslations('settings');
  const invited = role !== 'admin';
  const title = !invited
    ? t('title')
    : firstName
      ? t('invitedTitle', { workspace, name: firstName })
      : t('invitedTitleNoName', { workspace });
  const lede = invited
    ? t('invitedLede', { role: tSettings(`team_role_${role}`).toLowerCase() })
    : t('lede');

  return (
    <WorkAreasStep
      title={title}
      lede={lede}
      hiddenByAdmin={hiddenByAdmin}
      // A full load, so the dashboard reads the answer and doesn't send them back.
      onDone={() => window.location.assign(DASHBOARD_HOME)}
    />
  );
}
