import { MANAGER_ROLES } from '@/lib/mcp/roleGate';
import type { createClient } from '@/lib/supabase/server';

/**
 * Whether the signed-in member is an Admin or a Manager (MANAGER_ROLES), as
 * deleteTopic checks before it changes anything: the server actions Chat's
 * setup writes call (prompts, topics, competitors) refuse anyone else
 * themselves, whatever a table's policy lets through. Server only.
 */
export async function isManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return MANAGER_ROLES.some((role) => role === data?.role);
}
