'use client';

import { useSearchParams } from 'next/navigation';
import { usePlanContext } from '@/components/context/PlanProvider';
import { SettingsView } from './_SettingsView';
import { resolveSettingsSection } from './_sections';

/**
 * /dashboard/settings, on Account or on the section an older ?tab= names: the
 * Daily Pulse e-mail links ?tab=notifications, the integrations' OAuth popups
 * return to ?tab=integrations, and ?tab=agent is AI Providers now.
 */
export default function SettingsPage() {
  const { isCloud } = usePlanContext();
  const tab = useSearchParams().get('tab');
  return <SettingsView section={resolveSettingsSection(tab, { isCloud })} />;
}
