-- ============================================================================
-- 00182: Google queries you don't track yet (AT-009)
-- ============================================================================
-- Spec §3.6: the top Search Console queries by clicks that match no tracked
-- prompt, to track with one click. This reads the queries with clicks in
-- the window, most clicks first. Which of them a prompt already covers is
-- the server's call (backend/src/lib/untrackedQueries.js), with the rule
-- Prompt Suggestions uses for Google queries, so the two pages agree.
--
-- Google reports about two days late: with p_latest the window ends on the
-- latest day it has reported, keeping its length (§3.01), as the Google
-- clicks card's does (00174). All time (p_since null) reads every day kept.
-- At most p_limit queries; `capped` says there were more.
--
-- Security invoker: gsc_query_stats has a member select policy, so RLS
-- decides the brand. The server reads it as the service role, after
-- checking the member's access to the brand.

create or replace function public.ai_traffic_google_queries(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_latest boolean default false,
  p_limit integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_last date;
  v_since date;
  v_until date;
  v_rows jsonb;
  v_count integer;
begin
  select max(g.date) into v_last from public.gsc_query_stats g where g.brand_id = p_brand_id;
  if v_last is null then
    return jsonb_build_object(
      'last_day', null, 'since', null, 'until', null, 'capped', false, 'rows', '[]'::jsonb
    );
  end if;

  v_since := p_since;
  v_until := p_until;
  if p_latest and v_last < p_until then
    v_until := v_last;
    if p_since is not null then
      v_since := v_last - (p_until - p_since);
    end if;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object('query', q.query, 'clicks', q.clicks, 'impressions', q.impressions)
      order by q.clicks desc, q.impressions desc, q.query
    ), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select g.query, sum(g.clicks)::bigint as clicks, sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = p_brand_id
      and g.date >= coalesce(v_since, '-infinity'::date)
      and g.date <= v_until
    group by g.query
    having sum(g.clicks) > 0
    order by sum(g.clicks) desc, sum(g.impressions) desc, g.query
    limit greatest(p_limit, 0) + 1
  ) q;

  if v_count > p_limit then
    v_rows := v_rows - p_limit;
  end if;

  return jsonb_build_object(
    'last_day', v_last,
    'since', v_since,
    'until', v_until,
    'capped', v_count > p_limit,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.ai_traffic_google_queries(uuid, date, date, boolean, integer)
  from public, anon;
grant execute on function public.ai_traffic_google_queries(uuid, date, date, boolean, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_google_queries(uuid, date, date, boolean, integer) is
  'AI Traffic "Google queries you don''t track yet" (AT-009, spec §3.6): Search Console queries with clicks between two days, most clicks first, at most p_limit (capped says there were more). p_latest ends the window on Google''s latest reported day. The server drops the ones a tracked prompt covers. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
