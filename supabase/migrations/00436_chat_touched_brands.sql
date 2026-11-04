-- ============================================================================
-- 00436: brand access — the brands a chat touched, and who sees an agent
-- ============================================================================
-- BRAND-ACCESS PR 9 (Chat). 00424 let a Selected-brands person read a chat or
-- a file only about a brand they can access: one with no brand (about the
-- whole workspace) may hold any brand's data, since each call in it picks its
-- own brand, so only admins and All-brands people read someone else's. A
-- chat about one brand can read another brand's data too. This migration
-- keeps which brands a chat touched, and lets a Selected-brands person read
-- someone else's chat, or a file, only when every one of them is theirs. It
-- also takes Chat's agents, whose brands live in their version's scope, the
-- last of Chat's tables that didn't look at the brand.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for All-brands people every rule below passes the same rows
-- as before.
--
--   * chat_conversations.touched_brand_ids: the brands the chat's calls read
--     or changed, kept by the web (lib/chat/touchedBrands.ts) before each
--     call runs. Null is "not known": every chat from before this migration,
--     one Chat didn't start itself (an old Agent chat copied in), and one
--     whose calls listed every brand of the workspace. A chat Chat starts
--     (a person's, an agent run's) begins with its own brand, or none
--     (chat_start_touched_brands), and only while nothing is in it. A
--     deleted brand's chat keeps the brand's id here after its brand_id goes
--     (on delete set null).
--   * chat_files.touched_brand_ids: a file filed from a chat keeps the
--     chat's set as it was then, and its own brand (the insert trigger). A
--     file made outside a chat (a task's, an editor's, a schedule's) holds
--     its own brand's data: its brand, or not known without one; the files
--     there are now get the same.
--   * The shared chats', agent runs' chats' and files' policies: admins and
--     All-brands people read what they read before. Someone with Selected
--     brands reads a row about one of their brands only when every brand it
--     touched is theirs too, and a row with no brand on the same terms. Not
--     known reads as touching every brand: the chats from before this
--     migration stay hidden from them. The author's own chats are as 00424
--     left them.
--   * chat_note_touched_brands and chat_start_touched_brands: the server's
--     only (service role).
--   * can_see_chat_agent(agent): who sees an agent, as the web's canSeeAgent
--     (agentRules.ts): an admin every one; others a workspace agent, or
--     their own; and with Selected brands, only an agent whose brands are
--     all theirs, or their own agent on All brands, which runs on their
--     brands only. Its versions, triggers and runs follow it, as before.
--
-- A web deployed before this migration notes nothing (the functions aren't
-- there) and reads as 00424 does.

-- ── touched_brand_ids ───────────────────────────────────────────────────────

alter table public.chat_conversations
  add column if not exists touched_brand_ids uuid[];

comment on column public.chat_conversations.touched_brand_ids is
  'Brand access (00436): the brands the chat''s calls read or changed, kept by the server before each call. Null: not known (from before 00436, not started by Chat, or a call that listed every brand). A shared chat with no brand is read by people who can access every one.';

alter table public.chat_files
  add column if not exists touched_brand_ids uuid[];

comment on column public.chat_files.touched_brand_ids is
  'Brand access (00436): the brands of the chat it was filed from, as they were then, and its own brand. Null: not known. A file with no brand is read by people who can access every one.';

-- A new chat Chat starts keeps its brands from here: its own brand, or none.
-- Only while nothing is in it: what is already there was never noted.
create or replace function public.chat_start_touched_brands(p_conversation_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.chat_conversations c
  set touched_brand_ids = case
    when c.brand_id is null then '{}'::uuid[]
    else array[c.brand_id]
  end
  where c.id = p_conversation_id
    and c.touched_brand_ids is null
    and not exists (
      select 1 from public.chat_messages m where m.conversation_id = c.id
    );
$$;

revoke all on function public.chat_start_touched_brands(uuid) from public, anon, authenticated;
grant execute on function public.chat_start_touched_brands(uuid) to service_role;

comment on function public.chat_start_touched_brands(uuid) is
  'Brand access (00436): starts keeping a new chat''s brands (its own, or none), while nothing is in it. The server''s only.';

-- The brands a call touches, added to its chat's; the whole workspace makes
-- the set not known (null) for good. A chat not known stays so.
create or replace function public.chat_note_touched_brands(
  p_conversation_id uuid,
  p_brand_ids uuid[],
  p_whole_workspace boolean default false
)
returns void
language sql
set search_path = ''
as $$
  update public.chat_conversations c
  set touched_brand_ids = case
    when p_whole_workspace then null
    else array(
      select distinct t.id
      from unnest(c.touched_brand_ids || coalesce(p_brand_ids, '{}'::uuid[])) as t(id)
      where t.id is not null
      order by t.id
    )
  end
  where c.id = p_conversation_id
    and c.touched_brand_ids is not null
    and (
      p_whole_workspace
      or not (coalesce(p_brand_ids, '{}'::uuid[]) <@ c.touched_brand_ids)
    );
$$;

revoke all on function public.chat_note_touched_brands(uuid, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.chat_note_touched_brands(uuid, uuid[], boolean) to service_role;

comment on function public.chat_note_touched_brands(uuid, uuid[], boolean) is
  'Brand access (00436): adds the brands a call touches to its chat''s touched_brand_ids; the whole workspace sets it to null (not known). The server''s only, before the call runs.';

-- A file takes its chat's set as it is when filed, and its own brand; one
-- made outside a chat, its own brand (not known without one).
create or replace function public.chat_files_touched_brands()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id is not null then
    select c.touched_brand_ids into new.touched_brand_ids
    from public.chat_conversations c
    where c.id = new.conversation_id;
  elsif new.brand_id is not null then
    new.touched_brand_ids := array[new.brand_id];
  else
    new.touched_brand_ids := null;
  end if;
  if new.touched_brand_ids is not null
    and new.brand_id is not null
    and not (new.brand_id = any (new.touched_brand_ids)) then
    new.touched_brand_ids := new.touched_brand_ids || new.brand_id;
  end if;
  return new;
end;
$$;

revoke all on function public.chat_files_touched_brands() from public, anon, authenticated;

drop trigger if exists chat_files_touched_brands on public.chat_files;
create trigger chat_files_touched_brands
  before insert on public.chat_files
  for each row execute function public.chat_files_touched_brands();

-- The files there are that no chat made (origin task, editor, schedule) hold
-- their own brand's data. A chat's file stays not known: its chat's brands
-- were never kept.
update public.chat_files f
set touched_brand_ids = array[f.brand_id]
where f.touched_brand_ids is null
  and f.brand_id is not null
  and f.conversation_id is null
  and f.origin <> 'chat';

-- ── chat_conversations, chat_files ──────────────────────────────────────────
-- Admins and All-brands people as before (00424). Someone with Selected
-- brands: a row of one of their brands whose touched brands are all theirs,
-- or a row with no brand on the same terms. `<@ array(select …)` runs the
-- access rule once per query; null (not known) is never contained.

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
      (
        brand_id in (select public.user_brand_ids())
        and (
          (select public.user_has_all_brands())
          or touched_brand_ids <@ array(select public.user_brand_ids())
        )
      )
      or (brand_id is null and (select public.user_has_all_brands()))
      or (brand_id is null and touched_brand_ids <@ array(select public.user_brand_ids()))
    )
  );

-- An agent run's chat: whoever reads the run (00419, 00424), on the same terms.
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
      (
        brand_id in (select public.user_brand_ids())
        and (
          (select public.user_has_all_brands())
          or touched_brand_ids <@ array(select public.user_brand_ids())
        )
      )
      or (brand_id is null and (select public.user_has_all_brands()))
    )
  );

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
      (
        brand_id in (select public.user_brand_ids())
        and (
          (select public.user_has_all_brands())
          or touched_brand_ids <@ array(select public.user_brand_ids())
        )
      )
      or (brand_id is null and (select public.user_has_all_brands()))
      or (brand_id is null and touched_brand_ids <@ array(select public.user_brand_ids()))
    )
  );

