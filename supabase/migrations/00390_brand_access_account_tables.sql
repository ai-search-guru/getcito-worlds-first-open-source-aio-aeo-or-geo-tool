-- ============================================================================
-- 00390: brand access — the Account-level brand tables, quotas, invitations
-- ============================================================================
-- 00388 stored which brands a person sees and 00389 applied it to the brands
-- table, which every policy that reads its brand through brands follows. This
-- migration takes the brand tables whose policies look only at the
-- organization or the person, and the paths that would count or show less (or
-- more) once someone has Selected brands. Chat's tables, created from 00400
-- on, follow in 00424, after them.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for All-brands people every rule below passes the same rows as
-- before (their user_brand_ids() is every brand of their organization), with
-- one exception, below.
--
--   * user_has_all_brands(): whether the caller is an admin or has All
--     brands. A row with no brand (a chat or file about the whole workspace)
--     may still hold any brand's data, so where other people's rows have none
--     (00424) only they read it.
--   * prompt_usage_counters, content_draft_deliveries, agent_conversations
--     (and agent_messages, through it): a row is read only by someone who can
--     access its brand. The organization and person checks stay. A person's
--     own old Agent chat about a brand they no longer see is hidden, not
--     deleted, and comes back with the access.
--   * The exception: agent_conversations never checked the organization, so
--     someone who moved to another organization still read their own Agent
--     chats from the old one. Those about one of the old organization's
--     brands are hidden now (its brands are none of theirs); those with no
--     brand stay.
--   * content_draft_member(), which ten policies on a draft's inputs,
--     confirmations, images and ready log and three functions (snapshot,
--     restore, decide suggestions) call: the draft's brand must be one the
--     person can access, not just one of their organization. Its policies
--     are for signed-in people only (anon can't run it; it never could).
--   * The plan's quotas count the whole Account, whatever the person sees:
--     org_prompt_location_usage and prompt_usage_summary become security
--     definer with their own membership or brand check, and the brand count
--     behind maxBrands is org_brand_count(). A Selected-brands person can't
--     get past a limit by seeing fewer brands, and sees the Account's totals
--     (the usage cards, as shares) but no other brand's figure: the location
--     usage of brands they can't access comes back as one row with no brand.
--   * invitations: only admins read them, so the brands an invitation shares
--     stay with the admins. Settings › Team lists the pending invitations for
--     everyone from the server (web lib/actions/team.ts), without those
--     columns.
--   * member_brands' check locks the person's profile (for share), so a move
--     to another organization running at the same time either waits for the
--     grant (and then deletes it) or is seen by it (and refuses it).
--
-- Policies here call the access rule as `brand_id in (select
-- public.user_brand_ids())`: not correlated with the row, so it runs once per
-- query, and only for authenticated (anon may not run it). Functions that look
-- at one brand use can_access_brand(brand).

-- ── user_has_all_brands ─────────────────────────────────────────────────────
-- An admin, or All brands, in an organization: the people who may read a row
-- of the organization that names no brand. A policy calls it as
-- `(select public.user_has_all_brands())`, once per query.

create or replace function public.user_has_all_brands()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id is not null
      and (p.role = 'admin' or p.brand_scope = 'all')
  );
$$;

revoke all on function public.user_has_all_brands() from public, anon;
grant execute on function public.user_has_all_brands() to authenticated, service_role;

comment on function public.user_has_all_brands() is
  'Brand access (00390): whether the caller (auth.uid()) is an admin or has All brands in their organization. For policies on rows with no brand: brand_id is null and (select public.user_has_all_brands()).';

-- ── prompt_usage_counters ───────────────────────────────────────────────────

drop policy if exists "prompt_usage_counters: member select" on public.prompt_usage_counters;
create policy "prompt_usage_counters: member select" on public.prompt_usage_counters
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and brand_id in (select public.user_brand_ids())
  );

-- ── content_draft_deliveries ────────────────────────────────────────────────

drop policy if exists "content_draft_deliveries: member select" on public.content_draft_deliveries;
create policy "content_draft_deliveries: member select" on public.content_draft_deliveries
  for select
  to authenticated
  using (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and brand_id in (select public.user_brand_ids())
  );

