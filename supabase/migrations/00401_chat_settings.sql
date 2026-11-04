-- ============================================================================
-- 00401: Chat's settings — each workspace's tool policy and switches, and
-- each person's "Don't ask again" choices
-- ============================================================================
-- The approval precedence (CHAT-20 §5; web lib/chat/precedence.ts) reads both
-- before every tool call Chat makes, behind CHAT_AGENTIC: nothing reads them
-- while the flag is off.
--
--   * chat_settings: one row per workspace (Settings › Chat). Members read
--     it, since Settings › Chat and "What Chat can do" show it to every role;
--     the server writes it (service role), for an Admin. No row = the
--     defaults below: every tool at its registry default, Full auto open to
--     every role the plan allows, "Don't ask again" offered, Managers able to
--     go live after their click.
--       - tool_policies: an Admin's policy per tool, keyed by the tool's
--         label key (the key the browser knows a tool by: a tool's name never
--         reaches a member, CHAT-03 item 22). never · ask · ask_full_auto ·
--         always; the server keeps each within its tool's maximum, so an
--         EXECUTE or an always-card tool is never "always".
--       - full_auto_for_members: people other than Admins may use Full auto
--         (CHAT-23 policy.toggleFullAutoForManagers). The plan decides first:
--         Full auto is Growth and up.
--       - dont_ask_again: "Don't ask again" is offered and the ticks count.
--         Off, everyone's ticks stop at once; they are kept, not deleted.
--       - manager_execute_off: the go-live groups an Admin turned off for
--         Managers (CHAT-20 §4): publishing, email_outreach, code_prs, feeds.
--   * chat_auto_choices: a person's "Don't ask again" ticks, by tool label
--     key, in their workspace. Theirs to read, add and remove (Settings ›
--     Chat › "Your auto changes"). A tick counts only inside what the plan,
--     the role, the policy and the switches allow (precedence step 6), so a
--     row by itself never lets anything run without a card.

-- Whether every value of a tool policy map is a policy, keyed by a label key.
create or replace function public.chat_tool_policies_valid(p_policies jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_policies) <> 'object' then false
    else coalesce(
      (
        select bool_and(
          e.key ~ '^[a-z][A-Za-z0-9]{1,63}$'
          and e.value in ('never', 'ask', 'ask_full_auto', 'always')
        )
        from jsonb_each_text(p_policies) as e(key, value)
      ),
      true
    )
  end;
$$;

-- ─── A workspace's Chat settings ────────────────────────────────────────────

create table if not exists public.chat_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  tool_policies jsonb not null default '{}'::jsonb
    check (public.chat_tool_policies_valid(tool_policies)),
  full_auto_for_members boolean not null default true,
  dont_ask_again boolean not null default true,
  manager_execute_off text[] not null default '{}' check (
    manager_execute_off <@ array['publishing', 'email_outreach', 'code_prs', 'feeds']::text[]
    and public.chat_text_array_distinct(manager_execute_off)
  ),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_chat_settings_updated_at on public.chat_settings;
create trigger trg_chat_settings_updated_at
  before update on public.chat_settings
  for each row execute function public.handle_updated_at();

comment on table public.chat_settings is
  'Chat (00401): a workspace''s Chat settings (Settings › Chat): tool policies by label key, Full auto for non-Admins, "Don''t ask again", go-live groups off for Managers. Members read; the server writes for an Admin. No row = the defaults.';
comment on column public.chat_settings.tool_policies is
  'An Admin''s policy per tool, keyed by the tool''s label key (never its name): never, ask, ask_full_auto or always. Held within each tool''s maximum by the server.';

-- ─── A person's "Don't ask again" ticks ─────────────────────────────────────

create table if not exists public.chat_auto_choices (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The tool's label key, as in chat_settings.tool_policies.
  tool_key text not null check (tool_key ~ '^[a-z][A-Za-z0-9]{1,63}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id, tool_key)
);

create index if not exists chat_auto_choices_organization_idx
  on public.chat_auto_choices (organization_id);

comment on table public.chat_auto_choices is
  'Chat (00401): a person''s "Don''t ask again" ticks, by tool label key, in their workspace. Theirs to read, add and remove; a tick counts only where the plan, role, policy and switches allow Full auto.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_settings enable row level security;
alter table public.chat_auto_choices enable row level security;

revoke all on table public.chat_settings from anon, authenticated;
revoke all on table public.chat_auto_choices from anon, authenticated;

grant select on table public.chat_settings to authenticated;
grant select, insert, delete on table public.chat_auto_choices to authenticated;

grant all on table public.chat_settings to service_role;
grant all on table public.chat_auto_choices to service_role;

-- Members of the workspace read its settings; the server writes them.
drop policy if exists "chat_settings: member select" on public.chat_settings;
create policy "chat_settings: member select"
  on public.chat_settings
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- A person's own ticks, in the workspace they belong to now: one who moved
-- to another workspace doesn't carry them there.
drop policy if exists "chat_auto_choices: own select" on public.chat_auto_choices;
create policy "chat_auto_choices: own select"
  on public.chat_auto_choices
  for select
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "chat_auto_choices: own insert" on public.chat_auto_choices;
create policy "chat_auto_choices: own insert"
  on public.chat_auto_choices
  for insert
  with check (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "chat_auto_choices: own delete" on public.chat_auto_choices;
create policy "chat_auto_choices: own delete"
  on public.chat_auto_choices
  for delete
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
