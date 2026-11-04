import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { CHAT_TOOLS } from '@/lib/chat/registry/tools';
import { ActivityLogView } from '@/components/chat-access/ActivityLogView';

/**
 * The Activity log (CHAT-20 §10a; mockup #g-activity): every change Chat
 * made, every Undo and every denial, with Undo while it is open, and CSV
 * for Admins. Only with the new Chat on for the workspace.
 */
export default async function ChatActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!chatAgenticEnabled(profile?.organization_id)) notFound();
  // The areas the registry's changes belong to, in its order, for the Area filter.
  const areas = [
    ...new Set(CHAT_TOOLS.filter((tool) => tool.class !== 'read').map((tool) => tool.area)),
  ];
  return <ActivityLogView areas={areas} />;
}
