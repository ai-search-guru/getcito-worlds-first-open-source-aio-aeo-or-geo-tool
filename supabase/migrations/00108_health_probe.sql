-- Daily health report: time the dashboard's heaviest reads.
--
-- The Citations page once stopped opening on the largest brand: one read had
-- drifted past the 8 s statement timeout, and only a user noticed. The daily
-- health report (backend/src/lib/health) times those reads every morning and
-- flags any that are getting close.
--
-- Most of them check membership through auth.uid(), so a service-role call
-- would return nothing in no time. health_probe runs one read the way the
-- page does — as the `authenticated` role, with a given organization
-- member's claims, both for this transaction only — and returns how long it
-- took. The role matters as much as the claims: run with row security
-- bypassed, the Competitors read planned differently and ran past 120 s,
-- against 6.9 s as the page runs it. Only the server's service role may call
-- it, and only for the reads named below.

create or replace function public.health_probe(
  p_user_id uuid,
  p_brand_id uuid,
  p_probe text,
  p_days integer default null
)
returns numeric
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  t0 timestamptz;
  ts_from timestamptz := case when p_days is null then null else now() - make_interval(days => p_days) end;
  day_from date := (now() at time zone 'utc')::date - coalesce(p_days, 0);
  n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  t0 := clock_timestamp();

  case p_probe
    when 'citations_window_stats' then
      select count(*) into n from public.citations_window_stats(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_domains' then
      select count(*) into n from public.citations_domains(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_urls' then
      select count(*) into n from public.citations_urls(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null,
        p_limit => 100, p_domains => null, p_exclude_domains => null);
    when 'insights_aggregates_daily' then
      select count(*) into n from public.insights_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'competitor_aggregates_daily' then
      select count(*) into n from public.competitor_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'topics_overview_aggregates' then
      select count(*) into n from public.topics_overview_aggregates(p_brand_id => p_brand_id);
    else
      raise exception 'unknown health probe: %', p_probe;
  end case;

  return round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end;
$$;

revoke all on function public.health_probe(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.health_probe(uuid, uuid, text, integer) to service_role;
