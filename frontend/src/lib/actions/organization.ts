'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { insertOrganization } from '@/lib/organizationInsert';
import { assertWritable } from '@/lib/subscriptionGuard';

// ---------------------------------------------------------------------------
// Shared helpers (mirrors the pattern in team.ts)
// ---------------------------------------------------------------------------

async function getCurrentUserAndOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) throw new Error('No organization');

  return { user, profile: profile as { id: string; role: string; organization_id: string } };
}

async function requireAdmin() {
  const { user, profile } = await getCurrentUserAndOrg();
  if (profile.role !== 'admin') {
    throw new Error('Only admins can manage organization settings');
  }
  return { user, profile };
}

// ---------------------------------------------------------------------------
// updateOrganizationName
// ---------------------------------------------------------------------------

/**
 * Rename the current user's organization.
 *
 * Rules (per issue #753):
 * - Admin-only (requireAdmin belt-and-braces on top of RLS).
 * - Trims whitespace, rejects empty, caps at 100 chars.
 * - Leaves `slug` untouched — renaming the display name should not break
 *   any existing deep-links or external references that use the slug.
 */
export async function updateOrganizationName(name: string): Promise<void> {
  await assertWritable();
  const { profile } = await requireAdmin();

  const trimmed = name.trim();
  if (!trimmed) throw new Error('Organization name cannot be empty');
  if (trimmed.length > 100) throw new Error('Organization name must be 100 characters or fewer');

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ name: trimmed })
    .eq('id', profile.organization_id);

  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/settings');
}

// ---------------------------------------------------------------------------
// getOrganization — read the current org's name/slug/plan/member count
// ---------------------------------------------------------------------------

export interface OrganizationInfo {
  name: string;
  slug: string;
  memberCount: number;
  plan: string;
}

export async function getOrganization(): Promise<OrganizationInfo> {
  const { profile } = await getCurrentUserAndOrg();

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('name, slug, plan')
    .eq('id', profile.organization_id)
    .single();

  if (error || !org) throw new Error(error?.message ?? 'Organization not found');

  const { count } = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id);

  return {
    name: org.name as string,
    slug: org.slug as string,
    plan: (org.plan as string) ?? 'starter',
    memberCount: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// updateAccountName — write profiles.full_name + sync auth user_metadata
// ---------------------------------------------------------------------------

/**
 * Save the signed-in user's display name.
 *
 * Writes to two places so every consumer sees a consistent value:
 * 1. `profiles.full_name` — the column all app queries read.
 * 2. `auth.users.user_metadata.full_name` — so the Supabase JWT and
 *    client-side `supabase.auth.getUser()` stay in sync without a
 *    separate reload of the profile row.
 *
 * Open while the workspace is read-only: the person's own profile.
 */
export async function updateAccountName(name: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const trimmed = name.trim();
  if (!trimmed) throw new Error('Display name cannot be empty');

  // 1. Update the profiles row (the authoritative source for app queries).
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', user.id);

  if (profileError) throw new Error(profileError.message);

  // 2. Sync auth metadata so supabase.auth.getUser() reflects the new name
  //    immediately (avoids a stale value until the next session refresh).
  await supabase.auth.updateUser({ data: { full_name: trimmed } });

  revalidatePath('/dashboard/settings');
}

export async function createOrganization(name: string) {
  await assertWritable({ onboarding: true });
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user || authError) throw new Error('Unauthorized');

  const orgId = await insertOrganization(supabase, name);

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ organization_id: orgId })
    .eq('id', user.id);

  if (profileError) throw new Error(profileError.message);

  // A member now: the organization reads back with the person's session.
  const { data: org, error } = await supabase
    .from('organizations')
    .select()
    .eq('id', orgId)
    .single();

  if (error || !org) throw new Error(error?.message ?? 'Failed to create organization');

  revalidatePath('/dashboard');
  return org;
}

export async function getMyProfile() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organizations!profiles_organization_id_fkey(*)')
    .eq('id', user.id)
    .single();

  return profile;
}
