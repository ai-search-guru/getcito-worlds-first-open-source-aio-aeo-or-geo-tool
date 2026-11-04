-- ============================================================================
-- 00459: Chat's memory — what Chat remembers between chats, for a person, a
-- brand and the workspace
-- ============================================================================
-- Memory (CHAT-14, Wave 3), behind CHAT_AGENTIC: nothing reads or writes
-- these while the flag is off. Nothing is saved without a click (CHAT-14
-- item 10). The server writes every row (service role), after checking the
-- text (no secrets, personal data or rule changes, item 12), who may edit
-- the scope (item 25) and the confirm card's token.
--
--   * chat_memory_items: one remembered line:
--       - scope: user ("Me": one person's, in their workspace), brand (one
--         brand's facts and rules) or workspace (rules for every brand and
--         member).
--       - text: 1–300 characters (item 19); at most 4,000 characters a
--         scope, a person's Me or a brand's or the workspace's: the trigger
--         below holds it, under a lock per scope, so two saves at once can't
--         both fit.
--       - source: profile ("Call me {first name}", Me only, once a person),
--         chat (saved from a confirm card) or page (written on the Memory
--         page); source_ref names where; edited stops the profile sync.
--       - deleted_at: deleted, with Undo for 10 seconds (item 23); the
--         server deletes it for good after that. A deleted line counts for
--         nothing and nobody reads it.
--     A brand's lines go with the brand, a person's Me lines with their
--     account, and with their leaving the workspace (item 26, the trigger
--     on profiles below).
--   * chat_settings.memory_enabled: the workspace's switch (an Admin's);
--     off hides Memory for everyone (item 24).
--   * chat_user_prefs.memory_enabled: the person's "Use memory" (item 24).
--     Both start on (Wave 3 decision 1).

-- ─── Memory ─────────────────────────────────────────────────────────────────

create table if not exists public.chat_memory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null check (scope in ('user', 'brand', 'workspace')),
  -- Whose Me line it is (scope user only).
  user_id uuid references auth.users(id) on delete cascade,
  -- Whose brand line it is (scope brand only): it goes with the brand.
  brand_id uuid references public.brands(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  source text not null check (source in ('profile', 'chat', 'page')),
  -- Where it came from: the chat, or the profile field.
  source_ref text check (char_length(source_ref) between 1 and 200),
  -- A person changed it: the profile no longer rewrites it (item 4).
  edited boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deleted, while Undo is open (item 23).
  deleted_at timestamptz,
  check ((scope = 'user') = (user_id is not null)),
  check ((scope = 'brand') = (brand_id is not null)),
  check (source <> 'profile' or scope = 'user')
);

-- A scope's lines and what they hold: a person's Me, a brand's, the workspace's.
create index if not exists chat_memory_items_user_idx
  on public.chat_memory_items (user_id, organization_id) where user_id is not null;
create index if not exists chat_memory_items_brand_idx
  on public.chat_memory_items (brand_id) where brand_id is not null;
create index if not exists chat_memory_items_organization_scope_idx
  on public.chat_memory_items (organization_id, scope);
create index if not exists chat_memory_items_created_by_idx
  on public.chat_memory_items (created_by) where created_by is not null;
-- One "Call me {first name}" a person.
create unique index if not exists chat_memory_items_profile_uidx
  on public.chat_memory_items (user_id)
  where source = 'profile' and deleted_at is null;

drop trigger if exists trg_chat_memory_items_updated_at on public.chat_memory_items;
create trigger trg_chat_memory_items_updated_at
  before update on public.chat_memory_items
  for each row execute function public.handle_updated_at();

comment on table public.chat_memory_items is
  'Chat (00459): what Chat remembers (CHAT-14): a person''s Me lines, a brand''s and the workspace''s; 300 characters a line, 4,000 a scope; from the profile, a chat''s confirm card or the Memory page; deleted with Undo. Me: only its person; brand: who can access the brand; workspace: every member. The server writes.';
comment on column public.chat_memory_items.deleted_at is
  'Deleted, while Undo is open (CHAT-14 item 23); the server deletes the row for good after 10 seconds. A deleted line counts toward no limit and is read by nobody.';

