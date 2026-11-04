-- Site Audit Opportunities (SA-004): pages a team pins or excludes.
--
-- The Opportunities inbox lists a brand's pages worth auditing. A team can
-- pin a page (kept at the top, and always in the auto-audit runs of SA-006)
-- or exclude it (left out of the inbox and the runs). One row per page; no
-- row means neither.
--
-- page_key is the page as the Pages list groups audits (history.js pageKey):
-- the host without "www." and the path without a trailing slash, lowercased,
-- so every spelling of a page shares its row. url keeps one full URL of the
-- page, to audit it and to show it.

create table if not exists public.site_audit_page_prefs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  page_key text not null,
  url text not null,
  state text not null check (state in ('pinned', 'excluded')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, page_key)
);

alter table public.site_audit_page_prefs enable row level security;

-- Org members, as for site_audits (00017). The server writes with the
-- service role; members may read.
create policy site_audit_page_prefs_member_select on public.site_audit_page_prefs
  for select using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
