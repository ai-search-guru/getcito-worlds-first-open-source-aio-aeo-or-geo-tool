-- ============================================================================
-- 00389: brands — read, change and delete only the brands you can access
-- ============================================================================
-- 00388 stored which brands a person sees. This applies it to the brands
-- table: its select, update and delete policies add the person's brand
-- access to the organization and role checks they had (00001, 00380). The
-- insert policy stays as it was (an admin or a manager of the organization,
-- never a demo brand), and a Selected-brands person who adds a brand gets it
-- shared (00388's trigger).
--
-- Every policy on a brand's rows reaches the brand through a subquery on
-- public.brands, and PostgreSQL applies the brands policies inside that
-- subquery too: the 147 policies on 83 tables that read brands narrow with
-- this change. Brand tables whose policies look only at the organization or
-- the person, and the security definer functions that check the organization
-- themselves, follow in later migrations; backend/src/lib/
-- brandAccessPolicies.test.js lists the tables and fails on a new one.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for All-brands people each policy below passes exactly the
-- rows it passed before.
--
-- How the rules are written:
--   * select: All brands (admins included) match on the row's own
--     organization_id, as before; Selected brands on user_brand_ids(). A
--     brand being added has to pass too: `insert … returning` (any
--     .insert().select() with a person's session) checks the select policy against the
--     new row before it is stored, so a rule that looks the brand up by id,
--     such as can_access_brand(id), would refuse every new brand.
--   * A Selected-brands manager's new brand still can't read itself back in
--     that same insert: the creator's grant is added after the row is
--     stored. The web's createBrand therefore adds it with an id of its own
--     and reads it after the insert (no returning).
--   * update and delete: the row is there, so the scope is
--     `id in (select public.user_brand_ids())`, next to the role checks.
--   * `id in (select public.user_brand_ids())` isn't correlated with the row,
--     so it runs once per query (a hashed SubPlan), where
--     `(select public.can_access_brand(id))` would run once per row. The
--     look-ups inside use member_brands' primary key (user_id, brand_id) and
--     brands' organization_id index; no new index is needed.
--   * To authenticated: anon may not run the helpers, and with no profile it
--     matched no brand before either.
--
-- Performance, to measure on the development database before and after (as
-- a signed-in member: set local role authenticated plus request.jwt.claims):
--   * Insights (insights_aggregates_daily, insights_kpi_series, the
--     *_daily rollups) and Citations' invoker functions read through these
--     policies; Perception (mentions_perception) and the citations functions
--     with their own organization check are security definer and don't.
--   * Expect each brand-table policy's brands subquery to keep its plan,
--     with the brands filter showing `hashed SubPlan` and user_brand_ids()
--     run at most once per subquery (loops=1). They took 6–9 s before 00290.

drop policy if exists "brands: member select" on public.brands;
create policy "brands: member select" on public.brands
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.brand_scope = 'all')
    )
    or id in (select public.user_brand_ids())
  );

drop policy if exists "brands: admin/manager update" on public.brands;
create policy "brands: admin/manager update" on public.brands
  for update
  to authenticated
  using (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
    and id in (select public.user_brand_ids())
  )
  with check (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
    and id in (select public.user_brand_ids())
  );

drop policy if exists "brands: admin delete" on public.brands;
create policy "brands: admin delete" on public.brands
  for delete
  to authenticated
  using (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'::public.user_role
    )
    and id in (select public.user_brand_ids())
  );

notify pgrst, 'reload schema';
