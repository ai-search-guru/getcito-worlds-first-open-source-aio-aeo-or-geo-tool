import { notFound } from 'next/navigation';
import { ChatAllChats } from '@/components/chat/ChatAllChats';
import { initialsOf } from '@/lib/chat/conversations';
import { createClient } from '@/lib/supabase/server';
import { chatPageOpen } from '../_chatPageAccess';

/**
 * All chats (mockup #s-allchats; CHAT-01 agentic update): every chat the
 * person sees under Active and Archived (`?tab=archived`), with search,
 * filters and Archive selected. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC).
 */
export default async function AllChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const { tab } = await searchParams;
  return (
    <ChatAllChats
      initialTab={tab === 'archived' ? 'archived' : 'active'}
      ownInitials={await ownInitials()}
    />
  );
}

/** The person's initials for the Owner of their own chats ("AK"); null without a name. */
async function ownInitials(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  return initialsOf(profile?.full_name ?? null);
}
