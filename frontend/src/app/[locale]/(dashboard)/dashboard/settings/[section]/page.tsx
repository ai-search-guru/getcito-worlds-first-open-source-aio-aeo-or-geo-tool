'use client';

import { useParams } from 'next/navigation';
import { usePlanContext } from '@/components/context/PlanProvider';
import { SettingsView } from '../_SettingsView';
import { resolveSettingsSection } from '../_sections';

/** A settings section at its own address: /dashboard/settings/ai-providers. */
export default function SettingsSectionPage() {
  const { isCloud } = usePlanContext();
  const { section } = useParams<{ section: string }>();
  const resolved = resolveSettingsSection(section, { isCloud });
  // Keyed: a link from one section's address to another's opens the new one.
  return <SettingsView key={resolved} section={resolved} />;
}
