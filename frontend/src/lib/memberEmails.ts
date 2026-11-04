import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Members' e-mails, which live in auth rather than on their profiles. The
 * one identifier every member has, and what the team list and the assignee
 * pickers show when a profile has no name (most have none). Read in parallel:
 * one admin call per member, which one after another made a team of ten take
 * as long as ten calls. Server only — callers check the ids are members of
 * the caller's organization first.
 */
export async function readMemberEmails(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  for (const [id, auth] of await readMemberAuth(userIds)) {
    if (auth.email) emails.set(id, auth.email);
  }
  return emails;
}

/**
 * Members' e-mails and when they last signed in, from the same admin call:
 * what Settings › Team › Roles & access lists (CHAT-20 §4a). Server only, as
 * above.
 */
export async function readMemberAuth(
  userIds: string[],
): Promise<Map<string, { email: string | null; lastSignInAt: string | null }>> {
  const out = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (!data?.user) return;
      out.set(id, {
        email: data.user.email ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      });
    }),
  );
  return out;
}
