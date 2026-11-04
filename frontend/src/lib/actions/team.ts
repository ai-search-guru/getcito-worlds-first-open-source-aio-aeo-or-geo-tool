'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberEmails } from '@/lib/memberEmails';
import { brandReaders, readMemberBrandAccess } from '@/lib/brandAccess';
import { enforceLimit, getOrgPlan } from '@/lib/guards/planGuard';
import { assertWritable } from '@/lib/subscriptionGuard';

export type TeamRole = 'admin' | 'manager' | 'analyst' | 'agency_partner';

/**
 * Which brands a person sees (BRAND-ACCESS D2): All brands, or the brands
 * shared with them (and the demo brand, which is everyone's). Admins always
 * have All brands (D3).
 */
export type BrandScope = 'all' | 'selected';

export interface BrandAccessChoice {
  scope: BrandScope;
  /** The brands shared, for Selected brands; empty for All brands. */
  brandIds: string[];
}

export interface TeamMember {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: TeamRole;
  createdAt: string;
  isCurrentUser: boolean;
  /**
   * The member's brand access. An admin reads everyone's; anyone else their
   * own, and the others' as All brands (which brands an admin shared with
   * someone is the admins' to see).
   */
  brandAccess: BrandAccessChoice;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: TeamRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  /** The brands it shares: admins only (00390); All brands for anyone else. */
  brandAccess: BrandAccessChoice;
}

export interface TeamInfo {
  memberCount: number;
  pendingCount: number;
  seatsUsed: number;
  maxTeamMembers: number;
  canInvite: boolean;
  planName: string;
  /**
   * Whether the plan allows more than one brand: only then is there a brand
   * to choose (BRAND-ACCESS §9 Q1).
   */
  multiBrand: boolean;
}

/** A brand an admin may share, as the brand picker lists it. */
export interface ShareableBrand {
  id: string;
  name: string;
}

const ALL_BRANDS: BrandAccessChoice = { scope: 'all', brandIds: [] };

/** Brand ids a choice may name: a few hundred at most, each a uuid. */
const brandIdsSchema = z.array(z.guid()).max(500);

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

  return {
    user,
    profile: profile as { id: string; role: TeamRole; organization_id: string },
  };
}

async function requireAdmin() {
  const { user, profile } = await getCurrentUserAndOrg();
  if (profile.role !== 'admin') {
    throw new Error('Only admins can manage team members');
  }
  return { user, profile };
}

export async function getTeamInfo(): Promise<TeamInfo> {
  const { profile } = await getCurrentUserAndOrg();

  const [{ count: memberCount }, { count: pendingCount }, plan] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id),
    supabaseAdmin
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending'),
    getOrgPlan(profile.organization_id),
  ]);

  const mc = memberCount ?? 0;
  const pc = pendingCount ?? 0;
  const seatsUsed = mc + pc;
  const max = plan.limits.maxTeamMembers;
  const canInvite = max === -1 || seatsUsed < max;

  return {
    memberCount: mc,
    pendingCount: pc,
    seatsUsed,
    maxTeamMembers: max,
    canInvite,
    planName: plan.name,
    multiBrand: plan.limits.maxBrands !== 1,
  };
}

/**
 * The organization's brands an admin may share with someone, oldest first:
 * not the demo brand, which everyone sees. Admins only.
 */
export async function listShareableBrands(): Promise<ShareableBrand[]> {
  const { profile } = await requireAdmin();
  return readShareableBrands(profile.organization_id);
}

async function readShareableBrands(organizationId: string): Promise<ShareableBrand[]> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_demo', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({ id: b.id as string, name: b.name as string }));
}

/**
 * A brand choice checked against the organization: All brands for an admin
 * (D3), and for Selected brands the organization's brands it names, at least
 * one. Null when there is none left to share.
 */
async function checkedChoice(
  organizationId: string,
  role: TeamRole,
  choice: BrandAccessChoice,
): Promise<BrandAccessChoice | null> {
  if (role === 'admin' || choice.scope !== 'selected') return ALL_BRANDS;
  const ids = brandIdsSchema.safeParse(choice.brandIds);
  if (!ids.success) return null;
  const shareable = new Set((await readShareableBrands(organizationId)).map((b) => b.id));
  const brandIds = [...new Set(ids.data)].filter((id) => shareable.has(id));
  return brandIds.length > 0 ? { scope: 'selected', brandIds } : null;
}

