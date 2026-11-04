-- ============================================================================
-- 00172: one visit per session in the tracking snippet's data (AT-003)
-- ============================================================================
-- The snippet sends a beacon on every AI-referred page load, so a reload, a
-- back-and-forward or a second link from the same answer was stored, and
-- counted, as another visit. Recent AI Referral Visits showed three
-- identical Gemini rows for one person, and every count on the AI Traffic
-- page was a pageview count (F5).
--
-- A visit is now a session, as Google Analytics counts one: the same
-- visitor (IP address and user agent) from the same AI platform, with less
-- than 30 minutes between pageviews. A different platform starts a new
-- visit, as a new traffic source starts a new session in GA4.
--
--   * visit_of is null on the row that starts a visit and holds that row's
--     id on each further pageview of it. The beacon route decides it when
--     it stores a pageview (backend/src/lib/trafficVisits.js); the rows
--     already stored are grouped below with the same rule.
--   * A row with no IP address or no user agent can't be matched to another,
--     so it is a visit of its own.
--   * Counting visits is counting rows where visit_of is null; pageviews are
--     still every row. The partial index keeps the visit counts and the
--     visit list on the rows they read.

alter table public.ai_traffic_logs
  add column if not exists visit_of uuid
    references public.ai_traffic_logs (id) on delete cascade;

comment on column public.ai_traffic_logs.visit_of is
  'Null when this pageview starts a visit; otherwise the id of the pageview that started it. Same IP address, user agent and platform, under 30 minutes apart (AT-003).';

with ordered as (
  select
    id,
    brand_id,
    source_platform,
    ip_address,
    user_agent,
    created_at,
    ip_address is null or user_agent is null
      or lag(created_at) over visitor is null
      or created_at - lag(created_at) over visitor >= interval '30 minutes' as starts
  from public.ai_traffic_logs
  window visitor as (
    partition by brand_id, source_platform, ip_address, user_agent
    order by created_at, id
  )
),
numbered as (
  select
    *,
    count(*) filter (where starts) over (
      partition by brand_id, source_platform, ip_address, user_agent
      order by created_at, id
      rows between unbounded preceding and current row
    ) as visit_no
  from ordered
),
firsts as (
  select
    id,
    starts,
    first_value(id) over (
      partition by brand_id, source_platform, ip_address, user_agent, visit_no
      order by created_at, id
    ) as first_id
  from numbered
)
update public.ai_traffic_logs l
set visit_of = f.first_id
from firsts f
where l.id = f.id
  and not f.starts;

create index if not exists idx_ai_traffic_logs_brand_visits
  on public.ai_traffic_logs (brand_id, created_at desc)
  where visit_of is null;

create index if not exists idx_ai_traffic_logs_visit_of
  on public.ai_traffic_logs (visit_of)
  where visit_of is not null;