-- ── chat_agents (chat_agent_versions, _triggers and _runs follow) ───────────

-- Whether the caller sees the agent: as 00419's policy (their organization's,
-- and they are an admin, it is a workspace agent, or it is theirs), and with
-- Selected brands, every brand of its current version's scope is theirs, or
-- it is their own agent on All brands. Bypasses RLS (security definer), so
-- the agents' own policy can call it.
create or replace function public.can_see_chat_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_agents a
    join public.profiles p
      on p.id = auth.uid() and p.organization_id = a.organization_id
    left join public.chat_agent_versions v
      on v.agent_id = a.id and v.version = a.version
    where a.id = p_agent_id
      and (p.role = 'admin' or a.visibility = 'workspace' or a.owner_id = p.id)
      and (
        p.role = 'admin'
        or p.brand_scope = 'all'
        or case
          when coalesce(v.scope ->> 'all_brands', '') = 'true' then a.owner_id = p.id
          else not exists (
            select 1
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(v.scope -> 'brand_ids') = 'array' then v.scope -> 'brand_ids'
                else '[]'::jsonb
              end
            ) as s(brand_id)
            where s.brand_id not in (select u::text from public.user_brand_ids() as u)
          )
        end
      )
  );
$$;

revoke all on function public.can_see_chat_agent(uuid) from public, anon;
grant execute on function public.can_see_chat_agent(uuid) to authenticated, service_role;

comment on function public.can_see_chat_agent(uuid) is
  'Brand access (00436): whether the caller sees the Chat agent, as the web''s canSeeAgent: an admin, a workspace agent or their own, and with Selected brands only one whose brands are all theirs, or their own on All brands. Backs chat_agents'' policy; its versions, triggers and runs follow it.';

-- The organization first, so the function runs only on the caller's own agents.
drop policy if exists "chat_agents: member select" on public.chat_agents;
create policy "chat_agents: member select"
  on public.chat_agents
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and public.can_see_chat_agent(id)
  );

notify pgrst, 'reload schema';
