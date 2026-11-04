import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';

/**
 * The onboarding wizard, with whether the new Chat is on for the workspace
 * (CHAT_AGENTIC), read on the server as the welcome page reads it: its
 * "What do you work on?" step shows Agent Center only where the menu will.
 * Before the workspace exists it is on only where the flag is on for every
 * workspace (no CHAT_AGENTIC_ORGS).
 */
export default async function OnboardingWizardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle()
    : { data: null };
  return (
    <ChatAgenticProvider enabled={chatAgenticEnabled(profile?.organization_id ?? null)}>
      {children}
    </ChatAgenticProvider>
  );
}
