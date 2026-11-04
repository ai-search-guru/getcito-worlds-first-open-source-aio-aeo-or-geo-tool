-- ============================================================================
-- 00183: AI bots reading the site — ingestion and its hard caps (AT-010, part A)
-- ============================================================================
-- Spec §3.7 and §6: which AI bots read the brand's pages, sent from the
-- customer's own Cloudflare or Vercel. A request counts only when its user
-- agent names a bot on the list (backend/src/lib/ai-bots.json) and its IP is
-- in that operator's published ranges; the server checks both before
-- writing, and keeps no IP.
--
--   * ai_bot_connections — one per way a brand sends events (a Cloudflare
--     Worker, a Logpush job, a Vercel drain), each with its own secret.
--     Only the secret's SHA-256 is kept; the person sees it once.
--   * ai_bot_events — one row per verified request, kept 90 days.
--   * ai_bot_daily — bot × page × day counters, always added to. When the
--     month's cap is reached they are all that is written ("Detailed rows
--     paused until Nov 1, totals still counted", §6.3), and past it a bot's
--     hits of the day go on one '(other)' row instead of a row per page:
--     crawler hits are mostly a page, day and bot of their own, so page rows
--     would grow by about one per event. The cap is then a hard ceiling on
--     what is stored.
--   * ai_bot_usage — per organization (the workspace) and month: rows
--     stored, events counted, when the cap was reached, and when the 80%
--     alert fired (§6.3 guardrails).
--
-- Members read their brands' events, counters and connections (all but the
-- secret's hash); only the service role writes.

create table public.ai_bot_connections (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands(id) on delete cascade,
    kind text not null check (kind in ('cloudflare_worker', 'cloudflare_logpush', 'vercel_drain')),
    secret_hash text not null unique,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    last_event_at timestamptz,
    revoked_at timestamptz
);

create index ai_bot_connections_brand_idx on public.ai_bot_connections (brand_id);

create table public.ai_bot_events (
    id bigint generated always as identity primary key,
    brand_id uuid not null references public.brands(id) on delete cascade,
    bot text not null,
    bot_type text not null check (bot_type in ('training', 'search', 'user')),
    -- The path, as the Pages section keys pages (lower(normalize_page_path)).
    page text not null,
    status smallint,
    country text,
    occurred_at timestamptz not null,
    received_at timestamptz not null default now()
);

create index ai_bot_events_brand_time_idx on public.ai_bot_events (brand_id, occurred_at desc);
-- The daily prune deletes by time across every brand.
create index ai_bot_events_time_idx on public.ai_bot_events (occurred_at);

create table public.ai_bot_daily (
    brand_id uuid not null references public.brands(id) on delete cascade,
    day date not null,
    bot text not null,
    bot_type text not null check (bot_type in ('training', 'search', 'user')),
    page text not null,
    hits integer not null default 0,
    last_seen timestamptz not null,
    primary key (brand_id, day, bot, page)
);

create index ai_bot_daily_brand_day_idx on public.ai_bot_daily (brand_id, day desc);
create index ai_bot_daily_day_idx on public.ai_bot_daily (day);

create table public.ai_bot_usage (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    month date not null,
    stored_events bigint not null default 0,
    counted_events bigint not null default 0,
    capped_at timestamptz,
    alerted_at timestamptz,
    primary key (organization_id, month)
);

alter table public.ai_bot_connections enable row level security;
alter table public.ai_bot_events enable row level security;
alter table public.ai_bot_daily enable row level security;
alter table public.ai_bot_usage enable row level security;

create policy "ai_bot_connections: member select" on public.ai_bot_connections
    for select using (
        brand_id in (
            select b.id
            from public.brands b
            join public.profiles p on p.organization_id = b.organization_id
            where p.id = auth.uid()
        )
    );

create policy "ai_bot_events: member select" on public.ai_bot_events
    for select using (
        brand_id in (
            select b.id
            from public.brands b
            join public.profiles p on p.organization_id = b.organization_id
            where p.id = auth.uid()
        )
    );

create policy "ai_bot_daily: member select" on public.ai_bot_daily
    for select using (
        brand_id in (
            select b.id
            from public.brands b
            join public.profiles p on p.organization_id = b.organization_id
            where p.id = auth.uid()
        )
    );

create policy "ai_bot_usage: member select" on public.ai_bot_usage
    for select using (
        organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    );

-- The secret's hash stays with the server: members read every other column.
revoke all on public.ai_bot_connections from anon, authenticated;
grant select (id, brand_id, kind, created_by, created_at, last_event_at, revoked_at)
    on public.ai_bot_connections to authenticated;
grant select on public.ai_bot_events to authenticated;
grant select on public.ai_bot_daily to authenticated;
grant select on public.ai_bot_usage to authenticated;

