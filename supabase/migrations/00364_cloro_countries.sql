-- ============================================================================
-- 00364: the countries each tracking engine answers from (PROMPT-015e)
-- ============================================================================
-- The AI engines' provider (Cloro) supports a different set of countries per
-- engine, and asking an engine in a country it doesn't support fails. Its
-- GET /v1/countries?model= is the only source of truth, so the API reads it
-- daily, before the tracking runs, and keeps it here:
--
--   * the location picker offers only countries some engine answers from;
--   * the tracking run skips an engine in a country it doesn't support.
--
-- A model whose read fails keeps its last list. An empty table (no provider
-- key, or before the first read) restricts nothing.

create table if not exists public.cloro_countries (
  model text not null check (char_length(model) between 1 and 40),
  country text not null check (country ~ '^[A-Z]{2}$'),
  refreshed_at timestamptz not null default now(),
  primary key (model, country)
);

alter table public.cloro_countries enable row level security;
revoke all on table public.cloro_countries from anon, authenticated;
grant select on table public.cloro_countries to authenticated;
grant all on table public.cloro_countries to service_role;

-- Not a customer's data: every signed-in member may read it; the API writes.
drop policy if exists "cloro_countries: read" on public.cloro_countries;
create policy "cloro_countries: read" on public.cloro_countries
  for select to authenticated using (true);

comment on table public.cloro_countries is
  'Countries each tracking engine answers from (PROMPT-015e, 00364), read daily from the provider''s GET /v1/countries?model=. Empty restricts nothing.';

notify pgrst, 'reload schema';
