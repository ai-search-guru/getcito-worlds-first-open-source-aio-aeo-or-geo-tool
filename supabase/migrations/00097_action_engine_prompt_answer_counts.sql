-- Prompt and competitor stats count answers as well as days.
--
-- The library's detectors judged a prompt only once it had three days of
-- results. That kept one odd day from raising an action, and it also meant a
-- new brand saw nothing in the Action Center for three days: its first run
-- answers every prompt on every platform, but it is one day. `cur_answers`
-- lets a detector accept a prompt answered enough times, whichever days those
-- answers came from.
--
-- Additive: both functions return jsonb, and a caller that does not read the
-- new field is unaffected.

create or replace function public.ae_prompt_stats(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with days as (
    select prompt_id, day, bool_or(has_mention) as m, bool_or(has_citation) as c,
      sum(answer_count) as answers
    from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_prev_from and p_cur_to
    group by prompt_id, day
  ),
  active as (
    select p.id, p.topic_id
    from public.prompts p
    join public.prompt_sets s on s.id = p.prompt_set_id
    where s.brand_id = p_brand_id and p.is_active
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select a.id as prompt_id, a.topic_id,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to) as cur_days,
      coalesce(sum(d.answers) filter (where d.day between p_cur_from and p_cur_to), 0) as cur_answers,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to and d.m) as cur_mention_days,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to and d.c) as cur_citation_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to) as prev_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to and d.m) as prev_mention_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to and d.c) as prev_citation_days,
      max(d.day) filter (where d.m) as last_mention_day,
      max(d.day) filter (where d.c) as last_citation_day,
      (select coalesce(max(v.est_ai_volume), 0) from public.prompt_volumes v where v.prompt_id = a.id) as volume,
      exists (select 1 from public.prompt_target_urls t where t.prompt_id = a.id) as has_target_url
    from active a
    left join days d on d.prompt_id = a.id
    group by a.id, a.topic_id
  ) x
$$;

-- One row per (day, platform, model, region) the competitor appeared in, so
-- the count of rows is the count of answers naming it.
create or replace function public.ae_competitor_prompt_stats(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with days as (
    select prompt_id, competitor_id, day, count(*) as answers
    from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_prev_from and p_cur_to
    group by prompt_id, competitor_id, day
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select prompt_id, competitor_id,
      count(*) filter (where day between p_cur_from and p_cur_to) as cur_days,
      coalesce(sum(answers) filter (where day between p_cur_from and p_cur_to), 0) as cur_answers,
      count(*) filter (where day between p_prev_from and p_prev_to) as prev_days
    from days
    group by prompt_id, competitor_id
  ) x
$$;

revoke all on function public.ae_prompt_stats(uuid, date, date, date, date) from public, anon, authenticated;
revoke all on function public.ae_competitor_prompt_stats(uuid, date, date, date, date) from public, anon, authenticated;
grant execute on function public.ae_prompt_stats(uuid, date, date, date, date) to service_role;
grant execute on function public.ae_competitor_prompt_stats(uuid, date, date, date, date) to service_role;
