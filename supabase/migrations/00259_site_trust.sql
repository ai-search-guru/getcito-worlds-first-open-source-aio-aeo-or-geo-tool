-- ============================================================================
-- 00259: a brand's site trust (Content Editor Quality, CE-043)
-- ============================================================================
-- Site trust (Quality spec §8): five site-level checks Site Audit shows as
-- "Site trust {n}/5", and Trust gives 5 points on every page from:
--
--   * about: an About page;
--   * contact: a Contact page;
--   * editorial: an editorial policy (or "How we review") page;
--   * organizationSchema: Organization schema on the home page;
--   * authorPages: a page for each author in Settings › Authors.
--
-- The server reads them from the brand's page list (site_pages), its home
-- page and its authors, at most once a day or when someone asks again; this
-- is the last read. complete is false when the site didn't answer all of it
-- (slow, unreachable, a server error, a bot wall): such a read is read again
-- after a few minutes. scraped_at is when the home page last went through
-- Scrape.do, past a bot wall: at most once a day per brand, one credit.
-- Members read it; only the server writes it.

create table if not exists public.site_trust (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  checks jsonb not null,
  score smallint not null check (score between 0 and 5),
  complete boolean not null default true,
  checked_at timestamptz not null default now(),
  scraped_at timestamptz
);

-- For a database that ran this file before scraped_at was added to it.
alter table public.site_trust add column if not exists scraped_at timestamptz;

alter table public.site_trust enable row level security;
revoke all on table public.site_trust from anon, authenticated;
grant select on table public.site_trust to authenticated;
grant all on table public.site_trust to service_role;

drop policy if exists "site_trust: member select" on public.site_trust;
create policy "site_trust: member select"
  on public.site_trust
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.site_trust is
  'Content Editor Quality (CE-043): a brand''s five site trust checks (About, Contact, editorial policy, Organization schema on the home page, author pages) and how many pass. Written by the server, read by members.';
