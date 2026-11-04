import { notFound } from 'next/navigation';
import { ChatSettings } from '@/components/chat/ChatSettings';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  DEFAULT_CHAT_GENERAL,
  readChatGeneral,
  type ChatGeneralAccess,
} from '@/lib/chat/generalSettings';
import { createClient } from '@/lib/supabase/server';
import { chatFocusState } from '../_chatPageAccess';

/** What a person whose settings can't be read may pick: nothing that changes things. */
const CAREFUL_ACCESS: ChatGeneralAccess = { modes: false, fullAutoLock: 'plan', slack: false };

/**
 * Chat's Settings › General (mockup #s-settings): the person's default
 * mode, their focus (CHAT-24) and Ask Chat on every page. Only with the
 * new Chat on for the workspace (CHAT_AGENTIC). Settings that can't be
 * read open as the defaults, with nothing locked opened.
 */
export default async function ChatSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id ?? null;
  if (!organizationId || !chatAgenticEnabled(organizationId)) notFound();
  const [general, focus] = await Promise.all([
    readChatGeneral({ userId: user.id, organizationId }).catch((error) => {
      console.error('[chat/settings] could not read the settings:', error);
      return null;
    }),
    chatFocusState(),
  ]);
  return (
    <ChatSettings
      initial={general?.settings ?? DEFAULT_CHAT_GENERAL}
      access={general?.access ?? CAREFUL_ACCESS}
      focus={focus.focus ?? []}
    />
  );
}
