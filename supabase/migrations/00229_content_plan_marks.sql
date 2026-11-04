-- ============================================================================
-- 00229: the Content plan's row marks — priority and hidden (CE-014)
-- ============================================================================
-- The Plan's priority list is built on each read (content_plan_pages, 00221,
-- and the brand's open opportunities), so a row has no row of its own to
-- keep a choice on. Admins and managers mark a row as a priority, or hide
-- it, per brand:
--
--   * content_plan_marks: one row per brand and Plan row, keyed as the app
--     keys the rows: 'opportunity:<id>' or 'page:<host/path>'. priority puts
--     the row at the top of the list with a Priority tag; hidden_at takes it
--     off the list until someone shows it again. Hiding an opportunity's row
--     also dismisses the opportunity (the app does it through its status),
--     so the Opportunities page agrees; restore_status is the status it had,
--     given back when the row is shown again.
--   * Members of the brand's organization read the marks; admins and managers
--     write them, as they do the workspace's rule sets (00214).

create table if not exists public.content_plan_marks (
  brand_id uuid not null references public.brands(id) on delete cascade,
  row_key text not null check (char_length(row_key) between 1 and 600),
  priority boolean not null default false,
  hidden_at timestamptz,
  restore_status text check (restore_status in ('new', 'reviewed', 'sent', 'in_progress')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (brand_id, row_key)
);

alter table public.content_plan_marks enable row level security;

create policy "content_plan_marks: member select"
  on public.content_plan_marks
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "content_plan_marks: manager insert"
  on public.content_plan_marks
  for insert
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and updated_by = auth.uid()
  );

create policy "content_plan_marks: manager update"
  on public.content_plan_marks
  for update
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and updated_by = auth.uid()
  );

grant select, insert, update on public.content_plan_marks to authenticated;

comment on table public.content_plan_marks is
  'Content Editor (CE-014): an admin''s or manager''s marks on a Content plan row — priority (top of the list) or hidden (off it until shown again), with the opportunity''s status to give back.';
