-- Action Center: signals (observation layer).
--
-- A signal is a meaningful detected change — not an action, not a task. The
-- rows here are produced nightly by the server from detectors that already
-- run in production (the Daily Pulse highlight/warning engine, #540, and the
-- page-opportunity engine, #719); this table gives those detections what the
-- pulse email cannot: a queryable lifecycle (new → acknowledged → resolved /
-- dismissed), dedup across nights, and a stable identity that a future
-- Action can reference (many signals → one action).
--
-- Display text is NOT stored: like the KPI registry, the signal kind maps to
-- i18n templates code-side, and `payload` carries the values those templates
-- interpolate. What IS stored is everything the page filters or aggregates
-- on: category, impact, status, source, timestamps.

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,

  -- Broad category (the page's tabs) and the specific detector kind.
  -- Text, not enums: adding a detector must not take a migration.
  category text not null
    check (category in ('visibility', 'citation', 'mention', 'traffic', 'technical', 'competitor')),
  kind text not null,

  impact text not null check (impact in ('high', 'medium', 'low')),
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'resolved', 'dismissed')),

  -- Producing systems, e.g. {ai_results}, {ga4,ai_results}.
  source text[] not null default '{}',

  -- One row per ongoing condition: re-detection updates last_detected_at
  -- instead of inserting a sibling. The key encodes the condition's
  -- identity (kind + entity), not the night it fired.
  dedup_key text not null,
  detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,

  -- The measured movement, in the kind's own unit (points, counts).
  previous_value numeric,
  current_value numeric,
  change_value numeric,

  -- Interpolation values for the i18n templates plus affected entities
  -- (prompts, urls, platforms, competitors) — shapes vary by kind.
  payload jsonb not null default '{}'::jsonb,

  -- Which configured KPIs this signal bears on (registry keys).
  kpi_keys text[] not null default '{}',

  -- Future Actions link (many signals → one action). Plain uuid until the
  -- actions table exists; the FK arrives with it.
  action_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (brand_id, dedup_key)
);

create index signals_brand_detected_idx
  on public.signals (brand_id, detected_at desc);
create index signals_brand_status_idx
  on public.signals (brand_id, status);

-- ─── Row level security ──────────────────────────────────────────────────────
-- Members read and triage (status changes are lightweight review work, not a
-- management decision); the service role writes detections.

alter table public.signals enable row level security;

create policy "signals: member select"
  on public.signals
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "signals: member update"
  on public.signals
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "Service role can insert signals"
  on public.signals
  for insert
  with check (true);

create policy "Service role can delete signals"
  on public.signals
  for delete
  using (true);

-- ─── Summary RPC ─────────────────────────────────────────────────────────────
-- Everything the page's summary strip and tab counts need in one round trip,
-- immune to the PostgREST 1000-row cap. Security invoker: RLS scopes the
-- table to the caller's org, so the function needs no guard of its own.

create or replace function public.signals_summary(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with windowed as (
    select * from public.signals
    where brand_id = p_brand_id
      and detected_at >= p_from
      and detected_at < p_to
  ),
  prev as (
    select count(*) as total
    from public.signals
    where brand_id = p_brand_id
      and detected_at >= p_from - (p_to - p_from)
      and detected_at < p_from
  )
  select jsonb_build_object(
    'total', (select count(*) from windowed),
    'prev_total', (select total from prev),
    'important', (select count(*) from windowed where impact = 'high'),
    'new', (select count(*) from windowed where status = 'new'),
    'resolved', (
      select count(*) from public.signals
      where brand_id = p_brand_id
        and resolved_at >= p_from
        and resolved_at < p_to
    ),
    'by_day', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select detected_at::date as day, count(*) as cnt
        from windowed
        group by 1
      ) d
    ),
    'by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (
        select category, count(*) as cnt from windowed group by 1
      ) c
    ),
    'by_source', (
      select coalesce(jsonb_object_agg(src, cnt), '{}'::jsonb)
      from (
        select unnest(source) as src, count(*) as cnt from windowed group by 1
      ) s
    )
  );
$$;