export async function listMembers(): Promise<TeamMember[]> {
  const { user, profile } = await getCurrentUserAndOrg();
  const [members, access] = await Promise.all([
    readMembers(user.id, profile.organization_id),
    readMemberBrandAccess(profile.organization_id),
  ]);
  return members.map((member) => ({
    ...member,
    brandAccess:
      profile.role === 'admin' || member.isCurrentUser
        ? (access.get(member.userId) ?? ALL_BRANDS)
        : ALL_BRANDS,
  }));
}

/**
 * The people an action of the brand may be assigned to, for the assignee
 * pickers (BRAND-ACCESS §3.1): the members who may use the brand, in the
 * team's order. The caller must use it too; a brand they can't reads as not
 * found.
 */
export async function listBrandMembers(brandId: string): Promise<TeamMember[]> {
  const { user, profile } = await getCurrentUserAndOrg();
  const [readers, members] = await Promise.all([
    brandReaders(profile.organization_id, [brandId]),
    readMembers(user.id, profile.organization_id),
  ]);
  if (!readers.has(user.id)) throw new Error('Brand not found');
  return members
    .filter((member) => readers.has(member.userId))
    .map((member) => ({ ...member, brandAccess: ALL_BRANDS }));
}

/** The organization's members, the earliest first, with their e-mails. */
async function readMembers(
  userId: string,
  organizationId: string,
): Promise<Omit<TeamMember, 'brandAccess'>[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const userIds = (data ?? []).map((p) => p.id as string);
  if (userIds.length === 0) return [];

  const emailMap = await readMemberEmails(userIds);

  return (data ?? []).map((p) => ({
    userId: p.id as string,
    email: emailMap.get(p.id as string) ?? '',
    fullName: (p.full_name as string | null) ?? null,
    avatarUrl: (p.avatar_url as string | null) ?? null,
    role: p.role as TeamRole,
    createdAt: p.created_at as string,
    isCurrentUser: p.id === userId,
  }));
}

/**
 * The organization's pending invitations, as everyone in Settings › Team sees
 * them. Only admins read invitations themselves (00390: an invitation names
 * the brands it shares), so the list comes from the server, without the
 * token or the brands.
 */
