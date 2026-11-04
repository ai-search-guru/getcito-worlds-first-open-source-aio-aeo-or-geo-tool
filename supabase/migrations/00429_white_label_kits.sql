-- ============================================================================
-- 00429: White label — an agency's own brand on what it sends its clients
-- ============================================================================
-- An agency sends its clients reports with its own logo, color and name, not
-- GetCito's. The app uses a workspace's kit only when its plan has white
-- label (Growth and Enterprise) and the kit names a company or has a logo;
-- otherwise everything keeps GetCito's look, so a workspace without a kit,
-- or whose plan no longer has it, sees nothing change.
--
--   * The bucket white-label-logos: private. A workspace's logo under
--     {organization_id}/kit/, a brand's client logo under
--     {organization_id}/brands/{brand_id}/. PNG, JPEG or SVG, 1 MB an object.
--     Members have no policy on it, as on chat-files (00411): the app checks
--     the role, the plan and the brand, then gives a one-time upload address,
--     and short-lived signed addresses (or the image itself) to show one.
--   * white_label_kits: one row per workspace (Settings › White label): the
--     logo's object, the main color (#rrggbb), the company name and the
--     report footer, and who changed it last and when. Every member reads
--     it; only an Admin writes it. updated_by is stamped from the session,
--     so nobody can name someone else. No row = no kit.
--   * brands.client_logo_path: the client's logo for a brand's report cover
--     ("Prepared for {brand}"). It follows the brands policies: whoever sees
--     the brand reads it, Admins and Managers change it.

-- ─── The bucket ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'white-label-logos',
  'white-label-logos',
  false,
  1048576,
  array['image/png', 'image/jpeg', 'image/svg+xml']
)
-- Run again, it leaves the bucket as an admin may have set it.
on conflict (id) do nothing;

-- ─── A workspace's kit ──────────────────────────────────────────────────────

create table if not exists public.white_label_kits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- The logo's object in white-label-logos, in the workspace's own folder.
  logo_path text check (
    logo_path is null
    or (
      char_length(logo_path) between 1 and 300
      and starts_with(logo_path, organization_id::text || '/kit/')
    )
  ),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  company_name text check (company_name is null or char_length(company_name) between 1 and 100),
  footer_text text check (footer_text is null or char_length(footer_text) between 1 and 200),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_white_label_kits_updated_at on public.white_label_kits;
create trigger trg_white_label_kits_updated_at
  before update on public.white_label_kits
  for each row execute function public.handle_updated_at();

-- Who changed the kit: the session's person, whatever the write says. The
-- server's own writes (service role) keep the one they give.
create or replace function public.white_label_kits_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists white_label_kits_stamp on public.white_label_kits;
create trigger white_label_kits_stamp
  before insert or update on public.white_label_kits
  for each row execute function public.white_label_kits_stamp();

comment on table public.white_label_kits is
  'White label (00429): a workspace''s kit (Settings › White label): logo, main color, company name, report footer, who changed it and when. Used only on a plan with white_label and with a company name or a logo. Members read; Admins write.';
comment on column public.white_label_kits.logo_path is
  'The logo''s object in the private white-label-logos bucket, under {organization_id}/kit/.';
comment on column public.white_label_kits.accent_color is
  'The main color, #rrggbb in lower case; reports darken it where it would be too light to read.';

-- ─── A brand's client logo ──────────────────────────────────────────────────

alter table public.brands
  add column if not exists client_logo_path text;

alter table public.brands
  drop constraint if exists brands_client_logo_path_check;
alter table public.brands
  add constraint brands_client_logo_path_check
  check (
    client_logo_path is null
    or (
      char_length(client_logo_path) between 1 and 300
      and starts_with(client_logo_path, organization_id::text || '/brands/' || id::text || '/')
    )
  );

comment on column public.brands.client_logo_path is
  'White label (00429): the client''s logo for the brand''s report cover, in the private white-label-logos bucket under {organization_id}/brands/{brand_id}/. Follows the brands policies.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.white_label_kits enable row level security;

revoke all on table public.white_label_kits from anon, authenticated;
grant select, insert, update on table public.white_label_kits to authenticated;
grant all on table public.white_label_kits to service_role;

-- Members of the workspace read its kit.
drop policy if exists "white_label_kits: member select" on public.white_label_kits;
create policy "white_label_kits: member select"
  on public.white_label_kits
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Only its Admins write it.
drop policy if exists "white_label_kits: admin insert" on public.white_label_kits;
create policy "white_label_kits: admin insert"
  on public.white_label_kits
  for insert
  with check (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

drop policy if exists "white_label_kits: admin update" on public.white_label_kits;
create policy "white_label_kits: admin update"
  on public.white_label_kits
  for update
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  )
  with check (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

notify pgrst, 'reload schema';
