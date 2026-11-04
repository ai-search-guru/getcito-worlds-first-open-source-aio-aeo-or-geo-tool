-- ============================================================================
-- 00185: the AI bot report (AT-011)
-- ============================================================================
-- Spec §3.7, "AI bots reading your site": the verified AI-bot requests a
-- brand's Cloudflare or Vercel sent (00183), read from the bot × page × day
-- counters, which hold every request even past the month's cap:
--
--   * types — training crawlers, search crawlers and user fetches, reported
--     separately: hits, pages read and when last seen, with the bots seen;
--   * bots — the same per bot;
--   * pages — the most read pages, with when each type last read them (the
--     per-page last crawl);
--   * uncrawled — the alert "cited pages not read by any search bot in 30
--     days": pages tracked AI answers cited in the last 30 days that no
--     search crawler read in them. It only means something while the bot
--     data is whole, so it is null, and alert_state says why, until the
--     first request is 30 days old ('waiting'), and when no live connection
--     has sent for 2 days or search hits went on '(other)' rows past the
--     month's cap in those 30 days ('stale': a sender stopped, was revoked
--     or hit its raw cap, and the 30 days of pages read would drain).
--
-- "All time" (p_since null) covers the last 90 days here: a site crawled at
-- 10k pages a day keeps millions of rows over the counters' 400 days. The
-- rows are added up once by bot and page, and the first and last day come
-- from the ends of the (brand_id, day) index.
--
-- Pages are keyed as the Pages section keys them (00178). citation_urls has
-- no member select policy, so this runs as its owner after checking the
-- caller belongs to the brand's organization; a caller from elsewhere gets
-- nothing.

create or replace function public.ai_bot_report(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_first date;
  v_last_day date;
  v_last timestamptz;
  v_since date;
  v_alert text;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  select d.day into v_first
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id
  order by d.day
  limit 1;
  select d.day into v_last_day
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id
  order by d.day desc
  limit 1;
  select max(d.last_seen) into v_last
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id and d.day = v_last_day;

  v_since := coalesce(p_since, current_date - 89);

  v_alert := case
    when v_first is null or v_first > current_date - 29 then 'waiting'
    when not exists (
      select 1 from public.ai_bot_connections c
      where c.brand_id = p_brand_id
        and c.revoked_at is null
        and c.last_event_at >= now() - interval '2 days'
    ) or exists (
      select 1 from public.ai_bot_daily d
      where d.brand_id = p_brand_id
        and d.bot_type = 'search'
        and d.page = '(other)'
        and d.day >= current_date - 29
    ) then 'stale'
    else 'on'
  end;

  with g as (
    -- Each bot's hits on each page in the range, added up once.
    select
      d.bot_type,
      d.bot,
      d.page,
      sum(d.hits)::bigint as hits,
      max(d.last_seen) as last_seen
    from public.ai_bot_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_since
      and d.day <= p_until
    group by d.bot_type, d.bot, d.page
  ),
  types as (
    select
      g.bot_type,
      sum(g.hits)::bigint as hits,
      count(distinct g.page) filter (where g.page <> '(other)')::bigint as pages,
      max(g.last_seen) as last_seen,
      array_agg(distinct g.bot order by g.bot) as bots
    from g
    group by g.bot_type
  ),
  bots as (
    select
      g.bot,
      min(g.bot_type) as bot_type,
      sum(g.hits)::bigint as hits,
      count(*) filter (where g.page <> '(other)')::bigint as pages,
      max(g.last_seen) as last_seen
    from g
    group by g.bot
  ),
  -- Hits folded past the month's cap ('(other)') aren't a page.
  pages as (
    select
      g.page,
      sum(g.hits)::bigint as hits,
      max(g.last_seen) filter (where g.bot_type = 'training') as training_last,
      max(g.last_seen) filter (where g.bot_type = 'search') as search_last,
      max(g.last_seen) filter (where g.bot_type = 'user') as user_last
    from g
    where g.page <> '(other)'
    group by g.page
  ),
  -- The alert reads its own 30 days, whatever the range.
  uncrawled as (
    select c.page, c.citations
    from public.ai_traffic_page_citations(p_brand_id, current_date - 29, current_date) c
    where v_alert = 'on'
      and not exists (
        select 1 from public.ai_bot_daily d
        where d.brand_id = p_brand_id
          and d.bot_type = 'search'
          and d.page = c.page_key
          and d.day >= current_date - 29
      )
  )
  select jsonb_build_object(
    'first_day', v_first,
    'last_seen', v_last,
    'types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', t.bot_type, 'hits', t.hits, 'pages', t.pages,
          'last_seen', t.last_seen, 'bots', to_jsonb(t.bots)
        )
        order by array_position(array['training', 'search', 'user'], t.bot_type)
      )
      from types t
    ), '[]'::jsonb),
    'bots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bot', b.bot, 'type', b.bot_type, 'hits', b.hits, 'pages', b.pages,
          'last_seen', b.last_seen
        )
        order by b.hits desc, b.bot
      )
      from bots b
    ), '[]'::jsonb),
    'page_count', (select count(*) from pages),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.hits desc, p.page)
      from (select * from pages order by hits desc, page limit p_limit) p
    ), '[]'::jsonb),
    -- Null unless the bot data is whole (alert_state 'on').
    'uncrawled_count', case when v_alert = 'on' then (select count(*) from uncrawled) end,
    'uncrawled', case
      when v_alert = 'on' then coalesce((
        select jsonb_agg(to_jsonb(u) order by u.citations desc, u.page)
        from (select * from uncrawled order by citations desc, page limit 10) u
      ), '[]'::jsonb)
    end,
    'alert_state', v_alert,
    'alert_from', case when v_first is not null then v_first + 29 end,
    'since', v_since
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.ai_bot_report(uuid, date, date, integer) from public, anon;
grant execute on function public.ai_bot_report(uuid, date, date, integer)
  to authenticated, service_role;

comment on function public.ai_bot_report(uuid, date, date, integer) is
  'AI Traffic "AI bots reading your site" (AT-011, spec §3.7): verified AI-bot hits between two days by type (training, search, user) and by bot, the most read pages with each type''s last read, and the cited pages no search bot read in the last 30 days (null until 30 days of bot data). Security definer with an organization check.';

notify pgrst, 'reload schema';