export async function listInvitations(): Promise<TeamInvitation[]> {
  const { profile } = await getCurrentUserAndOrg();
  const isAdmin = profile.role === 'admin';

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select(
      'id, email, role, status, invited_by, expires_at, created_at, accepted_at, brand_scope, brand_ids',
    )
    .eq('organization_id', profile.organization_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((i) => ({
    id: i.id as string,
    email: i.email as string,
    role: i.role as TeamRole,
    status: i.status as TeamInvitation['status'],
    invitedBy: (i.invited_by as string | null) ?? null,
    expiresAt: i.expires_at as string,
    createdAt: i.created_at as string,
    acceptedAt: (i.accepted_at as string | null) ?? null,
    brandAccess:
      isAdmin && i.brand_scope === 'selected'
        ? { scope: 'selected', brandIds: (i.brand_ids as string[] | null) ?? [] }
        : ALL_BRANDS,
  }));
}

export type InviteMemberResult = { inviteLink: string; emailSent: boolean } | { error: string };

/**
 * User-facing failures (bad email, existing member, duplicate pending invite,
 * insert errors) come back as a VALUE: production masks every error thrown
 * from a server action, so the actionable message (e.g. "A pending invitation
 * already exists for this email") would otherwise reach users as the
 * meaningless digest string (#550).
 */
export async function inviteMember(
  email: string,
  role: TeamRole,
  brands: BrandAccessChoice = ALL_BRANDS,
): Promise<InviteMemberResult> {
  await assertWritable();
  const { user, profile } = await requireAdmin();
  const normalizedEmail = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { error: 'Invalid email address' };
  }

  // The brands it shares, kept by the invitation until it is accepted.
  const access = await checkedChoice(profile.organization_id, role, brands);
  if (!access) return { error: 'Choose at least one brand' };

  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id),
    supabaseAdmin
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending'),
  ]);

  const total = (memberCount ?? 0) + (inviteCount ?? 0);
  await enforceLimit(profile.organization_id, 'maxTeamMembers', total);

  const { data: existingMember } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .limit(1);

  if (existingMember && existingMember.length > 0) {
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const matched = authUsers?.users?.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (matched) {
      const { data: matchedProfile } = await supabaseAdmin
        .from('profiles')
        .select('organization_id')
        .eq('id', matched.id)
        .maybeSingle();
      if (matchedProfile?.organization_id === profile.organization_id) {
        return { error: 'This user is already a member of your team' };
      }
    }
  }

  const token = randomBytes(32).toString('hex');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // The link we surface to the admin (dashboard "share this link directly" +
  // clipboard) is the direct, self-contained accept page. It looks the
  // invitation up by token and routes to sign-up/accept on its own, so it
  // NEVER depends on Supabase's email OTP params.
  //
  // Previously this returned the /auth/confirm base below, which only works
  // once the invite EMAIL template appends token_hash + type. Opened directly
  // (which is exactly what the "share this link" affordance does) it has
  // neither, so /auth/confirm bounced to /sign-in?error=auth_confirm_missing_params.
  // resendInvitation already returned this direct form; inviteMember now matches.
  const shareLink = `${appUrl}/invite/${token}`;

  // What we hand to Supabase as `redirectTo` for the invite EMAIL only. It
  // becomes `{{ .RedirectTo }}` in the Invite User template, which appends
  // token_hash + type; /auth/confirm then verifies the OTP server-side and
  // forwards to /invite/{token}. The prefix is this environment's appUrl, so
  // one template works for both dev and prod.
  const emailRedirectTo = `${appUrl}/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}`;

  const { data: invitation, error: insertError } = await supabaseAdmin
    .from('invitations')
    .insert({
      organization_id: profile.organization_id,
      email: normalizedEmail,
      role,
      token,
      invited_by: user.id,
      brand_scope: access.scope,
      brand_ids: access.brandIds,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return { error: 'A pending invitation already exists for this email' };
    }
    return { error: insertError.message };
  }

  // inviteUserByEmail only emails BRAND-NEW addresses — it errors for an email
  // that's already registered (Supabase can't "create" that user), so existing
  // users never get the Supabase invite mail. Surface whether it actually sent
  // so the UI can be honest ("share this link" vs. "email sent") instead of
  // always claiming an email went out.
  let emailSent = false;
  try {
    await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: emailRedirectTo,
      data: { invitation_token: token },
    });
    emailSent = true;
  } catch (err) {
    // Existing-user or SMTP failure — the invitation row is saved and the admin
    // shares `shareLink` directly. Log the invitation/org id (not the invitee's
    // email — that's PII in persistent logs) plus the error for diagnostics.
    console.warn(
      `[invite] Supabase invite email not sent (invitation=${invitation.id}, org=${profile.organization_id}) — existing user or SMTP`,
      err,
    );
  }

  revalidatePath('/dashboard/settings');
  return { inviteLink: shareLink, emailSent };
}