-- ── agent_conversations (the old Agent; agent_messages follows it) ──────────
-- brand_id is the brand a chat was opened on, or null (none pinned). Only the
-- person who wrote a chat reads it, so one with no brand stays theirs.

drop policy if exists "Users read own conversations" on public.agent_conversations;
create policy "Users read own conversations" on public.agent_conversations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

drop policy if exists "Users write own conversations" on public.agent_conversations;
create policy "Users write own conversations" on public.agent_conversations
  for all
  to authenticated
  using (
    user_id = auth.uid()
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  )
  with check (
    user_id = auth.uid()
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

-- ── content_draft_member ────────────────────────────────────────────────────
-- A draft the caller may work on: its brand is one they can access, or the
-- caller is the server. It answers for one draft, row by row in the policies,
-- so it asks can_access_brand about that draft's brand (one indexed look-up)
-- rather than listing every brand the person sees.

create or replace function public.content_draft_member(p_draft_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.content_drafts d
    where d.id = p_draft_id
      and public.can_access_brand(d.brand_id)
  );
$$;

revoke all on function public.content_draft_member(uuid) from public, anon;
grant execute on function public.content_draft_member(uuid) to authenticated, service_role;

comment on function public.content_draft_member(uuid) is
  'Whether the caller may work on the draft (00215): the server, or a person who can access its brand (00390, can_access_brand). Backs the policies of content_draft_inputs, _confirmations, _own_images and _ready_log, and content_draft_snapshot, _restore and _decide_suggestions.';

alter policy "content_draft_inputs: member select" on public.content_draft_inputs to authenticated;
alter policy "content_draft_inputs: member insert" on public.content_draft_inputs to authenticated;
alter policy "content_draft_inputs: member update" on public.content_draft_inputs to authenticated;
alter policy "content_draft_inputs: member delete" on public.content_draft_inputs to authenticated;
alter policy "content_draft_confirmations: member select" on public.content_draft_confirmations to authenticated;
alter policy "content_draft_confirmations: member insert" on public.content_draft_confirmations to authenticated;
alter policy "content_draft_own_images: member select" on public.content_draft_own_images to authenticated;
alter policy "content_draft_own_images: member insert" on public.content_draft_own_images to authenticated;
alter policy "content_draft_ready_log: member select" on public.content_draft_ready_log to authenticated;
alter policy "content_draft_ready_log: member insert" on public.content_draft_ready_log to authenticated;

-- ── The plan's prompt-location quota (00128, 00380), Account-wide ──────────
-- savePromptSet, the prompt dialogs, the Tracked Prompts KPI and
-- import_prompts count through this, as the person. It counts every brand of
-- the organization when the caller belongs to it (or is the server); anyone
-- else gets no rows, as RLS gave them before. A brand the caller can't access
-- is counted in a single row with no brand id: the total is the Account's,
-- and no hidden brand's usage shows.

create or replace function public.org_prompt_location_usage(p_organization_id uuid)
returns table (brand_id uuid, locations bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with per_brand as (
    select b.id, sum(greatest(coalesce(array_length(p.regions, 1), 0), 1))::bigint as locations
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    join public.brands b on b.id = ps.brand_id
    where b.organization_id = p_organization_id
      and not b.is_demo
      and p.is_active
      and (
        coalesce(auth.role(), '') = 'service_role'
        or exists (
          select 1 from public.profiles pf
          where pf.id = auth.uid() and pf.organization_id = p_organization_id
        )
      )
    group by b.id
  ),
  shown as (
    select
      case
        when coalesce(auth.role(), '') = 'service_role'
          or u.id in (select public.user_brand_ids())
        then u.id
      end as brand_id,
      u.locations
    from per_brand u
  )
  select s.brand_id, sum(s.locations)::bigint
  from shown s
  group by s.brand_id;
$$;

revoke all on function public.org_prompt_location_usage(uuid) from public, anon;
grant execute on function public.org_prompt_location_usage(uuid) to authenticated, service_role;

comment on function public.org_prompt_location_usage(uuid) is
  'Active prompt locations per brand for one org (#691, 00128) — the plan-quota unit, one per region entry per active prompt, minimum one; paused prompts and the demo brand (00380) don''t count. Security definer (00390): the whole organization for its members and the server, nothing for anyone else; the brands the caller can''t access come back as one row with a null brand_id.';

-- ── The usage cards' Account totals (00139, 00380), Account-wide ────────────
-- One brand's counts, and its Account's prompts, brands and locations, which
-- the plan limits. For the server, or a person who can access the brand; the
-- Account's totals count every brand, whatever the person sees.

create or replace function public.prompt_usage_summary(p_brand_id uuid)
returns table (
  brand_active integer,
  brand_paused integer,
  account_active integer,
  account_brands integer,
  account_locations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(bc.active_prompts, 0),
    coalesce(bc.paused_prompts, 0),
    coalesce(acct.active_prompts, 0)::integer,
    (
      select count(*)
      from public.brands b2
      where b2.organization_id = b.organization_id
        and not b2.is_demo
    )::integer,
    coalesce(acct.active_locations, 0)::integer
  from public.brands b
  left join public.prompt_usage_counters bc on bc.brand_id = b.id
  left join lateral (
    select sum(c.active_prompts) as active_prompts, sum(c.active_locations) as active_locations
    from public.prompt_usage_counters c
    join public.brands cb on cb.id = c.brand_id
    where c.organization_id = b.organization_id
      and not cb.is_demo
  ) acct on true
  where b.id = p_brand_id
    and (coalesce(auth.role(), '') = 'service_role' or public.can_access_brand(b.id));
$$;

revoke all on function public.prompt_usage_summary(uuid) from public, anon;
grant execute on function public.prompt_usage_summary(uuid) to authenticated, service_role;

comment on function public.prompt_usage_summary(uuid) is
  'One brand''s active/paused prompts and its account''s active prompts, brands and active prompt locations, from prompt_usage_counters only (PROMPT-012); the account totals leave out the demo brand (00380). Security definer (00390): for the server or a person who can access the brand; the account totals count every brand.';

-- ── The plan's brand count (maxBrands), Account-wide ────────────────────────
-- The Brands page and createBrand (web) compare it with the plan. The
-- organization's brands but the demo brand, for its members and the server;
-- 0 for anyone else, as RLS gave them before.

create or replace function public.org_brand_count(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.brands b
  where b.organization_id = p_organization_id
    and not b.is_demo
    and (
      coalesce(auth.role(), '') = 'service_role'
      or exists (
        select 1 from public.profiles pf
        where pf.id = auth.uid() and pf.organization_id = p_organization_id
      )
    );
$$;

revoke all on function public.org_brand_count(uuid) from public, anon;
grant execute on function public.org_brand_count(uuid) to authenticated, service_role;

comment on function public.org_brand_count(uuid) is
  'Brand access (00390): the organization''s brands the plan counts (maxBrands), the demo brand left out, whatever brands the caller sees. For its members and the server; 0 for anyone else.';

-- ── invitations: admins only ────────────────────────────────────────────────
-- An invitation names the brands it shares (00388). Admins manage
-- invitations (00002) and are the only ones who read them now; the pending
-- list everyone sees in Settings › Team comes from the server.

drop policy if exists "Members can view org invitations" on public.invitations;
drop policy if exists "Admins can view org invitations" on public.invitations;
create policy "Admins can view org invitations" on public.invitations
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ── member_brands: the person stays in the organization while shared ───────
-- 00388's check, with the person's profile locked (for share) until the grant
-- commits. A move to another organization updates that row: it waits for the
-- grant, and its own trigger then deletes it; or it went first, and the check
-- reads the moved row and refuses the grant.

create or replace function public.check_member_brand_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.brands b
    where b.id = new.brand_id and b.organization_id = new.organization_id
  ) then
    raise exception 'member_brands: brand % is not in organization %', new.brand_id, new.organization_id
      using errcode = '23514';
  end if;
  perform 1 from public.profiles p
  where p.id = new.user_id and p.organization_id = new.organization_id
  for share;
  if not found then
    raise exception 'member_brands: person % is not in organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
