-- ============================================================================
-- 00443: agents that publish and send on their own — the permission and its
-- ledger
-- ============================================================================
-- AUTONOMOUS-GO-LIVE §10.1 (owner decision 2026-11-01). An agent in Full auto
-- may take a going-live step (a CMS draft, a new page published, a webhook)
-- without a person's click only when an Admin allowed it twice: for the
-- workspace in Settings › Chat, and for that agent on its form. Each such
-- step takes a slot of the agent's daily limit first. Nothing reads these
-- yet: the precedence's exception comes with a later PR, behind
-- CHAT_AUTO_GO_LIVE.
--
--   * chat_settings gains the workspace switch: auto_go_live_groups, the
--     go-live groups an Admin allowed agents to take live on their own (v1
--     writes ['publishing']), and who turned it on, when, under which
--     version of the responsibility text. A group can't be on without when.
--   * chat_agent_go_live: one row per allowed agent, for the agent version it
--     was given on (a new version drops it), with its daily limit (1–20, 5
--     unless set) and the checksums of its Library skills then. Members read
--     it as they read the agent; the server writes it, for an Admin.
--   * chat_agent_go_live_events: each going-live step an agent took on its
--     own: its slot (reserved), then done or failed, and later taken_down.
--     A brand table: read by whoever can access the brand.
--   * reserve_agent_go_live / finish_agent_go_live (service role): a slot
--     under a lock per agent, counting the last 24 hours' reserved, done and
--     taken-down steps once per (draft, target); a failed step frees it.

-- ─── The workspace switch ───────────────────────────────────────────────────

alter table public.chat_settings
  add column if not exists auto_go_live_groups text[] not null default '{}' check (
    auto_go_live_groups <@ array['publishing', 'email_outreach', 'code_prs', 'feeds']::text[]
    and public.chat_text_array_distinct(auto_go_live_groups)
  ),
  add column if not exists auto_go_live_by uuid references auth.users(id) on delete set null,
  add column if not exists auto_go_live_at timestamptz,
  add column if not exists auto_go_live_terms smallint check (auto_go_live_terms >= 1);

alter table public.chat_settings
  drop constraint if exists chat_settings_auto_go_live_when_check;
alter table public.chat_settings
  add constraint chat_settings_auto_go_live_when_check
  check (cardinality(auto_go_live_groups) = 0 or auto_go_live_at is not null);

comment on column public.chat_settings.auto_go_live_groups is
  'The go-live groups an Admin allowed agents to take live on their own (00443): publishing, email_outreach, code_prs, feeds. Each agent needs its own permission too (chat_agent_go_live).';
comment on column public.chat_settings.auto_go_live_terms is
  'The version of the responsibility text the Admin accepted when turning agents'' going live on.';

-- ─── An agent's permission ──────────────────────────────────────────────────