/** Open while the workspace is read-only: it takes back access, never gives it. */
export async function revokeInvitation(invitationId: string) {
  const { profile } = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

export async function resendInvitation(invitationId: string) {
  await assertWritable();
  const { profile } = await requireAdmin();

  const { data: invitation, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (error || !invitation) throw new Error('Invitation not found');
  if (invitation.status !== 'pending') {
    throw new Error('Only pending invitations can be resent');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const inviteLink = `${appUrl}/invite/${invitation.token}`;

  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('invitations')
    .update({ expires_at: newExpiresAt })
    .eq('id', invitationId);

  try {
    await supabaseAdmin.auth.admin.inviteUserByEmail(invitation.email as string, {
      redirectTo: inviteLink,
      data: { invitation_token: invitation.token },
    });
  } catch {
    // Ignore: link is still valid regardless of email delivery outcome.
  }

  revalidatePath('/dashboard/settings');
  return { inviteLink };
}

export async function updateMemberRole(userId: string, role: TeamRole) {
  await assertWritable();
  const { user, profile } = await requireAdmin();

  if (userId === user.id) {
    throw new Error('You cannot change your own role');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

export type SetMemberBrandsResult = { brandAccess: BrandAccessChoice } | { error: string };

/**
 * An admin's Edit brands (BRAND-ACCESS §3.2, Q2: admins only): All brands,
 * or the organization's brands named (at least one). An admin always has
 * All brands, and so does the caller (admins can't narrow themselves).
 * Written in one transaction (set_member_brand_access, 00471): the person
 * sees the new brands from their next page.
 */
export async function setMemberBrands(
  userId: string,
  brands: BrandAccessChoice,
): Promise<SetMemberBrandsResult> {
  await assertWritable();
  const { user, profile } = await requireAdmin();
  if (userId === user.id) return { error: 'Admins always have All brands' };

  const { data: member, error: memberError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) return { error: 'Member not found' };
  if (member.role === 'admin') return { error: 'Admins always have All brands' };

  const access = await checkedChoice(profile.organization_id, member.role as TeamRole, brands);
  if (!access) return { error: 'Choose at least one brand' };

  const { data, error } = await supabaseAdmin.rpc('set_member_brand_access', {
    p_organization_id: profile.organization_id,
    p_user_id: userId,
    p_brand_scope: access.scope,
    p_brand_ids: access.brandIds,
    p_granted_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath('/dashboard/settings');
  return {
    brandAccess:
      access.scope === 'all'
        ? ALL_BRANDS
        : { scope: 'selected', brandIds: (data as string[] | null) ?? access.brandIds },
  };
}

/** Open while the workspace is read-only: it takes back access, never gives it. */
export async function removeMember(userId: string) {
  const { user, profile } = await requireAdmin();

  if (userId === user.id) {
    throw new Error('You cannot remove yourself from the team');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ organization_id: null })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);

  // The member's author stays, but no longer as them: only they may unlink
  // themself from a session, so once they're gone only the service client
  // can, and the author would read "Another member is this author" forever.
  // A retry finds the profile already out and clears the link then.
  const { error: authorError } = await supabaseAdmin
    .from('content_authors')
    .update({ user_id: null })
    .eq('organization_id', profile.organization_id)
    .eq('user_id', userId);

  if (authorError) throw new Error(authorError.message);
  revalidatePath('/dashboard/settings');
}

export type AcceptInvitationResult = { organizationId: string; role: TeamRole } | { error: string };

/** Postgres' code for a function that isn't there, and PostgREST's for one not in its cache. */
const MISSING_FUNCTION = new Set(['42883', 'PGRST202']);

/**
 * User-facing failures (stale/invalid token, expired invite, wrong signed-in
 * account) come back as a VALUE: production masks every error thrown from a
 * server action, so the most actionable message in this flow — telling the
 * user which email to sign in with — would otherwise reach them as the
 * meaningless digest string (#550).
 *
 * Open while the workspace is read-only: the invited person's own account
 * joins, and finds the workspace read-only.
 */
export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('You must be signed in to accept an invitation');

  const { data: invitation, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error || !invitation) return { error: 'Invitation not found' };

  if (invitation.status !== 'pending') {
    return { error: 'This invitation is no longer valid' };
  }

  const expiresAt = new Date(invitation.expires_at as string);
  if (expiresAt.getTime() < Date.now()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('id', invitation.id);
    return { error: 'This invitation has expired' };
  }

  const inviteEmail = (invitation.email as string).toLowerCase();
  const userEmail = user.email?.toLowerCase() ?? '';
  if (inviteEmail !== userEmail) {
    return { error: `This invitation was sent to ${inviteEmail}. Please sign in with that email.` };
  }

  // The person joins with the invitation's role and brands, and the
  // invitation is used, in one transaction (00471): a Selected-brands
  // invitation never leaves them with All brands.
  const { error: acceptErr } = await supabaseAdmin.rpc('accept_invitation', {
    p_invitation_id: invitation.id,
    p_user_id: user.id,
  });

  if (acceptErr && MISSING_FUNCTION.has(acceptErr.code ?? '')) {
    // Before 00471 is applied: as before, for an All-brands invitation only.
    if (invitation.brand_scope === 'selected') {
      return { error: 'This invitation can’t be accepted yet. Please try again later.' };
    }
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update({
        organization_id: invitation.organization_id,
        role: invitation.role,
        onboarding_completed: true,
      })
      .eq('id', user.id);
    if (profileErr) return { error: profileErr.message };
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);
  } else if (acceptErr) {
    return { error: acceptErr.message };
  }

  revalidatePath('/dashboard');

  return {
    organizationId: invitation.organization_id as string,
    role: invitation.role as TeamRole,
  };
}

export async function getInvitationByToken(token: string) {
  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select('id, email, role, status, expires_at, organization_id, organizations(name)')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    role: data.role as TeamRole,
    status: data.status as TeamInvitation['status'],
    expiresAt: data.expires_at as string,
    organizationId: data.organization_id as string,
    organizationName: (data.organizations as unknown as { name: string } | null)?.name ?? null,
  };
}
