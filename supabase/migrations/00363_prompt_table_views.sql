-- ============================================================================
-- 00363: Tracked Prompts column views (PROMPT-015a)
-- ============================================================================
-- The Tracked Prompts table's columns, as a person set them: which are shown
-- and in what order. One row per person and brand, and one row per brand
-- (user_id null) for the view an admin or manager shared with everyone on it.
-- A person without a row of their own sees the brand's; without that,
-- today's default. `columns` is `{ "order": [ids], "hidden": [ids] }`; ids
-- the web doesn't know are ignored when read.

create table if not exists public.prompt_table_views (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Null: the brand's shared view.
  user_id uuid references auth.users(id) on delete cascade,
  columns jsonb not null check (jsonb_typeof(columns) = 'object' and pg_column_size(columns) <= 8192),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (brand_id, user_id)
);

alter table public.prompt_table_views enable row level security;
revoke all on table public.prompt_table_views from anon, authenticated;
grant select, insert, update, delete on table public.prompt_table_views to authenticated;
grant all on table public.prompt_table_views to service_role;

-- Members of the brand's organization read their own view and the brand's.
drop policy if exists "prompt_table_views: member select" on public.prompt_table_views;
create policy "prompt_table_views: member select" on public.prompt_table_views
  for select using (
    (user_id is null or user_id = auth.uid())
    and brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- A member writes their own view; an admin or manager writes the brand's.
drop policy if exists "prompt_table_views: write" on public.prompt_table_views;
create policy "prompt_table_views: write" on public.prompt_table_views
  for all using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and (
          prompt_table_views.user_id = auth.uid()
          or (prompt_table_views.user_id is null and p.role in ('admin', 'manager'))
        )
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and (
          prompt_table_views.user_id = auth.uid()
          or (prompt_table_views.user_id is null and p.role in ('admin', 'manager'))
        )
    )
  );

comment on table public.prompt_table_views is
  'Tracked Prompts columns (PROMPT-015a, 00363): a person''s shown and ordered columns per brand, and the brand''s shared view (user_id null) set by an admin or manager.';

notify pgrst, 'reload schema';