create table if not exists public.chat_agent_go_live (
  agent_id uuid primary key references public.chat_agents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The agent version it was given on: a run of another version has none.
  version integer not null check (version >= 1),
  daily_limit smallint not null default 5 check (daily_limit between 1 and 20),
  -- The agent's Library skills' checksums when it was given (skill key → hash).
  skill_checksums jsonb not null default '{}'::jsonb check (
    jsonb_typeof(skill_checksums) = 'object' and octet_length(skill_checksums::text) <= 4096
  ),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create index if not exists chat_agent_go_live_organization_idx
  on public.chat_agent_go_live (organization_id);

comment on table public.chat_agent_go_live is
  'Chat (00443): an agent an Admin allowed to publish and send on its own, for the version it was given on, with its daily limit. Read as the agent is; the server writes it.';

alter table public.chat_agent_go_live enable row level security;

revoke all on table public.chat_agent_go_live from anon, authenticated;
grant select on table public.chat_agent_go_live to authenticated;
grant all on table public.chat_agent_go_live to service_role;

-- Whoever reads the agent reads its permission (chat_agents' own rule).
drop policy if exists "chat_agent_go_live: agent select" on public.chat_agent_go_live;
create policy "chat_agent_go_live: agent select"
  on public.chat_agent_go_live
  for select
  to authenticated
  using (agent_id in (select a.id from public.chat_agents a));

-- ─── What agents took live on their own ─────────────────────────────────────

create table if not exists public.chat_agent_go_live_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.chat_agents(id) on delete set null,
  agent_run_id uuid references public.chat_agent_runs(id) on delete set null,
  run_id uuid references public.chat_runs(id) on delete set null,
  brand_id uuid not null references public.brands(id) on delete cascade,
  content_draft_id uuid references public.content_drafts(id) on delete set null,
  delivery_id uuid references public.content_draft_deliveries(id) on delete set null,
  tool_key text not null check (tool_key ~ '^[a-z][A-Za-z0-9]{1,63}$'),
  kind text not null check (kind in ('cms_draft', 'publish', 'webhook')),
  target text not null check (target in ('webflow', 'wordpress', 'framer', 'wix', 'webhook')),
  status text not null default 'reserved'
    check (status in ('reserved', 'done', 'failed', 'taken_down')),
  published_url text check (char_length(published_url) <= 2048),
  external_id text check (char_length(external_id) <= 500),
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  taken_down_at timestamptz,
  taken_down_by uuid references auth.users(id) on delete set null
);

-- The daily limit's count, and an agent page's last go-lives.
create index if not exists chat_agent_go_live_events_agent_idx
  on public.chat_agent_go_live_events (agent_id, created_at desc);
create index if not exists chat_agent_go_live_events_brand_idx
  on public.chat_agent_go_live_events (brand_id, created_at desc);
create index if not exists chat_agent_go_live_events_draft_idx
  on public.chat_agent_go_live_events (content_draft_id)
  where content_draft_id is not null;

comment on table public.chat_agent_go_live_events is
  'Chat (00443): each going-live step an agent took on its own (a CMS draft, a page published, a webhook), its slot of the daily limit, and its Take down. Read by whoever can access the brand; the server writes.';

alter table public.chat_agent_go_live_events enable row level security;

revoke all on table public.chat_agent_go_live_events from anon, authenticated;
grant select on table public.chat_agent_go_live_events to authenticated;
grant all on table public.chat_agent_go_live_events to service_role;

drop policy if exists "chat_agent_go_live_events: brand select" on public.chat_agent_go_live_events;
create policy "chat_agent_go_live_events: brand select"
  on public.chat_agent_go_live_events
  for select
  to authenticated
  using (
    brand_id in (select public.user_brand_ids())
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- ─── A slot of the daily limit ──────────────────────────────────────────────

-- The step's slot, or null when the agent's last 24 hours are full. Under a
-- lock per agent, so steps at once can't both take the last slot. Each
-- (draft, target) counts once: one already counted in the window returns its
-- row, with no second slot.
create or replace function public.reserve_agent_go_live(
  p_organization_id uuid,
  p_agent_id uuid,
  p_run_id uuid,
  p_agent_run_id uuid,
  p_brand_id uuid,
  p_content_draft_id uuid,
  p_tool_key text,
  p_kind text,
  p_target text,
  p_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_used integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'reserve_agent_go_live: the limit must be 1 to 20';
  end if;

  perform pg_advisory_xact_lock(hashtext('agent_go_live:' || p_agent_id::text));

  select e.id
    into v_id
    from public.chat_agent_go_live_events e
   where e.agent_id = p_agent_id
     and e.content_draft_id is not distinct from p_content_draft_id
     and e.target = p_target
     and e.status in ('reserved', 'done', 'taken_down')
     and e.created_at > now() - interval '24 hours'
   order by e.created_at desc
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select count(*)
    into v_used
    from (
      select distinct e.content_draft_id, e.target
        from public.chat_agent_go_live_events e
       where e.agent_id = p_agent_id
         and e.status in ('reserved', 'done', 'taken_down')
         and e.created_at > now() - interval '24 hours'
    ) counted;
  if v_used >= p_limit then
    return null;
  end if;

  insert into public.chat_agent_go_live_events (
    organization_id, agent_id, run_id, agent_run_id, brand_id,
    content_draft_id, tool_key, kind, target
  )
  values (
    p_organization_id, p_agent_id, p_run_id, p_agent_run_id, p_brand_id,
    p_content_draft_id, p_tool_key, p_kind, p_target
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- How a reserved step ended: done (with what went live) or failed, which
-- frees its slot. False when the row isn't reserved any more.
create or replace function public.finish_agent_go_live(
  p_id uuid,
  p_status text,
  p_delivery_id uuid default null,
  p_published_url text default null,
  p_external_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('done', 'failed') then
    raise exception 'finish_agent_go_live: the status must be done or failed';
  end if;
  update public.chat_agent_go_live_events
     set status = p_status,
         finished_at = now(),
         delivery_id = coalesce(p_delivery_id, delivery_id),
         published_url = coalesce(left(p_published_url, 2048), published_url),
         external_id = coalesce(left(p_external_id, 500), external_id),
         error = left(p_error, 500)
   where id = p_id
     and status = 'reserved';
  return found;
end;
$$;

revoke all on function public.reserve_agent_go_live(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_go_live(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer)
  to service_role;
revoke all on function public.finish_agent_go_live(uuid, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_agent_go_live(uuid, text, uuid, text, text, text)
  to service_role;
