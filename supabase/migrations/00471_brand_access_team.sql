-- ============================================================================
-- 00471: brand access — invite people to some brands, change who sees which
-- ============================================================================
-- BRAND-ACCESS PR 12 (the Team screen). 00388 stored the choice (a person's
-- brand_scope and the brands shared with them, member_brands, and an
-- invitation's brand_scope and brand_ids); the rules that apply it came
-- with 00389 to 00470. These two functions are how the server writes the
-- choice, each in one transaction, so a person is never left between two
-- states (joined but still All brands, or Selected brands with none of the
-- brands meant for them):
--
--   * accept_invitation(invitation, person): joins the person to the
--     invitation's organization with its role and brand access, shares the
--     invitation's brands that still exist (a brand deleted since is
--     skipped; the demo brand is everyone's already), and marks the
--     invitation accepted. A Selected-brands invitation never turns into
--     All brands: the scope is written, not left to the default.
--   * set_member_brand_access(organization, person, scope, brands, by): an
--     admin's Edit brands. All brands drops the person's shared brands;
--     Selected brands keeps exactly the brands named, of the organization
--     (the demo brand needs none). An admin always has All brands, and
--     Selected brands needs at least one brand.
--
-- The server (service role) calls them after its own checks: the invitation
-- is pending, unexpired and for the signed-in person's e-mail; the caller is
-- an admin of the organization. Security invoker, for the service role
-- only: the service role bypasses RLS, so the 00228/00374/00388 profile
-- guard lets it change the role, organization and brand_scope, and the
-- triggers that follow (00388: the reset on a new admin, dropping the old
-- organization's brands) run as before.

-- ── accept_invitation ───────────────────────────────────────────────────────

create or replace function public.accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_brand_ids uuid[];
begin
  select * into v_invitation
  from public.invitations i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.status <> 'pending' or v_invitation.expires_at < now() then
    raise exception 'invitation is no longer valid' using errcode = '22023';
  end if;

  update public.profiles
  set organization_id = v_invitation.organization_id,
      role = v_invitation.role,
      brand_scope = v_invitation.brand_scope,
      onboarding_completed = true
  where id = p_user_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- The brands named that are still the organization's (not the demo brand,
  -- which everyone sees). Inserted after the profile moved, so the
  -- member_brands check finds the person in the organization.
  if v_invitation.brand_scope = 'selected' then
    insert into public.member_brands (organization_id, user_id, brand_id, granted_by)
    select v_invitation.organization_id, p_user_id, b.id, v_invitation.invited_by
    from public.brands b
    where b.id = any (v_invitation.brand_ids)
      and b.organization_id = v_invitation.organization_id
      and not b.is_demo
    on conflict (user_id, brand_id) do nothing;
  end if;

  update public.invitations
  set status = 'accepted',
      accepted_at = now()
  where id = p_invitation_id;

  select coalesce(array_agg(mb.brand_id order by mb.brand_id), '{}')
  into v_brand_ids
  from public.member_brands mb
  where mb.user_id = p_user_id;

  return jsonb_build_object(
    'organization_id', v_invitation.organization_id,
    'role', v_invitation.role,
    'brand_scope', v_invitation.brand_scope,
    'brand_ids', to_jsonb(v_brand_ids)
  );
end;
$$;

revoke all on function public.accept_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_invitation(uuid, uuid) to service_role;

comment on function public.accept_invitation(uuid, uuid) is
  'Brand access (00471): joins the person to a pending, unexpired invitation''s organization with its role and brand access, shares the invitation''s brands that still exist (not the demo brand), and marks it accepted, in one transaction. Server only (service role), after it checked the invitation''s e-mail.';

-- ── set_member_brand_access ─────────────────────────────────────────────────

create or replace function public.set_member_brand_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_brand_scope text,
  p_brand_ids uuid[],
  p_granted_by uuid
)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_brand_ids uuid[];
begin
  if p_brand_scope is null or p_brand_scope not in ('all', 'selected') then
    raise exception 'brand scope must be all or selected' using errcode = '22023';
  end if;

  -- The person, locked: a move to another organization at the same time
  -- waits, then finds the grants gone with it (00388's trigger).
  select p.role into v_role
  from public.profiles p
  where p.id = p_user_id
    and p.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'member not found in this organization' using errcode = 'P0002';
  end if;
  if v_role = 'admin' and p_brand_scope = 'selected' then
    raise exception 'admins always have all brands' using errcode = '22023';
  end if;

  if p_brand_scope = 'selected' then
    select coalesce(array_agg(b.id order by b.id), '{}')
    into v_brand_ids
    from public.brands b
    where b.id = any (coalesce(p_brand_ids, '{}'))
      and b.organization_id = p_organization_id
      and not b.is_demo;
    if cardinality(v_brand_ids) = 0 then
      raise exception 'selected brands needs at least one brand of the organization'
        using errcode = '22023';
    end if;
  end if;

  update public.profiles
  set brand_scope = p_brand_scope
  where id = p_user_id;

  if p_brand_scope = 'all' then
    delete from public.member_brands mb where mb.user_id = p_user_id;
    return '{}';
  end if;

  delete from public.member_brands mb
  where mb.user_id = p_user_id
    and not (mb.brand_id = any (v_brand_ids));

  insert into public.member_brands (organization_id, user_id, brand_id, granted_by)
  select p_organization_id, p_user_id, ids.brand_id, p_granted_by
  from unnest(v_brand_ids) as ids(brand_id)
  on conflict (user_id, brand_id) do nothing;

  return v_brand_ids;
end;
$$;

revoke all on function public.set_member_brand_access(uuid, uuid, text, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.set_member_brand_access(uuid, uuid, text, uuid[], uuid)
  to service_role;

comment on function public.set_member_brand_access(uuid, uuid, text, uuid[], uuid) is
  'Brand access (00471): an admin''s Edit brands. All brands drops the person''s shared brands; Selected brands keeps exactly the organization''s brands named (at least one; not the demo brand). Admins are always All brands. One transaction, the person''s profile locked. Server only (service role), after it checked the caller is an admin.';

notify pgrst, 'reload schema';
