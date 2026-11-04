-- ============================================================================
-- 00424: brand access — Chat's brand tables
-- ============================================================================
-- 00390 took the brand tables whose policies look only at the organization or
-- the person, up to 00390. These are Chat's (00400–00422), so they come after
-- the migrations that create them: a chat, a filed file, a change that went
-- live, a person's daily suggestions, Chat's change log and access requests,
-- an agent's runs and a why-it-moved analysis are read only by someone who can
-- access their brand. Every condition they had stays.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for All-brands people every rule passes the same rows as
-- before.
--
--   * A row with no brand (a chat or file about the whole workspace, a run
--     whose brand was deleted) may still hold any brand's data: a chat with
--     no brand lets each tool call pick its own. Someone else's such row is
--     read only by admins and All-brands people (user_has_all_brands(),
--     00390). The person's own rows with no brand stay theirs: their own
--     chat, their own Chat changes and access requests (with the admins').
--   * A person's own chat about a brand they can't access is hidden, not
--     deleted, and comes back with the access (BRAND-ACCESS §9 Q4). So is a
--     shared one, and an agent run's.
--   * What follows these tables keeps following them: a chat's messages, runs,
--     steps, questions, next moves, task state and attachments; a file's task
--     links; a change's measurements and their control sets.
--   * The rule is `brand_id in (select public.user_brand_ids())`, once per
--     query, for authenticated only (anon may not run it).
--
-- backend/src/lib/brandAccessPolicies.test.js checks every brand table and
-- the tables that follow one.

-- ── chat_conversations ──────────────────────────────────────────────────────

-- The author's own chat with no brand stays theirs, whatever brands they see
-- (Q4 hides only chats about a brand): they wrote every question in it, and
-- an answer there that read a brand they have since lost is still the one
-- they were given.
drop policy if exists "chat_conversations: author select" on public.chat_conversations;
create policy "chat_conversations: author select"
  on public.chat_conversations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

drop policy if exists "chat_conversations: shared select" on public.chat_conversations;
create policy "chat_conversations: shared select"
  on public.chat_conversations
  for select
  to authenticated
  using (
    shared_at is not null
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (
      brand_id in (select public.user_brand_ids())
      or (brand_id is null and (select public.user_has_all_brands()))
    )
  );

drop policy if exists "chat_conversations: agent run select" on public.chat_conversations;
create policy "chat_conversations: agent run select"
  on public.chat_conversations
  for select
  to authenticated
  using (
    agent_run_id in (select r.id from public.chat_agent_runs r)
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (
      brand_id in (select public.user_brand_ids())
      or (brand_id is null and (select public.user_has_all_brands()))
    )
  );

-- ── chat_agent_runs ─────────────────────────────────────────────────────────

drop policy if exists "chat_agent_runs: agent select" on public.chat_agent_runs;
create policy "chat_agent_runs: agent select"
  on public.chat_agent_runs
  for select
  to authenticated
  using (
    (
      agent_id in (select a.id from public.chat_agents a)
      or organization_id in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
          and (p.role = 'admin' or chat_agent_runs.acting_user_id = auth.uid())
      )
    )
    and (
      brand_id in (select public.user_brand_ids())
      or (brand_id is null and (select public.user_has_all_brands()))
    )
  );

-- ── chat_why_analyses ───────────────────────────────────────────────────────

drop policy if exists "chat_why_analyses: chat select" on public.chat_why_analyses;
create policy "chat_why_analyses: chat select"
  on public.chat_why_analyses
  for select
  to authenticated
  using (
    conversation_id in (select c.id from public.chat_conversations c)
    and brand_id in (select public.user_brand_ids())
  );

-- ── chat_files ──────────────────────────────────────────────────────────────

drop policy if exists "chat_files: member select" on public.chat_files;
create policy "chat_files: member select"
  on public.chat_files
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (
      brand_id in (select public.user_brand_ids())
      or (brand_id is null and (select public.user_has_all_brands()))
    )
  );

-- ── chat_activity_log, chat_access_requests ─────────────────────────────────
-- Read by the person who acted (or asked) and the admins, who have All brands:
-- a row with no brand stays readable to them.

drop policy if exists "chat_activity_log: own or admin select" on public.chat_activity_log;
create policy "chat_activity_log: own or admin select"
  on public.chat_activity_log
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_activity_log.user_id = auth.uid())
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

drop policy if exists "chat_access_requests: own or admin select" on public.chat_access_requests;
create policy "chat_access_requests: own or admin select"
  on public.chat_access_requests
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_access_requests.requester_id = auth.uid())
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

-- ── ship_events (impact_measurements and impact_control_sets follow) ───────

drop policy if exists "ship_events: member select" on public.ship_events;
create policy "ship_events: member select"
  on public.ship_events
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and brand_id in (select public.user_brand_ids())
  );

-- ── chat_suggestion_feeds, chat_suggestions ─────────────────────────────────

drop policy if exists "chat_suggestion_feeds: own select" on public.chat_suggestion_feeds;
create policy "chat_suggestion_feeds: own select"
  on public.chat_suggestion_feeds
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and brand_id in (select public.user_brand_ids())
  );

drop policy if exists "chat_suggestions: own select" on public.chat_suggestions;
create policy "chat_suggestions: own select"
  on public.chat_suggestions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and brand_id in (select public.user_brand_ids())
  );

notify pgrst, 'reload schema';
