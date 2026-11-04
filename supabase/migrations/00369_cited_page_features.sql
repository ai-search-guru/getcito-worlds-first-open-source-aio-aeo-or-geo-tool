-- ============================================================================
-- 00369: what the pages AI answers cite have (learning C1)
-- ============================================================================
-- The Action Center's "Analyze competitor content" task was a step for a
-- person: nothing read the competitor pages AI engines cite instead of the
-- brand. The task now reads them (server action-center/competitorPages.js):
-- the public pages cited in the brand's own tracked answers for the action's
-- prompts, and the brand's own page cited there, fetched free (safe-fetch,
-- never a paid scraper) and run through Site Audit's own rule checks
-- (structure, FAQ, schema, statistics, dates, length). Only what the checks
-- found is kept here, never the page's text, and nothing is summarised by AI.
--
-- One row per brand and page: read again after two weeks, and a day's reads
-- counted against the brand's daily cap. The server writes and reads it
-- (service role); members see what it found on the task.

create table if not exists public.cited_page_features (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- The page as Site Audit keys it: host and path, lower case.
  page_key text not null,
  url text not null,
  domain text not null,
  -- The brand's own page, cited for the same prompts.
  own boolean not null default false,
  -- { words, checks: { "<check key>": "pass" | "warn" | "fail" | "na" } }, or
  -- { unreadable: true[, disallowed: true] } for a page that couldn't be read
  -- (it blocks readers, a wall, robots.txt): kept so it counts against the
  -- day's reads and isn't tried again while fresh.
  features jsonb not null default '{}'::jsonb,
  read_at timestamptz not null default now(),
  unique (brand_id, page_key)
);

create index if not exists cited_page_features_brand_read_idx
  on public.cited_page_features (brand_id, read_at desc);

-- The server's alone: no member reads it directly.
alter table public.cited_page_features enable row level security;
revoke all on table public.cited_page_features from anon, authenticated;
grant all on table public.cited_page_features to service_role;

comment on table public.cited_page_features is
  'Learning C1 (00369): Site Audit rule checks of the pages cited in a brand''s tracked answers for an action''s prompts (competitors'' and its own), read free (safe-fetch). Features only, never page text. Server only.';

notify pgrst, 'reload schema';
