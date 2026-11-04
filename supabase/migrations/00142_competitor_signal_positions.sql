-- Where a competitor beats the brand, prompt by prompt (AC-001).
--
-- A competitor signal ("Profound is gaining fast", "… is mentioned far more
-- than you") said who and how much, never where: the panel is to show, per
-- prompt and platform, the competitor's position against the brand's, this
-- week and last. The daily rollups already hold mention positions per
-- prompt, platform and day for the brand (insights_prompt_daily) and per
-- competitor (insights_competitor_prompt_daily), so this reads those rather
-- than the answers, like the other ae_* detector reads (00091).
--
-- A position is the harmonic mean over the answers that name the entity:
-- position_count / sum_inv_position, from the same columns for both sides so
-- the two compare like with like. Only rows where the competitor is level
-- with or ahead of the brand (or the brand is not named) are evidence of a
-- competitor signal; those where it leads by most come first, and only the
-- first p_limit are returned per competitor.
--
-- plpgsql with force_custom_plan, as 00147, 00148 and 00152: a SQL-language
-- function is planned without its argument values, so the day range was a
-- guess. On the largest brand, with its 19 competitors over two weeks, the
-- read took 28.6 s that way and 0.16 s planned with its arguments.

create or replace function public.ae_competitor_positions(
  p_brand_id uuid,
  p_competitor_ids text[],
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_limit integer default 5
) returns jsonb
language plpgsql
stable
set search_path = public
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
begin
  with competitor as (
    select competitor_id, prompt_id, platform,
      sum(position_count) filter (where day between p_cur_from and p_cur_to) as cur_n,
      sum(sum_inv_position) filter (where day between p_cur_from and p_cur_to) as cur_inv,
      sum(position_count) filter (where day between p_prev_from and p_prev_to) as prev_n,
      sum(sum_inv_position) filter (where day between p_prev_from and p_prev_to) as prev_inv
    from insights_competitor_prompt_daily
    where brand_id = p_brand_id
      and competitor_id = any(p_competitor_ids)
      and day between p_prev_from and p_cur_to
      and platform is not null
    group by competitor_id, prompt_id, platform
  ),
  brand as (
    select prompt_id, platform,
      sum(position_count) filter (where day between p_cur_from and p_cur_to) as cur_n,
      sum(sum_inv_position) filter (where day between p_cur_from and p_cur_to) as cur_inv,
      sum(position_count) filter (where day between p_prev_from and p_prev_to) as prev_n,
      sum(sum_inv_position) filter (where day between p_prev_from and p_prev_to) as prev_inv
    from insights_prompt_daily
    where brand_id = p_brand_id
      and day between p_prev_from and p_cur_to
      and prompt_id in (select prompt_id from competitor)
      and platform is not null
    group by prompt_id, platform
  ),
  positions as (
    select c.competitor_id, c.prompt_id, c.platform,
      round(c.cur_n / nullif(c.cur_inv, 0), 1) as competitor_now,
      round(c.prev_n / nullif(c.prev_inv, 0), 1) as competitor_before,
      round(b.cur_n / nullif(b.cur_inv, 0), 1) as brand_now,
      round(b.prev_n / nullif(b.prev_inv, 0), 1) as brand_before
    from competitor c
    left join brand b on b.prompt_id = c.prompt_id and b.platform = c.platform
    where coalesce(c.cur_n, 0) > 0 and coalesce(c.cur_inv, 0) > 0
  ),
  ahead as (
    select * from positions
    where brand_now is null or competitor_now <= brand_now
  ),
  ranked as (
    select p.*, row_number() over (
      partition by p.competitor_id
      order by coalesce(p.brand_now, 99) - p.competitor_now desc, p.competitor_now, p.prompt_id
    ) as rank
    from ahead p
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'competitor_id', competitor_id,
      'prompt_id', prompt_id,
      'platform', platform,
      'competitor_now', competitor_now,
      'competitor_before', competitor_before,
      'brand_now', brand_now,
      'brand_before', brand_before
    ) order by competitor_id, rank
  ), '[]'::jsonb)
  into v_result
  from ranked
  where rank <= p_limit;

  return v_result;
end;
$$;

-- Service-role only, like the other detector reads.
revoke all on function public.ae_competitor_positions(uuid, text[], date, date, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.ae_competitor_positions(uuid, text[], date, date, date, date, integer)
  to service_role;