-- At most 4,000 characters a scope (CHAT-14 item 19): a person's Me lines
-- in their workspace, a brand's, the workspace's. Deleted lines don't count.
-- A line already counted may still be shortened when a scope is over (a
-- lower limit later). The lock makes two saves to one scope take turns.
create or replace function public.chat_memory_items_scope_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_used integer;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(
    'chat_memory:' || new.organization_id::text || ':' || new.scope || ':'
      || coalesce(new.user_id::text, '') || ':' || coalesce(new.brand_id::text, '')
  ));

  select coalesce(sum(char_length(m.text)), 0) into v_used
  from public.chat_memory_items m
  where m.id <> new.id
    and m.deleted_at is null
    and m.organization_id = new.organization_id
    and m.scope = new.scope
    and m.user_id is not distinct from new.user_id
    and m.brand_id is not distinct from new.brand_id;

  if v_used + char_length(new.text) > 4000 then
    if tg_op = 'UPDATE'
      and old.deleted_at is null
      and old.organization_id = new.organization_id
      and old.scope = new.scope
      and old.user_id is not distinct from new.user_id
      and old.brand_id is not distinct from new.brand_id
      and char_length(new.text) <= char_length(old.text)
    then
      return new;
    end if;
    raise exception 'memory is full: a scope holds at most 4,000 characters'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_memory_items_scope_limit on public.chat_memory_items;
create trigger trg_chat_memory_items_scope_limit
  before insert or update of text, scope, organization_id, user_id, brand_id, deleted_at
  on public.chat_memory_items
  for each row execute function public.chat_memory_items_scope_limit();

-- A person's Me lines go when they leave the workspace or move to another
-- (CHAT-14 item 26); an account's go with it (user_id's cascade). Security
-- definer, as 00388's forget_profile_member_brands: a person's own update
-- (joining the organization they just created) fires it too, and people
-- can't write chat_memory_items.
create or replace function public.forget_profile_chat_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chat_memory_items m
  where m.user_id = new.id
    and m.scope = 'user'
    and m.organization_id is distinct from new.organization_id;
  return null;
end;
$$;

revoke all on function public.forget_profile_chat_memory() from public, anon, authenticated;

drop trigger if exists profiles_forget_chat_memory on public.profiles;
create trigger profiles_forget_chat_memory
  after update of organization_id on public.profiles
  for each row
  when (old.organization_id is distinct from new.organization_id)
  execute function public.forget_profile_chat_memory();

-- ─── The switches ───────────────────────────────────────────────────────────

alter table public.chat_settings
  add column if not exists memory_enabled boolean not null default true;

comment on column public.chat_settings.memory_enabled is
  'Memory for the workspace (CHAT-14 item 24), an Admin''s switch: off, no prompt has a memory block and Memory is hidden for everyone. On by default (Wave 3 decision 1).';

alter table public.chat_user_prefs
  add column if not exists memory_enabled boolean not null default true;

comment on column public.chat_user_prefs.memory_enabled is
  'The person''s "Use memory" (CHAT-14 item 24): off, their prompts have no memory block and Chat offers no saves. On by default (Wave 3 decision 1).';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_memory_items enable row level security;
revoke all on table public.chat_memory_items from anon, authenticated;
grant select on table public.chat_memory_items to authenticated;
grant all on table public.chat_memory_items to service_role;

-- Me: only its person, in the workspace they belong to now (CHAT-14 item 1:
-- Admins included). A Me line has no brand.
drop policy if exists "chat_memory_items: own select" on public.chat_memory_items;
create policy "chat_memory_items: own select"
  on public.chat_memory_items
  for select
  to authenticated
  using (
    scope = 'user'
    and user_id = auth.uid()
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

-- A brand's lines: whoever can access the brand (Analysts and Agency
-- partners read them, item 25).
drop policy if exists "chat_memory_items: brand select" on public.chat_memory_items;
create policy "chat_memory_items: brand select"
  on public.chat_memory_items
  for select
  to authenticated
  using (
    scope = 'brand'
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and brand_id in (select public.user_brand_ids())
  );

-- The workspace's lines: every member, whatever brands they see. They are
-- rules for every brand and member, no brand's data: a brand's facts go in
-- its own lines.
drop policy if exists "chat_memory_items: workspace select" on public.chat_memory_items;
create policy "chat_memory_items: workspace select"
  on public.chat_memory_items
  for select
  to authenticated
  using (
    scope = 'workspace'
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

notify pgrst, 'reload schema';
