import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberEmails } from '@/lib/memberEmails';
import type { ActionAssignee } from '@/lib/actions/actionCenter';

/**
 * Who a brand's actions are assigned to: name, avatar and e-mail.
 *
 * A profile is readable only by its owner (RLS "profiles: own row select"),
 * so read with the signed-in user's client every other member's action came
 * back unassigned, and a member with no name — most have none — showed as
 * "?". As the team list does: the brand is checked to be the user's with
 * `client`, then only the profiles in its organization are read with the
 * admin client, so an id from anywhere else names no one.
 */
export async function readAssignees(
  client: SupabaseClient,
  brandId: string,
  assigneeIds: string[],
): Promise<Map<string, ActionAssignee>> {
  const ids = [...new Set(assigneeIds)];
  if (ids.length === 0) return new Map();

  const [brandRes, profilesRes] = await Promise.all([
    client.from('brands').select('organization_id').eq('id', brandId).maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id, full_name, avatar_url, organization_id')
      .in('id', ids),
  ]);
  if (brandRes.error) throw new Error(brandRes.error.message);
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const organizationId = brandRes.data?.organization_id;
  if (!organizationId) return new Map();

  const members = (profilesRes.data ?? []).filter(
    (profile) => profile.organization_id === organizationId,
  );
  const emails = await readMemberEmails(members.map((profile) => profile.id as string));
  return new Map(
    members.map((profile) => [
      profile.id as string,
      {
        id: profile.id as string,
        fullName: (profile.full_name as string | null) ?? null,
        avatarUrl: (profile.avatar_url as string | null) ?? null,
        email: emails.get(profile.id as string) ?? null,
      },
    ]),
  );
}