-- ─── One batch of verified events, within the month's cap ──────────────────
--
-- p_events: [{bot, bot_type, page, status, country, at}], already verified;
-- `page` is the request's URL or path, keyed here as the Pages section keys
-- pages (lower(normalize_page_path), 00178).
-- The usage row is locked for the batch, so two batches for one
-- organization can't both take the last of its room. Rows are stored while
-- the month has room (p_cap < 0: no cap; 0: none stored); counters are
-- always added, by page for the events stored and on the bot's '(other)' row
-- of the day for the rest. Returns what was received and stored, the month's use, and
-- whether this batch took it past 80% of the cap (the server alerts once).

create or replace function public.ai_bot_ingest(
  p_connection_id uuid,
  p_cap bigint,
  p_events jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_brand uuid;
  v_org uuid;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_used bigint;
  v_received integer := coalesce(jsonb_array_length(p_events), 0);
  v_room bigint;
  v_stored integer := 0;
  v_alerted timestamptz;
  v_crossed boolean := false;
begin
  select c.brand_id, b.organization_id into v_brand, v_org
  from public.ai_bot_connections c
  join public.brands b on b.id = c.brand_id
  where c.id = p_connection_id and c.revoked_at is null;
  if v_brand is null then
    return jsonb_build_object('error', 'connection');
  end if;

  insert into public.ai_bot_usage (organization_id, month)
  values (v_org, v_month)
  on conflict (organization_id, month) do nothing;

  select u.stored_events, u.alerted_at into v_used, v_alerted
  from public.ai_bot_usage u
  where u.organization_id = v_org and u.month = v_month
  for update;

  v_room := case when p_cap < 0 then v_received else greatest(0, least(v_received, p_cap - v_used)) end;

  if v_room > 0 then
    insert into public.ai_bot_events (brand_id, bot, bot_type, page, status, country, occurred_at)
    select
      v_brand,
      x.ev ->> 'bot',
      x.ev ->> 'bot_type',
      lower(public.normalize_page_path(x.ev ->> 'page')),
      (x.ev ->> 'status')::smallint,
      x.ev ->> 'country',
      (x.ev ->> 'at')::timestamptz
    from jsonb_array_elements(p_events) with ordinality as x(ev, n)
    order by x.n
    limit v_room;
    get diagnostics v_stored = row_count;
  end if;

  insert into public.ai_bot_daily (brand_id, day, bot, bot_type, page, hits, last_seen)
  select v_brand, e.day, e.bot, min(e.bot_type), e.page, count(*), max(e.at)
  from (
    select
      (r.at at time zone 'utc')::date as day,
      r.bot,
      r.bot_type,
      case
        when x.n <= v_room then lower(public.normalize_page_path(r.page))
        else '(other)'
      end as page,
      r.at
    from jsonb_array_elements(p_events) with ordinality as x(ev, n)
    cross join lateral jsonb_to_record(x.ev)
      as r(bot text, bot_type text, page text, at timestamptz)
  ) e
  group by e.day, e.bot, e.page
  on conflict (brand_id, day, bot, page) do update
    set hits = public.ai_bot_daily.hits + excluded.hits,
        last_seen = greatest(public.ai_bot_daily.last_seen, excluded.last_seen);

  v_crossed := p_cap > 0 and v_alerted is null and v_used + v_stored >= 0.8 * p_cap;

  update public.ai_bot_usage u
  set stored_events = u.stored_events + v_stored,
      counted_events = u.counted_events + v_received,
      capped_at = case
        when p_cap >= 0 and u.capped_at is null and v_stored < v_received then now()
        else u.capped_at
      end,
      alerted_at = case when v_crossed then now() else u.alerted_at end
  where u.organization_id = v_org and u.month = v_month;

  update public.ai_bot_connections c
  set last_event_at = now()
  where c.id = p_connection_id and v_received > 0;

  return jsonb_build_object(
    'brand_id', v_brand,
    'organization_id', v_org,
    'received', v_received,
    'stored', v_stored,
    'used', v_used + v_stored,
    'cap', p_cap,
    'crossed80', v_crossed
  );
end;
$$;

revoke all on function public.ai_bot_ingest(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.ai_bot_ingest(uuid, bigint, jsonb) to service_role;

comment on function public.ai_bot_ingest(uuid, bigint, jsonb) is
  'AI bots (AT-010, spec §6.3): one batch of verified bot events for a connection. Stores rows while the organization''s month has room under p_cap (<0 = no cap), always adds bot × page × day counters, and reports whether the batch crossed 80% of the cap. Locks the usage row so concurrent batches cannot exceed it. Service role only.';

notify pgrst, 'reload schema';
